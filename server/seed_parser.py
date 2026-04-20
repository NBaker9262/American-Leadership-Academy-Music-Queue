from __future__ import annotations

import csv
import re
from dataclasses import dataclass

from .queue import SeedItem


class SeedParseError(ValueError):
    pass


def _looks_like_number_line(text: str) -> bool:
    # Matches lines like: "5,375,760,672\t1,420,892" or just a big number.
    compact = str(text or "").strip()
    if not compact:
        return False

    compact = compact.replace("\t", " ")
    parts = [p for p in compact.split() if p]
    if not parts:
        return False

    numeric_parts = 0
    for part in parts:
        if re.fullmatch(r"[0-9][0-9,]*", part):
            numeric_parts += 1

    return numeric_parts == len(parts) and numeric_parts >= 1


def _detect_text_format(lines: list[str]) -> str:
    blob = "\n".join(lines[:80]).lower()

    # Some pasted tables include these headers.
    if "artist and title" in blob:
        return "artist-title"

    # Default to the existing prom_dance_pack style.
    return "title-artist"


def parse_text_lines(text: str, *, fmt: str = "auto") -> list[SeedItem]:
    raw_lines = [str(line or "").strip() for line in str(text or "").splitlines()]
    lines = [line for line in raw_lines if line]

    if fmt not in {"auto", "title-artist", "artist-title"}:
        raise SeedParseError(f"Unknown format: {fmt}")

    if fmt == "auto":
        fmt = _detect_text_format(lines)

    items: list[SeedItem] = []

    for line in lines:
        if not line or line.startswith("#"):
            continue
        if _looks_like_number_line(line):
            continue

        lower = line.lower()
        # skip obvious header noise
        if lower in {
            "itunes",
            "worldwide",
            "artists",
            "charts",
            "spotify",
            "youtube",
            "trending",
            "home",
            "countries",
            "listeners",
            "top lists",
        }:
            continue
        if "streams" in lower and "daily" in lower:
            continue
        if "spotify most streamed songs" in lower:
            continue

        title = ""
        artist = ""

        if " - " in line:
            left, right = line.split(" - ", 1)
            left = left.strip()
            right = right.strip()
            if fmt == "artist-title":
                artist, title = left, right
            else:
                title, artist = left, right
        else:
            by_split = re.split(r"\s+by\s+", line, maxsplit=1, flags=re.IGNORECASE)
            if len(by_split) == 2:
                title = by_split[0].strip()
                artist = by_split[1].strip()
            else:
                # Not enough structure; skip.
                continue

        if title and artist:
            items.append(SeedItem(artist=artist, title=title))

    return items


def _find_col(headers: list[str], candidates: list[str]) -> int:
    normalized = [str(h or "").strip().lower() for h in headers]
    for cand in candidates:
        c = cand.lower()
        if c in normalized:
            return normalized.index(c)

    for cand in candidates:
        c = cand.lower()
        for idx, header in enumerate(normalized):
            if c in header:
                return idx

    return -1


def parse_csv_text(text: str) -> list[SeedItem]:
    rows = list(csv.reader(str(text or "").splitlines()))
    if not rows:
        return []

    headers = rows[0]
    title_idx = _find_col(headers, ["title", "song", "track", "track_name", "name"])
    artist_idx = _find_col(headers, ["artist", "artist_name", "artists", "primary_artist"])

    if title_idx == -1 or artist_idx == -1:
        raise SeedParseError(
            "CSV missing required columns. Need something like title/song and artist/artist_name. "
            f"Headers were: {headers}"
        )

    items: list[SeedItem] = []
    for row in rows[1:]:
        if not row:
            continue
        title = str(row[title_idx] if title_idx < len(row) else "").strip()
        artist = str(row[artist_idx] if artist_idx < len(row) else "").strip()
        if title and artist:
            items.append(SeedItem(artist=artist, title=title))
    return items


def parse_input(filename: str, content: bytes, *, fmt: str = "auto") -> list[SeedItem]:
    name = str(filename or "").lower().strip()
    text = content.decode("utf-8", errors="replace")

    if name.endswith(".csv"):
        return parse_csv_text(text)

    return parse_text_lines(text, fmt=fmt)
