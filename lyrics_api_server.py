#!/usr/bin/env python3
"""Minimal CORS-enabled lyrics API wrapper for GitHub Pages frontends.

Usage:
  python lyrics_api_server.py
  PORT=8787 python lyrics_api_server.py

Endpoint:
  GET /lyrics?artist=<artist>&song=<song>
    GET /rating?artist=<artist>&song=<song>

Response:
  {
    "url": "https://www.musixmatch.com/lyrics/...",
    "selector_used": "...",
    "lyrics": "...",
    "source": "musixmatch_lyrics_scraper.py"
  }
"""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from musixmatch_lyrics_scraper import (
    LyricsFetchError,
    build_musixmatch_url,
    fetch_musixmatch_content_rating,
    fetch_musixmatch_lyrics,
)


class LyricsApiHandler(BaseHTTPRequestHandler):
    server_version = "ALALyricsAPI/1.0"

    def _send_json(self, status_code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)

        if parsed.path == "/health":
            self._send_json(200, {"ok": True, "service": "lyrics-api"})
            return

        if parsed.path not in {"/lyrics", "/rating"}:
            self._send_json(404, {"ok": False, "error": "Not found"})
            return

        query = parse_qs(parsed.query)
        artist = (query.get("artist") or [""])[0].strip()
        song = (query.get("song") or [""])[0].strip()

        if not artist or not song:
            self._send_json(
                400,
                {
                    "ok": False,
                    "error": "Missing required query params: artist and song",
                },
            )
            return

        url = build_musixmatch_url(artist=artist, song=song)

        if parsed.path == "/rating":
            try:
                content_rating, rating_selector_used = fetch_musixmatch_content_rating(url=url)
            except LyricsFetchError as error:
                self._send_json(
                    422,
                    {
                        "ok": False,
                        "error": str(error),
                        "url": url,
                    },
                )
                return
            except Exception as error:  # noqa: BLE001
                self._send_json(
                    500,
                    {
                        "ok": False,
                        "error": f"Unexpected server error: {error}",
                        "url": url,
                    },
                )
                return

            self._send_json(
                200,
                {
                    "ok": True,
                    "url": url,
                    "content_rating": content_rating,
                    "rating_selector_used": rating_selector_used,
                    "source": "musixmatch_lyrics_scraper.py",
                },
            )
            return

        try:
            result = fetch_musixmatch_lyrics(url=url)
        except LyricsFetchError as error:
            self._send_json(
                422,
                {
                    "ok": False,
                    "error": str(error),
                    "url": url,
                },
            )
            return
        except Exception as error:  # noqa: BLE001
            self._send_json(
                500,
                {
                    "ok": False,
                    "error": f"Unexpected server error: {error}",
                    "url": url,
                },
            )
            return

        self._send_json(
            200,
            {
                "ok": True,
                "url": result.url,
                "selector_used": result.selector_used,
                "lyrics": result.lyrics,
                "content_rating": result.content_rating,
                "rating_selector_used": result.rating_selector_used,
                "source": "musixmatch_lyrics_scraper.py",
            },
        )


def main() -> None:
    port = int(os.environ.get("PORT", "8787"))
    server = ThreadingHTTPServer(("0.0.0.0", port), LyricsApiHandler)
    print(f"Lyrics API listening on http://0.0.0.0:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
