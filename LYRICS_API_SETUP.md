# Lyrics API Setup (BeautifulSoup Single File)

This project uses one Python file (`lyrics_api_server.py`) with `requests` + `beautifulsoup4` for scraping.

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

Expected response fields: `ok`, `url`, `selector_used`, `lyrics`, `source`.

## 2) Install dependencies

```bash
pip install -r requirements.txt
```

`requirements.txt` should include both:
- `beautifulsoup4`
- `requests`

## 3) Point frontend to API

In [app.js](app.js), `CONFIG.lyricsApiBaseUrl` should point to your running Python API.

```js
lyricsApiBaseUrl: "http://127.0.0.1:8787",
```

If lyrics fail in UI, run:

```bash
curl "http://127.0.0.1:8787/health"
```
