#!/usr/bin/env bash
# Deploy the Drakarys backend/frontend to a VPS over SSH (password auth via sshpass),
# then start / restart the backend with pm2.
#
# Usage:
#   VPS_HOST=1.2.3.4 VPS_USER=ubuntu VPS_PASS=secret ./deploy-app.sh
# or drop the same vars into deploy.env (gitignored) next to this script:
#   ./deploy-app.sh
#
# Optional vars:
#   VPS_PORT        ssh port            (default 22)
#   VPS_DIR         remote target dir   (default ~/drakarys)
#   BACK_ENV_FILE   env file uploaded as back/.env on the VPS
#                   (default back/.env.deploy if it exists)
#   DOMAIN          public domain for the site. When set, caddy is installed
#                   on the VPS and terminates HTTPS (auto Let's Encrypt cert),
#                   proxying everything to 127.0.0.1:$PORT. The domain's DNS
#                   A/AAAA record must point at the VPS and ports 80+443 open.
#                   The www<->apex counterpart gets a cert too and 301-redirects
#                   to DOMAIN (its DNS must point at the VPS as well).
#
# The remote back/.env is built from BACK_ENV_FILE plus any backend vars
# found in deploy.env - everything in deploy.env that is NOT a deploy-tool
# var (VPS_*, DOMAIN, BACK_ENV_FILE) is forwarded, so
# X_CLIENT_ID, X_CLIENT_SECRET, X_CALLBACK_URL, FRONT_URL, DATABASE_URL,
# NEAR_OPERATOR_ACCOUNT, PORT etc. can live in either file. Postgres is
# NOT managed here - point DATABASE_URL at wherever yours runs.

set -euo pipefail
cd "$(dirname "$0")"

[ -f deploy.env ] && set -a && . ./deploy.env && set +a

: "${VPS_HOST:?VPS_HOST required}" "${VPS_USER:?VPS_USER required}" "${VPS_PASS:?VPS_PASS required}"
VPS_PORT=${VPS_PORT:-22}
VPS_DIR=${VPS_DIR:-"~/drakarys"}
BACK_ENV_FILE=${BACK_ENV_FILE:-back/.env.deploy}
# DOMAIN is a bare host - tolerate people writing "https://domain.tld/"
DOMAIN="${DOMAIN:-}"
DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%/}"

command -v sshpass >/dev/null || {
  echo "sshpass is required: sudo apt install sshpass" >&2
  exit 1
}

SSH="sshpass -p $VPS_PASS ssh -o StrictHostKeyChecking=accept-new -p $VPS_PORT"
RSYNC="sshpass -p $VPS_PASS rsync -e \"ssh -o StrictHostKeyChecking=accept-new -p $VPS_PORT\""

echo "==> syncing project to $VPS_USER@$VPS_HOST:$VPS_DIR"
$SSH "$VPS_USER@$VPS_HOST" "mkdir -p $VPS_DIR"
eval "$RSYNC -az --delete \
  --exclude .git \
  --exclude node_modules \
  --exclude deploy.env \
  --exclude .env \
  --exclude .env.deploy \
  --exclude front/dist \
  --exclude front/node_modules \
  --exclude back/node_modules \
  --exclude sc-near/target \
  --exclude .env.near \
  ./ \"$VPS_USER@$VPS_HOST:$VPS_DIR/\""

# Compose the remote back/.env: BACK_ENV_FILE (if present) plus the
# backend vars from deploy.env. Deploy-tool vars are filtered out so
# VPS_PASS & co never end up in the app process env.
DEPLOY_ONLY_VARS="VPS_HOST VPS_USER VPS_PASS VPS_PORT VPS_DIR DOMAIN BACK_ENV_FILE"
emit_backend_env() {
  local src="$1" line key
  [ -f "$src" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '' | \#*) continue ;; esac
    key="${line%%=*}"
    key="${key//[[:space:]]/}"
    case " $DEPLOY_ONLY_VARS " in *" $key "*) continue ;; esac
    printf '%s\n' "$line"
  done <"$src"
}

TMP_ENV=$(mktemp)
trap 'rm -f "$TMP_ENV"' EXIT
emit_backend_env "$BACK_ENV_FILE" >"$TMP_ENV"
emit_backend_env deploy.env >>"$TMP_ENV"

