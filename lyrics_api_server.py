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
import sys
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

RATING_BUTTON_SELECTOR = (
    "#ritmo-portal > div:nth-child(1) > div > div:nth-child(1) > div:nth-child(1) > "
    "div.css-g5y9jx.r-1smwm8v > div > div > div.css-g5y9jx.r-1xidu1v.r-11c0sde > "
    "div > div > div > div.css-g5y9jx.r-13awgt0.r-is05cd.r-17ea83y.r-6koalj.r-eqz5dr."
    "r-f4gmv6.r-y54riw > div > div.css-g5y9jx.r-1otgn73.r-3s8xde.r-1867qdf.r-1rd2zbf."
    "r-13qz1uu > div"
)

RATING_OLD_SELECTOR = (
    "#ritmo-portal > div:nth-child(1) > div > div:nth-child(1) > div:nth-child(1) > "
    "div.css-g5y9jx.r-1smwm8v > div > div > div.css-g5y9jx.r-1xidu1v.r-11c0sde > "
    "div > div.css-g5y9jx.r-150rngu.r-18u37iz.r-16y2uox.r-1wbh5a2.r-lltvgl.r-buy8e9."
    "r-agouwx.r-2eszeu > div > div.css-g5y9jx.r-13awgt0.r-is05cd.r-1jnqxx1.r-6koalj."
    "r-eqz5dr.r-f4gmv6.r-y54riw > div > div.css-g5y9jx.r-1otgn73.r-3s8xde.r-1867qdf."
    "r-1rd2zbf.r-13qz1uu"
)

RATING_POPUP_SELECTOR = "#ritmo-portal > div:nth-child(3) > div > div > div:nth-child(3)"

# Keep the function defaults stable while pointing at the newest known selector.
RATING_SELECTOR = RATING_BUTTON_SELECTOR

FALLBACK_SELECTORS = (
    '[data-testid="lyrics-track"]',
    '[data-testid="lyrics-container"]',
    '#ritmo-portal div[class*="lyrics"]',
    'article[class*="lyrics"]',
)

