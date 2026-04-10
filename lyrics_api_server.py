#!/usr/bin/env python3
"""Single-file BeautifulSoup lyrics API.

Run:
  python lyrics_api_server.py

Endpoints:
  GET /health
  GET /lyrics?artist=<artist>&song=<song>
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Iterable
from urllib.parse import parse_qs, urlparse

import requests
from bs4 import BeautifulSoup
from bs4.element import Tag

DEFAULT_SELECTOR = (
    "#ritmo-portal > div:nth-child(1) > div > div:nth-child(1) > div:nth-child(1) > "
    "div.css-g5y9jx.r-1smwm8v > div > div > div:nth-child(2) > "
    "div.css-g5y9jx.r-13awgt0.r-eqz5dr.r-1v1z2uz"
)

FALLBACK_SELECTORS = (
    '[data-testid="lyrics-track"]',
    '[data-testid="lyrics-container"]',
    '#ritmo-portal div[class*="lyrics"]',
    'article[class*="lyrics"]',
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


def slugify_for_musixmatch(value: str) -> str:
    value = str(value or "").strip()
    value = value.replace("'", "-").replace("’", "-").replace("`", "-")
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
    return char_count >= 50 and line_count >= 3


def text_from_tag(node: Tag) -> str:
    raw = node.get_text("\n", strip=True)
    return clean_lyrics_text(raw)


def normalize_embedded_lyrics(value: str) -> str:
    text = str(value or "")
    text = text.replace("<br />", "\n").replace("<br/>", "\n").replace("<br>", "\n")
    rendered = BeautifulSoup(text, "html.parser").get_text("\n", strip=True)
    return clean_lyrics_text(rendered)


def deep_get(data: dict, path: list[str]) -> str | None:
    current = data
    for key in path:
        if not isinstance(current, dict) or key not in current:
            return None
        current = current[key]

    if isinstance(current, str):
        return current
    return None


def extract_lyrics_from_next_data(soup: BeautifulSoup) -> tuple[str, str] | None:
    node = soup.select_one("#__NEXT_DATA__")
    if not node:
        return None

    raw_json = node.string or node.get_text(strip=True)
    if not raw_json:
        return None

    try:
        payload = json.loads(raw_json)
    except json.JSONDecodeError:
        return None

    direct_paths = [
        ["props", "pageProps", "data", "trackInfo", "data", "lyrics", "body"],
        ["props", "pageProps", "data", "track", "lyrics", "body"],
    ]

    for path in direct_paths:
        value = deep_get(payload, path)
        if not value:
            continue

        cleaned = normalize_embedded_lyrics(value)
        if looks_like_lyrics(cleaned):
            return cleaned, f"__NEXT_DATA__:{'.'.join(path)}"

    stack: list[tuple[str, object]] = [("root", payload)]
    while stack:
        path, value = stack.pop()

        if isinstance(value, dict):
            for key, child in value.items():
                stack.append((f"{path}.{key}", child))
            continue

        if isinstance(value, list):
            for index, child in enumerate(value):
                stack.append((f"{path}[{index}]", child))
            continue

        if not isinstance(value, str):
            continue

        lower_path = path.lower()
        if "lyrics" not in lower_path and "trackinfo" not in lower_path:
            continue

        cleaned = normalize_embedded_lyrics(value)
        if looks_like_lyrics(cleaned):
            return cleaned, f"__NEXT_DATA__:{path}"

    return None


def selector_candidates(primary_selector: str) -> Iterable[str]:
    yield primary_selector
    for selector in FALLBACK_SELECTORS:
        if selector != primary_selector:
            yield selector


def extract_lyrics_from_html(html: str, primary_selector: str = DEFAULT_SELECTOR) -> tuple[str, str]:
    soup = BeautifulSoup(html, "html.parser")

    for selector in selector_candidates(primary_selector):
        node = soup.select_one(selector)
        if not node:
            continue

        text = text_from_tag(node)
        if looks_like_lyrics(text):
            return text, selector

    next_data_result = extract_lyrics_from_next_data(soup)
    if next_data_result:
        return next_data_result

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
    response = requests.get(url, headers=REQUEST_HEADERS, timeout=timeout_seconds)
    response.raise_for_status()
    return response.text


def fetch_musixmatch_lyrics(url: str, selector: str = DEFAULT_SELECTOR) -> LyricsResult:
    html = fetch_html(url)
    lower_html = html.lower()

    if "captcha" in lower_html and "musixmatch" in lower_html:
        raise LyricsFetchError("Musixmatch returned a bot/captcha page. Retry later or from a normal browser session.")

    lyrics, selector_used = extract_lyrics_from_html(html, primary_selector=selector)
    return LyricsResult(url=url, selector_used=selector_used, lyrics=lyrics)


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

        if parsed.path != "/lyrics":
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

        try:
            result = fetch_musixmatch_lyrics(url=url)
        except requests.HTTPError as error:
            status_code = getattr(error.response, "status_code", "unknown")
            self._send_json(
                502,
                {
                    "ok": False,
                    "error": f"Musixmatch HTTP error: {status_code}",
                    "url": url,
                },
            )
            return
        except requests.RequestException as error:
            self._send_json(
                502,
                {
                    "ok": False,
                    "error": f"Network error while fetching lyrics: {error}",
                    "url": url,
                },
            )
            return
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
                "source": "lyrics_api_server.py",
            },
        )


def main() -> None:
    port = int(os.environ.get("PORT", "8787"))
    server = ThreadingHTTPServer(("0.0.0.0", port), LyricsApiHandler)
    print(f"Lyrics API listening on http://0.0.0.0:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
