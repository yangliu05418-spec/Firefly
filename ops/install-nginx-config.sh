#!/bin/sh
set -eu

source_config=${1:-/opt/firefly/ops/firefly.nginx.conf}
enabled_dir=/etc/nginx/sites-enabled
available_dir=/etc/nginx/sites-available
archive_dir=/etc/nginx/sites-archive

[ "$(id -u)" -eq 0 ] || { echo "must run as root" >&2; exit 1; }
[ -f "$source_config" ] || { echo "Nginx source config not found" >&2; exit 1; }
mkdir -p "$archive_dir"

for candidate in "$enabled_dir"/firefly.conf.bak-*; do
  [ -e "$candidate" ] || continue
  base=$(basename "$candidate")
  mv "$candidate" "$archive_dir/$base"
done

install -o root -g root -m 0644 "$source_config" "$available_dir/firefly.conf"
ln -sfn "$available_dir/firefly.conf" "$enabled_dir/firefly.conf"
nginx -t
systemctl reload nginx
