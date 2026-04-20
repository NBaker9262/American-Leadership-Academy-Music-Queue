from __future__ import annotations

import json
import os
import sqlite3
from datetime import UTC, datetime
from pathlib import Path


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def export_cache(
    conn: sqlite3.Connection,
    *,
    out_dir: Path,
    chunk_size: int = 500,
    include_lyrics: bool = True,
) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = conn.execute(
        """
        SELECT song_key, artist, title, status, genius_id, genius_url, meta_json, lyrics, attempts, last_error, updated_at
        FROM songs
        ORDER BY id ASC
        """
    ).fetchall()

    def row_to_entry(row: sqlite3.Row) -> dict:
        entry = {
            "song_key": str(row["song_key"]),
            "artist": str(row["artist"]),
            "song": str(row["title"]),
            "status": str(row["status"]),
            "genius_id": str(row["genius_id"] or ""),
            "genius_url": str(row["genius_url"] or ""),
            "genius_meta": str(row["meta_json"] or ""),
            "attempts": int(row["attempts"] or 0),
            "error": str(row["last_error"] or ""),
            "updated_at": str(row["updated_at"] or ""),
        }
        if include_lyrics:
            entry["lyrics"] = str(row["lyrics"] or "")
        return entry

    entries = [row_to_entry(row) for row in rows]

    chunk_size = max(1, int(chunk_size))
    chunks: list[Path] = []

    for start in range(0, len(entries), chunk_size):
        chunk_index = (start // chunk_size) + 1
        chunk_entries = entries[start : start + chunk_size]
        path = out_dir / f"chunk_{chunk_index:04d}.json"
        path.write_text(json.dumps(chunk_entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        chunks.append(path)

    summary = {
        "generated_at": now_iso(),
        "source": {
            "notes": "Exported by server/exporter.py",
        },
        "stats": {
            "rows": len(entries),
            "chunks": len(chunks),
            "chunk_size": chunk_size,
        },
        "chunks": [str(p.as_posix()) for p in chunks],
    }

    (out_dir / "index.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return summary
