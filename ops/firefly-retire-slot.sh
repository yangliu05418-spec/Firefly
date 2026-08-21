#!/bin/sh
set -eu

slot=${1:-}
case "$slot" in blue|green|legacy) ;; *) echo "invalid slot" >&2; exit 1 ;; esac

release_env=/etc/firefly/release.env
legacy_project=firefly
[ -r "$release_env" ] || exit 0
# shellcheck disable=SC1090
. "$release_env"

container_label() {
  /usr/bin/docker inspect --format "{{index .Config.Labels \"$2\"}}" "$1" 2>/dev/null || true
}
assert_legacy_container() {
  container=$1
  expected_service=$2
  container_project=$(container_label "$container" com.docker.compose.project)
  container_service=$(container_label "$container" com.docker.compose.service)
  [ "$container_project" = "$legacy_project" ] && [ "$container_service" = "$expected_service" ] || {
    echo "refusing to retire container outside Firefly legacy service $expected_service: $container" >&2
    exit 1
  }
}
assert_slot_container() {
  container=$1
  expected_role=$2
  expected_slot=$3
  container_role=$(container_label "$container" com.firefly.role)
  container_slot=$(container_label "$container" com.firefly.slot)
  [ "$container_role" = "$expected_role" ] && [ "$container_slot" = "$expected_slot" ] || {
    echo "refusing to retire container outside Firefly slot $expected_slot/$expected_role: $container" >&2
    exit 1
  }
}

if [ "$slot" = "legacy" ]; then
  for service in web worker media-worker canvas-worker; do
    for container in $(/usr/bin/docker ps -aq \
      --filter "label=com.docker.compose.project=$legacy_project" \
      --filter "label=com.docker.compose.service=$service"); do
      [ -n "$container" ] || continue
      assert_legacy_container "$container" "$service"
      /usr/bin/docker stop --time 35 "$container" >/dev/null 2>&1 || true
    done
  done
  exit 0
fi

[ "$slot" != "${FIREFLY_ACTIVE_SLOT:-}" ] || exit 0
for role in web worker media-worker canvas-worker; do
  name="firefly-$role-$slot"
  container=$(/usr/bin/docker inspect --format '{{.Id}}' "$name" 2>/dev/null || true)
  [ -n "$container" ] || continue
  assert_slot_container "$container" "$role" "$slot"
  /usr/bin/docker stop --time 35 "$container" >/dev/null 2>&1 || true
  /usr/bin/docker rm "$container" >/dev/null 2>&1 || true
done