RATING_FALLBACK_SELECTORS = (
    RATING_OLD_SELECTOR,
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
    is_instrumental: bool = False
    instrumental_source: str = ""
    rating_label: str = ""
    rating_code: str = ""
    rating_reason: str = ""
    rating_selector_used: str = ""
    canonical_url: str = ""
    canonical_artist_slug: str = ""
    canonical_song_slug: str = ""
    match_strategy: str = ""


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


def extract_canonical_musixmatch_url(html: str) -> str:
    """Extract canonical Musixmatch URL from og:url or <link rel=canonical> tags."""

    text = str(html or "")
    if not text:
        return ""

    soup = BeautifulSoup(text, "html.parser")

    meta = soup.select_one('meta[property="og:url"][content]')
    if meta and meta.get("content"):
        return str(meta.get("content") or "").strip()

    link = soup.select_one('link[rel="canonical"][href]')
    if link and link.get("href"):
        return str(link.get("href") or "").strip()

    return ""


def parse_musixmatch_artist_song_slugs(url: str) -> tuple[str, str]:
    match = re.search(r"musixmatch\.com/lyrics/([^/]+)/([^/?#]+)", str(url or ""))
    if not match:
        return "", ""
    return match.group(1), match.group(2)


def iter_musixmatch_artist_slug_variants(artist: str, max_suffix: int = 8) -> list[str]:
    """Return likely Musixmatch artist slug variants.

    Musixmatch sometimes disambiguates artists by appending a numeric suffix
    (for example, "don-toliver-8"). We can't reliably predict the right suffix
    from just the name, so we try a small range when the base page 404s.
    """

    safe_slug = slugify_for_musixmatch(artist)
    variants: list[str] = []
    seen: set[str] = set()

    def add(value: str) -> None:
        value = str(value or "").strip()
        if not value or value in seen:
            return
        seen.add(value)
        variants.append(value)

    # If the slug already ends with "-<number>", try the root too.
    match = re.match(r"^(.*?)-(\d+)$", safe_slug)
    if match:
        root = match.group(1).strip("-")
        if root:
            add(root)
        add(safe_slug)
    else:
        add(safe_slug)

    max_suffix = max(0, int(max_suffix))
    for suffix in range(1, max_suffix + 1):
        add(f"{safe_slug}-{suffix}")

    return variants


def iter_musixmatch_song_slug_variants(song: str, max_suffix: int = 3) -> list[str]:
    """Return likely Musixmatch song slug variants.

    Musixmatch sometimes disambiguates songs by appending a numeric suffix
    (for example, "god-s-plan-1") and sometimes uses a collapsed form without
    hyphens (for example, "brainstew").
    """

    safe_slug = slugify_for_musixmatch(song)
    collapsed_slug = safe_slug.replace("-", "")

    variants: list[str] = []
    seen: set[str] = set()

    def add(value: str) -> None:
        value = str(value or "").strip()
        if not value or value in seen:
            return
        seen.add(value)
        variants.append(value)

    # If the slug already ends with "-<number>", try the root too.
    match = re.match(r"^(.*?)-(\d+)$", safe_slug)
    root = ""
    if match:
        root = match.group(1).strip("-")
        if root:
            add(root)
        add(safe_slug)
    else:
        add(safe_slug)

    if collapsed_slug and collapsed_slug != safe_slug:
        add(collapsed_slug)

    max_suffix = max(0, int(max_suffix))
    for suffix in range(1, max_suffix + 1):
        add(f"{safe_slug}-{suffix}")
        if collapsed_slug and collapsed_slug != safe_slug:
            add(f"{collapsed_slug}-{suffix}")
        if root and root != safe_slug:
            add(f"{root}-{suffix}")

    return variants


def fetch_musixmatch_lyrics_with_disambiguation(
    *,
    artist: str,
    song: str,
    selector: str = DEFAULT_SELECTOR,
    max_artist_suffix: int | None = None,
    max_song_suffix: int | None = None,
) -> tuple[LyricsResult, list[str]]:
    """Fetch Musixmatch lyrics, trying slug variants and a canonical retry."""

    artist_suffix_max = max_artist_suffix
    if artist_suffix_max is None:
        try:
            artist_suffix_max = int(os.environ.get("MUSIXMATCH_ARTIST_SUFFIX_MAX", "8"))
        except ValueError:
            artist_suffix_max = 8

    song_suffix_max = max_song_suffix
    if song_suffix_max is None:
        try:
            song_suffix_max = int(os.environ.get("MUSIXMATCH_SONG_SUFFIX_MAX", "3"))
        except ValueError:
            song_suffix_max = 3

    base_artist_slug = slugify_for_musixmatch(artist)
    base_song_slug = slugify_for_musixmatch(song)

    tried_urls: list[str] = []
    last_non_404_error: Exception | None = None

    artist_variants = iter_musixmatch_artist_slug_variants(artist, max_suffix=artist_suffix_max)
    song_variants = iter_musixmatch_song_slug_variants(song, max_suffix=song_suffix_max)

    for song_index, candidate_song_slug in enumerate(song_variants):
        for artist_index, candidate_artist_slug in enumerate(artist_variants):
            url = f"https://www.musixmatch.com/lyrics/{candidate_artist_slug}/{candidate_song_slug}"
            tried_urls.append(url)

            if (
                song_index == 0
                and artist_index == 0
                and candidate_artist_slug == base_artist_slug
                and candidate_song_slug == base_song_slug
            ):
                match_strategy = "direct"
            else:
                parts: list[str] = []
                if candidate_artist_slug != base_artist_slug:
                    parts.append("artist-variant")
                    if re.search(r"-\d+$", candidate_artist_slug):
                        parts.append("artist-suffix")
                if candidate_song_slug != base_song_slug:
                    parts.append("song-variant")
                    if candidate_song_slug == base_song_slug.replace("-", ""):
                        parts.append("song-collapsed")
                    if re.search(r"-\d+$", candidate_song_slug):
                        parts.append("song-suffix")
                match_strategy = "+".join(parts) or "variant"

            try:
                fetched = fetch_musixmatch_lyrics(url=url, selector=selector)
                return (
                    LyricsResult(
                        url=fetched.url,
                        selector_used=fetched.selector_used,
                        lyrics=fetched.lyrics,
                        is_instrumental=fetched.is_instrumental,
                        instrumental_source=fetched.instrumental_source,
                        rating_label=fetched.rating_label,
                        rating_code=fetched.rating_code,
                        rating_reason=fetched.rating_reason,
                        rating_selector_used=fetched.rating_selector_used,
                        canonical_url=fetched.canonical_url,
                        canonical_artist_slug=fetched.canonical_artist_slug,
                        canonical_song_slug=fetched.canonical_song_slug,
                        match_strategy=match_strategy,
                    ),
                    tried_urls,
                )
            except requests.HTTPError as error:
                status_code = getattr(error.response, "status_code", None)
                if status_code != 404:
                    raise

                html = ""
                response = getattr(error, "response", None)
                if response is not None:
                    try:
                        html = response.text or ""
                    except Exception:  # noqa: BLE001
                        html = ""

                canonical_url = extract_canonical_musixmatch_url(html)
                if canonical_url and canonical_url != url and canonical_url not in tried_urls:
                    tried_urls.append(canonical_url)
                    try:
                        fetched = fetch_musixmatch_lyrics(url=canonical_url, selector=selector)
                        return (
                            LyricsResult(
                                url=fetched.url,
                                selector_used=fetched.selector_used,
                                lyrics=fetched.lyrics,
                                is_instrumental=fetched.is_instrumental,
                                instrumental_source=fetched.instrumental_source,
                                rating_label=fetched.rating_label,
                                rating_code=fetched.rating_code,
                                rating_reason=fetched.rating_reason,
                                rating_selector_used=fetched.rating_selector_used,
                                canonical_url=fetched.canonical_url,
                                canonical_artist_slug=fetched.canonical_artist_slug,
                                canonical_song_slug=fetched.canonical_song_slug,
                                match_strategy="canonical-retry",
                            ),
                            tried_urls,
                        )
                    except requests.HTTPError as canonical_error:
                        if getattr(canonical_error.response, "status_code", None) != 404:
                            raise
                    except LyricsFetchError as canonical_error:
                        if "captcha" in str(canonical_error).lower():
                            raise
                        last_non_404_error = canonical_error

                continue
            except LyricsFetchError as error:
                # Don't loop on captcha/bot pages.
                if "captcha" in str(error).lower():
                    raise
                last_non_404_error = error
                continue

    if last_non_404_error:
        raise last_non_404_error

    raise LyricsFetchError("Musixmatch page not found for any slug variant.")


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


def extract_rating_from_next_data(soup: BeautifulSoup) -> tuple[str, str, str, str] | None:
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

    rating_paths = [
        ["props", "pageProps", "data", "trackInfo", "data", "track", "lens", "rating"],
        ["props", "pageProps", "data", "track", "lens", "rating"],
    ]

    for path in rating_paths:
        current: object = payload
        for key in path:
            if not isinstance(current, dict) or key not in current:
                current = None
                break
            current = current[key]

        if not isinstance(current, dict):
            continue

        audience = str(current.get("audience") or "").strip()
        descriptor = str(current.get("descriptor") or current.get("description") or "").strip()
        if not audience and not descriptor:
            continue

        rating_code = normalize_rating_code(audience)
        label_value = rating_code or audience
        rating_label = f"Rating: {label_value}" if label_value else ""
        rating_reason = clean_rating_reason_text(descriptor)
        return rating_label, rating_code, rating_reason, f"__NEXT_DATA__:{'.'.join(path)}"

    return None


def extract_instrumental_from_next_data(soup: BeautifulSoup) -> tuple[bool, str] | None:
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

    instrumental_paths = [
        ["props", "pageProps", "data", "trackInfo", "data", "track", "isInstrumental"],
        ["props", "pageProps", "data", "track", "isInstrumental"],
    ]

    for path in instrumental_paths:
        current: object = payload
        for key in path:
            if not isinstance(current, dict) or key not in current:
                current = None
                break
            current = current[key]

        if isinstance(current, bool):
            return current, f"__NEXT_DATA__:{'.'.join(path)}"

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


def clean_rating_reason_text(text: str) -> str:
    value = clean_inline_text(text)
    if not value:
        return ""

    # Musixmatch popups include a footer link label; remove it.
    value = re.sub(r"\blearn\s+more\s+about\b.*$", "", value, flags=re.IGNORECASE).strip()
    value = re.sub(r"\s*\|\s*", " | ", value)
    return value.strip(" -:|\t\r\n")


def extract_rating_popup_reason(
    soup: BeautifulSoup,
    *,
    rating_code: str,
    rating_label: str,
) -> tuple[str, str]:
    popup = soup.select_one(RATING_POPUP_SELECTOR)
    if popup:
        parsed = parse_rating_text(inline_text_from_tag(popup))
        if parsed:
            popup_label, popup_code, popup_reason = parsed
            popup_code = normalize_rating_code(popup_code)
            if not rating_code or popup_code == normalize_rating_code(rating_code):
                reason = clean_rating_reason_text(popup_reason)
                if reason:
                    return reason, f"popup:{RATING_POPUP_SELECTOR}"

    # Heuristic fallback: look for a long rating explanation block.
    best_blob = ""
    for node in (soup.select_one("#ritmo-portal") or soup).find_all(["div", "section", "article", "p"]):
        inline = inline_text_from_tag(node)
        if not inline:
            continue

        lower = inline.lower()
        if "rating" not in lower:
            continue
        if rating_code and normalize_rating_code(rating_code).lower() not in lower and (rating_label.lower() not in lower):
            continue
        if "lyrics may be" not in lower and "parental" not in lower and "advisory" not in lower:
            continue
        if len(inline) < 80:
            continue

        if len(inline) > len(best_blob):
            best_blob = inline

    if best_blob:
        parsed = parse_rating_text(best_blob)
        if parsed:
            _, _, tail = parsed
            reason = clean_rating_reason_text(tail)
            if reason:
                return reason, "heuristic:rating-popup"

    return "", ""


def extract_instrumental_from_html(html: str) -> tuple[bool, str]:
    soup = BeautifulSoup(html, "html.parser")

    next_data_result = extract_instrumental_from_next_data(soup)
    if next_data_result:
        return next_data_result

    return False, ""


def extract_rating_from_html(html: str, primary_selector: str = RATING_SELECTOR) -> tuple[str, str, str, str]:
    soup = BeautifulSoup(html, "html.parser")

    rating_label = ""
    rating_code = ""
    rating_reason = ""
    selector_used = ""

    got_next_data = False
    next_data_result = extract_rating_from_next_data(soup)
    if next_data_result:
        rating_label, rating_code, rating_reason, selector_used = next_data_result
        got_next_data = True

    if not got_next_data:
        for selector in rating_selector_candidates(primary_selector):
            node = soup.select_one(selector)
            if not node:
                continue

            parsed = parse_rating_text(inline_text_from_tag(node))
            if parsed:
                rating_label, rating_code, rating_reason = parsed
                selector_used = selector
                break

    # If we didn't find the rating badge/button, try reading the popup directly.
    if not rating_label and not rating_code:
        popup = soup.select_one(RATING_POPUP_SELECTOR)
        if popup:
            parsed = parse_rating_text(inline_text_from_tag(popup))
            if parsed:
                rating_label, rating_code, rating_reason = parsed
                selector_used = f"popup:{RATING_POPUP_SELECTOR}"

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

    if not rating_label and not rating_code:
        for node in root.find_all(["div", "section", "article", "p", "span"]):
            inline = inline_text_from_tag(node)
            if not inline:
                continue

            lower_inline = inline.lower()
            if not re.search(r"\b(rating|explicit|clean|parental|advisory)\b", lower_inline):
                continue

            attrs = _attr_blob(node)
            if (
                "rating" not in attrs
                and "explicit" not in attrs
                and "clean" not in attrs
                and "rating" not in lower_inline
            ):
                continue

            parsed = parse_rating_text(inline)
            if parsed:
                rating_label, rating_code, rating_reason = parsed
                selector_used = "heuristic:rating-text"
                break

    rating_reason = clean_rating_reason_text(rating_reason)

    if rating_label or rating_code:
        popup_reason, popup_selector = extract_rating_popup_reason(
            soup,
            rating_code=rating_code,
            rating_label=rating_label,
        )
        if popup_reason and len(popup_reason) > len(rating_reason):
            rating_reason = popup_reason
            selector_used = f"{selector_used} + {popup_selector}" if selector_used else popup_selector

    return rating_label, rating_code, rating_reason, selector_used


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

    canonical_url = extract_canonical_musixmatch_url(html)
    canonical_artist_slug, canonical_song_slug = parse_musixmatch_artist_song_slugs(canonical_url)

    lyrics, selector_used = extract_lyrics_from_html(html, primary_selector=selector)
    is_instrumental, instrumental_source = extract_instrumental_from_html(html)
    rating_label, rating_code, rating_reason, rating_selector_used = extract_rating_from_html(html)
    return LyricsResult(
        url=url,
        selector_used=selector_used,
        lyrics=lyrics,
        is_instrumental=is_instrumental,
        instrumental_source=instrumental_source,
        rating_label=rating_label,
        rating_code=rating_code,
        rating_reason=rating_reason,
        rating_selector_used=rating_selector_used,
        canonical_url=canonical_url,
        canonical_artist_slug=canonical_artist_slug,
        canonical_song_slug=canonical_song_slug,
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
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # Client aborted the request (browser navigation/refresh/timeout).
            # Avoid noisy stack traces for an expected condition.
            return

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
        tried_urls: list[str] = []

        try:
            result, tried_urls = fetch_musixmatch_lyrics_with_disambiguation(artist=artist, song=song)
        except requests.HTTPError as error:
            status_code = getattr(error.response, "status_code", "unknown")
            self._send_json(
                502,
                {
                    "ok": False,
                    "error": f"Musixmatch HTTP error: {status_code}",
                    "url": url,
                    "tried_urls": tried_urls[:12],
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
                    "tried_urls": tried_urls[:12],
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
                    "tried_urls": tried_urls[:12],
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
                    "tried_urls": tried_urls[:12],
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
                "is_instrumental": result.is_instrumental,
                "instrumental_source": result.instrumental_source,
                "rating_label": result.rating_label,
                "rating_code": result.rating_code,
                "rating_reason": result.rating_reason,
                "rating_selector_used": result.rating_selector_used,
                "canonical_url": result.canonical_url,
                "canonical_artist_slug": result.canonical_artist_slug,
                "canonical_song_slug": result.canonical_song_slug,
                "match_strategy": result.match_strategy,
                "source": "lyrics_api_server.py",
            },
        )


def main() -> None:
    port = int(os.environ.get("PORT", "8787"))
    bind_host = os.environ.get("BIND_HOST", "127.0.0.1")
    try:
        server = ThreadingHTTPServer((bind_host, port), LyricsApiHandler)
    except OSError as exc:
        # Most common on Windows when the port is already bound by another instance.
        msg = str(exc).lower()
        if "only one usage" in msg or "address already in use" in msg:
            print(
                "Could not start Lyrics API: port is already in use.\n"
                f"- Someone is already running it on http://{bind_host}:{port}\n"
                "- Close the other terminal/process, OR run with a different port:\n"
                "    PowerShell: $env:PORT=8788; python lyrics_api_server.py\n"
                "    cmd.exe:    set PORT=8788 && python lyrics_api_server.py\n"
            )
            raise SystemExit(1)
        raise

    print(f"Lyrics API listening on http://{bind_host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] in {"--test", "test"}:
        artist = sys.argv[2] if len(sys.argv) > 2 else ""
        song = sys.argv[3] if len(sys.argv) > 3 else ""
        if not artist or not song:
            print("Usage: python lyrics_api_server.py --test <artist> <song>")
            raise SystemExit(2)

        try:
            result, tried_urls = fetch_musixmatch_lyrics_with_disambiguation(artist=artist, song=song)
        except Exception as error:  # noqa: BLE001
            print(f"Test fetch failed: {error}")
            raise SystemExit(1)

        print(
            json.dumps(
                {
                    "artist": artist,
                    "song": song,
                    "match_strategy": result.match_strategy,
                    "chosen_url": result.url,
                    "is_instrumental": result.is_instrumental,
                    "instrumental_source": result.instrumental_source,
                    "canonical_url": result.canonical_url,
                    "canonical_artist_slug": result.canonical_artist_slug,
                    "canonical_song_slug": result.canonical_song_slug,
                    "tried_urls": tried_urls,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        raise SystemExit(0)

    main()
