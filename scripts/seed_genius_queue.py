#!/usr/bin/env python3
"""Seed the Genius scraping queue (SQLite) from a text or CSV list.

Text format:
- One song per line
- Supported:
    - "Song Title - Artist" (default)
    - "Artist - Title" (use --format artist-title)
- Lines starting with # are ignored

CSV format:
- Must include columns that match: title/song + artist
  (examples: title, song, track_name, artist, artist_name)

Usage:
    python scripts/seed_genius_queue.py --in prom_dance_pack.txt
    python scripts/seed_genius_queue.py --in top10000.csv
    python scripts/seed_genius_queue.py --in pasted_table.txt --format artist-title

Env:
  GENIUS_DB_PATH=./data/genius_cache.sqlite3
"""

from __future__ import annotations

import argparse
import csv
import os
from dataclasses import dataclass
from pathlib import Path

from server.queue import seed_songs
from server.seed_parser import SeedParseError, parse_input
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="in_path", required=True, help="Input .txt or .csv song list")
    parser.add_argument(
        "--format",
        dest="fmt",
        default="auto",
        choices=["auto", "title-artist", "artist-title"],
        help="Text input orientation for lines with ' - '",
    )
    args = parser.parse_args()

    in_path = Path(args.in_path)
    if not in_path.exists():
        raise SystemExit(f"Input file not found: {in_path}")

    content = in_path.read_bytes()
    try:
        items = parse_input(in_path.name, content, fmt=args.fmt)
    except SeedParseError as exc:
        raise SystemExit(str(exc)) from exc

    db_path = get_db_path()
    conn = connect(db_path)
    migrate(conn)

    inserted = seed_songs(conn, items)
    print(f"Seeded queue | input={in_path} rows={len(items)} inserted={inserted} db={db_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
