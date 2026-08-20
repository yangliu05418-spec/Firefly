#!/bin/sh
set -eu

user=${1:-}
printf '%s\n' "$user" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$' || { echo "invalid GHCR user" >&2; exit 1; }
IFS= read -r token || [ -n "${token:-}" ]
[ "${#token}" -ge 20 ] || { echo "GHCR token is missing" >&2; exit 1; }
printf '%s' "$token" | /usr/bin/docker login ghcr.io --username "$user" --password-stdin >/dev/null
