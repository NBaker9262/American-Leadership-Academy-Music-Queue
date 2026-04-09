# Lyrics Worker Setup (Python + GitHub Actions)

This repository now uses a Python lyrics worker and does not use committed lyrics cache files.

## 1) Run lyrics API locally

```bash
python lyrics_api_server.py serve --port 8787
```

Health check:

```bash
curl "http://localhost:8787/health"
```

Lyrics check:

```bash
curl "http://localhost:8787/lyrics?artist=Taron%20Egerton&song=I'm%20Still%20Standing%20From%20Sing%20Original%20Motion%20Picture%20Soundtrack"
```

Rating check:

```bash
curl "http://localhost:8787/rating?artist=Taron%20Egerton&song=I'm%20Still%20Standing%20From%20Sing%20Original%20Motion%20Picture%20Soundtrack"
```

## 2) Frontend config

In `app.js`, set your API endpoint:

```js
lyricsApiBaseUrl: "http://localhost:8787",
```

For GitHub Pages, set this to your deployed lyrics API URL.
If it is blank, the UI falls back to opening Musixmatch pages.

## 3) GitHub Actions worker checks

Workflow file: `.github/workflows/python-worker-checks.yml`

What it does:
- Installs Python dependencies.
- Compiles `lyrics_api_server.py` and `musixmatch_lyrics_scraper.py`.
- Starts the server and verifies `/health` returns OK.

Triggers:
- Push to files related to the lyrics worker.
- Pull requests touching those files.
- Manual run via `workflow_dispatch`.

## 4) Local Live Server extension testing

Use VS Code Live Server for the frontend (do not use `file://`).

Expected behavior:
- Moderation still combines Spotify explicit flag + theme policy + lyrics content rating.
- If `lyricsApiBaseUrl` is not set or API is unreachable, lyrics modal falls back to Musixmatch link.
