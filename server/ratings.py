from __future__ import annotations

import re

BLOCK_RULES: dict[str, list[str]] = {
    "sexual content": ["sex", "sexual", "nude", "porn", "hookup", "strip", "body shot"],
    "drug references": ["cocaine", "weed", "drug", "xanax", "blunt", "pills", "heroin"],
    "violence": ["kill", "murder", "shoot", "gun", "stab", "suicide", "blood"],
    "hate / abuse": ["slur", "nazi", "lynch", "hate crime"],
    "strong profanity": ["fuck", "motherfucker", "bitch", "shit"],
}

REVIEW_RULES: dict[str, list[str]] = {
    "party / club themes": ["party", "club", "afterparty", "drunk", "wild night"],
    "relationship drama": ["toxic", "revenge", "breakup", "kiss me", "cheat"],
    "mild language": ["damn", "hell", "freaking", "sucks"],
}


def analyze_lyrics(text: str) -> dict[str, object]:
    safe = str(text or "").lower()
    if not safe.strip():
        return {
            "lyrics_rating": "pending",
            "reasons": ["Lyrics not cached yet."],
        }

    found_block: list[str] = []
    found_review: list[str] = []

    for label, terms in BLOCK_RULES.items():
        hits = [term for term in terms if re.search(rf"\b{re.escape(term)}\b", safe)]
        if hits:
            found_block.append(f"{label}: {', '.join(hits[:3])}")

    for label, terms in REVIEW_RULES.items():
        hits = [term for term in terms if re.search(rf"\b{re.escape(term)}\b", safe)]
        if hits:
            found_review.append(f"{label}: {', '.join(hits[:3])}")

    if found_block:
        return {"lyrics_rating": "blocked", "reasons": found_block}
    if found_review:
        return {"lyrics_rating": "review", "reasons": found_review}
    return {"lyrics_rating": "clean", "reasons": ["No blocked lyric patterns detected."]}


def spotify_rating_from_explicit(is_explicit: bool | None) -> str:
    if is_explicit is None:
        return "unknown"
    return "explicit" if is_explicit else "clean"


def merge_ratings(spotify_rating: str, lyrics_rating: str) -> tuple[str, list[str]]:
    reasons: list[str] = []
    spotify_rating = str(spotify_rating or "unknown")
    lyrics_rating = str(lyrics_rating or "pending")

    if spotify_rating == "explicit":
        reasons.append("Spotify marked the track explicit.")
    if lyrics_rating == "blocked":
        reasons.append("Lyrics scan found blocked terms.")
    if lyrics_rating == "review":
        reasons.append("Lyrics scan found review-only themes.")
    if lyrics_rating == "pending":
        reasons.append("Lyrics still need to be scraped.")

    if spotify_rating == "explicit" or lyrics_rating == "blocked":
        return "blocked", reasons or ["Blocked by content rating."]
    if lyrics_rating in {"review", "pending"} or spotify_rating == "unknown":
        return "review", reasons or ["Needs DJ review."]
    return "clean", reasons or ["Spotify and lyric checks look clean."]
