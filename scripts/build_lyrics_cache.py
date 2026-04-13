#!/usr/bin/env python3
"""Build lyrics cache JSON for GitHub Pages.

This script reads the public request CSV, resolves Spotify track metadata via
Spotify oEmbed (no Spotify API token required), scrapes Musixmatch lyrics,
and writes a static cache file consumed by the frontend.
"""

from __future__ import annotations

import csv
import html
import io
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Iterable

import requests
from bs4 import BeautifulSoup

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from lyrics_api_server import LyricsFetchError, build_musixmatch_url, fetch_musixmatch_lyrics

DEFAULT_REQUESTS_CSV_URL = (
    "https://docs.google.com/spreadsheets/d/e/"
    "2PACX-1vQyc3RRDmjc-nN-XgMMDocbnn1tlxue5ynNoNnYSxnRKxgp2LRGNmYZXnVgAFLH7IViwTAtmIAkvDsK/"
    "pub?output=csv"
)
CACHE_PATH = Path("lyrics-cache.json")

REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


@dataclass(frozen=True)
class RequestRow:
    request_id: str
    spotify_link: str


@dataclass(frozen=True)
class TrackMeta:
    track_id: str
    spotify_url: str
    song: str
    artist: str


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def normalize_header(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def find_header_index(headers: list[str], candidates: Iterable[str], fallback: int = -1) -> int:
    normalized = [normalize_header(header) for header in headers]

    for candidate in candidates:
        target = normalize_header(candidate)
        try:
            return normalized.index(target)
        except ValueError:
            pass

    for candidate in candidates:
        target = normalize_header(candidate)
        for index, value in enumerate(normalized):
            if target in value:
                return index

    return fallback


def parse_csv_rows(csv_text: str) -> list[list[str]]:
    reader = csv.reader(io.StringIO(csv_text))
    return [list(row) for row in reader]


def extract_spotify_track_id(url: str) -> str:
    value = str(url or "").strip()
    if not value:
        return ""

    track_url = re.search(r"spotify\.com/track/([A-Za-z0-9]+)", value, re.IGNORECASE)
    if track_url:
        return track_url.group(1)

    track_uri = re.search(r"spotify:track:([A-Za-z0-9]+)", value, re.IGNORECASE)
    if track_uri:
        return track_uri.group(1)

    return ""


def spotify_track_url(track_id: str) -> str:
    return f"https://open.spotify.com/track/{track_id}"


def normalize_cache_key(artist: str, song: str) -> str:
    safe_artist = re.sub(r"\s+", " ", str(artist or "").strip().lower())
    safe_song = re.sub(r"\s+", " ", str(song or "").strip().lower())
    if not safe_artist or not safe_song:
        return ""
    return f"{safe_artist}|{safe_song}"


def split_title_artist(title: str, author_name: str) -> tuple[str, str]:
    safe_title = html.unescape(str(title or "")).strip()
    safe_author = html.unescape(str(author_name or "")).strip()

    if not safe_title and safe_author:
        return "Unknown Song", safe_author

    by_match = re.split(r"\s+by\s+", safe_title, maxsplit=1, flags=re.IGNORECASE)
    if len(by_match) == 2:
        song = by_match[0].strip() or "Unknown Song"
        artist = by_match[1].strip() or safe_author or "Unknown Artist"
        return song, artist

    if " - " in safe_title:
        parts = [part.strip() for part in safe_title.split(" - ") if part.strip()]
        if parts:
            if safe_author:
                for index, part in enumerate(parts):
                    if part.lower() == safe_author.lower():
                        song = " - ".join(parts[:index] + parts[index + 1 :]).strip() or parts[0]
                        return song, safe_author

            if len(parts) >= 2:
                return parts[0], parts[-1]

            return parts[0], safe_author or "Unknown Artist"

    return safe_title or "Unknown Song", safe_author or "Unknown Artist"


def parse_artist_from_spotify_description(description: str) -> str:
    value = html.unescape(str(description or "")).strip()
    if not value:
        return ""

    value = re.sub(r"\s+", " ", value)

    # Common formats observed on Spotify track pages, examples:
    # - "Listen to Song on Spotify. Artist · Song · 2024"
    # - "Listen to Song on Spotify. Artist"
    # - "Listen to Song by Artist on Spotify."

    spotify_dot_match = re.search(r"on Spotify\.\s*(.+)$", value, re.IGNORECASE)
    if spotify_dot_match:
        tail = spotify_dot_match.group(1).strip()
        if tail:
            tail = tail.split("\u00b7", 1)[0].strip()
            tail = tail.rstrip(" .|\t\r\n")
            if tail:
                return tail

    if "\u00b7 Song" in value:
        left = value.split("\u00b7 Song", 1)[0].strip()
        if "on Spotify." in left:
            tail = left.split("on Spotify.", 1)[1].strip()
            tail = tail.rstrip(" .|\t\r\n")
            return tail
        return left.strip()

    by_match = re.search(r"\sby\s(.+?)\son\sSpotify", value, re.IGNORECASE)
    if by_match:
        artist = by_match.group(1).strip().rstrip(" .|\t\r\n")
        return artist

    return ""


def resolve_track_meta_from_open_graph(track_url: str, timeout_seconds: int = 20) -> tuple[str, str]:
    response = requests.get(track_url, headers=REQUEST_HEADERS, timeout=timeout_seconds)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    title_node = soup.find("meta", attrs={"property": "og:title"})
    description_node = soup.find("meta", attrs={"property": "og:description"})

    song = ""
    artist = ""

    if title_node and title_node.get("content"):
        song = html.unescape(str(title_node["content"])).strip()

    if description_node and description_node.get("content"):
        artist = parse_artist_from_spotify_description(str(description_node["content"]))

    title_tag_text = html.unescape(str(soup.title.string if soup.title and soup.title.string else "")).strip()
    if title_tag_text:
        title_match = re.match(
            r"^(.*?)\s*-\s*song and lyrics by\s*(.*?)\s*\|\s*Spotify$",
            title_tag_text,
            flags=re.IGNORECASE,
        )
        if title_match:
            tag_song = title_match.group(1).strip()
            tag_artist = title_match.group(2).strip()
            if tag_song:
                song = tag_song
            if tag_artist:
                artist = tag_artist

    if not song:
        raise RuntimeError("Could not parse track title from Spotify Open Graph metadata.")

    if not artist:
        artist = "Unknown Artist"

    return song, artist


def resolve_track_meta(track_id: str, timeout_seconds: int = 20) -> TrackMeta:
    spotify_url = spotify_track_url(track_id)

    song = ""
    artist = ""
    oembed_error: Exception | None = None

    try:
        response = requests.get(
            "https://open.spotify.com/oembed",
            params={"url": spotify_url},
            headers=REQUEST_HEADERS,
            timeout=timeout_seconds,
        )
        response.raise_for_status()

        payload = response.json()
        title = str(payload.get("title") or "").strip()
        author_name = str(payload.get("author_name") or "").strip()
        song, artist = split_title_artist(title, author_name)
    except Exception as error:  # noqa: BLE001
        oembed_error = error

    if not song or not artist or artist.lower() == "unknown artist":
        try:
            fallback_song, fallback_artist = resolve_track_meta_from_open_graph(spotify_url, timeout_seconds)
            if fallback_song:
                song = fallback_song
            if fallback_artist:
                artist = fallback_artist
        except Exception as fallback_error:  # noqa: BLE001
            if oembed_error and not song:
                raise RuntimeError(f"Spotify metadata lookup failed: {oembed_error}") from fallback_error
            if not song:
                raise

    return TrackMeta(
        track_id=track_id,
        spotify_url=spotify_url,
        song=song,
        artist=artist,
    )


def build_request_rows(csv_url: str, timeout_seconds: int = 30) -> list[RequestRow]:
    response = requests.get(csv_url, headers=REQUEST_HEADERS, timeout=timeout_seconds)
    response.raise_for_status()

    rows = parse_csv_rows(response.text)
    if not rows:
        return []

    headers = [str(value or "").strip() for value in rows[0]]

    timestamp_index = find_header_index(headers, ["Timestamp"], 0)
    email_index = find_header_index(headers, ["Email Address", "Email", "Student Email"], 1)
    spotify_link_index = find_header_index(
        headers,
        [
            "Please insert the Spotify song share link here:",
            "Spotify share link",
            "Spotify song share link",
            "Spotify link",
            "Song Link",
            "Track Link",
        ],
        2,
    )

    if spotify_link_index == -1:
        raise RuntimeError("Spotify link column was not found in request CSV headers.")

    results: list[RequestRow] = []

    for row in rows[1:]:
        if not isinstance(row, list):
            continue
        if not any(str(cell or "").strip() for cell in row):
            continue

        timestamp = str(row[timestamp_index] if timestamp_index < len(row) else "").strip()
        email = str(row[email_index] if email_index < len(row) else "").strip()
        spotify_link = str(row[spotify_link_index] if spotify_link_index < len(row) else "").strip()

        if not spotify_link:
            continue

        request_id = "|".join([timestamp, email, spotify_link])
        results.append(RequestRow(request_id=request_id, spotify_link=spotify_link))

    return results


def build_cache(
    request_rows: list[RequestRow],
    refresh_minutes: int,
    scrape_delay_ms: int,
    max_tracks: int,
) -> dict:
    grouped_request_ids: dict[str, list[str]] = {}

    for row in request_rows:
        track_id = extract_spotify_track_id(row.spotify_link)
        if not track_id:
            continue
        grouped_request_ids.setdefault(track_id, []).append(row.request_id)

    track_ids = sorted(grouped_request_ids.keys())[: max(1, max_tracks)]

    by_track_id: dict[str, dict] = {}
    by_song_key: dict[str, dict] = {}

    resolved_count = 0
    scrape_success_count = 0
    scrape_failure_count = 0

    for index, track_id in enumerate(track_ids):
        request_ids = grouped_request_ids.get(track_id, [])

        try:
            track_meta = resolve_track_meta(track_id)
            resolved_count += 1
        except Exception as error:  # noqa: BLE001
            scrape_failure_count += 1
            by_track_id[track_id] = {
                "track_id": track_id,
                "spotify_url": spotify_track_url(track_id),
                "status": "fallback",
                "lyrics": "",
                "error": f"Spotify metadata lookup failed: {error}",
                "updated_at": now_iso(),
                "request_ids": request_ids,
            }
            continue

        musixmatch_url = build_musixmatch_url(track_meta.artist, track_meta.song)

        entry = {
            "track_id": track_meta.track_id,
            "spotify_url": track_meta.spotify_url,
            "artist": track_meta.artist,
            "song": track_meta.song,
            "song_key": normalize_cache_key(track_meta.artist, track_meta.song),
            "musixmatch_url": musixmatch_url,
            "status": "fallback",
            "lyrics": "",
            "selector_used": "",
            "source": "github-actions-cache",
            "updated_at": now_iso(),
            "error": "",
            "request_ids": request_ids,
        }

        try:
            result = fetch_musixmatch_lyrics(url=musixmatch_url)
            entry["status"] = "success"
            entry["lyrics"] = result.lyrics
            entry["selector_used"] = result.selector_used
            scrape_success_count += 1
        except (LyricsFetchError, requests.RequestException) as error:
            entry["status"] = "fallback"
            entry["error"] = str(error)
            scrape_failure_count += 1
        except Exception as error:  # noqa: BLE001
            entry["status"] = "fallback"
            entry["error"] = f"Unexpected scrape error: {error}"
            scrape_failure_count += 1

        by_track_id[track_id] = entry

        song_key = entry.get("song_key") or ""
        if song_key:
            by_song_key[song_key] = entry

        if index < len(track_ids) - 1 and scrape_delay_ms > 0:
            time.sleep(scrape_delay_ms / 1000)

    generated_at = now_iso()
    next_refresh = (datetime.now(UTC) + timedelta(minutes=refresh_minutes)).isoformat().replace("+00:00", "Z")

    return {
        "generated_at": generated_at,
        "next_refresh_at": next_refresh,
        "refresh_interval_minutes": refresh_minutes,
        "source": {
            "requests_csv_url": os.environ.get("REQUESTS_CSV_URL", DEFAULT_REQUESTS_CSV_URL),
            "notes": "Generated by scripts/build_lyrics_cache.py via GitHub Actions",
        },
        "stats": {
            "request_rows": len(request_rows),
            "tracks_considered": len(track_ids),
            "spotify_meta_resolved": resolved_count,
            "lyrics_success": scrape_success_count,
            "lyrics_fallback": scrape_failure_count,
        },
        "by_track_id": by_track_id,
        "by_song_key": by_song_key,
    }


def write_cache_if_changed(cache_data: dict, cache_path: Path) -> bool:
    next_text = json.dumps(cache_data, ensure_ascii=False, indent=2) + "\n"

    if cache_path.exists():
        current_text = cache_path.read_text(encoding="utf-8")
        if current_text == next_text:
            return False

    cache_path.write_text(next_text, encoding="utf-8")
    return True


def main() -> int:
    csv_url = os.environ.get("REQUESTS_CSV_URL", DEFAULT_REQUESTS_CSV_URL)
    refresh_minutes = max(1, int(os.environ.get("LYRICS_CACHE_REFRESH_MINUTES", "5")))
    scrape_delay_ms = max(0, int(os.environ.get("LYRICS_SCRAPE_DELAY_MS", "250")))
    max_tracks = max(1, int(os.environ.get("LYRICS_CACHE_MAX_TRACKS", "120")))

    request_rows = build_request_rows(csv_url)
    cache_data = build_cache(
        request_rows=request_rows,
        refresh_minutes=refresh_minutes,
        scrape_delay_ms=scrape_delay_ms,
        max_tracks=max_tracks,
    )

    changed = write_cache_if_changed(cache_data, CACHE_PATH)

    stats = cache_data.get("stats") or {}
    print(
        "Cache build complete | "
        f"rows={stats.get('request_rows', 0)} "
        f"tracks={stats.get('tracks_considered', 0)} "
        f"success={stats.get('lyrics_success', 0)} "
        f"fallback={stats.get('lyrics_fallback', 0)} "
        f"changed={changed}"
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
