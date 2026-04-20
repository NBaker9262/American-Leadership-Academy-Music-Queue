# American Leadership Academy Music Queue

A simple dashboard for running a school dance / event music queue with Spotify.

It is a static HTML/CSS/JS app (GitHub Pages friendly) with an optional local Python lyrics API.

## What it does

- Spotify login (PKCE)
- Shows “Now Playing” and basic playback controls
- Displays the Spotify queue
- Moderation panel backed by a published Google Sheet CSV
- Lyrics integration (live API first, with a static cache fallback)

## Quick start (dashboard)

Option A: open the file directly
- Open `index.html` in a browser.

Option B: serve the folder locally

```bash
python -m http.server 8000
```

Then open:
- http://127.0.0.1:8000

## Optional: run the lyrics API locally

Install dependencies:

```bash
pip install -r requirements.txt
```

Run the server (defaults to `127.0.0.1:8787`):

```bash
python lyrics_api_server.py
```

Health check:

```bash
curl "http://127.0.0.1:8787/health"
```

Lyrics check:

```bash
curl "http://127.0.0.1:8787/lyrics?artist=The%20Weeknd&song=Blinding%20Lights"
```

Notes:
- You can change the port with `PORT` (example: `PORT=8788`).
- If you host the dashboard over HTTPS (like GitHub Pages), browsers will block calls to an HTTP lyrics API due to mixed-content rules.

More details: see `LYRICS_API_SETUP.md`.

## Optional: (re)build the static lyrics cache

The dashboard can fall back to `lyrics-cache.json` when the live lyrics API is not reachable.

To rebuild locally:

```bash
python scripts/build_lyrics_cache.py
```

## Configuration

Most settings live in `app.js` in the `CONFIG` object, including:
- Spotify app client id and redirect URL
- Default playlist ids
- The Google Sheet CSV URL used for requests
- Lyrics API base URL and cache behavior

If Spotify login fails, confirm that the redirect URL you are using is added to your Spotify app’s Redirect URIs.

## Things to do

- Improve the lyrics cache refresh strategy (reduce re-scrapes, better invalidation)
- Add a simple “cache status” summary (counts, last refresh time, errors)
- Make lyrics scraping more resilient to Musixmatch DOM changes (more selectors, better fallbacks)
- Add rate-limit/backoff handling for Spotify and lyric scraping calls
- Make local development config easier (example config file or environment-based overrides)
- Tighten moderation rules and add a clear audit trail for overrides
- Add basic automated checks (linting/formatting, a smoke test for the lyrics API)
- Document a clean deployment path for HTTPS lyrics API (so Pages can use it)
