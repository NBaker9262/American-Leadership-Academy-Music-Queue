from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass

from .db import now_iso


def normalize_cache_key(artist: str, title: str) -> str:
    safe_artist = re.sub(r"\s+", " ", str(artist or "").strip().lower())
    safe_title = re.sub(r"\s+", " ", str(title or "").strip().lower())
    if not safe_artist or not safe_title:
        return ""
    return f"{safe_artist}|{safe_title}"


@dataclass(frozen=True)
class SeedItem:
    artist: str
    title: str


def seed_songs(conn: sqlite3.Connection, items: list[SeedItem]) -> int:
    inserted = 0

    for item in items:
        artist = str(item.artist or "").strip()
        title = str(item.title or "").strip()
        if not artist or not title:
            continue

        song_key = normalize_cache_key(artist, title)
        if not song_key:
            continue

        created = now_iso()
        updated = created

        cur = conn.execute(
            """
            INSERT OR IGNORE INTO songs(
                song_key, artist, title, status, created_at, updated_at
            ) VALUES(?, ?, ?, 'queued', ?, ?)
            """,
            (song_key, artist, title, created, updated),
        )
        if cur.rowcount:
            inserted += 1

    conn.commit()
    return inserted


def counts(conn: sqlite3.Connection) -> dict[str, int]:
    rows = conn.execute("SELECT status, COUNT(1) AS c FROM songs GROUP BY status").fetchall()
    result: dict[str, int] = {"total": 0}
    total = 0
    for row in rows:
        status = str(row["status"])
        c = int(row["c"])
        result[status] = c
        total += c
    result["total"] = total
    return result
