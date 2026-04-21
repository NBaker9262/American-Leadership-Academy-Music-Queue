from __future__ import annotations

import json
import re
import sqlite3
from typing import Any

from .db import now_iso


def normalize_cache_key(artist: str, title: str) -> str:
    safe_artist = re.sub(r"\s+", " ", str(artist or "").strip().lower())
    safe_title = re.sub(r"\s+", " ", str(title or "").strip().lower())
    safe_artist = re.sub(r"[^a-z0-9 ]+", "", safe_artist)
    safe_title = re.sub(r"[^a-z0-9 ]+", "", safe_title)
    return f"{safe_artist}|{safe_title}".strip("|")


def _json_loads(value: str, fallback: Any) -> Any:
    text = str(value or "").strip()
    if not text:
        return fallback
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return fallback


def hydrate_track(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "id": int(row["id"]),
        "song_key": str(row["song_key"]),
        "spotify_id": str(row["spotify_id"] or ""),
        "title": str(row["title"]),
        "artist": str(row["artist"]),
        "album": str(row["album"] or ""),
        "duration_ms": int(row["duration_ms"] or 0),
        "image_url": str(row["image_url"] or ""),
        "spotify_url": str(row["spotify_url"] or ""),
        "preview_url": str(row["preview_url"] or ""),
        "popularity": int(row["popularity"] or 0),
        "spotify_explicit": bool(int(row["spotify_explicit"] or 0)),
        "spotify_rating": str(row["spotify_rating"] or "unknown"),
        "lyrics_rating": str(row["lyrics_rating"] or "pending"),
        "merged_rating": str(row["merged_rating"] or "review"),
        "rating_reasons": _json_loads(str(row["rating_reasons_json"] or "[]"), []),
        "lyrics_status": str(row["lyrics_status"] or "missing"),
        "lyrics": str(row["lyrics"] or ""),
        "lyrics_excerpt": str(row["lyrics"] or "")[:240],
        "lyrics_source_url": str(row["lyrics_source_url"] or ""),
        "source": str(row["source"] or "local"),
        "metadata": _json_loads(str(row["metadata_json"] or "{}"), {}),
        "created_at": str(row["created_at"] or ""),
        "updated_at": str(row["updated_at"] or ""),
    }


def upsert_track(conn: sqlite3.Connection, payload: dict[str, Any]) -> dict[str, Any]:
    artist = str(payload.get("artist") or "").strip()
    title = str(payload.get("title") or "").strip()
    if not artist or not title:
        raise ValueError("artist and title are required")

    spotify_id = str(payload.get("spotify_id") or "").strip()
    song_key = str(payload.get("song_key") or normalize_cache_key(artist, title)).strip()
    metadata_json = json.dumps(payload.get("metadata") or {}, ensure_ascii=False)
    rating_reasons_json = json.dumps(payload.get("rating_reasons") or [], ensure_ascii=False)
    now = now_iso()

    existing = None
    if spotify_id:
        existing = conn.execute("SELECT * FROM tracks WHERE spotify_id=?", (spotify_id,)).fetchone()
    if not existing and song_key:
        existing = conn.execute("SELECT * FROM tracks WHERE song_key=?", (song_key,)).fetchone()

    values = (
        song_key,
        spotify_id,
        title,
        artist,
        str(payload.get("album") or ""),
        int(payload.get("duration_ms") or 0),
        str(payload.get("image_url") or ""),
        str(payload.get("spotify_url") or ""),
        str(payload.get("preview_url") or ""),
        int(payload.get("popularity") or 0),
        1 if payload.get("spotify_explicit") else 0,
        str(payload.get("spotify_rating") or "unknown"),
        str(payload.get("lyrics_rating") or "pending"),
        str(payload.get("merged_rating") or "review"),
        rating_reasons_json,
        str(payload.get("lyrics_status") or "missing"),
        str(payload.get("lyrics") or ""),
        str(payload.get("lyrics_source_url") or ""),
        str(payload.get("source") or "local"),
        metadata_json,
        now,
        now,
    )

    if existing:
        conn.execute(
            """
            UPDATE tracks
            SET song_key=?, spotify_id=?, title=?, artist=?, album=?, duration_ms=?, image_url=?, spotify_url=?,
                preview_url=?, popularity=?, spotify_explicit=?, spotify_rating=?, lyrics_rating=?, merged_rating=?,
                rating_reasons_json=?, lyrics_status=?, lyrics=?, lyrics_source_url=?, source=?, metadata_json=?,
                updated_at=?
            WHERE id=?
            """,
            values[:-2] + (now, int(existing["id"])),
        )
    else:
        conn.execute(
            """
            INSERT INTO tracks(
                song_key, spotify_id, title, artist, album, duration_ms, image_url, spotify_url, preview_url,
                popularity, spotify_explicit, spotify_rating, lyrics_rating, merged_rating, rating_reasons_json,
                lyrics_status, lyrics, lyrics_source_url, source, metadata_json, created_at, updated_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            values,
        )
    conn.commit()
    if spotify_id:
        row = conn.execute("SELECT * FROM tracks WHERE spotify_id=?", (spotify_id,)).fetchone()
    else:
        row = conn.execute("SELECT * FROM tracks WHERE song_key=?", (song_key,)).fetchone()
    return hydrate_track(row) or {}


def enqueue_scrape_job(conn: sqlite3.Connection, track_id: int, priority: int = 100) -> None:
    now = now_iso()
    conn.execute(
        """
        INSERT INTO scrape_jobs(track_id, status, priority, attempts, next_retry_at, last_error, created_at, updated_at)
        VALUES(?, 'queued', ?, 0, '', '', ?, ?)
        ON CONFLICT(track_id) DO UPDATE SET
            status=CASE
                WHEN scrape_jobs.status='done' THEN 'queued'
                ELSE scrape_jobs.status
            END,
            priority=MIN(scrape_jobs.priority, excluded.priority),
            next_retry_at='',
            updated_at=excluded.updated_at
        """,
        (track_id, int(priority), now, now),
    )
    conn.commit()


def get_track(conn: sqlite3.Connection, track_id: int) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM tracks WHERE id=?", (track_id,)).fetchone()
    return hydrate_track(row)


def list_recent_tracks(conn: sqlite3.Connection, limit: int = 18) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM tracks ORDER BY updated_at DESC, id DESC LIMIT ?",
        (max(1, int(limit)),),
    ).fetchall()
    return [hydrate_track(row) for row in rows if row]


def search_tracks_local(conn: sqlite3.Connection, query: str, limit: int = 20) -> list[dict[str, Any]]:
    text = f"%{str(query or '').strip()}%"
    rows = conn.execute(
        """
        SELECT * FROM tracks
        WHERE title LIKE ? OR artist LIKE ? OR album LIKE ?
        ORDER BY
            CASE merged_rating
                WHEN 'blocked' THEN 2
                WHEN 'review' THEN 1
                ELSE 0
            END,
            popularity DESC,
            updated_at DESC
        LIMIT ?
        """,
        (text, text, text, max(1, int(limit))),
    ).fetchall()
    return [hydrate_track(row) for row in rows if row]


def list_playlists(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT p.*, COUNT(pt.track_id) AS track_count
        FROM playlists p
        LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
        GROUP BY p.id
        ORDER BY LOWER(p.name) ASC
        """
    ).fetchall()
    return [
        {
            "id": int(row["id"]),
            "name": str(row["name"]),
            "description": str(row["description"] or ""),
            "track_count": int(row["track_count"] or 0),
            "created_at": str(row["created_at"] or ""),
            "updated_at": str(row["updated_at"] or ""),
        }
        for row in rows
    ]


