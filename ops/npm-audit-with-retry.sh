#!/bin/sh
set -eu

attempt=1
max_attempts=3
output=$(mktemp)
trap 'rm -f "$output"' EXIT

while [ "$attempt" -le "$max_attempts" ]; do
  : > "$output"
  set +e
  NPM_CONFIG_FETCH_TIMEOUT=60000 NPM_CONFIG_FETCH_RETRIES=0 \
    timeout 75s npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org >"$output" 2>&1
  status=$?
  set -e
  cat "$output"
  [ "$status" -eq 0 ] && exit 0

  # Vulnerability findings and deterministic npm errors must fail immediately.
  # Retry only transport failures from the external advisory endpoint.
  if [ "$status" -ne 124 ] && ! grep -Eiq 'network|timeout|ECONN|EAI_AGAIN|ENETUNREACH|audit endpoint returned an error' "$output"; then
    exit "$status"
  fi
  if [ "$attempt" -eq "$max_attempts" ]; then
    echo "npm advisory endpoint remained unavailable after $max_attempts bounded attempts" >&2
    exit "$status"
  fi
  delay=$((attempt * 5))
  echo "npm advisory endpoint unavailable; retrying in ${delay}s (${attempt}/${max_attempts})" >&2
  sleep "$delay"
  attempt=$((attempt + 1))
done
