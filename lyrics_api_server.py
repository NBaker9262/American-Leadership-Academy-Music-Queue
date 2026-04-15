#!/usr/bin/env python3
"""Single-file BeautifulSoup lyrics API.

Run:
  python lyrics_api_server.py

Endpoints:
  GET 127.0.0.1/health
  GET 127.0.0.1/lyrics?artist=<artist>&song=<song>
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

RATING_SELECTOR = (
    "#ritmo-portal > div:nth-child(1) > div > div:nth-child(1) > div:nth-child(1) > "
    "div.css-g5y9jx.r-1smwm8v > div > div > div.css-g5y9jx.r-1xidu1v.r-11c0sde > "
    "div > div.css-g5y9jx.r-150rngu.r-18u37iz.r-16y2uox.r-1wbh5a2.r-lltvgl.r-buy8e9."
    "r-agouwx.r-2eszeu > div > div.css-g5y9jx.r-13awgt0.r-is05cd.r-1jnqxx1.r-6koalj."
    "r-eqz5dr.r-f4gmv6.r-y54riw > div > div.css-g5y9jx.r-1otgn73.r-3s8xde.r-1867qdf."
    "r-1rd2zbf.r-13qz1uu"
)

FALLBACK_SELECTORS = (
    '[data-testid="lyrics-track"]',
    '[data-testid="lyrics-container"]',
    '#ritmo-portal div[class*="lyrics"]',
    'article[class*="lyrics"]',
)

RATING_FALLBACK_SELECTORS = (
    '[data-testid*="rating"]',
    '[data-testid*="explicit"]',
    '[aria-label*="explicit"]',
    '#ritmo-portal div[class*="rating"]',
    '#ritmo-portal div[class*="explicit"]',
    '#ritmo-portal section[class*="rating"]',
    '#ritmo-portal article[class*="rating"]',
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
    rating_label: str = ""
    rating_code: str = ""
    rating_reason: str = ""
    rating_selector_used: str = ""


def slugify_for_musixmatch(value: str) -> str:
    value = str(value or "").strip()
    value = value.replace("'", "-").replace("\u2019", "-").replace("`", "-")
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


def clean_inline_text(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def looks_like_lyrics(text: str) -> bool:
    if not text:
        return False

    line_count = text.count("\n") + 1
    char_count = len(text)
    return char_count >= 50 and line_count >= 3


def text_from_tag(node: Tag) -> str:
    raw = node.get_text("\n", strip=True)
    return clean_lyrics_text(raw)


def inline_text_from_tag(node: Tag) -> str:
    raw = node.get_text(" ", strip=True)
    return clean_inline_text(raw)


def normalize_embedded_lyrics(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""

    # Some embedded fields are URLs, not HTML lyric fragments.
    if text.startswith("http://") or text.startswith("https://"):
        return ""

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


def rating_selector_candidates(primary_selector: str) -> Iterable[str]:
    yield primary_selector
    for selector in RATING_FALLBACK_SELECTORS:
        if selector != primary_selector:
            yield selector


def normalize_rating_code(value: str) -> str:
    raw = re.sub(r"[^A-Za-z0-9-]+", "", str(value or "").strip().upper())
    if not raw:
        return ""

    aliases = {
        "PG13": "PG-13",
        "NC17": "NC-17",
        "TVMA": "TV-MA",
        "NOTRATED": "NR",
        "UNRATED": "NR",
        "EXPLICIT": "EXPLICIT",
        "MA": "TV-MA",
    }
    return aliases.get(raw, raw)


def parse_rating_text(text: str) -> tuple[str, str, str] | None:
    compact = clean_inline_text(text)
    if not compact:
        return None

    match = re.search(
        r"\brating\s*:\s*(G|PG-13|PG13|PG|R|NC-17|NC17|TV-MA|TVMA|MA|EXPLICIT|NR|NOT RATED|UNRATED)\b",
        compact,
        re.IGNORECASE,
    )
    if not match:
        lower = compact.lower()

        # Musixmatch often shows an "Explicit" badge without a "Rating:" prefix.
        # Only treat it as a rating signal when it appears in a short/badge-like string
        # or alongside other rating-ish words (to avoid matching lyrics content).
        rating_context = bool(re.search(r"\b(rating|content|advisory|parental|badge|lyrics)\b", lower))
        badge_like = len(lower) <= 40

        if re.search(r"\b(not\s+explicit|non\s*-?explicit)\b", lower):
            rating_code = "CLEAN"
            rating_label = "Rating: CLEAN"
            return rating_label, rating_code, "Detected non-explicit label"

        if re.search(r"\bexplicit\b", lower) and (rating_context or badge_like):
            rating_code = "EXPLICIT"
            rating_label = "Rating: EXPLICIT"
            return rating_label, rating_code, "Detected explicit badge"

        if re.search(r"\bclean\b", lower) and (rating_context or badge_like):
            rating_code = "CLEAN"
            rating_label = "Rating: CLEAN"
            return rating_label, rating_code, "Detected clean label"

        if re.search(r"\bok\b", lower) and "rating" in lower:
            rating_code = "OK"
            rating_label = "Rating: OK"
            return rating_label, rating_code, "Detected OK rating"

        return None

    rating_code = normalize_rating_code(match.group(1))
    tail = compact[match.end() :].strip(" :-")
    tail = re.split(r"\bshow more\b", tail, maxsplit=1, flags=re.IGNORECASE)[0].strip(" :-")
    rating_label = f"Rating: {rating_code}" if rating_code else ""
    return rating_label, rating_code, tail


def extract_rating_from_html(html: str, primary_selector: str = RATING_SELECTOR) -> tuple[str, str, str, str]:
    soup = BeautifulSoup(html, "html.parser")

    for selector in rating_selector_candidates(primary_selector):
        node = soup.select_one(selector)
        if not node:
            continue

        parsed = parse_rating_text(inline_text_from_tag(node))
        if parsed:
            rating_label, rating_code, rating_reason = parsed
            return rating_label, rating_code, rating_reason, selector

    root = soup.select_one("#ritmo-portal") or soup

    def _attr_blob(tag: Tag) -> str:
        parts: list[str] = []
        for key in ("id", "class", "data-testid", "aria-label"):
            value = tag.get(key)
            if not value:
                continue
            if isinstance(value, list):
                parts.append(" ".join(str(item) for item in value))
            else:
                parts.append(str(value))
        return " ".join(parts).lower()

    for node in root.find_all(["div", "section", "article", "p", "span"]):
        inline = inline_text_from_tag(node)
        if not inline:
            continue

        lower_inline = inline.lower()
        if not re.search(r"\b(rating|explicit|clean|parental|advisory)\b", lower_inline):
            continue

        attrs = _attr_blob(node)
        if "rating" not in attrs and "explicit" not in attrs and "clean" not in attrs and "rating" not in lower_inline:
            continue

        parsed = parse_rating_text(inline)
        if parsed:
            rating_label, rating_code, rating_reason = parsed
            return rating_label, rating_code, rating_reason, "heuristic:rating-text"

    return "", "", "", ""


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
    rating_label, rating_code, rating_reason, rating_selector_used = extract_rating_from_html(html)
    return LyricsResult(
        url=url,
        selector_used=selector_used,
        lyrics=lyrics,
        rating_label=rating_label,
        rating_code=rating_code,
        rating_reason=rating_reason,
        rating_selector_used=rating_selector_used,
    )


class LyricsApiHandler(BaseHTTPRequestHandler):
    server_version = "ALALyricsAPI/2.1"

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
                "rating_label": result.rating_label,
                "rating_code": result.rating_code,
                "rating_reason": result.rating_reason,
                "rating_selector_used": result.rating_selector_used,
                "source": "lyrics_api_server.py",
            },
        )


def main() -> None:
    port = int(os.environ.get("PORT", "8787"))
    bind_host = os.environ.get("BIND_HOST", "127.0.0.1")
    server = ThreadingHTTPServer((bind_host, port), LyricsApiHandler)
    print(f"Lyrics API listening on http://{bind_host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
