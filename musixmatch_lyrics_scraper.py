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
    '#ritmo-portal span',
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
    # Keep exact user-provided selector first, then progressively looser fallbacks.
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
                    "content_rating": result.content_rating,
                    "rating_selector_used": result.rating_selector_used,
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
