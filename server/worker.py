from __future__ import annotations

import os
import random
import sqlite3
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import requests

from . import genius_client
from .db import now_iso, row_to_song


def parse_iso(value: str) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(UTC)
    except ValueError:
        return None


def iso_after(seconds: float) -> str:
    dt = datetime.now(UTC) + timedelta(seconds=max(0.0, float(seconds)))
    return dt.isoformat().replace("+00:00", "Z")


def backoff_seconds(attempt: int) -> float:
    # Exponential backoff with jitter: 5s, 10s, 20s, ... capped at 30min
    base = min(1800.0, 5.0 * (2 ** max(0, attempt - 1)))
    return base * (0.75 + random.random() * 0.5)


@dataclass
class WorkerConfig:
    min_delay_seconds: float = 0.6
    max_attempts: int = 10


@dataclass
class WorkerState:
    running: bool = False
    paused: bool = True
    current_song_key: str = ""
    current_title: str = ""
    current_artist: str = ""
    last_event: str = ""
    last_error: str = ""
    last_updated_at: str = ""


class GeniusScrapeWorker:
    def __init__(self, conn: sqlite3.Connection, config: WorkerConfig | None = None) -> None:
        self._conn = conn
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._state = WorkerState(running=False, paused=True)
        self._config = config or WorkerConfig()
        self._last_request_at = 0.0

    @property
    def state(self) -> WorkerState:
        with self._lock:
            return WorkerState(**self._state.__dict__)

    @property
    def config(self) -> WorkerConfig:
        return self._config

    def start(self) -> None:
        with self._lock:
            if self._thread and self._thread.is_alive():
                self._state.paused = False
                return
            self._stop.clear()
            self._state.running = True
            self._state.paused = False
            self._thread = threading.Thread(target=self._run, name="genius-worker", daemon=True)
            self._thread.start()

    def pause(self) -> None:
        with self._lock:
            self._state.paused = True
            self._state.last_event = "paused"
            self._state.last_updated_at = now_iso()

    def resume(self) -> None:
        with self._lock:
            self._state.paused = False
            self._state.last_event = "resumed"
            self._state.last_updated_at = now_iso()

    def stop(self) -> None:
        self._stop.set()
        with self._lock:
            self._state.running = False
            self._state.paused = True
            self._state.last_event = "stopped"
            self._state.last_updated_at = now_iso()

    def _sleep_rate_limit(self) -> None:
        delay = max(0.0, float(self._config.min_delay_seconds))
        now = time.time()
        remaining = (self._last_request_at + delay) - now
        if remaining > 0:
            time.sleep(remaining)
        self._last_request_at = time.time()

    def _next_job(self) -> sqlite3.Row | None:
        # pick a queued/retry row that's due
        row = self._conn.execute(
            """
            SELECT *
            FROM songs
            WHERE status IN ('queued','retry')
              AND (next_retry_at IS NULL OR next_retry_at = '' OR next_retry_at <= ?)
            ORDER BY id ASC
            LIMIT 1
            """,
            (now_iso(),),
        ).fetchone()
        return row

    def _mark_in_progress(self, song_id: int) -> None:
        self._conn.execute(
            "UPDATE songs SET status='in_progress', updated_at=? WHERE id=?",
            (now_iso(), song_id),
        )
        self._conn.commit()

    def _set_result(
        self,
        song_id: int,
        *,
        status: str,
        genius_id: str = "",
        genius_url: str = "",
        meta_json: str = "",
        lyrics: str = "",
        last_error: str = "",
        next_retry_at: str = "",
    ) -> None:
        self._conn.execute(
            """
            UPDATE songs
            SET status=?, genius_id=?, genius_url=?, meta_json=?, lyrics=?, last_error=?, next_retry_at=?, updated_at=?
            WHERE id=?
            """,
            (status, genius_id, genius_url, meta_json, lyrics, last_error, next_retry_at, now_iso(), song_id),
        )
        self._conn.commit()

    def _increment_attempt(self, song_id: int) -> int:
        self._conn.execute("UPDATE songs SET attempts = attempts + 1, updated_at=? WHERE id=?", (now_iso(), song_id))
        self._conn.commit()
        row = self._conn.execute("SELECT attempts FROM songs WHERE id=?", (song_id,)).fetchone()
        return int(row[0]) if row else 0

    def _run(self) -> None:
        token = None
        try:
            token = genius_client.get_access_token()
        except Exception as exc:  # noqa: BLE001
            with self._lock:
                self._state.last_error = str(exc)
                self._state.last_event = "missing_token"
                self._state.last_updated_at = now_iso()
                self._state.paused = True

        while not self._stop.is_set():
            with self._lock:
                paused = self._state.paused

            if paused:
                time.sleep(0.5)
                continue

            if not token:
                time.sleep(2.0)
                continue

            row = self._next_job()
            if not row:
                with self._lock:
                    self._state.current_song_key = ""
                    self._state.current_title = ""
                    self._state.current_artist = ""
                    self._state.last_event = "idle"
                    self._state.last_updated_at = now_iso()
                time.sleep(1.0)
                continue

            song = row_to_song(row)

            with self._lock:
                self._state.current_song_key = song.song_key
                self._state.current_title = song.title
                self._state.current_artist = song.artist
                self._state.last_event = "picked"
                self._state.last_updated_at = now_iso()

            self._mark_in_progress(song.id)
            attempt = self._increment_attempt(song.id)

            try:
                self._sleep_rate_limit()
                query = genius_client.clean_inline_text(f"{song.title} {song.artist}")
                hits = genius_client.genius_search(token, query)
                chosen = genius_client.choose_best_hit(hits=hits, title=song.title, artist=song.artist)
                if not chosen or not chosen.url:
                    raise genius_client.GeniusError("No Genius result URL")

                meta_blob = ""
                if chosen.genius_id:
                    try:
                        self._sleep_rate_limit()
                        details = genius_client.genius_song_details(token, chosen.genius_id)
                        # Keep only a small, stable subset (avoid massive nested fields).
                        keep = {
                            "id": details.get("id"),
                            "url": details.get("url"),
                            "title": details.get("title"),
                            "full_title": details.get("full_title"),
                            "song_art_image_url": details.get("song_art_image_url"),
                            "release_date": details.get("release_date"),
                            "pageviews": details.get("pageviews"),
                            "primary_artist": (details.get("primary_artist") or {}).get("name")
                            if isinstance(details.get("primary_artist"), dict)
                            else None,
                        }
                        import json as _json

                        meta_blob = _json.dumps(keep, ensure_ascii=False)
                    except Exception:
                        meta_blob = ""

                self._sleep_rate_limit()
                lyrics, resp = genius_client.fetch_lyrics_page(chosen.url)

                self._set_result(
                    song.id,
                    status="success",
                    genius_id=chosen.genius_id,
                    genius_url=chosen.url,
                    meta_json=meta_blob,
                    lyrics=lyrics,
                    last_error="",
                    next_retry_at="",
                )

                with self._lock:
                    self._state.last_event = "success"
                    self._state.last_error = ""
                    self._state.last_updated_at = now_iso()

            except requests.HTTPError as exc:
                resp = getattr(exc, "response", None)
                status_code = getattr(resp, "status_code", None)

                # Decide retry timing
                retry_at = ""
                error_text = f"HTTP {status_code or 'error'}"

                # 429: respect Retry-After if present
                if status_code == 429:
                    retry_after = 0.0
                    try:
                        retry_after = float((resp.headers or {}).get("Retry-After") or 0)
                    except Exception:  # noqa: BLE001
                        retry_after = 0.0
                    retry_after = retry_after if retry_after > 0 else backoff_seconds(attempt)
                    retry_at = iso_after(retry_after)
                    error_text = f"HTTP 429 rate-limited; retry_after={int(retry_after)}s"
                elif status_code and int(status_code) >= 500:
                    retry_at = iso_after(backoff_seconds(attempt))
                elif status_code in (403,):
                    # Often indicates bot/blocked; cool down longer
                    retry_at = iso_after(min(3600.0, backoff_seconds(attempt) * 4))
                    error_text = f"HTTP 403 blocked; cooling down"
                else:
                    retry_at = iso_after(backoff_seconds(attempt))

                final_status = "retry" if attempt < self._config.max_attempts else "failed"
                self._set_result(
                    song.id,
                    status=final_status,
                    last_error=error_text,
                    meta_json="",
                    next_retry_at=retry_at if final_status == "retry" else "",
                )

                with self._lock:
                    self._state.last_event = final_status
                    self._state.last_error = error_text
                    self._state.last_updated_at = now_iso()

            except Exception as exc:  # noqa: BLE001
                retry_at = iso_after(backoff_seconds(attempt))
                final_status = "retry" if attempt < self._config.max_attempts else "failed"
                self._set_result(
                    song.id,
                    status=final_status,
                    last_error=str(exc),
                    meta_json="",
                    next_retry_at=retry_at if final_status == "retry" else "",
                )

                with self._lock:
                    self._state.last_event = final_status
                    self._state.last_error = str(exc)
                    self._state.last_updated_at = now_iso()
