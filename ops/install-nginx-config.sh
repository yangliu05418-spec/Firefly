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

install -o root -g root -m 0644 "$source_config" "$available_dir/firefly.conf"
ln -sfn "$available_dir/firefly.conf" "$enabled_dir/firefly.conf"
"$nginx_bin" -t
"$systemctl_bin" reload nginx
