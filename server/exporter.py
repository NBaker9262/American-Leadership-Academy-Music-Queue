from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from .db import now_iso


def export_cache(
    conn: sqlite3.Connection,
    *,
    out_dir: Path,
    chunk_size: int = 500,
    include_lyrics: bool = True,
) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = conn.execute("SELECT * FROM tracks ORDER BY id ASC").fetchall()
    entries = []
    for row in rows:
        entry = {
            "id": int(row["id"]),
            "song_key": str(row["song_key"]),
            "spotify_id": str(row["spotify_id"] or ""),
            "title": str(row["title"]),
            "artist": str(row["artist"]),
            "album": str(row["album"] or ""),
            "spotify_rating": str(row["spotify_rating"] or ""),
            "lyrics_rating": str(row["lyrics_rating"] or ""),
            "merged_rating": str(row["merged_rating"] or ""),
            "lyrics_status": str(row["lyrics_status"] or ""),
            "lyrics_source_url": str(row["lyrics_source_url"] or ""),
            "spotify_url": str(row["spotify_url"] or ""),
            "updated_at": str(row["updated_at"] or ""),
            "rating_reasons": json.loads(str(row["rating_reasons_json"] or "[]")),
            "metadata": json.loads(str(row["metadata_json"] or "{}")),
        }
        if include_lyrics:
            entry["lyrics"] = str(row["lyrics"] or "")
        entries.append(entry)

    chunk_size = max(1, int(chunk_size))
    chunks: list[Path] = []
    for start in range(0, len(entries), chunk_size):
        chunk_index = (start // chunk_size) + 1
        chunk_entries = entries[start : start + chunk_size]
        path = out_dir / f"tracks_{chunk_index:04d}.json"
        path.write_text(json.dumps(chunk_entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        chunks.append(path)

    summary = {
        "generated_at": now_iso(),
        "stats": {
            "rows": len(entries),
            "chunks": len(chunks),
            "chunk_size": chunk_size,
        },
        "chunks": [path.as_posix() for path in chunks],
    }
    (out_dir / "index.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return summary
