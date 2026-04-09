#!/usr/bin/env python3
"""Unified lyrics API server.

Modes:
  1) Serve local API (default):
     python lyrics_api_server.py
     PORT=8787 python lyrics_api_server.py serve --port 8787
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Iterable
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup
from bs4.element import Tag

DEFAULT_SELECTOR = (
    "#ritmo-portal > div:nth-child(1) > div > div:nth-child(1) > div:nth-child(1) > "
    "div.css-g5y9jx.r-1smwm8v > div > div > div:nth-child(2) > "
    "div.css-g5y9jx.r-13awgt0.r-eqz5dr.r-1v1z2uz"
)

DEFAULT_RATING_SELECTOR = (
    "#ritmo-portal > div:nth-child(1) > div > div:nth-child(1) > div:nth-child(1) > "
    "div.css-g5y9jx.r-1smwm8v > div > div > div:nth-child(1) > "
    "div.css-g5y9jx.r-13awgt0.r-eqz5dr.r-1v1z2uz"
)

FALLBACK_SELECTORS = (
    '[data-testid="lyrics-track"]',
    '[data-testid="lyrics-container"]',
    "#root > main > div > div > div > div > div > div > div > div > div > div > div",
    "#ritmo-portal > div > div > div > div > div > div > div > div > div",
    '#ritmo-portal div[class*="lyrics"]',
    'article[class*="lyrics"]',
)

RATING_FALLBACK_SELECTORS = (
    '[data-testid="content-rating"]',
    '[data-testid="lyrics-rating"]',
    '[class*="content-rating"]',
    '[class*="lyrics-rating"]',
    "#ritmo-portal span",
)

CONTENT_RATING_PATTERN = re.compile(
    r"\b(?:rating\s*)?(G|PG-13|PG13|PG|R|NC-17|NC17)\b",
    re.IGNORECASE,
)

REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


class LyricsFetchError(RuntimeError):
    """Raised when lyrics cannot be fetched or parsed."""


@dataclass(frozen=True)
class LyricsResult:
    url: str
    selector_used: str
    lyrics: str
    content_rating: str | None
    rating_selector_used: str | None


def slugify_for_musixmatch(value: str) -> str:
    value = str(value or "").strip()
    value = re.sub(r"[,&/+]+", " ", value)
    value = "".join(ch for ch in value if ch.isalnum() or ch in {" ", "-"})
    value = re.sub(r"\s+", "-", value)
    value = re.sub(r"-+", "-", value)
    value = value.strip("-")
    return value or "Unknown"


def build_musixmatch_url(artist: str, song: str) -> str:
    artist_slug = slugify_for_musixmatch(artist)
    song_slug = slugify_for_musixmatch(song)
    return f"https://www.musixmatch.com/lyrics/{artist_slug}/{song_slug}"


def clean_lyrics_text(text: str) -> str:
    lines = [line.strip() for line in text.splitlines()]
    lines = [line for line in lines if line]
    return "\n".join(lines)


def looks_like_lyrics(text: str) -> bool:
    if not text:
        return False

    line_count = text.count("\n") + 1
    char_count = len(text)

    if char_count < 50:
        return False
    if line_count < 3:
        return False

    return True


def text_from_tag(node: Tag) -> str:
    raw = node.get_text("\n", strip=True)
    return clean_lyrics_text(raw)


def selector_candidates(primary_selector: str) -> Iterable[str]:
    yield primary_selector
    for selector in FALLBACK_SELECTORS:
        if selector != primary_selector:
            yield selector


def rating_selector_candidates(primary_selector: str) -> Iterable[str]:
    yield primary_selector
    for selector in RATING_FALLBACK_SELECTORS:
        if selector != primary_selector:
            yield selector


def normalize_content_rating(value: str) -> str | None:
    cleaned = (
        str(value or "")
        .strip()
        .upper()
        .replace("_", "-")
        .replace("–", "-")
        .replace("—", "-")
        .replace(" ", "")
    )

    if cleaned == "PG13":
        cleaned = "PG-13"
    elif cleaned == "NC17":
        cleaned = "NC-17"

    if cleaned in {"G", "PG", "PG-13", "R", "NC-17"}:
        return cleaned

    return None


def extract_content_rating_from_text(text: str) -> str | None:
    if not text:
        return None

    match = CONTENT_RATING_PATTERN.search(text)
    if not match:
        return None

    return normalize_content_rating(match.group(1))


def extract_content_rating_from_html(
    html: str,
    primary_selector: str = DEFAULT_RATING_SELECTOR,
) -> tuple[str | None, str | None]:
    soup = BeautifulSoup(html, "html.parser")

    for selector in rating_selector_candidates(primary_selector):
        node = soup.select_one(selector)
        if not node:
            continue

        rating = extract_content_rating_from_text(text_from_tag(node))
        if rating:
            return rating, selector

    page_rating = extract_content_rating_from_text(soup.get_text(" ", strip=True))
    if page_rating:
        return page_rating, "heuristic:page-text"

    return None, None


def extract_lyrics_from_html(html: str, primary_selector: str = DEFAULT_SELECTOR) -> tuple[str, str]:
    soup = BeautifulSoup(html, "html.parser")

    for selector in selector_candidates(primary_selector):
        node = soup.select_one(selector)
        if not node:
            continue

        text = text_from_tag(node)
        if looks_like_lyrics(text):
            return text, selector

    root = soup.select_one("#ritmo-portal") or soup
    best_text = ""
    best_selector = "heuristic:#ritmo-portal"

    for node in root.find_all(["div", "section", "article", "p"]):
        text = text_from_tag(node)
        if not looks_like_lyrics(text):
            continue
        if len(text) > len(best_text):
            best_text = text

    if best_text:
        return best_text, best_selector

    raise LyricsFetchError("Lyrics element not found or extracted text was too short.")


def fetch_html(url: str, timeout_seconds: int = 20) -> str:
    request = Request(url=url, headers=REQUEST_HEADERS, method="GET")
    with urlopen(request, timeout=timeout_seconds) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        body = response.read()

    return body.decode(charset, errors="replace")


def fetch_musixmatch_lyrics(url: str, selector: str = DEFAULT_SELECTOR) -> LyricsResult:
    html = fetch_html(url)

    lower_html = html.lower()
    if "captcha" in lower_html and "musixmatch" in lower_html:
        raise LyricsFetchError("Musixmatch returned a bot/captcha page. Retry later or from a normal browser session.")

    lyrics, selector_used = extract_lyrics_from_html(html, primary_selector=selector)
    content_rating, rating_selector_used = extract_content_rating_from_html(html)
    return LyricsResult(
        url=url,
        selector_used=selector_used,
        lyrics=lyrics,
        content_rating=content_rating,
        rating_selector_used=rating_selector_used,
    )


def fetch_musixmatch_content_rating(url: str) -> tuple[str | None, str | None]:
    html = fetch_html(url)

    lower_html = html.lower()
    if "captcha" in lower_html and "musixmatch" in lower_html:
        raise LyricsFetchError("Musixmatch returned a bot/captcha page. Retry later or from a normal browser session.")

    return extract_content_rating_from_html(html)


class LyricsApiHandler(BaseHTTPRequestHandler):
    server_version = "ALALyricsAPI/2.0"

    def _send_json(self, status_code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)

        if parsed.path == "/health":
            self._send_json(200, {"ok": True, "service": "lyrics-api"})
            return

        if parsed.path not in {"/lyrics", "/rating"}:
            self._send_json(404, {"ok": False, "error": "Not found"})
            return

        query = parse_qs(parsed.query)
        artist = (query.get("artist") or [""])[0].strip()
        song = (query.get("song") or [""])[0].strip()

        if not artist or not song:
            self._send_json(
                400,
                {
                    "ok": False,
                    "error": "Missing required query params: artist and song",
                },
            )
            return

        url = build_musixmatch_url(artist=artist, song=song)

        if parsed.path == "/rating":
            try:
                content_rating, rating_selector_used = fetch_musixmatch_content_rating(url=url)
            except LyricsFetchError as error:
                self._send_json(
                    422,
                    {
                        "ok": False,
                        "error": str(error),
                        "url": url,
                    },
                )
                return
            except Exception as error:  # noqa: BLE001
                self._send_json(
                    500,
                    {
                        "ok": False,
                        "error": f"Unexpected server error: {error}",
                        "url": url,
                    },
                )
                return

            self._send_json(
                200,
                {
                    "ok": True,
                    "url": url,
                    "content_rating": content_rating,
                    "rating_selector_used": rating_selector_used,
                    "source": "lyrics_api_server.py",
                },
            )
            return

        try:
            result = fetch_musixmatch_lyrics(url=url)
        except LyricsFetchError as error:
            self._send_json(
                422,
                {
                    "ok": False,
                    "error": str(error),
                    "url": url,
                },
            )
            return
        except Exception as error:  # noqa: BLE001
            self._send_json(
                500,
                {
                    "ok": False,
                    "error": f"Unexpected server error: {error}",
                    "url": url,
                },
            )
            return

        self._send_json(
            200,
            {
                "ok": True,
                "url": result.url,
                "selector_used": result.selector_used,
                "lyrics": result.lyrics,
                "content_rating": result.content_rating,
                "rating_selector_used": result.rating_selector_used,
                "source": "lyrics_api_server.py",
            },
        )


def run_server(port: int) -> int:
    server = ThreadingHTTPServer(("0.0.0.0", port), LyricsApiHandler)
    print(f"Lyrics API listening on http://0.0.0.0:{port}")
    server.serve_forever()
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Unified lyrics API server.")
    subparsers = parser.add_subparsers(dest="command")

    serve_parser = subparsers.add_parser("serve", help="Run local lyrics API server.")
    serve_parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8787")))

    # Backward-compatible default: no command means serve.
    if len(argv) == 1:
        return argparse.Namespace(command="serve", port=int(os.environ.get("PORT", "8787")))

    return parser.parse_args(argv[1:])


def main(argv: list[str] | None = None) -> int:
    argv = argv or sys.argv
    args = parse_args(argv)

    return run_server(port=int(args.port))


if __name__ == "__main__":
    raise SystemExit(main())
