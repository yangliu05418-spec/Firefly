#!/bin/sh
set -eu

release_env=${FIREFLY_RELEASE_ENV:-/etc/firefly/release.env}
alerts_env=${FIREFLY_ALERTS_ENV:-/etc/firefly/alerts.env}
app_env=${FIREFLY_APP_ENV:-/opt/firefly/.env}
feishu_env=${FIREFLY_FEISHU_ENV:-/opt/firefly/.env.feishu}

[ -r "$release_env" ] || { echo "release environment is not readable" >&2; exit 1; }
[ -r "$app_env" ] || { echo "application environment is not readable" >&2; exit 1; }
[ -r "$feishu_env" ] || { echo "Feishu environment is not readable" >&2; exit 1; }
[ -r "$alerts_env" ] || { echo "alerts environment is not readable" >&2; exit 1; }

# shellcheck disable=SC1090
. "$release_env"
printf '%s\n' "${FIREFLY_IMAGE:-}" | grep -Eq '^ghcr\.io/yangliu05418-spec/firefly@sha256:[0-9a-f]{64}$' || {
  echo "FIREFLY_IMAGE must be an approved immutable GHCR digest" >&2
  exit 1
}

stamp=$(date -u +%Y%m%dT%H%M%SZ)
/usr/bin/docker image inspect "$FIREFLY_IMAGE" >/dev/null
/usr/bin/docker run --rm \
  --name "firefly-backup-$stamp" \
  --label com.firefly.role=backup \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --env-file "$app_env" \
  --env-file "$feishu_env" \
  --env-file "$alerts_env" \
  -e REQUIRE_TOS_BACKUP=true \
  -e "BACKUP_PATH=/data/backups/firefly-$stamp.db" \
  -v /srv/firefly/data:/data:rw \
  "$FIREFLY_IMAGE" node /app/ops/backup-db.mjs

find /srv/firefly/data/backups -type f -name 'firefly-*.db' -mtime +7 -delete
