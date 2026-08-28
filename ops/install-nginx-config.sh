#!/bin/sh
set -eu

source_config=${1:-/opt/firefly/ops/firefly.nginx.conf}
enabled_dir=${NGINX_ENABLED_DIR:-/etc/nginx/sites-enabled}
available_dir=${NGINX_AVAILABLE_DIR:-/etc/nginx/sites-available}
archive_dir=${NGINX_ARCHIVE_DIR:-/etc/nginx/sites-archive}
runtime_dir=${NGINX_RUNTIME_DIR:-/etc/nginx/firefly}
nginx_bin=${NGINX_BIN:-nginx}
systemctl_bin=${SYSTEMCTL_BIN:-systemctl}

[ "$(id -u)" -eq 0 ] || { echo "must run as root" >&2; exit 1; }
[ -f "$source_config" ] || { echo "Nginx source config not found" >&2; exit 1; }
mkdir -p "$archive_dir"
mkdir -p "$runtime_dir"
archive_config() {
  source=$1
  archive_name=$2
  if [ ! -e "$source" ] && [ ! -L "$source" ]; then return; fi
  destination="$archive_dir/$archive_name"
  if [ -e "$destination" ] || [ -L "$destination" ]; then
    destination="$archive_dir/$archive_name.$(date -u +%Y%m%dT%H%M%SZ)-$$"
  fi
  mv "$source" "$destination"
}
if [ ! -f "$runtime_dir/upstream.conf" ]; then
  printf '%s\n' 'upstream firefly_web { server 127.0.0.1:8090; keepalive 32; }' > "$runtime_dir/upstream.conf"
  chown root:root "$runtime_dir/upstream.conf"
  chmod 0644 "$runtime_dir/upstream.conf"
fi

for candidate in "$enabled_dir"/firefly.conf.bak-*; do
  [ -e "$candidate" ] || continue
  base=$(basename "$candidate")
  archive_config "$candidate" "$base"
done

target="$available_dir/firefly.conf"
candidate="$available_dir/.firefly.conf.candidate-$$"
backup="$available_dir/.firefly.conf.backup-$$"
had_target=0
cleanup() { rm -f "$candidate" "$backup"; }
trap cleanup EXIT

install -o root -g root -m 0644 "$source_config" "$candidate"
if [ -f "$target" ]; then
  cp -p "$target" "$backup"
  had_target=1
fi
mv "$candidate" "$target"
ln -sfn "$target" "$enabled_dir/firefly.conf"

restore_previous() {
  if [ "$had_target" -eq 1 ]; then mv "$backup" "$target"; else rm -f "$target"; fi
  ln -sfn "$target" "$enabled_dir/firefly.conf"
}

if ! "$nginx_bin" -t; then
  restore_previous
  "$nginx_bin" -t >/dev/null 2>&1 || true
  exit 1
fi
if ! "$systemctl_bin" reload nginx; then
  restore_previous
  "$nginx_bin" -t && "$systemctl_bin" reload nginx || true
  exit 1
fi

rm -f "$backup"
trap - EXIT
