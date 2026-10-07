#!/usr/bin/env bash
# Creates .env from .env.example, replacing every CHANGE_ME_* value with a random
# secret (the same secret wherever the same placeholder appears). When .env already
# exists, adds the variables of .env.example it lacks (new versions add some) and
# keeps everything else.
#
#   ./infrastructure/scripts/init-env.sh [--force]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEMPLATE="$ROOT/.env.example"
TARGET="$ROOT/.env"

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

# Replaces each CHANGE_ME_* placeholder of the text with a random secret.
with_secrets() {
  local content="$1" placeholder
  for placeholder in $(grep -o 'CHANGE_ME_[A-Za-z0-9_]*' <<<"$content" | sort -u); do
    content="${content//$placeholder/$(random_secret)}"
  done
  printf '%s\n' "$content"
}

if [[ -f "$TARGET" && "${1:-}" != "--force" ]]; then
  variable='^([A-Z][A-Z0-9_]*)='
  section_header='^# ----'
  block="" added="" comments="" section="" section_added=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ $variable ]]; then
      name="${BASH_REMATCH[1]}"
      # Present, even commented out (someone chose not to use it): left alone.
      if ! grep -Eq "^[[:blank:]]*#?[[:blank:]]*${name}=" "$TARGET"; then
        if [[ -n "$section" && -z "$section_added" ]]; then
          block+=$'\n'"$section"$'\n'
          section_added=1
        fi
        block+="$comments$line"$'\n'
        added+=" $name"
      fi
      comments=""
    elif [[ "$line" =~ $section_header ]]; then
      section="$line" section_added="" comments=""
    elif [[ "$line" == \#* && "$line" != "# ="* ]]; then
      comments+="$line"$'\n'
    else
      comments=""
    fi
  done <"$TEMPLATE"

  if [[ -z "$added" ]]; then
    echo ".env already exists and has every variable of .env.example (use --force to regenerate it)."
    exit 0
  fi
  # Without a final newline, the first added line would join the last one of the file.
  if [[ -s "$TARGET" && -n "$(tail -c 1 "$TARGET")" ]]; then printf '\n' >>"$TARGET"; fi
  with_secrets "${block%$'\n'}" >>"$TARGET"
  echo "Added to .env:$added (secrets generated at random). Review them before starting the stack."
  exit 0
fi

umask 077
with_secrets "$(cat "$TEMPLATE")" >"$TARGET"
echo "Created .env with random secrets (readable only by you). Review it before starting the stack."
