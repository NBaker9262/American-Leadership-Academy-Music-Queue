from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import exporter
from .db import connect, get_db_path, migrate
from .queue import (
    add_student_request,
    add_to_queue,
    add_tracks_to_playlist,
    create_playlist,
    enqueue_scrape_job,
    get_playlist,
    get_track,
    hydrate_track,
    list_playlists,
    list_queue,
    list_recent_tracks,
    list_student_requests,
    move_queue_entry,
    remove_queue_entry,
    resolve_student_request,
    scrape_counts,
    search_tracks_local,
    upsert_track,
)
from .ratings import merge_ratings, spotify_rating_from_explicit
from .seed_parser import SeedParseError, parse_input
from .spotify_client import SpotifyClient
from .worker import GeniusScrapeWorker, WorkerConfig

ROOT_DIR = Path(__file__).resolve().parents[1]
WEB_DIR = ROOT_DIR / "web"

app = FastAPI(title="ALA Music Queue")
app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")

conn = connect(get_db_path())
migrate(conn)
spotify = SpotifyClient()
worker = GeniusScrapeWorker(
    conn,
    config=WorkerConfig(
        min_delay_seconds=float(os.environ.get("GENIUS_MIN_DELAY_SECONDS", "1.1")),
        max_attempts=int(os.environ.get("GENIUS_MAX_ATTEMPTS", "12")),
    ),
)

if str(os.environ.get("ALA_AUTO_START_WORKER") or "1").strip().lower() not in {"0", "false", "no"}:
    worker.start()


def _track_from_spotify_item(item: dict[str, Any]) -> dict[str, Any]:
    spotify_rating = spotify_rating_from_explicit(bool(item.get("spotify_explicit")))
    merged_rating, reasons = merge_ratings(spotify_rating, "pending")
    item["spotify_rating"] = spotify_rating
    item["lyrics_rating"] = "pending"
    item["merged_rating"] = merged_rating
    item["rating_reasons"] = reasons
    item["lyrics_status"] = "missing"
    return item


def _bootstrap_payload() -> dict[str, Any]:
    return {
        "ok": True,
        "config": {
            "db_path": str(get_db_path().as_posix()),
            "spotify_enabled": spotify.enabled,
            "genius_enabled": bool(str(os.environ.get("GENIUS_ACCESS_TOKEN") or "").strip()),
        },
        "playlists": list_playlists(conn),
        "queue": list_queue(conn),
        "requests": list_student_requests(conn),
        "recent_tracks": list_recent_tracks(conn),
        "scrape": {
            "counts": scrape_counts(conn),
            "worker": worker.state.__dict__,
        },
    }


@app.get("/")
def home() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


@app.get("/api/bootstrap")
def api_bootstrap() -> JSONResponse:
    return JSONResponse(_bootstrap_payload())


@app.get("/api/search")
def api_search(q: str = "", limit: int = 16) -> JSONResponse:
    query = str(q or "").strip()
    if not query:
        return JSONResponse({"ok": True, "results": []})

    local_results = search_tracks_local(conn, query, limit=limit)
    local_by_key = {track["song_key"]: track for track in local_results}

    if spotify.enabled:
        try:
            spotify_results = spotify.search_tracks(query, limit=limit)
            for item in spotify_results:
                saved = upsert_track(conn, _track_from_spotify_item(item))
                enqueue_scrape_job(conn, int(saved["id"]), priority=80)
                local_by_key[saved["song_key"]] = saved
        except Exception as exc:  # noqa: BLE001
            return JSONResponse({"ok": True, "results": list(local_by_key.values()), "warning": str(exc)})

    return JSONResponse({"ok": True, "results": list(local_by_key.values())[:limit]})


