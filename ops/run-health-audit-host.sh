#!/bin/sh
set -eu

release_env=/etc/firefly/release.env
app_env=/opt/firefly/.env
feishu_env=/opt/firefly/.env.feishu
state_dir=/var/lib/firefly/health
network=${FIREFLY_DOCKER_NETWORK:-firefly_default}
[ -r "$release_env" ] || exit 0
# shellcheck disable=SC1090
. "$release_env"
mkdir -p "$state_dir"

audit_state=ok
output=$(/usr/bin/docker run --rm --network "$network" --read-only --tmpfs /tmp:rw,noexec,nosuid,size=32m \
  --env-file "$app_env" --env-file "$feishu_env" -e FIREFLY_REVISION="${FIREFLY_REVISION:-unknown}" -e FIREFLY_IMAGE_DIGEST="${FIREFLY_IMAGE##*@}" \
  -v /srv/firefly/data:/data:rw "$FIREFLY_IMAGE" node dist-server/health-audit.js) || audit_state=application_degraded

disk_percent=$(df -P /srv/firefly/data | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
if [ "${disk_percent:-100}" -ge 85 ]; then audit_state="${audit_state},disk_high"; fi

restart_total=0
for container in $(/usr/bin/docker ps -q --filter label=com.firefly.role); do
  count=$(/usr/bin/docker inspect --format '{{.RestartCount}}' "$container" 2>/dev/null || printf '0')
  restart_total=$((restart_total + count))
done
printf '%s\n' "$output" >&2
printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ) state=$audit_state disk=$disk_percent restarts=$restart_total" > "$state_dir/latest.log"

previous=$(cat "$state_dir/state" 2>/dev/null || printf 'unknown')
if [ "$audit_state" != "$previous" ]; then
  printf '%s\n' "$audit_state" > "$state_dir/state"
  if [ "$audit_state" = "ok" ]; then event=health_recovered; else event=health_degraded; fi
  /usr/local/sbin/firefly-notify "$event" "${FIREFLY_REVISION:-unknown}" "health-$(date -u +%Y%m%dT%H%M%SZ)" 0 || true
fi
[ "$audit_state" = "ok" ]
