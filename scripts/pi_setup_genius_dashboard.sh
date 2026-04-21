#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/ala-music-queue}"
REPO_GIT_URL="${REPO_GIT_URL:-https://github.com/nbaker9262/American-Leadership-Academy-Music-Queue.git}"
APP_PORT="${APP_PORT:-2034}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

echo "Installing Raspberry Pi packages..."
sudo apt update
sudo apt install -y git python3 python3-venv python3-pip sqlite3

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "Cloning repo into $REPO_DIR"
  git clone "$REPO_GIT_URL" "$REPO_DIR"
fi

cd "$REPO_DIR"
git pull --ff-only || true

echo "Creating virtual environment..."
$PYTHON_BIN -m venv .venv
. .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo "Preparing service environment..."
sudo mkdir -p /etc/ala-music-queue
sudo chmod 700 /etc/ala-music-queue

if [ ! -f /etc/ala-music-queue/env ]; then
  read -r -p "Spotify client id (optional, press Enter to skip): " SPOTIFY_CLIENT_ID
  read -r -s -p "Spotify client secret (optional, hidden): " SPOTIFY_CLIENT_SECRET
  echo
  read -r -s -p "Genius access token (optional but needed for lyrics scraping): " GENIUS_ACCESS_TOKEN
  echo

  TMP_ENV="$(mktemp)"
  cat >"$TMP_ENV" <<EOF
ALA_DB_PATH=${REPO_DIR}/data/ala_music.sqlite3
ALA_EXPORT_DIR=${REPO_DIR}/cache/exports
ALA_EXPORT_CHUNK_SIZE=500
ALA_AUTO_START_WORKER=1
GENIUS_ACCESS_TOKEN=${GENIUS_ACCESS_TOKEN}
GENIUS_MIN_DELAY_SECONDS=1.2
GENIUS_MAX_ATTEMPTS=12
SPOTIFY_CLIENT_ID=${SPOTIFY_CLIENT_ID}
SPOTIFY_CLIENT_SECRET=${SPOTIFY_CLIENT_SECRET}
SPOTIFY_MARKET=US
EOF
  sudo install -m 600 "$TMP_ENV" /etc/ala-music-queue/env
  rm -f "$TMP_ENV"
else
  echo "Existing /etc/ala-music-queue/env found; leaving it in place."
fi

echo "Installing systemd service..."
sudo bash -c "cat > /etc/systemd/system/ala-music-queue.service" <<EOF
[Unit]
Description=ALA Music Queue Dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=$REPO_DIR
EnvironmentFile=/etc/ala-music-queue/env
ExecStart=$REPO_DIR/.venv/bin/python -m uvicorn server.dashboard:app --host 0.0.0.0 --port $APP_PORT
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now ala-music-queue.service

PI_IP="$(hostname -I | awk '{print $1}')"
echo
echo "ALA Music Queue is running."
echo "Dashboard: http://${PI_IP}:${APP_PORT}"
echo "Logs: sudo journalctl -u ala-music-queue.service -f"
