#!/usr/bin/env bash
# =============================================================================
# Redeploy StealthRegistry on Sepolia after multi-token interface change
# =============================================================================
# Usage:
#   cd contracts && ./scripts/redeploy-stealth-registry.sh
#
# Prerequisites:
#   - scarb build (fresh artifacts with new token param)
#   - sncast configured with deployer account
# =============================================================================
set -euo pipefail

SNCAST_ACCOUNT="${SNCAST_ACCOUNT:-deployer}"
RPC_URL="${RPC_URL:-https://api.cartridge.gg/x/starknet/sepolia}"
PACKAGE="obelysk_contracts"
ARTIFACT_DIR="target/dev"
OWNER="0x0759a4374389b0e3cfcc59d49310b6bc75bb12bbf8ce550eb5c2f026918bb344"
SAGE_TOKEN="0x072349097c8a802e7f66dc96b95aca84e4d78ddad22014904076c76293a99850"

echo "=== Redeploy StealthRegistry (multi-token) ==="
echo "Network:  Sepolia"
echo "Account:  $SNCAST_ACCOUNT"
echo "RPC:      $RPC_URL"
echo ""

# Step 1: Build
echo "[1/3] Building contracts..."
scarb build

# Step 2: Declare new class hash
echo ""
echo "[2/3] Declaring StealthRegistry..."
DECLARE_OUTPUT=$(sncast --account "$SNCAST_ACCOUNT" --url "$RPC_URL" \
  declare \
  --contract-name StealthRegistry \
  --max-fee 1000000000000000 \
  2>&1) || true

# Extract class hash (from declare output or "already declared" message)
CLASS_HASH=$(echo "$DECLARE_OUTPUT" | grep -oP 'class_hash:\s*\K0x[a-fA-F0-9]+' || true)
if [ -z "$CLASS_HASH" ]; then
  CLASS_HASH=$(echo "$DECLARE_OUTPUT" | grep -oP 'already declared.*\K0x[a-fA-F0-9]+' || true)
fi

if [ -z "$CLASS_HASH" ]; then
  echo "ERROR: Could not extract class hash from declare output:"
  echo "$DECLARE_OUTPUT"
  exit 1
fi
echo "Class hash: $CLASS_HASH"

# Step 3: Deploy
echo ""
echo "[3/3] Deploying StealthRegistry..."
DEPLOY_OUTPUT=$(sncast --account "$SNCAST_ACCOUNT" --url "$RPC_URL" \
  deploy \
  --class-hash "$CLASS_HASH" \
  --constructor-calldata "$OWNER" "$SAGE_TOKEN" \
  --max-fee 1000000000000000 \
  2>&1) || true

CONTRACT_ADDR=$(echo "$DEPLOY_OUTPUT" | grep -oP 'contract_address:\s*\K0x[a-fA-F0-9]+' || true)
if [ -z "$CONTRACT_ADDR" ]; then
  echo "Deploy output:"
  echo "$DEPLOY_OUTPUT"
  echo ""
  echo "WARNING: Could not extract contract address. Check output above."
  exit 1
fi

echo ""
echo "=== Deployment Complete ==="
echo "Class Hash:       $CLASS_HASH"
echo "Contract Address: $CONTRACT_ADDR"
echo ""
echo "Next steps:"
echo "  1. Update STEALTH_REGISTRY in apps/web/src/lib/contracts/addresses.ts"
echo "  2. Update the hardcoded address in apps/web/src/app/(app)/vault/stealth/page.tsx"
echo "  3. Update the hardcoded address in apps/web/src/lib/hooks/useSendStealthPayment.ts"
