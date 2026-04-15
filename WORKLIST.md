# Work List (next session)

## Must-do fixes
- [ ] Musixmatch artist slug matching
  - [ ] Handle numeric artist suffixes reliably (example: /lyrics/sombr-1/back-to-friends)
  - [ ] Add server-side fallback: if 404, parse canonical artist+song from returned HTML (og:url / canonical link) and retry once
  - [ ] Add server response fields to help debug: `canonical_url`, `canonical_artist_slug`, `canonical_song_slug`, `match_strategy`
  - [ ] Add small test harness: given `artist,song` prints tried URLs + chosen URL

- [ ] Final single marker (Clean / Flag / Explicit)
  - [x] Add `finalMarker` + label/reason to moderation metadata
  - [x] Prefer `flag` over `clean` when uncertain
  - [ ] Confirm marker rules are correct with real examples (explicit Spotify + no lyrics => marker should still be Explicit)

- [ ] Expanded bypass/override controls
  - [x] "Allow Now" sets explicit clean + theme clear
  - [x] Add lyrics bypass (force `lyricsGateStatus=ok`)
  - [x] Add force marker controls: force-clean / force-flag / force-explicit
  - [ ] Add these buttons to Moderation Details UI (currently only Allow/Reset are visible)
  - [ ] Ensure overrides persist + re-render correctly for requests + approved queue

## Wordlist/theme checker upgrade (JS-only)
- [ ] Replace current naive keyword scanning with a scalable matcher for 100s–1000s of terms
  - [ ] Pre-normalize lists at startup (lowercase, strip accents, collapse spaces)
  - [ ] Support word-boundary + phrase matching and “near match” for bypass attempts

- [ ] Bypass-resistant normalization
  - [ ] Expand leetspeak mapping (e.g., `@ -> a`, `$ -> s`, `! -> i`, `3 -> e`, `0 -> o`)
  - [ ] Collapse repeated letters (`heeeell` => `hell`)
  - [ ] Remove separators used for obfuscation (`d-a-m-n`, `d.a.m.n`, `d@mn`)
  - [ ] Handle partial censoring (`f**k`, `sh*t`) via masked-pattern regex generation

- [ ] Plurals + simple morphology
  - [ ] Match `word`, `words`, `wording`, common suffixes where safe
  - [ ] Avoid false positives for short tokens

- [ ] Smarter decision logic
  - [ ] Keep explicit = explicit
  - [ ] Prefer Flag over Clean when signal is uncertain
  - [ ] Add per-category weights and thresholds (review vs block)
  - [ ] Log which normalization variant matched (debug mode)

## UI polish
- [ ] Show final marker consistently everywhere
  - [ ] Requests list badge uses `finalMarker`
  - [ ] Approved queue rows show `finalMarker`
  - [ ] Moderation Details show `finalMarker` with reason

## Quick verification checklist
- [ ] Track with Spotify explicit=true AND lyrics missing => final marker remains Explicit
- [ ] Track with Spotify explicit=false BUT Musixmatch rating danger => explicit signal becomes Explicit (Musixmatch)
- [ ] Track with no lyrics => decision becomes Flag, but Spotify explicit/clean badge stays accurate
- [ ] Force marker override persists after refresh and applies everywhere
