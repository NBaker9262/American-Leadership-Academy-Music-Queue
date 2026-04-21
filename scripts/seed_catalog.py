#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from server.db import connect, get_db_path, migrate
from server.queue import add_tracks_to_playlist, create_playlist, enqueue_scrape_job, list_playlists, upsert_track
from server.ratings import merge_ratings, spotify_rating_from_explicit
from server.seed_parser import SeedParseError, parse_input


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed the ALA music catalog from a txt/csv file.")
    parser.add_argument("--in", dest="in_path", required=True, help="Input .txt or .csv file")
    parser.add_argument("--format", dest="fmt", default="auto", choices=["auto", "title-artist", "artist-title"])
    parser.add_argument("--playlist", default="Imported Seeds", help="Playlist to append imported songs to")
    parser.add_argument("--priority", default=120, type=int, help="Scrape priority (lower is sooner)")
    args = parser.parse_args()

    in_path = Path(args.in_path)
    if not in_path.exists():
        raise SystemExit(f"Input file not found: {in_path}")

    try:
        items = parse_input(in_path.name, in_path.read_bytes(), fmt=args.fmt)
    except SeedParseError as exc:
        raise SystemExit(str(exc)) from exc

    conn = connect(get_db_path())
    migrate(conn)

    existing = [playlist for playlist in list_playlists(conn) if playlist["name"].lower() == args.playlist.lower()]
    playlist = existing[0] if existing else create_playlist(conn, args.playlist, f"Imported from {in_path.name}")

    track_ids: list[int] = []
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
                "source": "cli-seed",
                "metadata": {"seed_file": in_path.name},
            },
        )
        track_id = int(saved["id"])
        track_ids.append(track_id)
        enqueue_scrape_job(conn, track_id, priority=args.priority)

    add_tracks_to_playlist(conn, int(playlist["id"]), track_ids)

    print(
        f"Imported {len(track_ids)} tracks from {in_path} into playlist '{playlist['name']}' "
        f"using database {get_db_path().as_posix()}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
