# Raspberry Pi Zero 2 W Setup (Live Lyrics Scraper + VS Code Access)

This guide is written for a beginner and assumes:
- You have a Raspberry Pi Zero 2 W + microSD card.
- You are using Windows for VS Code.
- Goal: run the live lyrics scraper API (`lyrics_api_server.py`) on the Pi, then connect to the Pi from VS Code.

## What you’ll end up with

- The Pi runs a web API on port `8787`:
  - `GET /health`
  - `GET /lyrics?artist=...&song=...`
- You can SSH into the Pi.
- You can open/edit this repo on the Pi from VS Code using **Remote - SSH**.
- Optional: the Pi can serve the dashboard over HTTP so your browser can call the API without HTTPS mixed-content problems.

---

## 0) Parts + checklist

- Raspberry Pi Zero 2 W
- MicroSD card (16GB+ recommended)
- MicroSD reader for your Windows PC
- Pi power supply
- Wi‑Fi network name + password

---

## 1) Flash Raspberry Pi OS (Lite recommended)

1. Install **Raspberry Pi Imager** on Windows.
2. Insert your microSD card.
3. In Raspberry Pi Imager:
   - **Device**: Raspberry Pi Zero 2 W
   - **OS**: Raspberry Pi OS Lite (32-bit is fine)
   - **Storage**: your microSD
4. Click the gear / advanced options:
   - Enable **SSH**
   - Set a **username + password**
   - Configure **Wi‑Fi** (SSID + password) and your country
   - Set hostname (example: `ala-lyrics-pi`)
5. Flash.

Boot the Pi. Give it 2–5 minutes to connect to Wi‑Fi.

---

## 2) Find the Pi’s IP address

Ways to find it:
- Your router’s “Connected devices” page
- Or, from Windows PowerShell, try:
  - `ping ala-lyrics-pi.local`

If `.local` doesn’t work on Windows, use the numeric IP from your router.

---

## 3) SSH into the Pi (first login)

In Windows PowerShell:

- `ssh <username>@<pi-ip>`

Example:
- `ssh pi@192.168.1.50`

Accept the fingerprint prompt, then log in.

---

## 4) Install system dependencies

On the Pi (SSH session):

```bash
sudo apt update
sudo apt -y upgrade
sudo apt -y install git python3 python3-venv python3-pip
```

---

## 5) Clone this repo on the Pi

Still on the Pi:

```bash
mkdir -p ~/repos
cd ~/repos
git clone https://github.com/NBaker9262/American-Leadership-Academy-Music-Queue.git
cd American-Leadership-Academy-Music-Queue
```

---

## 6) Create a Python venv + install requirements

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

Quick test:

```bash
python3 -m py_compile lyrics_api_server.py
```

---

## 7) Run the lyrics API manually (sanity check)

```bash
source .venv/bin/activate
python lyrics_api_server.py
```

On the Pi, in a second SSH window:

```bash
curl "http://127.0.0.1:8787/health"
```

From your Windows machine (replace IP):

```bash
curl "http://<pi-ip>:8787/health"
```

If that returns JSON like `{ "ok": true, ... }`, the API is working.

Stop the server with `Ctrl+C`.

---

## 8) Run the lyrics API on boot (systemd)

1. Create a service file:

```bash
sudo nano /etc/systemd/system/ala-lyrics-api.service
```

2. Paste this (replace `<username>` everywhere):

```ini
[Unit]
Description=ALA Lyrics API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=<username>
WorkingDirectory=/home/<username>/repos/American-Leadership-Academy-Music-Queue
Environment=PORT=8787
ExecStart=/home/<username>/repos/American-Leadership-Academy-Music-Queue/.venv/bin/python /home/<username>/repos/American-Leadership-Academy-Music-Queue/lyrics_api_server.py
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

3. Enable + start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ala-lyrics-api.service
```

4. Check logs:

```bash
sudo systemctl status ala-lyrics-api.service --no-pager
journalctl -u ala-lyrics-api.service -n 100 --no-pager
```

---

## 9) VS Code access from Windows (Remote - SSH)

1. Install VS Code on Windows.
2. Install the extension:
   - **Remote - SSH** (by Microsoft)
3. In VS Code:
   - Press `Ctrl+Shift+P`
   - Run: `Remote-SSH: Add New SSH Host...`
   - Enter:
     - `ssh <username>@<pi-ip>`
4. Then:
   - `Remote-SSH: Connect to Host...`
5. Once connected:
   - File → Open Folder…
   - Open: `/home/<username>/repos/American-Leadership-Academy-Music-Queue`

