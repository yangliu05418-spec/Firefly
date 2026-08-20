#!/bin/sh
set -eu

release_env=/etc/firefly/release.env
app_env=/opt/firefly/.env
feishu_env=/opt/firefly/.env.feishu
[ -r "$release_env" ] || exit 0
# shellcheck disable=SC1090
. "$release_env"
printf '%s\n' "${FIREFLY_IMAGE:-}" | grep -Eq '^ghcr\.io/yangliu05418-spec/firefly@sha256:[0-9a-f]{64}$' || { echo "invalid release image" >&2; exit 1; }

/usr/bin/docker run --rm --name "firefly-maintenance-$(date -u +%Y%m%dT%H%M%SZ)" \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=32m --cap-drop ALL --security-opt no-new-privileges \
  --env-file "$app_env" --env-file "$feishu_env" -e TOMBSTONE_RETENTION_DAYS=30 \
  -v /srv/firefly/data:/data:rw "$FIREFLY_IMAGE" node dist-server/maintenance.js --apply