if [ -s "$TMP_ENV" ]; then
  echo "==> uploading backend env -> back/.env"
  eval "$RSYNC -az \"$TMP_ENV\" \"$VPS_USER@$VPS_HOST:$VPS_DIR/back/.env\""
else
  echo "==> no backend env - remote keeps its existing .env (if any)"
fi

echo "==> build front + install deps + (re)start with pm2"
$SSH "$VPS_USER@$VPS_HOST" bash -s -- "$VPS_DIR" <<'REMOTE'
set -euo pipefail
D="${1/#\~/$HOME}"
cd "$D/front"
npm ci
npm run build
cd "$D/back"
npm ci --omit=dev

# runtime env for pm2
if [ -f .env ]; then set -a; . ./.env; set +a; fi

# Clear stale match data only for chains explicitly opted in via
# DB_CLEAN_CHAINS="chain1,chain2" (deploy.env or back/.env.deploy).
# Default is a NO-OP - the indexer reuses postgres history across deploys,
# and an unconditional wipe forced an expensive re-scan on every deploy.
if [ -n "${DATABASE_URL:-}" ] && [ -n "${DB_CLEAN_CHAINS:-}" ]; then
  echo "--> clearing match data for: $DB_CLEAN_CHAINS"
  cd "$D/back"
  node -e 'const{Client}=require("pg");const c=new Client({connectionString:process.env.DATABASE_URL});const chains=process.env.DB_CLEAN_CHAINS.split(",").map(s=>s.trim()).filter(Boolean);c.connect().then(()=>c.query("DELETE FROM matches WHERE chain=ANY(\$1)",[chains])).then(()=>c.query("DELETE FROM commits WHERE chain=ANY(\$1)",[chains])).then(()=>c.query("DELETE FROM reveals WHERE chain=ANY(\$1)",[chains])).then(()=>c.query("DELETE FROM transactions WHERE chain=ANY(\$1)",[chains])).then(()=>console.log("--> cleared match data for",chains.join(", "))).catch((e)=>console.error("--> db cleanup failed:",e.message)).finally(()=>c.end());'
else
  echo "--> skipping db cleanup (set DB_CLEAN_CHAINS=chain1,chain2 to enable)"
fi

command -v pm2 >/dev/null || npm i -g pm2
if pm2 describe drakarys-back >/dev/null 2>&1; then
  pm2 restart drakarys-back --update-env
else
  pm2 start index.js --name drakarys-back
fi
pm2 save
REMOTE

# HTTPS: Caddy terminates TLS and proxies to 127.0.0.1:$PORT.
if [ -n "$DOMAIN" ]; then
  echo "==> enabling https for $DOMAIN (caddy reverse proxy)"
  $SSH "$VPS_USER@$VPS_HOST" bash -s -- "$VPS_DIR" "$DOMAIN" "$VPS_PASS" <<'REMOTE'
set -euo pipefail
D="${1/#\~/$HOME}" DOMAIN="$2" PASS="$3"
PORT=3000
[ -f "$D/back/.env" ] && { set -a; . "$D/back/.env"; set +a; }

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  printf '%s\n' "$PASS" | sudo -S -p '' -v
  SUDO="sudo -n"
fi

if ! command -v caddy >/dev/null; then
  command -v apt-get >/dev/null || {
    echo "caddy auto-install needs apt (debian/ubuntu) - install caddy manually" >&2
    exit 1
  }
  echo "--> installing caddy"
  $SUDO apt-get update -y
  $SUDO apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' |
    $SUDO gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' |
    $SUDO tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  $SUDO apt-get update -y
  $SUDO apt-get install -y caddy
fi

# serve DOMAIN, and redirect the www<->apex counterpart to it
case "$DOMAIN" in
  www.*) ALIAS="${DOMAIN#www.}" ;;
  *)     ALIAS="www.$DOMAIN" ;;
esac

printf '%s {\n\treverse_proxy 127.0.0.1:%s\n}\n%s {\n\tredir https://%s{uri} permanent\n}\n' \
  "$DOMAIN" "$PORT" "$ALIAS" "$DOMAIN" |
  $SUDO tee /etc/caddy/Caddyfile >/dev/null
$SUDO systemctl enable --now caddy
$SUDO systemctl reload caddy || $SUDO systemctl restart caddy
REMOTE
fi

if [ -n "${DOMAIN:-}" ]; then
  echo "==> done - https://$DOMAIN/"
else
  echo "==> done - http://$VPS_HOST:${PORT:-3000}/api/chains"
fi
