#!/usr/bin/env python3
"""Compatibility wrapper for legacy imports.

The scraper logic now lives in lyrics_api_server.py so there is a single
Python implementation to maintain.
"""

from __future__ import annotations

from lyrics_api_server import (  # noqa: F401
    DEFAULT_SELECTOR,
    LyricsFetchError,
    LyricsResult,
    build_musixmatch_url,
    fetch_musixmatch_content_rating,
    fetch_musixmatch_lyrics,
)


if __name__ == "__main__":
    raise SystemExit(
        "This module is now a compatibility wrapper. "
        "Use `python lyrics_api_server.py serve`."
    )
