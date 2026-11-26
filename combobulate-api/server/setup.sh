#!/usr/bin/env bash
# Sets up Combobulate's AI server on an Oracle Cloud "Always Free" Ampere VM (Ubuntu 24.04, Arm).
#
#   sudo bash setup.sh <the VM's public IP>
#
# What it does (safe to run again):
#   1. Builds llama.cpp's llama-server (pinned release) tuned for this CPU.
#   2. Downloads Llama 3.2 3B Instruct (Q4_K_M, ~2.0 GB) and checks its SHA-256.
#   3. Runs it as a locked-down systemd service on 127.0.0.1:8080 with a random API key.
#   4. Puts Caddy in front for HTTPS at https://<ip-with-dashes>.sslip.io (free, automatic cert),
#      exposing only /v1/chat/completions and /health.
#   5. Opens ports 80/443 in the VM's own firewall (you also open them in Oracle's security list).
set -euo pipefail

LLAMA_TAG="b12262"
MODEL_URL="https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf"
MODEL_SHA256="6c1a2b41161032677be168d354123594c0e6e67d2b9227c84f296ad037c728ff"

ROOT=/opt/llm
MODEL="$ROOT/models/model.gguf"
KEY_FILE=/etc/llm/api-key

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "Run this with sudo: sudo bash setup.sh <public-ip>"; exit 1; }
IP="${1:-}"
[[ $IP =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || { echo "Usage: sudo bash setup.sh <public-ip>"; exit 1; }
HOST="${IP//./-}.sslip.io"
[[ $(uname -m) == aarch64 ]] || echo "Warning: expected an Arm (aarch64) VM; continuing anyway."

say "Installing packages"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  build-essential cmake git curl ca-certificates openssl libssl-dev libcurl4-openssl-dev \
  caddy iptables-persistent

id llm &>/dev/null || useradd --system --home-dir "$ROOT" --shell /usr/sbin/nologin llm
mkdir -p "$ROOT/models" /etc/llm

say "Building llama.cpp $LLAMA_TAG (takes 10-20 minutes on 2 cores)"
if [[ ! -x "$ROOT/llama.cpp/build/bin/llama-server" || "$(cat "$ROOT/llama.cpp/.tag" 2>/dev/null)" != "$LLAMA_TAG" ]]; then
  rm -rf "$ROOT/llama.cpp"
  git clone --depth 1 --branch "$LLAMA_TAG" https://github.com/ggml-org/llama.cpp "$ROOT/llama.cpp"
  cmake -S "$ROOT/llama.cpp" -B "$ROOT/llama.cpp/build" -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=ON
  cmake --build "$ROOT/llama.cpp/build" --config Release -j "$(nproc)" --target llama-server
  echo "$LLAMA_TAG" > "$ROOT/llama.cpp/.tag"
else
  echo "Already built."
fi

say "Downloading the model (~2.0 GB)"
if echo "$MODEL_SHA256  $MODEL" | sha256sum -c --status 2>/dev/null; then
  echo "Already downloaded."
else
  curl -fL --retry 3 -o "$MODEL.part" "$MODEL_URL"
  echo "$MODEL_SHA256  $MODEL.part" | sha256sum -c -
  mv "$MODEL.part" "$MODEL"
fi

say "Creating the API key"
[[ -s $KEY_FILE ]] || openssl rand -hex 32 > "$KEY_FILE"
chown root:llm "$KEY_FILE"
chmod 640 "$KEY_FILE"
chown -R llm:llm "$ROOT"

say "Installing the llama-server service"
cat > /etc/systemd/system/llama-server.service <<EOF
[Unit]
Description=llama.cpp server for Combobulate
After=network-online.target
Wants=network-online.target

[Service]
User=llm
Group=llm
ExecStart=$ROOT/llama.cpp/build/bin/llama-server -m $MODEL --host 127.0.0.1 --port 8080 --ctx-size 2048 --parallel 1 --threads $(nproc) --api-key-file $KEY_FILE
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable llama-server
systemctl restart llama-server

say "Configuring Caddy for https://$HOST"
cat > /etc/caddy/Caddyfile <<EOF
$HOST {
	request_body {
		max_size 64KB
	}
	@api path /v1/chat/completions /health
	handle @api {
		reverse_proxy 127.0.0.1:8080
	}
	handle {
		respond 404
	}
}
EOF
systemctl enable caddy
systemctl restart caddy

say "Opening ports 80 and 443 in the VM firewall"
for port in 80 443; do
  iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null ||
    iptables -I INPUT 1 -p tcp --dport "$port" -m state --state NEW -j ACCEPT
done
netfilter-persistent save

say "Waiting for the model to load"
for _ in $(seq 1 90); do
  curl -fs http://127.0.0.1:8080/health >/dev/null && break
  sleep 2
done
curl -fs http://127.0.0.1:8080/health >/dev/null || { echo "llama-server didn't come up. Check: journalctl -u llama-server -n 50"; exit 1; }

say "Test: Water + Fire"
start=$(date +%s%N)
curl -fs http://127.0.0.1:8080/v1/chat/completions \
  -H "authorization: Bearer $(cat "$KEY_FILE")" -H 'content-type: application/json' \
  -d '{"messages":[{"role":"system","content":"Reply with one line: the thing two things make (1-3 words), then \" | \", then one emoji."},{"role":"user","content":"Water + Fire"}],"max_tokens":24}' |
  grep -o '"content":"[^"]*"' | head -1
echo "Took $(( ($(date +%s%N) - start) / 1000000 )) ms (the first request is the slowest)."

say "Checking HTTPS from outside"
if curl -fs --max-time 60 "https://$HOST/health" >/dev/null; then
  echo "https://$HOST is up."
else
  echo "Couldn't reach https://$HOST yet. Make sure ports 80 and 443 are open in Oracle's security list"
  echo "(see server/README.md), then run: sudo systemctl restart caddy"
fi

cat <<EOF

Done. Now, on your PC, in combobulate-api/:

  1. In wrangler.toml set:   LLM_URL = "https://$HOST"
  2. Run:  npx wrangler secret put LLM_TOKEN
     and paste the key shown by this command on the VM:  sudo cat $KEY_FILE
  3. Run:  npm run deploy

EOF
