#!/bin/sh
set -eu

backup_dir=/data/backups
mkdir -p "$backup_dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_PATH="$backup_dir/firefly-$stamp.db" node /app/ops/backup-db.mjs
find "$backup_dir" -type f -name 'firefly-*.db' -mtime +7 -delete
