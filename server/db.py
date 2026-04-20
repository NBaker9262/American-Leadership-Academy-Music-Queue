from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

DEFAULT_DB_PATH = Path(__file__).resolve().parents[1] / "data" / "genius_cache.sqlite3"


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def get_db_path() -> Path:
    raw = str(os.environ.get("GENIUS_DB_PATH") or "").strip()
    if raw:
        return Path(raw)
    return DEFAULT_DB_PATH


def connect(db_path: Path | None = None) -> sqlite3.Connection:
    path = Path(db_path or get_db_path())
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn


def migrate(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            song_key TEXT NOT NULL UNIQUE,
            artist TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL,
            genius_id TEXT,
            genius_url TEXT,
            meta_json TEXT,
            lyrics TEXT,
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            next_retry_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_songs_status_next_retry
            ON songs(status, next_retry_at);

        CREATE INDEX IF NOT EXISTS idx_songs_song_key
            ON songs(song_key);
        """
    )

    # If the table pre-exists from an older version, ensure new columns exist.
    existing_cols = {
        str(row["name"]).strip().lower()
        for row in conn.execute("PRAGMA table_info(songs)").fetchall()
        if row and row["name"]
    }

    def ensure_column(name: str, ddl: str) -> None:
        if name.lower() in existing_cols:
            return
        conn.execute(f"ALTER TABLE songs ADD COLUMN {ddl}")
        existing_cols.add(name.lower())

    ensure_column("meta_json", "meta_json TEXT")

    conn.commit()


@dataclass(frozen=True)
class SongRow:
    id: int
    song_key: str
    artist: str
    title: str
    status: str
    genius_id: str
    genius_url: str
    attempts: int
    last_error: str
    created_at: str
    updated_at: str
    next_retry_at: str


def row_to_song(row: sqlite3.Row) -> SongRow:
    return SongRow(
        id=int(row["id"]),
        song_key=str(row["song_key"]),
        artist=str(row["artist"]),
        title=str(row["title"]),
        status=str(row["status"]),
        genius_id=str(row["genius_id"] or ""),
        genius_url=str(row["genius_url"] or ""),
        attempts=int(row["attempts"] or 0),
        last_error=str(row["last_error"] or ""),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
        next_retry_at=str(row["next_retry_at"] or ""),
    )
