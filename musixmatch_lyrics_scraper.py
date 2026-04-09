#!/usr/bin/env python3
"""Musixmatch lyrics fetcher using BeautifulSoup.

Usage examples:
  python musixmatch_lyrics_scraper.py --url "https://www.musixmatch.com/lyrics/Artist/Song"
  python musixmatch_lyrics_scraper.py --artist "Artist Name" --song "Song Name"
  python musixmatch_lyrics_scraper.py --artist "Artist Name" --song "Song Name" --json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

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
    # Keep exact user-provided selector first, then progressively looser fallbacks.
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

    # Heuristic fallback: scan for a text-heavy block under #ritmo-portal.
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
    return LyricsResult(url=url, selector_used=selector_used, lyrics=lyrics)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch lyrics from Musixmatch using BeautifulSoup.")

    parser.add_argument(
        "--url",
        help="Direct Musixmatch lyrics URL. Example: https://www.musixmatch.com/lyrics/Artist/Song",
    )
    parser.add_argument("--artist", help="Artist name used to build Musixmatch URL.")
    parser.add_argument("--song", help="Song title used to build Musixmatch URL.")
    parser.add_argument(
        "--selector",
        default=DEFAULT_SELECTOR,
        help="Primary CSS selector for lyrics extraction.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit JSON output with url, selector_used, and lyrics.",
    )

    args = parser.parse_args()

    has_direct_url = bool(args.url)
    has_artist_song = bool(args.artist and args.song)

    if not has_direct_url and not has_artist_song:
        parser.error("Provide either --url OR both --artist and --song.")

    if has_direct_url and has_artist_song:
        parser.error("Use either --url OR --artist/--song, not both.")

    return args


def main() -> int:
    args = parse_args()

    url = args.url or build_musixmatch_url(args.artist, args.song)

    try:
        result = fetch_musixmatch_lyrics(url=url, selector=args.selector)
    except HTTPError as error:
        print(f"HTTP error while fetching Musixmatch page: {error.code}", file=sys.stderr)
        return 1
    except URLError as error:
        print(f"Network error while fetching Musixmatch page: {error}", file=sys.stderr)
        return 1
    except LyricsFetchError as error:
        print(f"Lyrics extraction failed: {error}", file=sys.stderr)
        return 1

    if args.json:
        print(
            json.dumps(
                {
                    "url": result.url,
                    "selector_used": result.selector_used,
                    "lyrics": result.lyrics,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        print(result.lyrics)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
