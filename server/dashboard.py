from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse

from . import exporter
from .db import connect, get_db_path, migrate
from .queue import counts, seed_songs
from .seed_parser import SeedParseError, parse_input
from .worker import GeniusScrapeWorker, WorkerConfig

APP_TITLE = "ALA Genius Cache Dashboard"

app = FastAPI(title=APP_TITLE)

_conn = connect(get_db_path())
migrate(_conn)

_worker = GeniusScrapeWorker(
    _conn,
    config=WorkerConfig(
        min_delay_seconds=float(os.environ.get("GENIUS_MIN_DELAY_SECONDS", "0.6")),
        max_attempts=int(os.environ.get("GENIUS_MAX_ATTEMPTS", "10")),
    ),
)


@app.get("/", response_class=HTMLResponse)
def home() -> str:
    return f"""<!doctype html>
<html>
<head>
  <meta charset='utf-8'/>
  <meta name='viewport' content='width=device-width, initial-scale=1'/>
  <title>{APP_TITLE}</title>
  <style>
    body {{ font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 20px; }}
    .row {{ display: flex; gap: 12px; flex-wrap: wrap; }}
    .card {{ border: 1px solid #ddd; border-radius: 10px; padding: 12px 14px; min-width: 260px; }}
    button {{ padding: 8px 12px; }}
    code {{ background: #f6f6f6; padding: 2px 6px; border-radius: 6px; }}
    .muted {{ color: #666; }}
    .err {{ color: #b00020; white-space: pre-wrap; }}
  </style>
</head>
<body>
  <h2>{APP_TITLE}</h2>
  <p class='muted'>DB: <code>{Path(get_db_path()).as_posix()}</code></p>

  <div class='row'>
    <div class='card'>
      <h3>Controls</h3>
      <div class='row'>
        <button onclick='post("/api/start")'>Start</button>
        <button onclick='post("/api/pause")'>Pause</button>
        <button onclick='post("/api/resume")'>Resume</button>
      </div>
      <div style='height:8px'></div>
      <div class='row'>
        <button onclick='post("/api/export")'>Export cache (chunks)</button>
      </div>
      <p class='muted'>Seed via upload below, or run <code>python scripts/seed_genius_queue.py --in your_list.txt</code></p>

      <hr />
      <h4>Seed queue (upload)</h4>
      <form id='seedForm'>
        <input type='file' name='file' accept='.txt,.csv' required />
        <div style='height:6px'></div>
        <label>Format:
          <select name='format'>
            <option value='auto' selected>auto</option>
            <option value='title-artist'>title-artist</option>
            <option value='artist-title'>artist-title</option>
          </select>
        </label>
        <div style='height:8px'></div>
        <button type='submit'>Upload + Seed</button>
      </form>
    </div>

    <div class='card' style='flex: 1'>
      <h3>Status</h3>
      <div id='status'>Loading…</div>
      <div class='err' id='err'></div>
    </div>
  </div>

<script>
async function post(url) {{
  document.getElementById('err').textContent = '';
  const r = await fetch(url, {{ method: 'POST' }});
  const t = await r.text();
  if (!r.ok) document.getElementById('err').textContent = t;
  await refresh();
}}

function fmt(obj) {{
  return '<pre>' + JSON.stringify(obj, null, 2) + '</pre>';
}}

async function refresh() {{
  const r = await fetch('/api/status');
  const j = await r.json();
  document.getElementById('status').innerHTML = fmt(j);
}}

setInterval(refresh, 1500);
refresh();

document.getElementById('seedForm').addEventListener('submit', async (e) => {{
  e.preventDefault();
  document.getElementById('err').textContent = '';
  const form = e.target;
  const fd = new FormData(form);
  const r = await fetch('/api/seed', {{ method: 'POST', body: fd }});
  const t = await r.text();
  if (!r.ok) document.getElementById('err').textContent = t;
  await refresh();
}});
</script>
</body>
</html>"""


@app.get("/api/status")
def api_status() -> JSONResponse:
    c = counts(_conn)
    s = _worker.state
    return JSONResponse(
        {
            "ok": True,
            "counts": c,
            "worker": {
                "running": s.running,
                "paused": s.paused,
                "current_song_key": s.current_song_key,
                "current_artist": s.current_artist,
                "current_title": s.current_title,
                "last_event": s.last_event,
                "last_error": s.last_error,
                "last_updated_at": s.last_updated_at,
            },
            "config": {
                "min_delay_seconds": _worker.config.min_delay_seconds,
                "max_attempts": _worker.config.max_attempts,
            },
        }
    )


@app.post("/api/start")
def api_start() -> JSONResponse:
    _worker.start()
    return JSONResponse({"ok": True})


@app.post("/api/pause")
def api_pause() -> JSONResponse:
    _worker.pause()
    return JSONResponse({"ok": True})


@app.post("/api/resume")
def api_resume() -> JSONResponse:
    _worker.resume()
    return JSONResponse({"ok": True})


@app.post("/api/export")
def api_export() -> JSONResponse:
    out_dir = Path(os.environ.get("GENIUS_EXPORT_DIR") or (Path(__file__).resolve().parents[1] / "cache" / "genius"))
    chunk_size = int(os.environ.get("GENIUS_EXPORT_CHUNK_SIZE", "500"))
    include_lyrics = os.environ.get("GENIUS_EXPORT_INCLUDE_LYRICS", "1") not in {"0", "false", "no"}

    summary = exporter.export_cache(_conn, out_dir=out_dir, chunk_size=chunk_size, include_lyrics=include_lyrics)
    return JSONResponse({"ok": True, "export": summary})


  @app.post("/api/seed")
  async def api_seed(
    file: UploadFile = File(...),
    format: str = Form("auto"),
  ) -> JSONResponse:
    name = file.filename or "uploaded"
    content = await file.read()
    try:
      items = parse_input(name, content, fmt=format)
    except SeedParseError as exc:
      return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)

    inserted = seed_songs(_conn, items)
    return JSONResponse({"ok": True, "rows": len(items), "inserted": inserted})
