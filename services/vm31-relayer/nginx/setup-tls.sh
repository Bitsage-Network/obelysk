#!/usr/bin/env bash
# =============================================================================
# setup-tls.sh — Obtain Let's Encrypt TLS certificate for relayer.obelysk.network
# =============================================================================
#
# Prerequisites:
#   1. DNS A record:  relayer.obelysk.network  ->  <server-public-ip>
#      (or CNAME pointing to the server hostname)
#
#   2. Ports 80 and 443 open in firewall / security group
#
#   3. Nginx installed and able to serve /.well-known/acme-challenge/
#      (the nginx.conf in this directory handles that path on port 80)
#
#   4. certbot installed:
#        Debian/Ubuntu: sudo apt install certbot python3-certbot-nginx
#        RHEL/Fedora:   sudo dnf install certbot python3-certbot-nginx
#        macOS (dev):   brew install certbot
#
# Usage:
#   chmod +x setup-tls.sh
#   sudo ./setup-tls.sh              # interactive (prompts for email)
#   sudo ./setup-tls.sh --email ops@obelysk.network   # non-interactive
#
# =============================================================================
set -euo pipefail

DOMAIN="relayer.obelysk.network"
WEBROOT="/var/www/certbot"
EMAIL=""

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --email)
            EMAIL="$2"
            shift 2
            ;;
        --help|-h)
            head -n 25 "$0" | tail -n +3 | sed 's/^# \?//'
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
if [[ $EUID -ne 0 ]]; then
    echo "Error: This script must be run as root (sudo)."
    exit 1
fi

if ! command -v certbot &>/dev/null; then
    echo "Error: certbot is not installed."
    echo "  Debian/Ubuntu: sudo apt install certbot python3-certbot-nginx"
    echo "  RHEL/Fedora:   sudo dnf install certbot python3-certbot-nginx"
    exit 1
fi

if ! command -v nginx &>/dev/null; then
    echo "Error: nginx is not installed."
    exit 1
fi

# ---------------------------------------------------------------------------
# DNS check
# ---------------------------------------------------------------------------
echo "Checking DNS for ${DOMAIN}..."
RESOLVED_IP=$(dig +short "${DOMAIN}" A 2>/dev/null | head -n1 || true)
if [[ -z "${RESOLVED_IP}" ]]; then
    echo ""
    echo "WARNING: DNS lookup for ${DOMAIN} returned no A record."
    echo ""
    echo "Before running this script, create a DNS A record:"
    echo ""
    echo "  Type: A"
    echo "  Name: relayer"
    echo "  Value: <your-server-public-ip>"
    echo "  TTL: 300"
    echo ""
    echo "If you use Cloudflare, set the record to DNS-only (grey cloud)"
    echo "so that Let's Encrypt can reach port 80 directly."
    echo ""
    read -rp "Continue anyway? [y/N] " CONT
    if [[ "${CONT}" != "y" && "${CONT}" != "Y" ]]; then
        exit 1
    fi
else
    echo "  ${DOMAIN} -> ${RESOLVED_IP}"
fi

# ---------------------------------------------------------------------------
# Create webroot directory for ACME challenges
# ---------------------------------------------------------------------------
mkdir -p "${WEBROOT}"

# ---------------------------------------------------------------------------
# Ensure nginx is running with the port-80 config (for the ACME challenge)
# ---------------------------------------------------------------------------
echo "Testing nginx configuration..."
nginx -t

echo "Reloading nginx..."
systemctl reload nginx || nginx -s reload

# ---------------------------------------------------------------------------
# Obtain certificate
# ---------------------------------------------------------------------------
echo ""
echo "Requesting certificate for ${DOMAIN}..."
echo ""

CERTBOT_ARGS=(
    certonly
    --webroot
    --webroot-path "${WEBROOT}"
    -d "${DOMAIN}"
    --agree-tos
    --no-eff-email
)

if [[ -n "${EMAIL}" ]]; then
    CERTBOT_ARGS+=(--email "${EMAIL}")
else
    CERTBOT_ARGS+=(--register-unsafely-without-email)
    echo "Note: No email provided. Pass --email ops@obelysk.network for renewal notices."
fi

certbot "${CERTBOT_ARGS[@]}"

# ---------------------------------------------------------------------------
# Verify certificate files exist
# ---------------------------------------------------------------------------
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
if [[ -f "${CERT_DIR}/fullchain.pem" && -f "${CERT_DIR}/privkey.pem" ]]; then
    echo ""
    echo "TLS certificate obtained successfully."
    echo "  Certificate: ${CERT_DIR}/fullchain.pem"
    echo "  Private key: ${CERT_DIR}/privkey.pem"
    echo "  Chain:       ${CERT_DIR}/chain.pem"
else
    echo "Error: Certificate files not found in ${CERT_DIR}."
    exit 1
fi

# ---------------------------------------------------------------------------
# Copy nginx config and reload with TLS
# ---------------------------------------------------------------------------
NGINX_CONF_SRC="$(cd "$(dirname "$0")" && pwd)/nginx.conf"
NGINX_CONF_DST="/etc/nginx/sites-available/vm31-relayer.conf"
NGINX_ENABLED="/etc/nginx/sites-enabled/vm31-relayer.conf"

echo ""
echo "Installing nginx config..."
cp "${NGINX_CONF_SRC}" "${NGINX_CONF_DST}"
ln -sf "${NGINX_CONF_DST}" "${NGINX_ENABLED}"

echo "Testing full nginx configuration (with TLS)..."
nginx -t

echo "Reloading nginx..."
systemctl reload nginx || nginx -s reload

# ---------------------------------------------------------------------------
# Set up auto-renewal cron (certbot usually does this, but let's be sure)
# ---------------------------------------------------------------------------
if ! systemctl is-enabled certbot.timer &>/dev/null 2>&1; then
    echo ""
    echo "Setting up certbot auto-renewal timer..."
    systemctl enable --now certbot.timer 2>/dev/null || {
        echo "  systemd timer not available; adding crontab entry instead."
        (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'") | sort -u | crontab -
        echo "  Cron job added: daily renewal check at 03:00."
    }
else
    echo "certbot.timer is already enabled for auto-renewal."
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "============================================"
echo " Setup complete!"
echo "============================================"
echo ""
echo " HTTPS endpoint: https://${DOMAIN}"
echo ""
echo " Test with:"
echo "   curl -I https://${DOMAIN}/health"
echo ""
echo " To renew manually:"
echo "   sudo certbot renew --dry-run"
echo ""
