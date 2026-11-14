#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f scripts/update.py ]]; then
  echo "Run this script from the repository root." >&2
  exit 1
fi

exec python3 scripts/update.py "$@"
