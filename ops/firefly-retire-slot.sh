#!/bin/sh
set -eu

slot=${1:-}
case "$slot" in blue|green|legacy) ;; *) echo "invalid slot" >&2; exit 1 ;; esac

release_env=/etc/firefly/release.env
legacy_project=firefly
[ -r "$release_env" ] || exit 0
# shellcheck disable=SC1090
. "$release_env"

if [ "$slot" = "legacy" ]; then
  for service in web worker media-worker; do
    for container in $(/usr/bin/docker ps -aq \
      --filter "label=com.docker.compose.project=$legacy_project" \
      --filter "label=com.docker.compose.service=$service"); do
      [ -n "$container" ] || continue
      container_project=$(/usr/bin/docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container" 2>/dev/null || true)
      [ "$container_project" = "$legacy_project" ] || { echo "refusing to stop container outside Firefly project: $container" >&2; exit 1; }
      /usr/bin/docker stop --time 35 "$container" >/dev/null 2>&1 || true
    done
  done
  exit 0
fi

[ "$slot" != "${FIREFLY_ACTIVE_SLOT:-}" ] || exit 0
for role in web worker media-worker; do
  name="firefly-$role-$slot"
  /usr/bin/docker stop --time 35 "$name" >/dev/null 2>&1 || true
  /usr/bin/docker rm "$name" >/dev/null 2>&1 || true
done
