#!/bin/sh
set -eu

image=${1:-}
revision=${2:-}
printf '%s\n' "$image" | grep -Eq '^ghcr\.io/yangliu05418-spec/firefly@sha256:[0-9a-f]{64}$' || { echo "invalid immutable image" >&2; exit 1; }
printf '%s\n' "$revision" | grep -Eq '^[0-9a-f]{40}$' || { echo "invalid revision" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "must run as root" >&2; exit 1; }

exec 9>/run/lock/firefly-deploy.lock
flock -n 9 || { echo "another deployment is active" >&2; exit 1; }

started_at=$(date +%s)
case_id="deploy-$(date -u +%Y%m%dT%H%M%SZ)-$$"
release_env=/etc/firefly/release.env
app_env=/opt/firefly/.env
feishu_env=/opt/firefly/.env.feishu
alerts_env=/etc/firefly/alerts.env
network=${FIREFLY_DOCKER_NETWORK:-firefly_default}
legacy_project=${FIREFLY_LEGACY_COMPOSE_PROJECT:-firefly}
current_slot=legacy
current_port=8090
switched=0
old_workers_file="/run/firefly-old-workers-$case_id"
diagnostics_dir="/var/lib/firefly/deployments/$case_id"
: > "$old_workers_file"
if [ -r "$release_env" ]; then
  # shellcheck disable=SC1090
  . "$release_env"
  current_slot=${FIREFLY_ACTIVE_SLOT:-legacy}
  current_port=${FIREFLY_ACTIVE_PORT:-8090}
fi
if [ "$current_port" = "8090" ]; then next_port=8091; next_slot=green; else next_port=8090; next_slot=blue; fi

notify() { /usr/local/sbin/firefly-notify "$1" "$revision" "$case_id" "$(( $(date +%s) - started_at ))" || true; }
capture_candidate_diagnostics() {
  install -d -o root -g root -m 0700 "$diagnostics_dir"
  diagnostics_file="$diagnostics_dir/candidate.log"
  {
    printf 'case_id=%s\nrevision=%s\nslot=%s\nport=%s\ncaptured_at=%s\n' \
      "$case_id" "$revision" "$next_slot" "$next_port" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '\nREADY\n'
    curl --silent --show-error --max-time 5 --write-out '\nhttp_status=%{http_code}\n' \
      "http://127.0.0.1:$next_port/api/health/ready" || true
    for role in web worker media-worker canvas-worker; do
      container="firefly-$role-$next_slot"
      printf '\nCONTAINER %s\n' "$container"
      /usr/bin/docker inspect --format '{{json .State}}' "$container" 2>&1 || true
      /usr/bin/docker logs --tail 200 "$container" 2>&1 || true
    done
  } > "$diagnostics_file" 2>&1
  chown root:root "$diagnostics_file"
  chmod 0600 "$diagnostics_file"
  echo "candidate diagnostics stored at $diagnostics_file" >&2
}
failure_event=failed
restart_old_workers() {
  while IFS= read -r container; do
    [ -n "$container" ] || continue
    /usr/bin/docker start "$container" >/dev/null 2>&1 || true
  done < "$old_workers_file"
}
on_exit() {
  code=$?
  trap - EXIT
  if [ "$code" -ne 0 ]; then
    capture_candidate_diagnostics || true
    if [ "$switched" -eq 1 ]; then
      restart_old_workers
      # Only retire the candidate after Nginx is certainly back on the old
      # slot. If rollback itself fails, leave both slots alive for recovery.
      if switch_upstream "$current_port"; then cleanup_candidate; fi
    fi
    notify "$failure_event"
  fi
  rm -f "$old_workers_file"
  exit "$code"
}
trap on_exit EXIT
cleanup_candidate() {
  for role in web worker media-worker canvas-worker; do
    /usr/bin/docker stop --time 35 "firefly-$role-$next_slot" >/dev/null 2>&1 || true
    /usr/bin/docker rm "firefly-$role-$next_slot" >/dev/null 2>&1 || true
  done
}
switch_upstream() {
  port=$1
  runtime_dir=/etc/nginx/firefly
  current="$runtime_dir/upstream.conf"
  candidate="$runtime_dir/upstream.conf.$case_id"
  previous="$runtime_dir/upstream.conf.previous-$case_id"
  printf 'upstream firefly_web { server 127.0.0.1:%s; keepalive 32; }\n' "$port" > "$candidate"
  chown root:root "$candidate"; chmod 0644 "$candidate"
  cp "$current" "$previous"
  mv "$candidate" "$current"
  if ! nginx -t; then mv "$previous" "$current"; return 1; fi
  if ! systemctl reload nginx; then mv "$previous" "$current"; nginx -t && systemctl reload nginx; return 1; fi
  rm -f "$previous"
}
stop_old_workers() {
  if [ "$current_slot" = "legacy" ]; then
    for service in worker media-worker canvas-worker; do
      for container in $(/usr/bin/docker ps -q \
        --filter "label=com.docker.compose.project=$legacy_project" \
        --filter "label=com.docker.compose.service=$service"); do
        printf '%s\n' "$container" >> "$old_workers_file"
      done
    done
  else
    for role in worker media-worker canvas-worker; do
      container="firefly-$role-$current_slot"
      /usr/bin/docker inspect "$container" >/dev/null 2>&1 && printf '%s\n' "$container" >> "$old_workers_file"
    done
  fi
  while IFS= read -r container; do
    [ -n "$container" ] || continue
    /usr/bin/docker stop --time 35 "$container" >/dev/null 2>&1 || true
  done < "$old_workers_file"
}

