#!/bin/sh
set -eu

slot=${1:-}
case "$slot" in blue|green|legacy) ;; *) echo "invalid slot" >&2; exit 1 ;; esac

release_env=/etc/firefly/release.env
[ -r "$release_env" ] || exit 0
# shellcheck disable=SC1090
. "$release_env"

if [ "$slot" = "legacy" ]; then
  for service in web worker media-worker image-worker; do
    for container in $(/usr/bin/docker ps -aq --filter "label=com.docker.compose.service=$service"); do
      [ -n "$container" ] || continue
      /usr/bin/docker stop --time 35 "$container" >/dev/null 2>&1 || true
    done
  done
  exit 0
fi

[ "$slot" != "${FIREFLY_ACTIVE_SLOT:-}" ] || exit 0
for role in web worker media-worker image-worker; do
  name="firefly-$role-$slot"
  /usr/bin/docker stop --time 35 "$name" >/dev/null 2>&1 || true
  /usr/bin/docker rm "$name" >/dev/null 2>&1 || true
done
