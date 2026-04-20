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

Paste this whole block into an SSH session on the Pi.

It will:
- Install OS deps
- Clone/update the repo into `~/ala-music-queue`
- Create `.venv` and install `requirements.txt`
- Prompt you for the Genius Access Token (hidden input) and save it to `/etc/ala-genius/env`
- Create + start a systemd service for the dashboard on port `2034`

```bash
set -euo pipefail

REPO_DIR="$HOME/ala-music-queue"
REPO_GIT_URL="https://github.com/nbaker9262/American-Leadership-Academy-Music-Queue.git"
DASH_PORT="2034"

echo "Installing OS packages..."
sudo apt update
sudo apt install -y git python3 python3-venv

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "Cloning repo to $REPO_DIR ..."
  git clone "$REPO_GIT_URL" "$REPO_DIR"
fi

cd "$REPO_DIR"
echo "Updating repo..."
git pull --ff-only || true

echo "Creating venv + installing Python deps..."
python3 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo "Configuring env file at /etc/ala-genius/env ..."
sudo mkdir -p /etc/ala-genius
sudo chmod 700 /etc/ala-genius

if [ ! -f /etc/ala-genius/env ]; then
  read -r -s -p "Paste your Genius ACCESS TOKEN (input hidden): " GENIUS_ACCESS_TOKEN
  echo
  if [ -z "${GENIUS_ACCESS_TOKEN}" ]; then
    echo "Token was empty; aborting."
    exit 1
  fi

  TMP_ENV="$(mktemp)"
  cat >"$TMP_ENV" <<EOF
GENIUS_ACCESS_TOKEN=${GENIUS_ACCESS_TOKEN}
GENIUS_MIN_DELAY_SECONDS=1.3
GENIUS_MAX_ATTEMPTS=10
GENIUS_DB_PATH=${REPO_DIR}/data/genius_cache.sqlite3
GENIUS_EXPORT_DIR=${REPO_DIR}/cache/genius
GENIUS_EXPORT_CHUNK_SIZE=400
EOF
  sudo install -m 600 "$TMP_ENV" /etc/ala-genius/env
  rm -f "$TMP_ENV"
  unset GENIUS_ACCESS_TOKEN
else
  echo "Found existing /etc/ala-genius/env (leaving as-is)."
fi

echo "Creating systemd service..."
sudo bash -c "cat > /etc/systemd/system/ala-genius-dashboard.service" <<EOF
[Unit]
Description=ALA Genius Cache Dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=$REPO_DIR
EnvironmentFile=/etc/ala-genius/env
ExecStart=$REPO_DIR/.venv/bin/python -m uvicorn server.dashboard:app --host 0.0.0.0 --port $DASH_PORT
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now ala-genius-dashboard

PI_IP="$(hostname -I | awk '{print $1}')"
echo
echo "Dashboard running."
echo "Open: http://${PI_IP}:${DASH_PORT}"
echo
echo "Next: open the dashboard, upload your song list, then click Start."
```

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