notify started
/usr/bin/docker pull "$image" >/dev/null
/usr/bin/docker image inspect "$image" >/dev/null
/usr/local/sbin/firefly-backup "$image"

/usr/bin/docker run --rm --network "$network" --env-file "$app_env" --env-file "$feishu_env" \
  -e FIREFLY_REVISION="$revision" -e FIREFLY_IMAGE_DIGEST="${image##*@}" \
  -v /srv/firefly/data:/data:rw "$image" node dist-server/migrate.js

cleanup_candidate
if [ "$current_slot" != "legacy" ]; then
  FIREFLY_LEGACY_COMPOSE_PROJECT="$legacy_project" /usr/local/sbin/firefly-retire-slot legacy
fi
if /usr/bin/docker ps -q --filter "publish=$next_port" | grep -q .; then
  failure_event=failed_standby_port_busy
  echo "standby port $next_port is still allocated" >&2
  exit 1
fi
/usr/bin/docker run -d --name "firefly-web-$next_slot" --restart unless-stopped --stop-timeout 35 \
  --network "$network" --label com.firefly.role=web --label com.firefly.slot="$next_slot" --security-opt no-new-privileges --cap-drop ALL \
  --log-driver json-file --log-opt max-size=10m --log-opt max-file=5 \
  --env-file "$app_env" --env-file "$feishu_env" -e FIREFLY_REVISION="$revision" -e FIREFLY_IMAGE_DIGEST="${image##*@}" \
  -p "127.0.0.1:$next_port:8090" -v /srv/firefly/uploads:/data/uploads -v /srv/firefly/data:/data "$image" node dist-server/index.js >/dev/null

ready_count=0
attempt=0
while [ "$attempt" -lt 60 ] && [ "$ready_count" -lt 3 ]; do
  attempt=$((attempt + 1))
  if curl --fail --silent --max-time 5 "http://127.0.0.1:$next_port/api/health/ready" >/dev/null; then ready_count=$((ready_count + 1)); else ready_count=0; fi
  [ "$ready_count" -ge 3 ] || sleep 2
done
if [ "$ready_count" -lt 3 ]; then failure_event=failed_readiness; cleanup_candidate; exit 1; fi

for role_command in 'worker:dist-server/worker.js' 'media-worker:dist-server/media-worker.js' 'canvas-worker:dist-server/canvas-worker.js'; do
  role=${role_command%%:*}; command=${role_command#*:}
  /usr/bin/docker run -d --name "firefly-$role-$next_slot" --restart unless-stopped --stop-timeout 35 \
    --network "$network" --label com.firefly.role="$role" --label com.firefly.slot="$next_slot" --security-opt no-new-privileges --cap-drop ALL \
    --log-driver json-file --log-opt max-size=10m --log-opt max-file=5 \
    --env-file "$app_env" --env-file "$feishu_env" -e FIREFLY_REVISION="$revision" -e FIREFLY_IMAGE_DIGEST="${image##*@}" \
    -v /srv/firefly/uploads:/data/uploads -v /srv/firefly/data:/data "$image" node "$command" >/dev/null
done

if ! switch_upstream "$next_port"; then failure_event=failed_nginx; cleanup_candidate; exit 1; fi
switched=1
stop_old_workers

failures=0
checks=0
while [ "$checks" -lt 30 ]; do
  checks=$((checks + 1))
  if curl --fail --silent --max-time 5 "http://127.0.0.1:$next_port/api/health/ready" >/dev/null; then failures=0; else failures=$((failures + 1)); fi
  if [ "$failures" -ge 2 ]; then
    failure_event=auto_rollback
    exit 1
  fi
  sleep 10
done

mkdir -p /etc/firefly /var/lib/firefly/releases
next_release="$release_env.$case_id"
printf 'FIREFLY_IMAGE=%s\nFIREFLY_REVISION=%s\nFIREFLY_ACTIVE_SLOT=%s\nFIREFLY_ACTIVE_PORT=%s\n' "$image" "$revision" "$next_slot" "$next_port" > "$next_release"
chown root:root "$next_release"; chmod 0600 "$next_release"; mv "$next_release" "$release_env"
cp "$release_env" "/var/lib/firefly/releases/$revision.env"

if command -v systemd-run >/dev/null 2>&1; then
  systemd-run --quiet --unit="firefly-retire-$current_slot-${revision%????????????????????????????????}" --on-active=30m /usr/local/sbin/firefly-retire-slot "$current_slot" || true
fi
notify succeeded
rm -f "$old_workers_file"
trap - EXIT
