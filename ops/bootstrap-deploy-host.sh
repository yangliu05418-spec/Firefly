#!/bin/sh
set -eu

public_key=${1:-}
[ "$(id -u)" -eq 0 ] || { echo "must run as root" >&2; exit 1; }
printf '%s\n' "$public_key" | grep -Eq '^ssh-ed25519 [A-Za-z0-9+/=]+ firefly-github-actions$' || { echo "invalid deploy public key" >&2; exit 1; }

id firefly-deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash firefly-deploy
install -d -o firefly-deploy -g firefly-deploy -m 0700 /home/firefly-deploy/.ssh
printf '%s\n' "$public_key" > /home/firefly-deploy/.ssh/authorized_keys
chown firefly-deploy:firefly-deploy /home/firefly-deploy/.ssh/authorized_keys
chmod 0600 /home/firefly-deploy/.ssh/authorized_keys

for mapping in \
  'firefly-deploy.sh:firefly-deploy' \
  'firefly-alerts-configure.sh:firefly-alerts-configure' \
  'firefly-ghcr-login.sh:firefly-ghcr-login' \
  'firefly-notify.sh:firefly-notify' \
  'firefly-retire-slot.sh:firefly-retire-slot' \
  'install-nginx-config.sh:firefly-install-nginx' \
  'harden-ssh-host.sh:firefly-harden-ssh' \
  'run-health-audit-host.sh:firefly-health-audit' \
  'firefly-logs.sh:firefly-logs' \
  'run-backup-host.sh:firefly-backup'; do
  source_name=${mapping%%:*}; target_name=${mapping#*:}
  install -o root -g root -m 0755 "/opt/firefly/ops/$source_name" "/usr/local/sbin/$target_name"
done

printf '%s\n' \
  'firefly-deploy ALL=(root) NOPASSWD: /usr/local/sbin/firefly-ghcr-login *, /usr/local/sbin/firefly-alerts-configure, /usr/local/sbin/firefly-deploy *' \
  > /etc/sudoers.d/firefly-deploy
chmod 0440 /etc/sudoers.d/firefly-deploy
visudo -cf /etc/sudoers.d/firefly-deploy

/usr/local/sbin/firefly-install-nginx /opt/firefly/ops/firefly.nginx.conf

install -d -o root -g root -m 0700 /etc/firefly
[ -f /etc/firefly/alerts.env ] || { touch /etc/firefly/alerts.env; chown root:root /etc/firefly/alerts.env; chmod 0600 /etc/firefly/alerts.env; }

install -o root -g root -m 0644 /opt/firefly/ops/firefly-backup.service /etc/systemd/system/firefly-backup.service
install -o root -g root -m 0644 /opt/firefly/ops/firefly-backup.timer /etc/systemd/system/firefly-backup.timer
install -o root -g root -m 0644 /opt/firefly/ops/firefly-health-audit.service /etc/systemd/system/firefly-health-audit.service
install -o root -g root -m 0644 /opt/firefly/ops/firefly-health-audit.timer /etc/systemd/system/firefly-health-audit.timer
systemctl daemon-reload
systemctl enable --now firefly-backup.timer firefly-health-audit.timer
