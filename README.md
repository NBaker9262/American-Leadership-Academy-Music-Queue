# ALA Music Queue

ALA Music Queue is a local-first DJ dashboard for school events. It combines a Spotify-style browsing workflow with:

- local playlists and a DJ queue
- student request intake
- Spotify metadata enrichment
- Genius lyric scraping and caching
- merged safety ratings shown before songs are queued or playlisted
- a scrape dashboard designed to stay running on a Raspberry Pi Zero 2 W

## What Changed

This repo was consolidated into one supported app:

- `server/dashboard.py` now serves both the API and the web UI
- `web/` contains the Spotify-like frontend
- the old single-file frontend and duplicate cache scripts were removed
- the SQLite schema now stores tracks, playlists, queue entries, student requests, and scrape jobs together

## Architecture

- Backend: FastAPI + SQLite
- Frontend: static HTML/CSS/JS served by FastAPI
- Metadata source: Spotify Web API via client credentials
- Lyrics source: Genius API search + Genius page scrape
- Ratings:
  `Spotify`: `clean`, `explicit`, or `unknown`
  `Lyrics`: `clean`, `review`, `blocked`, or `pending`
  `Merged`: `clean`, `review`, or `blocked`

## Setup

### 1. Create a virtual environment

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 2. Configure environment variables

Set these before starting the app:

```powershell
$env:ALA_DB_PATH="C:\Repositories\American-Leadership-Academy-Music-Queue\data\ala_music.sqlite3"
$env:GENIUS_ACCESS_TOKEN="your_genius_token"
$env:SPOTIFY_CLIENT_ID="your_spotify_client_id"
$env:SPOTIFY_CLIENT_SECRET="your_spotify_client_secret"
$env:SPOTIFY_MARKET="US"
$env:ALA_AUTO_START_WORKER="1"
```

Minimum setup:

- `GENIUS_ACCESS_TOKEN` is needed for lyric scraping
- `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` are needed for Spotify search/import

### 3. Run the app

```powershell
python -m uvicorn server.dashboard:app --reload --host 127.0.0.1 --port 2034
```

Then open `http://127.0.0.1:2034`

## Raspberry Pi Zero 2 W Setup

The Pi script is now the main setup path:

```bash
chmod +x scripts/pi_setup_genius_dashboard.sh
./scripts/pi_setup_genius_dashboard.sh
```

What it does:

- installs Python and SQLite packages
- clones or updates the repo
- builds `.venv`
- writes `/etc/ala-music-queue/env`
- installs `ala-music-queue.service`
- starts the dashboard on port `2034`

Useful Pi commands:

```bash
sudo systemctl status ala-music-queue.service
sudo journalctl -u ala-music-queue.service -f
sudo nano /etc/ala-music-queue/env
sudo systemctl restart ala-music-queue.service
```

## Importing Large Catalogs

For a catalog of 100,000+ songs, the better path is:

1. Import a CSV dataset or exported song list into the local catalog.
2. Let the worker slowly enrich and scrape lyrics over time.
3. Use Spotify playlist imports for curated collections, not for the full bulk seed.

Why:

- Spotify's API is good for live lookup and playlist imports.
- It is not the best source for discovering the top 100,000 songs in one shot.
- A local CSV dataset is much easier to seed in bulk and resume on a Pi.

Use the CLI seeder:

```powershell
python scripts/seed_catalog.py --in prom_dance_pack.txt --playlist "Prom Seeds"
```

Or upload files from the `Scrape Dashboard` tab in the web UI.

## Student Requests

The app stores raw student requests separately from the queue.

Recommended flow:

1. Student request is saved to the inbox.
2. DJ searches for the matching song.
3. DJ checks `Merged`, `Spotify`, and `Lyrics` ratings.
4. DJ approves it into the live queue or dismisses it.

This avoids mixing unreviewed requests directly into playback.

## Exporting Cache

The dashboard can export the full local track cache as chunked JSON files.

Default output:

- `cache/exports/index.json`
- `cache/exports/tracks_0001.json`, `tracks_0002.json`, etc.

## Main Files

- `server/dashboard.py`: main API + static app host
- `server/worker.py`: continuous Genius scrape worker
- `server/spotify_client.py`: Spotify client credentials integration
- `server/ratings.py`: merged content rating rules
- `server/db.py`: SQLite schema and migration
- `server/queue.py`: catalog, playlist, queue, and request operations
- `web/`: frontend
- `scripts/seed_catalog.py`: CLI catalog seeding
- `scripts/pi_setup_genius_dashboard.sh`: Raspberry Pi install script
