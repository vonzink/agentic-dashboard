#!/usr/bin/env bash
# Builds the SPA into infra/ec2/spa/ (served by Caddy) using a throwaway
# Node container — no Node install needed on the box. Reads Cognito values
# from infra/ec2/.env. Run from infra/ec2:  ./build-spa.sh
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "infra/ec2/.env missing — copy .env.example first"; exit 1; }
# shellcheck disable=SC1091
set -a; source .env; set +a

for v in APP_HOSTNAME COGNITO_USER_POOL_ID COGNITO_CLIENT_ID COGNITO_REGION; do
  [ -n "${!v:-}" ] || { echo "$v is empty in .env"; exit 1; }
done

WEB_DIR="$(cd ../../apps/web && pwd)"
[ -n "${COGNITO_DOMAIN:-}" ] || { echo "COGNITO_DOMAIN is empty in .env (terraform output cognito_domain)"; exit 1; }

cat > "$WEB_DIR/.env.production" <<EOF
VITE_ENV=prod
VITE_AUTH_MODE=cognito
VITE_COGNITO_DOMAIN=${COGNITO_DOMAIN}
VITE_COGNITO_CLIENT_ID=${COGNITO_CLIENT_ID}
VITE_COGNITO_REDIRECT_URI=https://${APP_HOSTNAME}
EOF

echo "Building SPA for https://${APP_HOSTNAME} ..."
docker run --rm -v "$WEB_DIR":/app -w /app node:22-alpine \
  sh -c "npm ci --no-audit --no-fund && npm run build"

rm -rf spa && cp -r "$WEB_DIR/dist" spa
echo "Done → infra/ec2/spa ($(du -sh spa | cut -f1)). Caddy serves it immediately;"
echo "if Caddy was already running: docker compose restart caddy"
