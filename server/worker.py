from __future__ import annotations

import json
import os
import random
import sqlite3
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import requests

from . import genius_client
from .db import now_iso
from .queue import hydrate_track
from .ratings import analyze_lyrics, merge_ratings, spotify_rating_from_explicit


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
    base = min(1800.0, 12.0 * (2 ** max(0, attempt - 1)))
    return base * (0.8 + random.random() * 0.4)


@dataclass
class WorkerConfig:
    min_delay_seconds: float = 1.1
    max_attempts: int = 12


@dataclass
class WorkerState:
    running: bool = False
    paused: bool = True
    current_track_id: int = 0
    current_title: str = ""
    current_artist: str = ""
    last_event: str = ""
    last_error: str = ""
    last_updated_at: str = ""


class GeniusScrapeWorker:
    def __init__(self, conn: sqlite3.Connection, config: WorkerConfig | None = None) -> None:
        self._conn = conn
        self._config = config or WorkerConfig()
        self._lock = threading.Lock()
        self._state = WorkerState(running=False, paused=True)
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
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
                self._state.running = True
                self._state.last_event = "resumed"
                self._state.last_updated_at = now_iso()
                return
            self._stop.clear()
            self._state.running = True
            self._state.paused = False
            self._state.last_event = "started"
            self._state.last_updated_at = now_iso()
            self._thread = threading.Thread(target=self._run, name="ala-genius-worker", daemon=True)
            self._thread.start()

    def pause(self) -> None:
        with self._lock:
            self._state.paused = True
            self._state.last_event = "paused"
            self._state.last_updated_at = now_iso()

    def resume(self) -> None:
        self.start()

    def stop(self) -> None:
        self._stop.set()
        with self._lock:
            self._state.running = False
            self._state.paused = True
            self._state.last_event = "stopped"
            self._state.last_updated_at = now_iso()

    def _sleep_rate_limit(self) -> None:
        delay = max(0.0, float(self._config.min_delay_seconds))
        wait_for = (self._last_request_at + delay) - time.time()
        if wait_for > 0:
            time.sleep(wait_for)
        self._last_request_at = time.time()

    def _claim_next_job(self) -> sqlite3.Row | None:
        row = self._conn.execute(
            """
            SELECT
                j.id AS job_id,
                j.track_id,
                j.attempts,
                t.title,
                t.artist
            FROM scrape_jobs j
            JOIN tracks t ON t.id = j.track_id
            WHERE j.status IN ('queued', 'retry')
              AND (j.next_retry_at = '' OR j.next_retry_at <= ?)
            ORDER BY j.priority ASC, j.id ASC
            LIMIT 1
            """,
            (now_iso(),),
        ).fetchone()
        if not row:
            return None
        self._conn.execute(
            "UPDATE scrape_jobs SET status='in_progress', updated_at=? WHERE id=?",
            (now_iso(), int(row["job_id"])),
        )
        self._conn.commit()
        return row

    def _complete_job(self, job_id: int) -> None:
        self._conn.execute(
            "UPDATE scrape_jobs SET status='done', updated_at=?, last_error='', next_retry_at='' WHERE id=?",
            (now_iso(), job_id),
        )
        self._conn.commit()

    def _retry_job(self, job_id: int, attempt: int, error_text: str) -> None:
        retry_status = "retry" if attempt < self._config.max_attempts else "failed"
        next_retry = iso_after(backoff_seconds(attempt)) if retry_status == "retry" else ""
        self._conn.execute(
            """
            UPDATE scrape_jobs
            SET status=?, attempts=?, last_error=?, next_retry_at=?, updated_at=?
            WHERE id=?
            """,
            (retry_status, attempt, error_text, next_retry, now_iso(), job_id),
        )
        self._conn.commit()

    def _update_track_with_lyrics(self, track_id: int, lyrics: str, source_url: str) -> None:
        track_row = self._conn.execute("SELECT * FROM tracks WHERE id=?", (track_id,)).fetchone()
        track = hydrate_track(track_row)
        spotify_rating = spotify_rating_from_explicit(track["spotify_explicit"] if track else None)
        lyric_result = analyze_lyrics(lyrics)
        merged_rating, merged_reasons = merge_ratings(spotify_rating, str(lyric_result["lyrics_rating"]))
        reasons = list(dict.fromkeys([*merged_reasons, *list(lyric_result["reasons"])]))
        self._conn.execute(
            """
            UPDATE tracks
            SET spotify_rating=?, lyrics_rating=?, merged_rating=?, rating_reasons_json=?,
                lyrics_status='scraped', lyrics=?, lyrics_source_url=?, updated_at=?
            WHERE id=?
            """,
            (
                spotify_rating,
                str(lyric_result["lyrics_rating"]),
                merged_rating,
                json.dumps(reasons, ensure_ascii=False),
                lyrics,
                source_url,
                now_iso(),
                track_id,
            ),
        )
        self._conn.commit()

    def _mark_missing_lyrics(self, track_id: int, error_text: str) -> None:
        track_row = self._conn.execute("SELECT * FROM tracks WHERE id=?", (track_id,)).fetchone()
        track = hydrate_track(track_row)
        spotify_rating = spotify_rating_from_explicit(track["spotify_explicit"] if track else None)
        merged_rating, reasons = merge_ratings(spotify_rating, "pending")
        reasons.append(error_text)
        self._conn.execute(
            """
            UPDATE tracks
            SET spotify_rating=?, lyrics_rating='pending', merged_rating=?, rating_reasons_json=?,
                lyrics_status='missing', updated_at=?
            WHERE id=?
            """,
            (spotify_rating, merged_rating, json.dumps(reasons, ensure_ascii=False), now_iso(), track_id),
        )
        self._conn.commit()

    def _run(self) -> None:
        token = str(os.environ.get("GENIUS_ACCESS_TOKEN") or "").strip()
        if not token:
            with self._lock:
                self._state.paused = True
                self._state.last_event = "missing_token"
                self._state.last_error = "Missing GENIUS_ACCESS_TOKEN"
                self._state.last_updated_at = now_iso()

        while not self._stop.is_set():
            with self._lock:
                paused = self._state.paused

            if paused:
                time.sleep(0.6)
                continue

            if not token:
                token = str(os.environ.get("GENIUS_ACCESS_TOKEN") or "").strip()
                time.sleep(2.0)
                continue

            row = self._claim_next_job()
            if not row:
                with self._lock:
                    self._state.current_track_id = 0
                    self._state.current_title = ""
                    self._state.current_artist = ""
                    self._state.last_event = "idle"
                    self._state.last_updated_at = now_iso()
                time.sleep(1.0)
                continue

            job_id = int(row["job_id"])
            track_id = int(row["track_id"])
            title = str(row["title"] or "")
            artist = str(row["artist"] or "")
            attempt = int(row["attempts"] or 0) + 1

            with self._lock:
                self._state.current_track_id = track_id
                self._state.current_title = title
                self._state.current_artist = artist
                self._state.last_event = "scraping"
                self._state.last_error = ""
                self._state.last_updated_at = now_iso()

            try:
                self._sleep_rate_limit()
                query = genius_client.clean_inline_text(f"{title} {artist}")
                hits = genius_client.genius_search(token, query)
                chosen = genius_client.choose_best_hit(hits=hits, title=title, artist=artist)
                if not chosen or not chosen.url:
                    raise RuntimeError("No Genius result URL found")
                self._sleep_rate_limit()
                lyrics, _resp = genius_client.fetch_lyrics_page(chosen.url)
                self._update_track_with_lyrics(track_id, lyrics, chosen.url)
                self._complete_job(job_id)
                with self._lock:
                    self._state.last_event = "success"
                    self._state.last_updated_at = now_iso()
            except requests.HTTPError as exc:
                status_code = getattr(getattr(exc, "response", None), "status_code", None)
                error_text = f"Genius HTTP {status_code or 'error'}"
                self._retry_job(job_id, attempt, error_text)
                self._mark_missing_lyrics(track_id, error_text)
                with self._lock:
                    self._state.last_event = "retry" if attempt < self._config.max_attempts else "failed"
                    self._state.last_error = error_text
                    self._state.last_updated_at = now_iso()
            except Exception as exc:  # noqa: BLE001
                error_text = str(exc)
                self._retry_job(job_id, attempt, error_text)
                self._mark_missing_lyrics(track_id, error_text)
                with self._lock:
                    self._state.last_event = "retry" if attempt < self._config.max_attempts else "failed"
                    self._state.last_error = error_text
                    self._state.last_updated_at = now_iso()