def create_playlist(conn: sqlite3.Connection, name: str, description: str = "") -> dict[str, Any]:
    clean_name = str(name or "").strip()
    if not clean_name:
        raise ValueError("playlist name is required")
    now = now_iso()
    conn.execute(
        """
        INSERT INTO playlists(name, description, created_at, updated_at)
        VALUES(?, ?, ?, ?)
        """,
        (clean_name, str(description or "").strip(), now, now),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM playlists WHERE name=?", (clean_name,)).fetchone()
    return {
        "id": int(row["id"]),
        "name": str(row["name"]),
        "description": str(row["description"] or ""),
        "track_count": 0,
        "created_at": str(row["created_at"] or ""),
        "updated_at": str(row["updated_at"] or ""),
    }


def get_playlist(conn: sqlite3.Connection, playlist_id: int) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM playlists WHERE id=?", (playlist_id,)).fetchone()
    if not row:
        return None
    tracks = conn.execute(
        """
        SELECT t.*
        FROM playlist_tracks pt
        JOIN tracks t ON t.id = pt.track_id
        WHERE pt.playlist_id=?
        ORDER BY pt.position ASC, pt.added_at ASC
        """,
        (playlist_id,),
    ).fetchall()
    return {
        "id": int(row["id"]),
        "name": str(row["name"]),
        "description": str(row["description"] or ""),
        "tracks": [hydrate_track(track_row) for track_row in tracks if track_row],
    }


def add_tracks_to_playlist(conn: sqlite3.Connection, playlist_id: int, track_ids: list[int]) -> None:
    base_position_row = conn.execute(
        "SELECT COALESCE(MAX(position), 0) AS pos FROM playlist_tracks WHERE playlist_id=?",
        (playlist_id,),
    ).fetchone()
    position = int(base_position_row["pos"] or 0)
    for track_id in track_ids:
        position += 1
        conn.execute(
            """
            INSERT OR IGNORE INTO playlist_tracks(playlist_id, track_id, position, added_at)
            VALUES(?, ?, ?, ?)
            """,
            (playlist_id, int(track_id), position, now_iso()),
        )
    conn.execute("UPDATE playlists SET updated_at=? WHERE id=?", (now_iso(), playlist_id))
    conn.commit()


def list_queue(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT
            q.id AS queue_id,
            q.position AS queue_position,
            q.source_type,
            q.source_name,
            q.student_name,
            q.note,
            q.created_at AS queue_created_at,
            t.*
        FROM queue_entries q
        JOIN tracks t ON t.id = q.track_id
        WHERE q.status='queued'
        ORDER BY q.position ASC, q.id ASC
        """
    ).fetchall()
    result: list[dict[str, Any]] = []
    for row in rows:
        track = hydrate_track(row)
        result.append(
            {
                "id": int(row["queue_id"]),
                "position": int(row["queue_position"]),
                "source_type": str(row["source_type"] or ""),
                "source_name": str(row["source_name"] or ""),
                "student_name": str(row["student_name"] or ""),
                "note": str(row["note"] or ""),
                "created_at": str(row["queue_created_at"] or ""),
                "track": track,
            }
        )
    return result


def add_to_queue(
    conn: sqlite3.Connection,
    track_ids: list[int],
    *,
    source_type: str = "dj",
    source_name: str = "",
    student_name: str = "",
    note: str = "",
) -> None:
    row = conn.execute("SELECT COALESCE(MAX(position), 0) AS pos FROM queue_entries WHERE status='queued'").fetchone()
    position = int(row["pos"] or 0)
    for track_id in track_ids:
        position += 1
        conn.execute(
            """
            INSERT INTO queue_entries(track_id, status, source_type, source_name, student_name, note, position, created_at)
            VALUES(?, 'queued', ?, ?, ?, ?, ?, ?)
            """,
            (int(track_id), source_type, source_name, student_name, note, position, now_iso()),
        )
    conn.commit()


def move_queue_entry(conn: sqlite3.Connection, entry_id: int, direction: str) -> None:
    current = conn.execute("SELECT id, position FROM queue_entries WHERE id=? AND status='queued'", (entry_id,)).fetchone()
    if not current:
        return
    if direction == "up":
        swap = conn.execute(
            """
            SELECT id, position FROM queue_entries
            WHERE status='queued' AND position < ?
            ORDER BY position DESC LIMIT 1
            """,
            (int(current["position"]),),
        ).fetchone()
    else:
        swap = conn.execute(
            """
            SELECT id, position FROM queue_entries
            WHERE status='queued' AND position > ?
            ORDER BY position ASC LIMIT 1
            """,
            (int(current["position"]),),
        ).fetchone()
    if not swap:
        return
    conn.execute("UPDATE queue_entries SET position=? WHERE id=?", (int(swap["position"]), int(current["id"])))
    conn.execute("UPDATE queue_entries SET position=? WHERE id=?", (int(current["position"]), int(swap["id"])))
    conn.commit()


def remove_queue_entry(conn: sqlite3.Connection, entry_id: int) -> None:
    conn.execute("DELETE FROM queue_entries WHERE id=?", (entry_id,))
    conn.commit()


def add_student_request(conn: sqlite3.Connection, raw_query: str, student_name: str = "", note: str = "") -> dict[str, Any]:
    now = now_iso()
    conn.execute(
        """
        INSERT INTO student_requests(raw_query, student_name, note, status, created_at, updated_at)
        VALUES(?, ?, ?, 'pending', ?, ?)
        """,
        (str(raw_query or "").strip(), str(student_name or "").strip(), str(note or "").strip(), now, now),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM student_requests ORDER BY id DESC LIMIT 1").fetchone()
    return hydrate_request(conn, row)


def hydrate_request(conn: sqlite3.Connection, row: sqlite3.Row | None) -> dict[str, Any] | None:
    if not row:
        return None
    matched_track = None
    if row["matched_track_id"]:
        matched_track = get_track(conn, int(row["matched_track_id"]))
    return {
        "id": int(row["id"]),
        "raw_query": str(row["raw_query"]),
        "student_name": str(row["student_name"] or ""),
        "note": str(row["note"] or ""),
        "status": str(row["status"] or "pending"),
        "created_at": str(row["created_at"] or ""),
        "updated_at": str(row["updated_at"] or ""),
        "matched_track": matched_track,
    }


def list_student_requests(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM student_requests ORDER BY created_at DESC, id DESC LIMIT 100"
    ).fetchall()
    return [hydrate_request(conn, row) for row in rows if row]


def resolve_student_request(
    conn: sqlite3.Connection,
    request_id: int,
    *,
    status: str,
    matched_track_id: int | None = None,
) -> None:
    conn.execute(
        """
        UPDATE student_requests
        SET status=?, matched_track_id=?, updated_at=?
        WHERE id=?
        """,
        (status, matched_track_id, now_iso(), request_id),
    )
    conn.commit()


def scrape_counts(conn: sqlite3.Connection) -> dict[str, int]:
    rows = conn.execute("SELECT status, COUNT(1) AS c FROM scrape_jobs GROUP BY status").fetchall()
    result = {"total": 0}
    total = 0
    for row in rows:
        count = int(row["c"] or 0)
        result[str(row["status"])] = count
        total += count
    result["total"] = total
    return result
