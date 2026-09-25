#!/usr/bin/env bash
# Creates .env from .env.example, replacing every CHANGE_ME_* value with a random
# secret (the same secret wherever the same placeholder appears).
#
#   ./infrastructure/scripts/init-env.sh [--force]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEMPLATE="$ROOT/.env.example"
TARGET="$ROOT/.env"

if [[ -f "$TARGET" && "${1:-}" != "--force" ]]; then
  echo ".env already exists; keeping it (use --force to regenerate it)."
  exit 0
fi

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

content="$(cat "$TEMPLATE")"
for placeholder in $(grep -o 'CHANGE_ME_[A-Za-z0-9_]*' "$TEMPLATE" | sort -u); do
  secret="$(random_secret)"
  content="${content//$placeholder/$secret}"
done

umask 077
printf '%s\n' "$content" >"$TARGET"
echo "Created .env with random secrets (readable only by you). Review it before starting the stack."
