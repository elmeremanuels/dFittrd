#!/usr/bin/env bash
# First-time VPS bootstrap for Curtain (D9). Run ONCE as root on a fresh Ubuntu 24.04 or Debian 12:
#
#   ssh root@<vps> 'bash -s' -- --pubkey "ssh-ed25519 AAAA… curtain-deploy" < scripts/deploy-bootstrap.sh
#
# Options:
#   --pubkey "<key>"   public half of the GitHub VPS_SSH_KEY; installed for the deploy user (required)
#   --user <name>      deploy user (default: deploy)
#   --dir <path>       install directory (default: /opt/curtain)
#   --harden-ssh       also turn off password logins and root password login (check that you can
#                      log in with a key first)
#
# It installs Docker Engine + the compose plugin from Docker's apt repository, ufw (22, 80, 443 tcp,
# 443 udp), unattended security upgrades with a 04:30 reboot when needed, age, rclone, rsync and curl;
# creates the deploy user (docker group, key login only), /opt/curtain, /var/backups/curtain, the
# nightly backup cron and /etc/curtain/curtain.env with freshly generated database and app secrets.
# Re-running is safe: existing secrets and keys are kept.
set -euo pipefail

DEPLOY_USER="deploy"
APP_DIR="/opt/curtain"
PUBKEY=""
HARDEN_SSH=0
while [ $# -gt 0 ]; do
  case "$1" in
    --pubkey) PUBKEY="$2"; shift 2 ;;
    --user) DEPLOY_USER="$2"; shift 2 ;;
    --dir) APP_DIR="$2"; shift 2 ;;
    --harden-ssh) HARDEN_SSH=1; shift ;;
    *) echo "bootstrap: unknown argument $1" >&2; exit 2 ;;
  esac
done

[ "$(id -u)" = 0 ] || { echo "bootstrap: run as root" >&2; exit 1; }
[ -n "$PUBKEY" ] || { echo "bootstrap: --pubkey is required (the public half of VPS_SSH_KEY)" >&2; exit 2; }
[[ "$PUBKEY" =~ ^(ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa)\  ]] || { echo "bootstrap: --pubkey does not look like an ssh public key" >&2; exit 2; }
[[ "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || { echo "bootstrap: bad --user" >&2; exit 2; }
# shellcheck disable=SC1091
. /etc/os-release
case "$ID" in
  ubuntu|debian) ;;
  *) echo "bootstrap: tested on Ubuntu 24.04 and Debian 12 only (found $ID)" >&2; exit 1 ;;
esac

export DEBIAN_FRONTEND=noninteractive
step() { printf '\n== %s\n' "$*"; }

step "packages"
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl gnupg ufw unattended-upgrades apt-listchanges age rclone rsync openssl cron

step "docker engine (Docker's apt repository)"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
# Container logs rotate (compose sets it per service too); live-restore keeps containers up during
# a docker daemon upgrade.
if [ ! -f /etc/docker/daemon.json ]; then
  cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "7" },
  "live-restore": true
}
JSON
  systemctl restart docker
fi
systemctl enable --now docker

step "firewall (ufw): ssh, http, https, http/3"
# Docker publishes 80/443 itself; postgres and the api are never published (compose uses expose).
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

step "unattended security upgrades"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
cat > /etc/apt/apt.conf.d/52curtain-unattended <<'CONF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
CONF
systemctl enable --now unattended-upgrades

step "deploy user $DEPLOY_USER"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$DEPLOY_USER"
  passwd -l "$DEPLOY_USER" >/dev/null
fi
usermod -aG docker "$DEPLOY_USER"
HOME_DIR="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$HOME_DIR/.ssh"
AUTH="$HOME_DIR/.ssh/authorized_keys"
touch "$AUTH"
grep -qxF "$PUBKEY" "$AUTH" || echo "$PUBKEY" >> "$AUTH"
chown "$DEPLOY_USER:$DEPLOY_USER" "$AUTH"
chmod 600 "$AUTH"

step "directories"
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR" "$APP_DIR/infra" "$APP_DIR/web" "$APP_DIR/web/releases"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /var/backups/curtain
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /var/log/curtain
install -d -m 750 -o root -g "$DEPLOY_USER" /etc/curtain

step "secrets file /etc/curtain/curtain.env"
SECRETS=/etc/curtain/curtain.env
if [ ! -f "$SECRETS" ]; then
  umask 077
  cat > "$SECRETS" <<ENV
# Curtain production secrets. Lives only on this server; the deploy merges it into infra/.env.
# Generated by scripts/deploy-bootstrap.sh on $(date -u +%Y-%m-%d). Fill in the empty values.
POSTGRES_PASSWORD=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
SHOP_KEY_PEPPER=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)

# Let's Encrypt contact (required)
ACME_EMAIL=

# Shopify app (Partner Dashboard → the app → Client credentials)
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=

# Backups: the age PUBLIC key (age1…). Keep the private key off this server.
BACKUP_AGE_RECIPIENT=
# Optional offsite copy: an rclone remote configured for $DEPLOY_USER (rclone config), e.g. b2:curtain-backups
BACKUP_RCLONE_REMOTE=
ENV
  echo "created $SECRETS with generated secrets; set ACME_EMAIL, SHOPIFY_* and BACKUP_AGE_RECIPIENT"
else
  echo "$SECRETS exists; left unchanged"
fi
chown "root:$DEPLOY_USER" "$SECRETS"
chmod 640 "$SECRETS"

step "nightly backup cron (03:17 UTC)"
cat > /etc/cron.d/curtain-backup <<CRON
# Curtain: encrypted pg_dump to /var/backups/curtain (+ rclone offsite when configured)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
17 3 * * * $DEPLOY_USER [ -f $APP_DIR/infra/.env ] && $APP_DIR/infra/scripts/backup.sh >> /var/log/curtain/backup.log 2>&1
CRON
chmod 644 /etc/cron.d/curtain-backup
cat > /etc/logrotate.d/curtain <<ROT
/var/log/curtain/*.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
  su $DEPLOY_USER $DEPLOY_USER
}
ROT

if [ "$HARDEN_SSH" = 1 ]; then
  step "ssh: key logins only"
  cat > /etc/ssh/sshd_config.d/50-curtain.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
CONF
  sshd -t
  systemctl reload ssh 2>/dev/null || systemctl reload sshd
fi

step "done"
echo "Host key for the GitHub secret VPS_SSH_KNOWN_HOSTS (run on your laptop, check the fingerprint):"
echo "  ssh-keyscan -t ed25519 <this host>"
if [ -f /etc/ssh/ssh_host_ed25519_key.pub ]; then ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub; fi
echo "Next: edit $SECRETS (ACME_EMAIL, SHOPIFY_*, BACKUP_AGE_RECIPIENT), then run the Deploy workflow."
