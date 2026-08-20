#!/bin/sh
set -eu

[ "$(id -u)" -eq 0 ] || { echo "must run as root" >&2; exit 1; }
IFS= read -r webhook || [ -n "${webhook:-}" ]
printf '%s\n' "$webhook" | grep -Eq '^https://open\.(feishu\.cn|larksuite\.com)/open-apis/bot/v2/hook/[A-Za-z0-9_-]+$' || {
  echo "invalid Feishu webhook" >&2
  exit 1
}
install -d -o root -g root -m 0700 /etc/firefly
target=/etc/firefly/alerts.env
temporary="$target.$$"
printf 'FEISHU_WEBHOOK_URL=%s\n' "$webhook" > "$temporary"
chown root:root "$temporary"
chmod 0600 "$temporary"
mv "$temporary" "$target"
