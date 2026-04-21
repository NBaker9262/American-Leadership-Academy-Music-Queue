from __future__ import annotations

import os
import re
import time
from typing import Any

import requests

SPOTIFY_API_BASE = "https://api.spotify.com/v1"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"


class SpotifyClient:
    def __init__(self) -> None:
        self.client_id = str(os.environ.get("SPOTIFY_CLIENT_ID") or "").strip()
        self.client_secret = str(os.environ.get("SPOTIFY_CLIENT_SECRET") or "").strip()
        self.market = str(os.environ.get("SPOTIFY_MARKET") or "US").strip()
        self._access_token = ""
        self._expires_at = 0.0

    @property
    def enabled(self) -> bool:
        return bool(self.client_id and self.client_secret)

    def _token(self) -> str:
        if not self.enabled:
            raise RuntimeError("Spotify client credentials are not configured")
        now = time.time()
        if self._access_token and now < self._expires_at - 60:
            return self._access_token

        resp = requests.post(
            SPOTIFY_TOKEN_URL,
            data={"grant_type": "client_credentials"},
            auth=(self.client_id, self.client_secret),
            timeout=20,
        )
        resp.raise_for_status()
        payload = resp.json() or {}
        self._access_token = str(payload.get("access_token") or "")
        self._expires_at = now + int(payload.get("expires_in") or 3600)
        if not self._access_token:
            raise RuntimeError("Spotify did not return an access token")
        return self._access_token

    def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        token = self._token()
        resp = requests.get(
            f"{SPOTIFY_API_BASE}{path}",
            headers={"Authorization": f"Bearer {token}"},
            params=params or {},
            timeout=20,
        )
        resp.raise_for_status()
        return resp.json() or {}

    def _to_track(self, item: dict[str, Any]) -> dict[str, Any]:
        artists = item.get("artists") or []
        album = item.get("album") or {}
        images = album.get("images") or []
        return {
            "spotify_id": str(item.get("id") or ""),
            "title": str(item.get("name") or ""),
            "artist": ", ".join(str(artist.get("name") or "") for artist in artists if artist.get("name")),
            "album": str(album.get("name") or ""),
            "duration_ms": int(item.get("duration_ms") or 0),
            "image_url": str(images[0].get("url") or "") if images else "",
            "spotify_url": str((item.get("external_urls") or {}).get("spotify") or ""),
            "preview_url": str(item.get("preview_url") or ""),
            "popularity": int(item.get("popularity") or 0),
            "spotify_explicit": bool(item.get("explicit")),
            "source": "spotify-api",
            "metadata": {
                "album_release_date": str(album.get("release_date") or ""),
                "album_type": str(album.get("album_type") or ""),
                "artists": [artist.get("name") for artist in artists if artist.get("name")],
            },
        }

    def search_tracks(self, query: str, limit: int = 12) -> list[dict[str, Any]]:
        if not self.enabled:
            return []
        payload = self._get(
            "/search",
            params={
                "q": str(query or "").strip(),
                "type": "track",
                "limit": max(1, min(int(limit), 50)),
                "market": self.market,
            },
        )
        items = ((payload.get("tracks") or {}).get("items") or [])
        return [self._to_track(item) for item in items if isinstance(item, dict)]

    def fetch_playlist_tracks(self, playlist_ref: str, limit: int = 100) -> tuple[str, list[dict[str, Any]]]:
        if not self.enabled:
            return "", []

        playlist_id = self.parse_playlist_id(playlist_ref)
        if not playlist_id:
            raise ValueError("Could not parse Spotify playlist id from the provided value")

        playlist_meta = self._get(f"/playlists/{playlist_id}", params={"market": self.market})
        playlist_name = str(playlist_meta.get("name") or "Imported Playlist")
        items: list[dict[str, Any]] = []
        offset = 0
        remaining = max(1, min(int(limit), 500))
        while remaining > 0:
            page_size = min(100, remaining)
            payload = self._get(
                f"/playlists/{playlist_id}/tracks",
                params={"market": self.market, "limit": page_size, "offset": offset},
            )
            page_items = payload.get("items") or []
            for entry in page_items:
                track = (entry or {}).get("track") if isinstance(entry, dict) else None
                if isinstance(track, dict) and track.get("type") == "track":
                    items.append(self._to_track(track))
            if not page_items or not payload.get("next"):
                break
            offset += len(page_items)
            remaining -= len(page_items)
        return playlist_name, items

    @staticmethod
    def parse_playlist_id(value: str) -> str:
        text = str(value or "").strip()
        if re.fullmatch(r"[A-Za-z0-9]{10,}", text):
            return text
        match = re.search(r"playlist/([A-Za-z0-9]+)", text)
        return match.group(1) if match else ""
