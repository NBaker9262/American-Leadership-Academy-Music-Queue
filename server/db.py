from __future__ import annotations

import json
import os
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

DEFAULT_DB_PATH = Path(__file__).resolve().parents[1] / "data" / "ala_music.sqlite3"

DEFAULT_PLAYLISTS = (
    ("Main Floor", "Primary DJ playlist for the event."),
    ("Warm Up", "Early event songs and arrivals."),
    ("Slow Set", "Slower songs and couples dance block."),
    ("Student Requests", "Songs approved from student requests."),
)


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def get_db_path() -> Path:
    raw = str(os.environ.get("ALA_DB_PATH") or os.environ.get("GENIUS_DB_PATH") or "").strip()
    return Path(raw) if raw else DEFAULT_DB_PATH


def connect(db_path: Path | None = None) -> sqlite3.Connection:
    path = Path(db_path or get_db_path())
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (name,),
    ).fetchone()
    return bool(row)


def _seed_default_playlists(conn: sqlite3.Connection) -> None:
    for name, description in DEFAULT_PLAYLISTS:
        conn.execute(
            """
            INSERT OR IGNORE INTO playlists(name, description, created_at, updated_at)
            VALUES(?, ?, ?, ?)
            """,
            (name, description, now_iso(), now_iso()),
        )


def _import_legacy_songs(conn: sqlite3.Connection) -> None:
    if not _table_exists(conn, "songs"):
        return

    existing_track_count = conn.execute("SELECT COUNT(1) FROM tracks").fetchone()[0]
    if int(existing_track_count or 0) > 0:
        return

    legacy_rows = conn.execute(
        """
        SELECT song_key, artist, title, genius_url, meta_json, lyrics, status, updated_at, created_at
        FROM songs
        ORDER BY id ASC
        """
    ).fetchall()

    for row in legacy_rows:
        meta_blob = row["meta_json"] or ""
        spotify_meta = {}
        if meta_blob:
            try:
                spotify_meta = json.loads(str(meta_blob))
            except json.JSONDecodeError:
                spotify_meta = {"legacy_meta": str(meta_blob)}

        conn.execute(
            """
            INSERT OR IGNORE INTO tracks(
                song_key,
                title,
                artist,
                album,
                image_url,
                spotify_url,
                spotify_explicit,
                spotify_rating,
                lyrics_rating,
                merged_rating,
                lyrics_status,
                lyrics,
                lyrics_source_url,
                source,
                metadata_json,
                created_at,
                updated_at
            ) VALUES(?, ?, ?, '', ?, '', 0, 'unknown', ?, ?, ?, ?, ?, 'legacy-import', ?, ?, ?)
            """,
            (
                str(row["song_key"] or ""),
                str(row["title"] or ""),
                str(row["artist"] or ""),
                str(spotify_meta.get("song_art_image_url") or ""),
                "clean" if str(row["lyrics"] or "").strip() else "pending",
                "clean" if str(row["lyrics"] or "").strip() else "review",
                "scraped" if str(row["lyrics"] or "").strip() else "missing",
                str(row["lyrics"] or ""),
                str(row["genius_url"] or ""),
                json.dumps(spotify_meta, ensure_ascii=False),
                str(row["created_at"] or now_iso()),
                str(row["updated_at"] or now_iso()),
            ),
        )


def migrate(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            song_key TEXT NOT NULL UNIQUE,
            spotify_id TEXT UNIQUE,
            title TEXT NOT NULL,
            artist TEXT NOT NULL,
            album TEXT NOT NULL DEFAULT '',
            duration_ms INTEGER NOT NULL DEFAULT 0,
            image_url TEXT NOT NULL DEFAULT '',
            spotify_url TEXT NOT NULL DEFAULT '',
            preview_url TEXT NOT NULL DEFAULT '',
            popularity INTEGER NOT NULL DEFAULT 0,
            spotify_explicit INTEGER NOT NULL DEFAULT 0,
            spotify_rating TEXT NOT NULL DEFAULT 'unknown',
            lyrics_rating TEXT NOT NULL DEFAULT 'pending',
            merged_rating TEXT NOT NULL DEFAULT 'review',
            rating_reasons_json TEXT NOT NULL DEFAULT '[]',
            lyrics_status TEXT NOT NULL DEFAULT 'missing',
            lyrics TEXT NOT NULL DEFAULT '',
            lyrics_source_url TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL DEFAULT 'local',
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_tracks_lookup ON tracks(artist, title);
        CREATE INDEX IF NOT EXISTS idx_tracks_spotify_id ON tracks(spotify_id);
        CREATE INDEX IF NOT EXISTS idx_tracks_rating ON tracks(merged_rating, lyrics_status);

        CREATE TABLE IF NOT EXISTS playlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS playlist_tracks (
            playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            added_at TEXT NOT NULL,
            PRIMARY KEY (playlist_id, track_id)
        );

        CREATE INDEX IF NOT EXISTS idx_playlist_tracks_position
            ON playlist_tracks(playlist_id, position);

        CREATE TABLE IF NOT EXISTS queue_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'queued',
            source_type TEXT NOT NULL DEFAULT 'dj',
            source_name TEXT NOT NULL DEFAULT '',
            student_name TEXT NOT NULL DEFAULT '',
            note TEXT NOT NULL DEFAULT '',
            position INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_queue_entries_position
            ON queue_entries(status, position);

        CREATE TABLE IF NOT EXISTS student_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            raw_query TEXT NOT NULL,
            student_name TEXT NOT NULL DEFAULT '',
            note TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending',
            matched_track_id INTEGER REFERENCES tracks(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS scrape_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id INTEGER NOT NULL UNIQUE REFERENCES tracks(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'queued',
            priority INTEGER NOT NULL DEFAULT 100,
            attempts INTEGER NOT NULL DEFAULT 0,
            next_retry_at TEXT NOT NULL DEFAULT '',
            last_error TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_scrape_jobs_status
            ON scrape_jobs(status, next_retry_at, priority, id);

        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """
    )
    _seed_default_playlists(conn)
    _import_legacy_songs(conn)
    conn.commit()


def get_setting(conn: sqlite3.Connection, key: str, default: str = "") -> str:
    row = conn.execute("SELECT value FROM app_settings WHERE key=?", (key,)).fetchone()
    return str(row["value"]) if row else default


def set_setting(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        """
        INSERT INTO app_settings(key, value, updated_at)
        VALUES(?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
            value=excluded.value,
            updated_at=excluded.updated_at
        """,
        (key, value, now_iso()),
    )
    conn.commit()
