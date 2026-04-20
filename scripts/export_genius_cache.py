#!/usr/bin/env python3
"""Export the Genius SQLite cache into chunked JSON files.

Usage:
  python scripts/export_genius_cache.py

Env:
  GENIUS_DB_PATH=./data/genius_cache.sqlite3
  GENIUS_EXPORT_DIR=./cache/genius
  GENIUS_EXPORT_CHUNK_SIZE=500
"""

from __future__ import annotations

import os
from pathlib import Path

from server.db import connect, get_db_path, migrate
from server.exporter import export_cache


def main() -> int:
    conn = connect(get_db_path())
    migrate(conn)

    out_dir = Path(os.environ.get("GENIUS_EXPORT_DIR") or (Path(__file__).resolve().parents[1] / "cache" / "genius"))
    chunk_size = int(os.environ.get("GENIUS_EXPORT_CHUNK_SIZE", "500"))
    include_lyrics = os.environ.get("GENIUS_EXPORT_INCLUDE_LYRICS", "1") not in {"0", "false", "no"}

    summary = export_cache(conn, out_dir=out_dir, chunk_size=chunk_size, include_lyrics=include_lyrics)
    print(f"Exported cache | out={out_dir} chunks={summary.get('stats', {}).get('chunks', 0)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
