#!/usr/bin/env python3
"""Build a lyrics cache using the Genius API + HTML scraping.

Why this exists:
- The existing cache builder uses Musixmatch and can be blocked/captcha'd.
- Genius provides an API for search, but lyrics still require scraping the
  resulting Genius song page.

Usage (PowerShell):
  $env:GENIUS_ACCESS_TOKEN='...'
  python scripts/build_genius_lyrics_cache.py --in prom_dance_pack.txt

Input format:
- One song per line.
- Recommended: "Song Title - Artist"
- Blank lines and lines starting with # are ignored.

Output:
- Writes genius-lyrics-cache.json in the repo root (configurable with --out).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_IN_PATH = ROOT_DIR / "prom_dance_pack.txt"
DEFAULT_OUT_PATH = ROOT_DIR / "genius-lyrics-cache.json"

API_BASE = "https://api.genius.com"

REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


@dataclass(frozen=True)
class SongRequest:
    raw: str
    song: str
    artist: str


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


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


def normalize_cache_key(artist: str, song: str) -> str:
    safe_artist = re.sub(r"\s+", " ", str(artist or "").strip().lower())
    safe_song = re.sub(r"\s+", " ", str(song or "").strip().lower())
    if not safe_artist or not safe_song:
        return ""
    return f"{safe_artist}|{safe_song}"


def parse_song_list(text: str) -> list[SongRequest]:
    results: list[SongRequest] = []

    for line in str(text or "").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#"):
            continue

        song = ""
        artist = ""

        # Preferred format in prom_dance_pack.txt: "Song - Artist".
        if " - " in raw:
            left, right = raw.split(" - ", 1)
            song = left.strip()
            artist = right.strip()
        else:
            # Alternate common format: "Song by Artist".
            by_split = re.split(r"\s+by\s+", raw, maxsplit=1, flags=re.IGNORECASE)
            if len(by_split) == 2:
                song = by_split[0].strip()
                artist = by_split[1].strip()
            else:
                song = raw
                artist = ""

        results.append(SongRequest(raw=raw, song=song or "Unknown Song", artist=artist or "Unknown Artist"))

    return results


def genius_auth_headers(token: str) -> dict[str, str]:
    return {
        **REQUEST_HEADERS,
        "Authorization": f"Bearer {token}",
    }


def normalize_tokens(value: str) -> set[str]:
    cleaned = re.sub(r"[^A-Za-z0-9]+", " ", str(value or "").lower()).strip()
    return {part for part in cleaned.split() if part}


def match_score(*, want_song: str, want_artist: str, hit_title: str, hit_artist: str) -> float:
    want_song_tokens = normalize_tokens(want_song)
    want_artist_tokens = normalize_tokens(want_artist)
    title_tokens = normalize_tokens(hit_title)
    artist_tokens = normalize_tokens(hit_artist)

    if not want_song_tokens:
        return 0.0

    title_overlap = len(want_song_tokens & title_tokens) / max(1, len(want_song_tokens))

    # Artist is a soft hint (some requests omit it or Genius uses different naming).
    artist_overlap = 0.0
    if want_artist_tokens:
        artist_overlap = len(want_artist_tokens & artist_tokens) / max(1, len(want_artist_tokens))

    # Slight penalty for obviously wrong matches.
    if want_artist_tokens and artist_overlap == 0 and title_overlap < 0.7:
        return 0.0

    return (title_overlap * 0.75) + (artist_overlap * 0.25)


def genius_search(token: str, query: str, timeout_seconds: int = 20) -> list[dict]:
    resp = requests.get(
        f"{API_BASE}/search",
        params={"q": query},
        headers=genius_auth_headers(token),
        timeout=timeout_seconds,
    )
    resp.raise_for_status()
    payload = resp.json() or {}
    response = payload.get("response") or {}
    hits = response.get("hits") or []
    return [hit for hit in hits if isinstance(hit, dict)]


def choose_best_hit(*, hits: list[dict], song: str, artist: str) -> dict | None:
    best: dict | None = None
    best_score = 0.0

    for hit in hits:
        result = hit.get("result") if isinstance(hit, dict) else None
        if not isinstance(result, dict):
            continue

        title = clean_inline_text(result.get("title") or "")
        primary_artist = result.get("primary_artist")
        artist_name = ""
        if isinstance(primary_artist, dict):
            artist_name = clean_inline_text(primary_artist.get("name") or "")

        score = match_score(
            want_song=song,
            want_artist=artist,
            hit_title=title,
            hit_artist=artist_name,
        )

        if score > best_score:
            best_score = score
            best = result

    # Require a minimal confidence level.
    if best and best_score >= 0.55:
        return best

    # If nothing hit the threshold, still return the top Genius hit (it can be right
    # even when token overlap is low, e.g. punctuation/parentheticals).
    first = hits[0].get("result") if hits and isinstance(hits[0], dict) else None
    return first if isinstance(first, dict) else None


def extract_genius_lyrics_from_html(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")

    containers = soup.select('[data-lyrics-container="true"]')
    if containers:
        parts: list[str] = []
        for node in containers:
            text = node.get_text("\n", strip=True)
            text = clean_lyrics_text(text)
            if text:
                parts.append(text)
        combined = clean_lyrics_text("\n".join(parts))
        if looks_like_lyrics(combined):
            return combined

    # Older/alternate Genius layouts.
    legacy = soup.select_one("div.lyrics")
    if legacy:
        combined = clean_lyrics_text(legacy.get_text("\n", strip=True))
        if looks_like_lyrics(combined):
            return combined

    # Heuristic: pick the biggest Lyrics__Container-like blob.
    best = ""
    for node in soup.find_all(["div", "section", "article", "p"]):
        attrs = " ".join([
            str(node.get("id") or ""),
            " ".join(node.get("class") or []) if isinstance(node.get("class"), list) else str(node.get("class") or ""),
        ]).lower()
        if "lyric" not in attrs:
            continue
        text = clean_lyrics_text(node.get_text("\n", strip=True))
        if looks_like_lyrics(text) and len(text) > len(best):
            best = text

    if best:
        return best

    raise RuntimeError("Lyrics not found on Genius page (layout may have changed).")


def fetch_genius_lyrics(url: str, timeout_seconds: int = 20) -> str:
    resp = requests.get(url, headers=REQUEST_HEADERS, timeout=timeout_seconds)
    resp.raise_for_status()
    return extract_genius_lyrics_from_html(resp.text)


def build_cache(
    requests_list: list[SongRequest],
    *,
    token: str,
    delay_ms: int,
    max_songs: int,
) -> dict:
    by_song_key: dict[str, dict] = {}
    success = 0
    fallback = 0

    for idx, item in enumerate(requests_list[: max(1, max_songs)]):
        song_key = normalize_cache_key(item.artist, item.song)
        entry = {
            "song": item.song,
            "artist": item.artist,
            "song_key": song_key,
            "status": "fallback",
            "lyrics": "",
            "genius_url": "",
            "genius_id": "",
            "updated_at": now_iso(),
            "error": "",
            "source": "genius",
            "raw": item.raw,
        }

        try:
            query = clean_inline_text(f"{item.song} {item.artist}")
            hits = genius_search(token, query)
            chosen = choose_best_hit(hits=hits, song=item.song, artist=item.artist)
            if not chosen:
                raise RuntimeError("No Genius search results")

            entry["genius_url"] = str(chosen.get("url") or "")
            entry["genius_id"] = str(chosen.get("id") or "")

            if not entry["genius_url"]:
                raise RuntimeError("Genius result had no URL")

            lyrics = fetch_genius_lyrics(entry["genius_url"])
            entry["lyrics"] = lyrics
            entry["status"] = "success"
            success += 1
        except Exception as error:  # noqa: BLE001
            entry["status"] = "fallback"
            entry["error"] = str(error)
            fallback += 1

        if song_key:
            by_song_key[song_key] = entry
        else:
            # If we can't build a key, still store it under a stable-ish key.
            by_song_key[f"raw:{idx}:{re.sub(r'\s+', ' ', item.raw.strip().lower())}"] = entry

        if idx < len(requests_list) - 1 and delay_ms > 0:
            time.sleep(delay_ms / 1000)

    return {
        "generated_at": now_iso(),
        "refresh_interval_minutes": 0,
        "source": {
            "input": "song-list",
            "notes": "Generated by scripts/build_genius_lyrics_cache.py",
        },
        "stats": {
            "songs_input": len(requests_list),
            "songs_considered": min(len(requests_list), max(1, max_songs)),
            "lyrics_success": success,
            "lyrics_fallback": fallback,
        },
        "by_song_key": by_song_key,
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="in_path", default=str(DEFAULT_IN_PATH), help="Input txt file (Song - Artist)")
    parser.add_argument("--out", dest="out_path", default=str(DEFAULT_OUT_PATH), help="Output JSON path")
    parser.add_argument("--max", dest="max_songs", type=int, default=int(os.environ.get("GENIUS_MAX_SONGS", "200")))
    parser.add_argument(
        "--delay-ms",
        dest="delay_ms",
        type=int,
        default=int(os.environ.get("GENIUS_DELAY_MS", "350")),
        help="Delay between songs to be polite to Genius",
    )

    args = parser.parse_args(argv)

    token = str(os.environ.get("GENIUS_ACCESS_TOKEN") or "").strip()
    if not token:
        print("Missing GENIUS_ACCESS_TOKEN env var.")
        print("PowerShell: $env:GENIUS_ACCESS_TOKEN='...'")
        print("cmd.exe:    set GENIUS_ACCESS_TOKEN=... && python scripts/build_genius_lyrics_cache.py")
        return 2

    in_path = Path(args.in_path)
    out_path = Path(args.out_path)

    if not in_path.exists():
        print(f"Input file not found: {in_path}")
        return 2

    requests_list = parse_song_list(in_path.read_text(encoding="utf-8"))
    if not requests_list:
        print("No songs found in input list.")
        return 0

    cache = build_cache(
        requests_list,
        token=token,
        delay_ms=max(0, int(args.delay_ms)),
        max_songs=max(1, int(args.max_songs)),
    )

    out_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    stats = cache.get("stats") or {}
    print(
        "Genius cache build complete | "
        f"songs={stats.get('songs_considered', 0)} "
        f"success={stats.get('lyrics_success', 0)} "
        f"fallback={stats.get('lyrics_fallback', 0)} "
        f"out={out_path}"
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
