# Genius Cache Dashboard (Pi-friendly, resumable)

This repo can build a long-running Genius lyric cache on a Raspberry Pi and export it as chunked JSON under `cache/genius/` so you can commit/push it to GitHub.

Important:
- You need the Genius **Access Token** (bearer token). You do NOT need Client Secret.
- Don’t paste tokens into chat or into git commits. If you already did, revoke/rotate them.

## What you need

- Raspberry Pi on Wi-Fi + SSH access
- Genius **Access Token** (API token)
- A song list file (`.txt` or `.csv`)
- Your GitHub repo: `https://github.com/nbaker9262/American-Leadership-Academy-Music-Queue`

## One-paste Raspberry Pi setup (recommended)

If you see `Waiting for cache lock` during installs, it means another `apt`/`dpkg` process is running (often auto-upgrades). In that case:
- safest: wait a few minutes for it to finish
- or inspect what’s running:

```bash
ps -eo pid,cmd | egrep "apt|apt-get|dpkg" | grep -v egrep
```

Do NOT delete lock files.

### Paste-proof setup (recommended)

This avoids huge copy/paste blocks getting mangled in terminals.

1) SSH into the Pi
2) Run this one-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/nbaker9262/American-Leadership-Academy-Music-Queue/main/scripts/pi_setup_genius_dashboard.sh | bash
```

It will:
- Install OS deps
- Clone/update the repo into `~/ala-music-queue`
- Create `.venv` and install `requirements.txt`
- Prompt you for the Genius Access Token (hidden input) and save it to `/etc/ala-genius/env`
- Create + start a systemd service for the dashboard on port `2034`

If `curl` isn’t installed, do:

```bash
sudo apt update
sudo apt install -y curl
```

Then re-run the one-liner.

### If you need to change the token later

```bash
sudo nano /etc/ala-genius/env
sudo systemctl restart ala-genius-dashboard
```

## Daily use (dashboard)

1) Open `http://<PI_IP>:2034`

2) Seed songs
- Use the upload/seed area in the dashboard to load your `.txt`/`.csv` list.

CLI backup option:

```bash
cd "$HOME/ala-music-queue"
. .venv/bin/activate
python scripts/seed_genius_queue.py --in your_list.txt
```

If your list is the pasted-table format where each line looks like `Artist - Title ...` (with extra columns), use:

```bash
python scripts/seed_genius_queue.py --in your_list.txt --format artist-title
```

3) Scrape
- Click **Start** and let it run.
- It’s resumable (SQLite). Reboots are fine.

4) Export
- Click **Export cache (chunks)**.
- Or run:

```bash
cd "$HOME/ala-music-queue"
. .venv/bin/activate
python scripts/export_genius_cache.py
```

Exports go to:
- `cache/genius/index.json`
- `cache/genius/chunk_0001.json`, `chunk_0002.json`, ...

## Push the exported cache to GitHub

### One-time: make sure `git push` works on the Pi

Set your commit identity (only needed once):

```bash
git config --global user.name "Noah"
git config --global user.email "you@example.com"
```

Recommended auth: SSH key

```bash
ssh-keygen -t ed25519 -C "pi-ala-genius"
cat ~/.ssh/id_ed25519.pub
```

Copy/paste the printed public key into:
- GitHub → Settings → SSH and GPG keys → New SSH key

Then switch the repo remote to SSH:

```bash
cd "$HOME/ala-music-queue"
git remote set-url origin git@github.com:nbaker9262/American-Leadership-Academy-Music-Queue.git
ssh -T git@github.com
```

### Each time you want to publish an updated cache

1) Export (button or script).

2) Commit + push:

```bash
cd "$HOME/ala-music-queue"
git add cache/genius/index.json cache/genius/chunk_*.json
git commit -m "chore(cache): update genius chunks" || true
git push
```

Notes:
- `data/` (SQLite) is ignored by git via `.gitignore` (good).
- `/etc/ala-genius/env` is outside the repo (good).

## Estimated cache size (10,000 songs)

The dominant factor is lyric text length.

Typical ranges:
- Average exported JSON payload per song: ~4–20 KB (lyrics + small metadata + JSON overhead)
- For 10,000 songs: ~40 MB to ~200+ MB total

Chunking:
- With `GENIUS_EXPORT_CHUNK_SIZE=500`, you’ll get ~20 chunk files.
- Typical chunk sizes: ~2–10+ MB each.

GitHub limits:
- GitHub blocks single files over ~100 MB.
- Chunked exports keep each file well below that limit.

## Notes on performance (Pi Zero 2 W)

Most time is network and rate limiting.
- With `GENIUS_MIN_DELAY_SECONDS=0.8` and ~2 requests/song, expect roughly:
  - 10,000 songs → ~16,000 seconds of request delay alone (~4.4 hours)
  - plus retries/cooldowns → commonly 12–48 hours depending on blocks.

Exporting to chunks is cheap and can be done while paused.