@app.get("/api/tracks/{track_id}")
def api_track(track_id: int) -> JSONResponse:
    track = get_track(conn, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    return JSONResponse({"ok": True, "track": track})


@app.get("/api/playlists")
def api_playlists() -> JSONResponse:
    return JSONResponse({"ok": True, "playlists": list_playlists(conn)})


@app.post("/api/playlists")
def api_create_playlist(payload: dict[str, Any] = Body(...)) -> JSONResponse:
    playlist = create_playlist(conn, str(payload.get("name") or ""), str(payload.get("description") or ""))
    return JSONResponse({"ok": True, "playlist": playlist})


@app.get("/api/playlists/{playlist_id}")
def api_playlist(playlist_id: int) -> JSONResponse:
    playlist = get_playlist(conn, playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return JSONResponse({"ok": True, "playlist": playlist})


@app.post("/api/playlists/{playlist_id}/tracks")
def api_playlist_add_tracks(playlist_id: int, payload: dict[str, Any] = Body(...)) -> JSONResponse:
    track_ids = [int(track_id) for track_id in payload.get("track_ids") or []]
    add_tracks_to_playlist(conn, playlist_id, track_ids)
    return JSONResponse({"ok": True, "playlist": get_playlist(conn, playlist_id)})


@app.post("/api/queue")
def api_add_queue(payload: dict[str, Any] = Body(...)) -> JSONResponse:
    track_ids = [int(track_id) for track_id in payload.get("track_ids") or []]
    add_to_queue(
        conn,
        track_ids,
        source_type=str(payload.get("source_type") or "dj"),
        source_name=str(payload.get("source_name") or ""),
        student_name=str(payload.get("student_name") or ""),
        note=str(payload.get("note") or ""),
    )
    return JSONResponse({"ok": True, "queue": list_queue(conn)})


@app.post("/api/queue/{entry_id}/move")
def api_move_queue(entry_id: int, payload: dict[str, Any] = Body(...)) -> JSONResponse:
    move_queue_entry(conn, entry_id, str(payload.get("direction") or "up"))
    return JSONResponse({"ok": True, "queue": list_queue(conn)})


@app.delete("/api/queue/{entry_id}")
def api_remove_queue(entry_id: int) -> JSONResponse:
    remove_queue_entry(conn, entry_id)
    return JSONResponse({"ok": True, "queue": list_queue(conn)})


@app.get("/api/requests")
def api_requests() -> JSONResponse:
    return JSONResponse({"ok": True, "requests": list_student_requests(conn)})


@app.post("/api/requests")
def api_add_request(payload: dict[str, Any] = Body(...)) -> JSONResponse:
    request = add_student_request(
        conn,
        str(payload.get("raw_query") or ""),
        student_name=str(payload.get("student_name") or ""),
        note=str(payload.get("note") or ""),
    )
    return JSONResponse({"ok": True, "request": request})


@app.post("/api/requests/{request_id}/resolve")
def api_resolve_request(request_id: int, payload: dict[str, Any] = Body(...)) -> JSONResponse:
    status = str(payload.get("status") or "queued")
    matched_track_id = payload.get("matched_track_id")
    matched_track_id_int = int(matched_track_id) if matched_track_id is not None else None
    resolve_student_request(conn, request_id, status=status, matched_track_id=matched_track_id_int)
    if status == "queued" and matched_track_id_int:
        add_to_queue(conn, [matched_track_id_int], source_type="student-request", source_name="Request Inbox")
    return JSONResponse({"ok": True, "requests": list_student_requests(conn), "queue": list_queue(conn)})


@app.post("/api/scrape/start")
def api_scrape_start() -> JSONResponse:
    worker.start()
    return JSONResponse({"ok": True, "worker": worker.state.__dict__})


@app.post("/api/scrape/pause")
def api_scrape_pause() -> JSONResponse:
    worker.pause()
    return JSONResponse({"ok": True, "worker": worker.state.__dict__})


@app.post("/api/scrape/resume")
def api_scrape_resume() -> JSONResponse:
    worker.resume()
    return JSONResponse({"ok": True, "worker": worker.state.__dict__})


@app.get("/api/scrape/status")
def api_scrape_status() -> JSONResponse:
    return JSONResponse(
        {
            "ok": True,
            "counts": scrape_counts(conn),
            "worker": worker.state.__dict__,
            "recent_tracks": list_recent_tracks(conn, limit=10),
        }
    )


@app.post("/api/scrape/track/{track_id}")
def api_scrape_track(track_id: int) -> JSONResponse:
    if not get_track(conn, track_id):
        raise HTTPException(status_code=404, detail="Track not found")
    enqueue_scrape_job(conn, track_id, priority=20)
    return JSONResponse({"ok": True})


@app.post("/api/import/upload")
async def api_import_upload(
    file: UploadFile = File(...),
    fmt: str = Form("auto"),
    playlist_name: str = Form("Imported Seeds"),
) -> JSONResponse:
    try:
        items = parse_input(file.filename or "upload", await file.read(), fmt=fmt)
    except SeedParseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    playlist = None
    clean_playlist_name = str(playlist_name or "").strip()
    if clean_playlist_name:
        existing = [item for item in list_playlists(conn) if item["name"].lower() == clean_playlist_name.lower()]
        playlist = existing[0] if existing else create_playlist(conn, clean_playlist_name, "Imported from dashboard upload.")

    inserted_ids: list[int] = []
    for item in items:
        spotify_explicit_raw = str(item.get("spotify_explicit") or "").strip().lower()
        spotify_explicit = spotify_explicit_raw in {"1", "true", "yes", "explicit"}
        spotify_rating = spotify_rating_from_explicit(spotify_explicit if spotify_explicit_raw else None)
        merged_rating, reasons = merge_ratings(spotify_rating, "pending")
        saved = upsert_track(
            conn,
            {
                "title": item.get("title"),
                "artist": item.get("artist"),
                "album": item.get("album") or "",
                "spotify_id": item.get("spotify_id") or "",
                "spotify_explicit": spotify_explicit,
                "spotify_rating": spotify_rating,
                "lyrics_rating": "pending",
                "merged_rating": merged_rating,
                "rating_reasons": reasons,
                "lyrics_status": "missing",
                "source": "seed-upload",
                "metadata": {"seed_file": file.filename or ""},
            },
        )
        inserted_ids.append(int(saved["id"]))
        enqueue_scrape_job(conn, int(saved["id"]), priority=120)

    if playlist and inserted_ids:
        add_tracks_to_playlist(conn, int(playlist["id"]), inserted_ids)

    return JSONResponse(
        {
            "ok": True,
            "rows": len(items),
            "tracks_imported": len(inserted_ids),
            "playlist": playlist,
            "scrape": scrape_counts(conn),
        }
    )


@app.post("/api/import/spotify-playlist")
def api_import_spotify_playlist(payload: dict[str, Any] = Body(...)) -> JSONResponse:
    playlist_ref = str(payload.get("playlist_ref") or "").strip()
    if not playlist_ref:
        raise HTTPException(status_code=400, detail="playlist_ref is required")
    if not spotify.enabled:
        raise HTTPException(status_code=400, detail="Spotify credentials are not configured")

    playlist_name, items = spotify.fetch_playlist_tracks(playlist_ref, limit=int(payload.get("limit") or 150))
    destination_name = str(payload.get("destination_name") or playlist_name or "Spotify Import").strip()
    existing = [item for item in list_playlists(conn) if item["name"].lower() == destination_name.lower()]
    playlist = existing[0] if existing else create_playlist(conn, destination_name, "Imported from Spotify playlist.")

    track_ids: list[int] = []
    for item in items:
        saved = upsert_track(conn, _track_from_spotify_item(item))
        track_ids.append(int(saved["id"]))
        enqueue_scrape_job(conn, int(saved["id"]), priority=90)

    add_tracks_to_playlist(conn, int(playlist["id"]), track_ids)
    return JSONResponse({"ok": True, "playlist": get_playlist(conn, int(playlist["id"]))})


@app.post("/api/export")
def api_export() -> JSONResponse:
    out_dir = Path(os.environ.get("ALA_EXPORT_DIR") or (ROOT_DIR / "cache" / "exports"))
    summary = exporter.export_cache(
        conn,
        out_dir=out_dir,
        chunk_size=int(os.environ.get("ALA_EXPORT_CHUNK_SIZE", "500")),
        include_lyrics=str(os.environ.get("ALA_EXPORT_INCLUDE_LYRICS") or "1").lower() not in {"0", "false", "no"},
    )
    return JSONResponse({"ok": True, "export": summary})


@app.get("/favicon.ico")
def favicon() -> JSONResponse:
    return JSONResponse({}, status_code=204)