You can now edit/run code on the Pi from VS Code.

---

## 9.5) Remote access from anywhere (no port forwarding, no domain)

If you want to access the Pi when you are NOT on the same Wi‑Fi, you have a few free options.

### Option A (recommended for VS Code): VS Code Remote Tunnels

This avoids IP/port issues entirely and does **not** require your own domain.

High-level idea:
- You run a tunnel on the Pi.
- VS Code on Windows connects to that tunnel.

On the Pi:

1. Install VS Code server tooling (one common way is to install the `code` CLI via Microsoft’s instructions for Raspberry Pi OS).
2. Run the tunnel:

```bash
code tunnel
```

It will give you a login prompt/link the first time.

On Windows (VS Code):

1. Install the **Remote Tunnels** / **Remote Development** extension(s) if prompted.
2. Use the Command Palette and connect to the running tunnel.

Notes:
- This is the simplest way to “access in VS Code” without needing SSH, static IPs, or router config.

### Option B (recommended for SSH): Tailscale

Tailscale is free for personal use and does **not** require a domain.

High-level idea:
- Install Tailscale on Windows and the Pi.
- The Pi gets a stable private VPN IP (usually `100.x.y.z`).
- You SSH to that IP from anywhere.

It also works great for the **lyrics API** (port `8787`) so you don’t need to deal with home IPs, port forwarding, or CGNAT.

#### B1) Install Tailscale on Windows

1. Install the Tailscale app on Windows.
2. Sign in.

#### B2) Install Tailscale on the Pi

On the Pi (SSH or Raspberry Pi Connect terminal):

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

Start / login (this prints a link):

```bash
sudo tailscale up
```

Open the link in a browser (Raspberry Pi Connect makes this easy), sign in, and approve the device.

#### B3) Get the Pi’s Tailscale IP + test

On the Pi:

```bash
tailscale ip -4
tailscale status
```

From Windows PowerShell (replace with the Pi’s Tailscale IP):

```bash
curl "http://<tailscale-pi-ip>:8787/health"
```

If you see `{ "ok": true, ... }`, your API is reachable over Tailscale.

#### B4) VS Code Remote-SSH over Tailscale

Once Tailscale is working, your VS Code SSH target becomes:

Once set up, your VS Code SSH target becomes:

```bash
ssh <username>@<tailscale-pi-ip>
```

#### B5) Important browser note (GitHub Pages vs. HTTP API)

If you open the dashboard from GitHub Pages (HTTPS), most browsers will block calls to an `http://` API (mixed-content).

Recommended fix (simple): open the dashboard from the Pi over HTTP through Tailscale:

- Start the dashboard server on the Pi (see step 10).
- On Windows, open:
   - `http://<tailscale-pi-ip>:8000/`

That way the dashboard is also HTTP, and it can call the lyrics API on port `8787`.

(If you want to keep using GitHub Pages + live API, you’ll need an HTTPS front like Cloudflare Tunnel, or use Tailscale’s HTTPS serving features inside your tailnet.)

### Option C (recommended for HTTPS API URL): Cloudflare Tunnel “Quick Tunnel”

Use this if you want an **HTTPS** URL to your lyrics API without buying a domain.

Why you might need it:
- GitHub Pages is HTTPS.
- Browsers typically block calling an `http://` API from an `https://` page (mixed content).

With a Cloudflare quick tunnel you can get a temporary HTTPS URL like `https://<random>.trycloudflare.com` pointing to your Pi’s `http://127.0.0.1:8787`.

Notes:
- Quick tunnels are often **temporary** (the URL can change). For a stable hostname you typically use your own domain, but it’s not required to test/validate.

---

## 10) (Recommended) Serve the dashboard from the Pi to avoid HTTPS mixed-content

If you open the dashboard from GitHub Pages (HTTPS), browsers will block calls to an `http://` API.

Simplest approach: serve the dashboard over HTTP from the Pi and browse it from your laptop:

On the Pi:

```bash
cd ~/repos/American-Leadership-Academy-Music-Queue
python3 -m http.server 8000 --bind 0.0.0.0
```

Then on your Windows machine, open:

- `http://<pi-ip>:8000/`

This makes it easy for the dashboard to call the live API on the same Pi.

If you want this dashboard hosting to run on boot too, tell me and I’ll add a second systemd service.

---

## 11) Backup cache (optional)

A backup `lyrics-cache.json` exists in the repo and is refreshed by GitHub Actions on a slower schedule.
When the live API is not reachable, the dashboard can use this backup cache.
