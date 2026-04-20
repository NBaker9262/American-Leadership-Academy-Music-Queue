#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/ala-music-queue}"
REPO_GIT_URL="${REPO_GIT_URL:-https://github.com/nbaker9262/American-Leadership-Academy-Music-Queue.git}"
DASH_PORT="${DASH_PORT:-2034}"

GENIUS_MIN_DELAY_SECONDS="${GENIUS_MIN_DELAY_SECONDS:-1.3}"
GENIUS_MAX_ATTEMPTS="${GENIUS_MAX_ATTEMPTS:-10}"
GENIUS_EXPORT_CHUNK_SIZE="${GENIUS_EXPORT_CHUNK_SIZE:-400}"

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
GENIUS_MIN_DELAY_SECONDS=${GENIUS_MIN_DELAY_SECONDS}
GENIUS_MAX_ATTEMPTS=${GENIUS_MAX_ATTEMPTS}
GENIUS_DB_PATH=${REPO_DIR}/data/genius_cache.sqlite3
GENIUS_EXPORT_DIR=${REPO_DIR}/cache/genius
GENIUS_EXPORT_CHUNK_SIZE=${GENIUS_EXPORT_CHUNK_SIZE}
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
