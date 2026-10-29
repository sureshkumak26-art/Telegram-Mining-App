#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [ ! -f package.json ] || ! grep -q '"workspaces"' package.json; then
  echo "Run this script from the Telegram-Mining-App repository root." >&2
  exit 1
fi

echo "== Telegram Mining App: Termux setup =="
pkg update -y
pkg install -y nodejs-lts postgresql git curl

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js/npm installation failed." >&2; exit 1
fi
node -v
npm -v

PGDATA="$PREFIX/var/lib/postgresql"
mkdir -p "$PGDATA"
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "Initializing PostgreSQL data directory..."
  initdb "$PGDATA"
fi
if ! pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
  pg_ctl -D "$PGDATA" -l "$PGDATA/server.log" start
fi

DB_USER="$(whoami)"
if ! psql -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  createuser -s "$DB_USER"
fi
if ! psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='mining_app'" | grep -q 1; then
  createdb mining_app
fi

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
fi

set_env() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  awk -v k="$key" -v v="$value" 'BEGIN{FS="="} $1==k {print k "=" v; found=1; next} {print} END{if(!found) print k "=" v}' .env > "$tmp"
  cat "$tmp" > .env
  rm -f "$tmp"
}
set_env DATABASE_URL "postgresql://$DB_USER@localhost:5432/mining_app"
set_env NODE_ENV development
set_env PORT 3001
set_env CLIENT_ORIGIN "http://localhost:5173"

read -r -p "Telegram bot username (without @): " BOT_USERNAME
read -r -s -p "Telegram bot token (input hidden): " BOT_TOKEN; echo
read -r -p "Your numeric Telegram user ID (admin): " ADMIN_ID
read -r -p "Ethereum Mainnet RPC URL (blank to configure later): " RPC_URL
read -r -p "Public Ethereum treasury address (blank to configure later): " TREASURY
read -r -p "Verified Ethereum Mainnet USDC contract (optional, blank to disable): " USDC

[ -n "$BOT_USERNAME" ] && set_env TELEGRAM_BOT_USERNAME "$BOT_USERNAME"
[ -n "$BOT_TOKEN" ] && set_env TELEGRAM_BOT_TOKEN "$BOT_TOKEN"
[ -n "$ADMIN_ID" ] && set_env ADMIN_TELEGRAM_IDS "$ADMIN_ID"
[ -n "$RPC_URL" ] && set_env ETHEREUM_RPC_URL "$RPC_URL"
[ -n "$TREASURY" ] && set_env ETHEREUM_TREASURY_ADDRESS "$TREASURY"
[ -n "$USDC" ] && set_env ETHEREUM_USDC_CONTRACT "$USDC"
chmod 600 .env

echo "Installing project dependencies..."
npm install

echo "Checking TypeScript..."
npm run typecheck
echo "Building frontend and backend..."
npm run build

echo
echo "Setup complete."
echo "Local app: http://localhost:5173"
echo "Admin panel: http://localhost:5173/admin (inside Telegram for authenticated admin access)"
echo "API health: http://localhost:3001/health"

if command -v cloudflared >/dev/null 2>&1; then
  read -r -p "Start a temporary PUBLIC HTTPS tunnel for Telegram testing? (y/N): " TUNNEL_CHOICE
  if [[ "$TUNNEL_CHOICE" =~ ^[Yy]$ ]]; then
    cloudflared tunnel --url http://localhost:5173 --no-autoupdate > "$ROOT/.cloudflared.log" 2>&1 &
    TUNNEL_PID=$!
    trap 'kill "$TUNNEL_PID" 2>/dev/null || true' EXIT INT TERM
    sleep 5
    TUNNEL_URL="$(grep -Eo 'https://[-a-zA-Z0-9]+\\.trycloudflare\\.com' "$ROOT/.cloudflared.log" | head -n 1 || true)"
    if [ -n "$TUNNEL_URL" ]; then
      echo
      echo "Temporary HTTPS URL: $TUNNEL_URL"
      echo "Set this URL as your bot's Mini App URL in BotFather."
      echo "This URL changes when the tunnel restarts; testing only, not production."
    else
      echo "Tunnel URL not detected. Check $ROOT/.cloudflared.log"
    fi
  fi
else
  echo "cloudflared is not installed. Local testing is ready; install cloudflared separately if you need a temporary HTTPS URL."
fi

echo "Stop with Ctrl+C. Keep this Termux session open."
npm run dev
