from __future__ import annotations

import csv
import re


class SeedParseError(ValueError):
    pass


def _looks_like_number_line(text: str) -> bool:
    compact = str(text or "").strip().replace("\t", " ")
    parts = [part for part in compact.split() if part]
    return bool(parts) and all(re.fullmatch(r"[0-9][0-9,]*", part) for part in parts)


def _detect_text_format(lines: list[str]) -> str:
    blob = "\n".join(lines[:80]).lower()
    if "artist and title" in blob or "artist - title" in blob:
        return "artist-title"
    return "title-artist"


def parse_text_lines(text: str, *, fmt: str = "auto") -> list[dict[str, str]]:
    raw_lines = [str(line or "").strip() for line in str(text or "").splitlines()]
    lines = [line for line in raw_lines if line]

    if fmt == "auto":
        fmt = _detect_text_format(lines)
    if fmt not in {"title-artist", "artist-title"}:
        raise SeedParseError(f"Unknown text format: {fmt}")

    items: list[dict[str, str]] = []
    for line in lines:
        if not line or line.startswith("#") or _looks_like_number_line(line):
            continue
        left = ""
        right = ""
        if " - " in line:
            left, right = line.split(" - ", 1)
        else:
            by_parts = re.split(r"\s+by\s+", line, maxsplit=1, flags=re.IGNORECASE)
            if len(by_parts) == 2:
                left, right = by_parts[0], by_parts[1]
        left = left.strip()
        right = right.strip()
        if not left or not right:
            continue
        if fmt == "artist-title":
            artist, title = left, right
        else:
            title, artist = left, right
        items.append({"artist": artist, "title": title})
    return items


def _find_col(headers: list[str], candidates: list[str]) -> int:
    normalized = [str(header or "").strip().lower() for header in headers]
    for candidate in candidates:
        if candidate.lower() in normalized:
            return normalized.index(candidate.lower())
    for candidate in candidates:
        for idx, header in enumerate(normalized):
            if candidate.lower() in header:
                return idx
    return -1


def parse_csv_text(text: str) -> list[dict[str, str]]:
    rows = list(csv.reader(str(text or "").splitlines()))
    if not rows:
        return []
    headers = rows[0]
    title_idx = _find_col(headers, ["title", "song", "track", "track_name", "name"])
    artist_idx = _find_col(headers, ["artist", "artist_name", "artists", "primary_artist"])
    album_idx = _find_col(headers, ["album", "album_name"])
    spotify_id_idx = _find_col(headers, ["spotify_id", "track_id", "id"])
    explicit_idx = _find_col(headers, ["explicit", "is_explicit"])

    if title_idx == -1 or artist_idx == -1:
        raise SeedParseError(
            "CSV must include title/song and artist columns. "
            f"Headers seen: {headers}"
        )

    items: list[dict[str, str]] = []
    for row in rows[1:]:
        title = str(row[title_idx] if title_idx < len(row) else "").strip()
        artist = str(row[artist_idx] if artist_idx < len(row) else "").strip()
        if not title or not artist:
            continue
        item = {"artist": artist, "title": title}
        if album_idx != -1 and album_idx < len(row):
            item["album"] = str(row[album_idx]).strip()
        if spotify_id_idx != -1 and spotify_id_idx < len(row):
            item["spotify_id"] = str(row[spotify_id_idx]).strip()
        if explicit_idx != -1 and explicit_idx < len(row):
            item["spotify_explicit"] = str(row[explicit_idx]).strip()
        items.append(item)
    return items


def parse_input(filename: str, content: bytes, *, fmt: str = "auto") -> list[dict[str, str]]:
    name = str(filename or "").strip().lower()
    text = content.decode("utf-8", errors="replace")
    if name.endswith(".csv"):
        return parse_csv_text(text)
    return parse_text_lines(text, fmt=fmt)
