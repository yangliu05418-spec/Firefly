#!/bin/sh
set -eu

minutes=${1:-60}
limit=${2:-500}
case "$minutes" in ''|*[!0-9]*) echo "minutes must be an integer" >&2; exit 2;; esac
case "$limit" in ''|*[!0-9]*) echo "limit must be an integer" >&2; exit 2;; esac
[ "$minutes" -ge 1 ] && [ "$minutes" -le 10080 ] || { echo "minutes must be between 1 and 10080" >&2; exit 2; }
[ "$limit" -ge 1 ] && [ "$limit" -le 5000 ] || { echo "limit must be between 1 and 5000" >&2; exit 2; }

journalctl --since "$minutes minutes ago" --output=json --no-pager | jq -c '
  select((.CONTAINER_TAG // "") | startswith("firefly/")) |
  . as $row |
  (($row.MESSAGE | fromjson?) // { message: $row.MESSAGE }) + {
    observedAt: ($row.__REALTIME_TIMESTAMP | tonumber / 1000000 | todateiso8601),
    container: $row.CONTAINER_NAME,
    containerTag: $row.CONTAINER_TAG
  }
' | tail -n "$limit"
