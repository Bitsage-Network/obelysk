#!/usr/bin/env bash
#
# generate-keys.sh
#
# Generates production secrets for the VM31 relayer:
#   - VM31_RELAYER_PRIVKEY  (X25519 private key, 32 bytes hex)
#   - VM31_STORAGE_KEY      (AES-256 key, 32 bytes hex)
#
# Also derives and prints the X25519 public key so the frontend can be
# configured to encrypt submissions to the relayer.
#
# Usage:
#   ./generate-keys.sh              # print to stdout
#   ./generate-keys.sh > .env.keys  # save to file (add to .gitignore!)

set -euo pipefail

# ── Dependency check ────────────────────────────────────────────────
if ! command -v openssl &>/dev/null; then
  echo "ERROR: openssl is not installed or not in PATH." >&2
  echo "       Install it with your package manager (e.g. brew install openssl)." >&2
  exit 1
fi

# ── Generate keys ───────────────────────────────────────────────────
VM31_RELAYER_PRIVKEY=$(openssl rand -hex 32)
VM31_STORAGE_KEY=$(openssl rand -hex 32)

# ── Derive X25519 public key ───────────────────────────────────────
# OpenSSL expects the raw 32-byte private key wrapped in PKCS#8 DER.
# We build the DER envelope manually:
#   - PKCS#8 header for X25519 (16 bytes): 302e020100300506032b656e04220420
#   - followed by the 32-byte raw key
#
# Steps:
#   1. Build a DER file from hex
#   2. Import as PEM
#   3. Extract the public key

TMPDIR_KEYS=$(mktemp -d)
trap 'rm -rf "${TMPDIR_KEYS}"' EXIT

# PKCS#8 v0 header for X25519 private key (48 bytes total DER)
PKCS8_HEADER="302e020100300506032b656e04220420"
echo "${PKCS8_HEADER}${VM31_RELAYER_PRIVKEY}" \
  | xxd -r -p > "${TMPDIR_KEYS}/privkey.der"

# Convert DER to PEM so openssl pkey can read it
openssl pkey -inform DER -in "${TMPDIR_KEYS}/privkey.der" \
  -outform PEM -out "${TMPDIR_KEYS}/privkey.pem" 2>/dev/null

# Extract raw public key bytes (32 bytes hex)
# The DER-encoded SubjectPublicKeyInfo for X25519 is 44 bytes:
#   12-byte header + 32-byte raw public key
# We grab the last 32 bytes (64 hex chars).
VM31_RELAYER_PUBKEY=$(
  openssl pkey -in "${TMPDIR_KEYS}/privkey.pem" -pubout -outform DER 2>/dev/null \
    | xxd -p -c 256 \
    | sed 's/.*\(.\{64\}\)$/\1/'
)

# ── Output ──────────────────────────────────────────────────────────
cat <<EOF
# ============================================================
#  VM31 Relayer Production Secrets
#  Generated: $(date -u '+%Y-%m-%dT%H:%M:%SZ')
# ============================================================
#
#  WARNING: These values are cryptographic secrets.
#  NEVER commit them to version control.
#  Store them in a secrets manager (Vault, AWS SSM, etc.)
#  or inject them via CI/CD environment variables.
#
# ============================================================

# X25519 private key for ECIES-encrypted submissions (32 bytes hex)
VM31_RELAYER_PRIVKEY=${VM31_RELAYER_PRIVKEY}

# AES-256 key for encrypted note storage at rest (32 bytes hex)
VM31_STORAGE_KEY=${VM31_STORAGE_KEY}

# ── Derived (not a secret — safe to embed in frontend config) ──
# X25519 public key corresponding to VM31_RELAYER_PRIVKEY
# Set this as NEXT_PUBLIC_RELAYER_PUBKEY in the web app .env
NEXT_PUBLIC_RELAYER_PUBKEY=${VM31_RELAYER_PUBKEY}
EOF
