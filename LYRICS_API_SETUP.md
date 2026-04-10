# Lyrics API Setup (GitHub Pages Compatible)

GitHub Pages serves static files only, so it cannot execute Python directly.

This project now supports an optional external lyrics API.

## 1) Run API locally

```bash
python lyrics_api_server.py
```

API URL: `http://localhost:8787`

Health check:

```bash
curl "http://localhost:8787/health"
```

Lyrics check:

```bash
curl "http://localhost:8787/lyrics?artist=Taron%20Egerton&song=I'm%20Still%20Standing%20From%20Sing%20Original%20Motion%20Picture%20Soundtrack"
```

## 2) Deploy free/basic host

You can deploy `lyrics_api_server.py` to a free Python host (Render, Railway, Fly free tier, etc.).

## 3) Point frontend to API

In `app.js`, set:

```js
lyricsApiBaseUrl: "https://your-lyrics-api-host.example.com",
```

If this value is blank, the UI falls back to opening Musixmatch directly.
