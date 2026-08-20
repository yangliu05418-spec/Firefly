#!/bin/sh
set -eu

[ "$(id -u)" -eq 0 ] || { echo "must run as root" >&2; exit 1; }
[ -s /home/firefly-deploy/.ssh/authorized_keys ] || { echo "deploy key must be installed and tested first" >&2; exit 1; }

install -d -o root -g root -m 0755 /etc/ssh/sshd_config.d
config=/etc/ssh/sshd_config.d/60-firefly-hardening.conf
printf '%s\n' \
  'PubkeyAuthentication yes' \
  'PasswordAuthentication no' \
  'KbdInteractiveAuthentication no' \
  'PermitRootLogin no' \
  'MaxAuthTries 4' \
  > "$config"
chown root:root "$config"; chmod 0644 "$config"
sshd -t

if ! command -v fail2ban-client >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends fail2ban
fi
install -d -o root -g root -m 0755 /etc/fail2ban/jail.d
printf '%s\n' \
  '[sshd]' \
  'enabled = true' \
  'backend = systemd' \
  'bantime = 1h' \
  'findtime = 10m' \
  'maxretry = 5' \
  > /etc/fail2ban/jail.d/firefly-sshd.conf
systemctl enable --now fail2ban
systemctl reload ssh
