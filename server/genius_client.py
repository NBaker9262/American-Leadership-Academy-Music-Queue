from __future__ import annotations

import os
import random
import re
import time
from dataclasses import dataclass

import requests
from bs4 import BeautifulSoup

API_BASE = "https://api.genius.com"

REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


class GeniusError(RuntimeError):
    pass


@dataclass(frozen=True)
class GeniusSong:
    genius_id: str
    url: str
    title: str
    artist: str


def clean_inline_text(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def clean_lyrics_text(text: str) -> str:
    lines = [line.strip() for line in str(text or "").splitlines()]
    lines = [line for line in lines if line]
    return "\n".join(lines)


def looks_like_lyrics(text: str) -> bool:
    if not text:
        return False
    line_count = text.count("\n") + 1
    char_count = len(text)
    return char_count >= 80 and line_count >= 4


def normalize_tokens(value: str) -> set[str]:
    cleaned = re.sub(r"[^A-Za-z0-9]+", " ", str(value or "").lower()).strip()
    return {part for part in cleaned.split() if part}


def match_score(*, want_title: str, want_artist: str, hit_title: str, hit_artist: str) -> float:
    want_title_tokens = normalize_tokens(want_title)
    want_artist_tokens = normalize_tokens(want_artist)
    title_tokens = normalize_tokens(hit_title)
    artist_tokens = normalize_tokens(hit_artist)

    if not want_title_tokens:
        return 0.0

    title_overlap = len(want_title_tokens & title_tokens) / max(1, len(want_title_tokens))

    artist_overlap = 0.0
    if want_artist_tokens:
        artist_overlap = len(want_artist_tokens & artist_tokens) / max(1, len(want_artist_tokens))

    if want_artist_tokens and artist_overlap == 0 and title_overlap < 0.7:
        return 0.0

    return (title_overlap * 0.75) + (artist_overlap * 0.25)


def get_access_token() -> str:
    token = str(os.environ.get("GENIUS_ACCESS_TOKEN") or "").strip()
    if not token:
        raise GeniusError("Missing GENIUS_ACCESS_TOKEN")
    return token


def auth_headers(token: str) -> dict[str, str]:
    return {
        **REQUEST_HEADERS,
        "Authorization": f"Bearer {token}",
    }


def genius_search(token: str, query: str, timeout_seconds: int = 20) -> list[dict]:
    resp = requests.get(
        f"{API_BASE}/search",
        params={"q": query},
        headers=auth_headers(token),
        timeout=timeout_seconds,
    )
    resp.raise_for_status()
    payload = resp.json() or {}
    response = payload.get("response") or {}
    hits = response.get("hits") or []
    return [hit for hit in hits if isinstance(hit, dict)]


def genius_song_details(token: str, genius_id: str, timeout_seconds: int = 20) -> dict:
    safe_id = str(genius_id or "").strip()
    if not safe_id:
        raise GeniusError("Missing genius_id")

    resp = requests.get(
        f"{API_BASE}/songs/{safe_id}",
        headers=auth_headers(token),
        timeout=timeout_seconds,
        params={"text_format": "plain"},
    )
    resp.raise_for_status()
    payload = resp.json() or {}
    response = payload.get("response") or {}
    song = response.get("song")
    if not isinstance(song, dict):
        raise GeniusError("Song details not found in Genius response")
    return song


def choose_best_hit(*, hits: list[dict], title: str, artist: str) -> GeniusSong | None:
    best: dict | None = None
    best_score = 0.0

    for hit in hits:
        result = hit.get("result") if isinstance(hit, dict) else None
        if not isinstance(result, dict):
            continue

        hit_title = clean_inline_text(result.get("title") or "")
        primary_artist = result.get("primary_artist")
        hit_artist = ""
        if isinstance(primary_artist, dict):
            hit_artist = clean_inline_text(primary_artist.get("name") or "")

        score = match_score(want_title=title, want_artist=artist, hit_title=hit_title, hit_artist=hit_artist)
        if score > best_score:
            best_score = score
            best = result

    if best and best_score >= 0.55:
        return GeniusSong(
            genius_id=str(best.get("id") or ""),
            url=str(best.get("url") or ""),
            title=clean_inline_text(best.get("title") or ""),
            artist=clean_inline_text((best.get("primary_artist") or {}).get("name") if isinstance(best.get("primary_artist"), dict) else ""),
        )

    if hits:
        result = hits[0].get("result") if isinstance(hits[0], dict) else None
        if isinstance(result, dict):
            primary_artist = result.get("primary_artist")
            hit_artist = ""
            if isinstance(primary_artist, dict):
                hit_artist = clean_inline_text(primary_artist.get("name") or "")
            return GeniusSong(
                genius_id=str(result.get("id") or ""),
                url=str(result.get("url") or ""),
                title=clean_inline_text(result.get("title") or ""),
                artist=hit_artist,
            )

    return None


def extract_lyrics_from_html(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")

    containers = soup.select('[data-lyrics-container="true"]')
    if containers:
        parts: list[str] = []
        for node in containers:
            text = clean_lyrics_text(node.get_text("\n", strip=True))
            if text:
                parts.append(text)
        combined = clean_lyrics_text("\n".join(parts))
        if looks_like_lyrics(combined):
            return combined

    legacy = soup.select_one("div.lyrics")
    if legacy:
        combined = clean_lyrics_text(legacy.get_text("\n", strip=True))
        if looks_like_lyrics(combined):
            return combined

    best = ""
    for node in soup.find_all(["div", "section", "article", "p"]):
        classes = node.get("class")
        class_blob = " ".join(classes) if isinstance(classes, list) else str(classes or "")
        attrs = f"{node.get('id') or ''} {class_blob}".lower()
        if "lyric" not in attrs:
            continue
        text = clean_lyrics_text(node.get_text("\n", strip=True))
        if looks_like_lyrics(text) and len(text) > len(best):
            best = text

    if best:
        return best

    raise GeniusError("Lyrics not found on Genius page (layout may have changed).")


def fetch_lyrics_page(url: str, timeout_seconds: int = 25) -> tuple[str, requests.Response]:
    resp = requests.get(url, headers=REQUEST_HEADERS, timeout=timeout_seconds)
    resp.raise_for_status()
    return extract_lyrics_from_html(resp.text), resp


def sleep_with_jitter(seconds: float) -> None:
    seconds = max(0.0, float(seconds))
    jitter = random.random() * min(0.25, seconds)
    time.sleep(seconds + jitter)
