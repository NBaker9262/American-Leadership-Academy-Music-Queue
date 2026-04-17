import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
SOURCES_PATH = ROOT / "moderation-wordlist-sources.json"
OUT_JSON = ROOT / "moderation-wordlists.generated.json"
OUT_JS = ROOT / "moderation-wordlists.generated.js"


@dataclass(frozen=True)
class Source:
    id: str
    label: str
    url: str
    format: str
    comment_prefixes: tuple[str, ...]
    json_array_key: str
    severity: str
    category: str


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load_sources() -> list[Source]:
    if not SOURCES_PATH.exists():
        raise SystemExit(f"Missing {SOURCES_PATH}")

    payload = json.loads(SOURCES_PATH.read_text(encoding="utf-8"))
    sources_raw = payload.get("sources") or []
    sources: list[Source] = []

    for item in sources_raw:
        sources.append(
            Source(
                id=str(item.get("id") or "").strip(),
                label=str(item.get("label") or "").strip(),
                url=str(item.get("url") or "").strip(),
                format=str(item.get("format") or "newline").strip().lower(),
                comment_prefixes=tuple(item.get("commentPrefixes") or ["#"]),
                json_array_key=str(item.get("jsonArrayKey") or "words").strip(),
                severity=str(item.get("severity") or "review").strip().lower(),
                category=str(item.get("category") or "External List").strip(),
            )
        )

    sources = [s for s in sources if s.id and s.url]
    if not sources:
        raise SystemExit("No valid sources found in moderation-wordlist-sources.json")

    for s in sources:
        if s.severity not in ("block", "review"):
            raise SystemExit(f"Invalid severity for source {s.id}: {s.severity}")
        if s.format not in ("newline", "json-array", "json-object-array"):
            raise SystemExit(f"Unsupported format for source {s.id}: {s.format}")

    return sources


def fetch_text(url: str) -> str:
    resp = requests.get(url, timeout=30, headers={"User-Agent": "ALA-Music-Queue/wordlist-builder"})
    resp.raise_for_status()
    resp.encoding = resp.encoding or "utf-8"
    return resp.text


_whitespace_re = re.compile(r"\s+")


def normalize_entry(text: str) -> str:
    # Keep the builder conservative: we do NOT try to be clever here.
    # The app already does runtime normalization (NFKD, punctuation stripping, leetspeak, etc.).
    s = text.strip().lower()
    s = _whitespace_re.sub(" ", s)
    return s


def iter_newline_entries(text: str, comment_prefixes: tuple[str, ...]) -> list[str]:
    items: list[str] = []
    for raw in text.splitlines():
        line = raw.strip("\ufeff").strip()
        if not line:
            continue
        if any(line.startswith(prefix) for prefix in comment_prefixes):
            continue
        # Some lists include inline comments; strip after a tab or ' #'
        line = line.split("\t", 1)[0].strip()
        if " #" in line:
            line = line.split(" #", 1)[0].strip()
        if not line:
            continue
        items.append(line)
    return items


def iter_json_entries(text: str, format: str, json_array_key: str) -> list[str]:
    payload = json.loads(text)

    if format == "json-array":
        if not isinstance(payload, list):
            raise ValueError("Expected JSON array")
        return [str(item) for item in payload if isinstance(item, (str, int, float))]

    if format == "json-object-array":
        if not isinstance(payload, dict):
            raise ValueError("Expected JSON object")
        key = str(json_array_key or "words").strip() or "words"
        raw = payload.get(key)
        if not isinstance(raw, list):
            raise ValueError(f"Expected '{key}' array in JSON object")
        return [str(item) for item in raw if isinstance(item, (str, int, float))]

    raise ValueError(f"Unsupported JSON format: {format}")


def build_rules(sources: list[Source]) -> dict:
    # Group into rules by (severity, category)
    grouped: dict[tuple[str, str], dict[str, set[str]]] = {}

    for source in sources:
        print(f"Fetching {source.id}: {source.url}")
        text = fetch_text(source.url)
        if source.format == "newline":
            entries = iter_newline_entries(text, source.comment_prefixes)
        else:
            entries = iter_json_entries(text, source.format, source.json_array_key)

        key = (source.severity, source.category)
        if key not in grouped:
            grouped[key] = {"terms": set(), "phrases": set()}

        for entry in entries:
            norm = normalize_entry(entry)
            if not norm:
                continue
            # Heuristic: entries with spaces are phrases
            if " " in norm:
                grouped[key]["phrases"].add(norm)
            else:
                grouped[key]["terms"].add(norm)

        print(f"  +{len(entries)} raw entries")

    rules = []
    for (severity, category), buckets in grouped.items():
        terms = sorted(buckets["terms"])
        phrases = sorted(buckets["phrases"])
        rule_id = f"external-{severity}-{re.sub(r'[^a-z0-9]+', '-', category.lower()).strip('-') or 'list'}"
        rules.append(
            {
                "id": rule_id,
                "category": category,
                "severity": severity,
                "terms": terms,
                "phrases": phrases,
            }
        )

    # Stable ordering
    rules.sort(key=lambda r: (r.get("severity"), r.get("category"), r.get("id")))

    return {
        "version": 1,
        "generatedAt": _now_iso(),
        "generator": "scripts/build_moderation_wordlists.py",
        "sources": [
            {
                "id": s.id,
                "label": s.label,
                "url": s.url,
                "format": s.format,
                "jsonArrayKey": s.json_array_key,
                "severity": s.severity,
                "category": s.category,
            }
            for s in sources
        ],
        "rules": rules,
    }


def write_outputs(payload: dict) -> None:
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    js = (
        "// This file is generated by scripts/build_moderation_wordlists.py\n"
        "// Do not hand-edit.\n"
        "window.ALA_MODERATION_WORDLISTS = "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n"
    )
    OUT_JS.write_text(js, encoding="utf-8")


def main() -> int:
    try:
        sources = load_sources()
        payload = build_rules(sources)
        write_outputs(payload)
        print(f"Wrote {OUT_JSON}")
        print(f"Wrote {OUT_JS}")
        total_terms = sum(len(r.get('terms') or []) for r in payload.get('rules') or [])
        total_phrases = sum(len(r.get('phrases') or []) for r in payload.get('rules') or [])
        print(f"Total terms: {total_terms}")
        print(f"Total phrases: {total_phrases}")
        return 0
    except requests.RequestException as exc:
        print(f"Network error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
