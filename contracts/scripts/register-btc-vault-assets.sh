#!/usr/bin/env bash
# =============================================================================
# BTC Privacy Vault — Asset Registration Script
# =============================================================================
# Registers BTC-backed ERC20 tokens (wBTC, LBTC, tBTC, SolvBTC) as VM31 pool
# assets and configures bridge asset pairs.
#
# Usage:
#   ./register-btc-vault-assets.sh --network sepolia --vm31-pool 0x<POOL> --vm31-bridge 0x<BRIDGE>
#   ./register-btc-vault-assets.sh --network mainnet --vm31-pool 0x<POOL> --vm31-bridge 0x<BRIDGE>
#   ./register-btc-vault-assets.sh --network sepolia --vm31-pool 0x<POOL> --dry-run
#
# Prerequisites:
#   - sncast configured with deployer account
#   - VM31Pool and VM31ConfidentialBridge deployed
#   - Token contracts deployed on target network
# =============================================================================

set -euo pipefail

# ─── Defaults ────────────────────────────────────────────────────────────────
NETWORK="sepolia"
DRY_RUN=false
SNCAST_ACCOUNT="${SNCAST_ACCOUNT:-deployer}"
VM31_POOL=""
VM31_BRIDGE=""
RPC_URL="${RPC_URL:-}"

# ─── Token Addresses ────────────────────────────────────────────────────────

# Sepolia
SEPOLIA_WBTC="0x00452bd5c0512a61df7c7be8cfea5e4f893cb40e126bdc40aee6054db955129e"
SEPOLIA_LBTC="0x0"   # Not deployed on Sepolia
SEPOLIA_TBTC="0x0"   # Not deployed on Sepolia
SEPOLIA_SOLVBTC="0x0" # Not deployed on Sepolia

# Mainnet
MAINNET_WBTC="0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac"
MAINNET_LBTC="0x0"   # TBD — Lombard LBTC on Starknet
MAINNET_TBTC="0x0"   # TBD — tBTC on Starknet
MAINNET_SOLVBTC="0x0" # TBD — SolvBTC on Starknet

# Confidential Transfer asset IDs (for bridge pairing)
CT_WBTC_ASSET_ID="0x4"  # Matches ASSET_ID_FOR_TOKEN in addresses.ts

# ─── Parse Arguments ────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)      NETWORK="$2"; shift 2 ;;
    --vm31-pool)    VM31_POOL="$2"; shift 2 ;;
    --vm31-bridge)  VM31_BRIDGE="$2"; shift 2 ;;
    --account)      SNCAST_ACCOUNT="$2"; shift 2 ;;
    --rpc-url)      RPC_URL="$2"; shift 2 ;;
    --dry-run)      DRY_RUN=true; shift ;;
    --help)
      echo "Usage: $0 --network <sepolia|mainnet> --vm31-pool <0x...> [--vm31-bridge <0x...>] [--dry-run]"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ─── Validation ──────────────────────────────────────────────────────────────
if [[ -z "$VM31_POOL" ]]; then
  echo "ERROR: --vm31-pool is required"
  exit 1
fi

# ─── Resolve Token Addresses ────────────────────────────────────────────────
if [[ "$NETWORK" == "mainnet" ]]; then
  WBTC="$MAINNET_WBTC"
  LBTC="$MAINNET_LBTC"
  TBTC="$MAINNET_TBTC"
  SOLVBTC="$MAINNET_SOLVBTC"
else
  WBTC="$SEPOLIA_WBTC"
  LBTC="$SEPOLIA_LBTC"
  TBTC="$SEPOLIA_TBTC"
  SOLVBTC="$SEPOLIA_SOLVBTC"
fi

# ─── Helpers ─────────────────────────────────────────────────────────────────
SNCAST_BASE="sncast --account $SNCAST_ACCOUNT"
if [[ -n "$RPC_URL" ]]; then
  SNCAST_BASE="$SNCAST_BASE --url $RPC_URL"
fi

run_invoke() {
  local desc="$1"
  local contract="$2"
  local function="$3"
  shift 3
  local calldata=("$@")

  echo ""
  echo "═══ $desc ═══"
  echo "  Contract: $contract"
  echo "  Function: $function"
  echo "  Calldata: ${calldata[*]}"

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "  [DRY RUN] Skipped"
    return 0
  fi

  local result
  result=$($SNCAST_BASE invoke \
    --contract-address "$contract" \
    --function "$function" \
    --calldata "${calldata[@]}" \
    --max-fee 0x100000000000000 2>&1)

  echo "  Result: $result"

  # Extract tx hash
  local tx_hash
  tx_hash=$(echo "$result" | grep -oE '0x[0-9a-fA-F]+' | head -1 || true)
  if [[ -n "$tx_hash" ]]; then
    echo "  TX Hash: $tx_hash"
  fi
}

run_call() {
  local desc="$1"
  local contract="$2"
  local function="$3"
  shift 3
  local calldata=("$@")

  echo ""
  echo "─── $desc ───"
  echo "  Contract: $contract"
  echo "  Function: $function"

  local result
  result=$($SNCAST_BASE call \
    --contract-address "$contract" \
    --function "$function" \
    --calldata "${calldata[@]}" 2>&1)

  echo "  Result: $result"
  echo "$result"
}

# ─── Banner ──────────────────────────────────────────────────────────────────
echo "============================================="
echo " BTC Privacy Vault — Asset Registration"
echo "============================================="
echo " Network:    $NETWORK"
echo " VM31 Pool:  $VM31_POOL"
echo " VM31 Bridge: ${VM31_BRIDGE:-"(not provided)"}"
echo " Account:    $SNCAST_ACCOUNT"
echo " Dry Run:    $DRY_RUN"
echo "============================================="

# ─── Step 1: Register wBTC in VM31Pool ───────────────────────────────────────
echo ""
echo "▶ Step 1: Register BTC tokens in VM31Pool"

if [[ "$WBTC" != "0x0" ]]; then
  run_invoke "Register wBTC" "$VM31_POOL" "register_asset" "$WBTC"

  # Query back the assigned asset ID
  echo ""
  echo "  Querying wBTC asset ID..."
  if [[ "$DRY_RUN" != "true" ]]; then
    run_call "Get wBTC asset ID" "$VM31_POOL" "get_token_asset" "$WBTC"
  else
    echo "  [DRY RUN] Would query get_token_asset($WBTC)"
  fi
else
  echo "  [SKIP] wBTC not deployed on $NETWORK"
fi

if [[ "$LBTC" != "0x0" ]]; then
  run_invoke "Register LBTC" "$VM31_POOL" "register_asset" "$LBTC"
else
  echo "  [SKIP] LBTC not deployed on $NETWORK"
fi

if [[ "$TBTC" != "0x0" ]]; then
  run_invoke "Register tBTC" "$VM31_POOL" "register_asset" "$TBTC"
else
  echo "  [SKIP] tBTC not deployed on $NETWORK"
fi

if [[ "$SOLVBTC" != "0x0" ]]; then
  run_invoke "Register SolvBTC" "$VM31_POOL" "register_asset" "$SOLVBTC"
else
  echo "  [SKIP] SolvBTC not deployed on $NETWORK"
fi

# ─── Step 2: Register bridge asset pairs ─────────────────────────────────────
if [[ -n "$VM31_BRIDGE" ]]; then
  echo ""
  echo "▶ Step 2: Register bridge asset pairs"

  if [[ "$WBTC" != "0x0" ]]; then
    # register_asset_pair(token, vm31_asset_id, ct_asset_id)
    # The vm31_asset_id is returned from register_asset above — use the known ID
    # For now, pass the CT asset ID we know from addresses.ts
    run_invoke "Register wBTC bridge pair" "$VM31_BRIDGE" "register_asset_pair" \
      "$WBTC" "$CT_WBTC_ASSET_ID" "$CT_WBTC_ASSET_ID"
  fi
else
  echo ""
  echo "▶ Step 2: [SKIP] No VM31 bridge address provided"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "============================================="
echo " Registration Complete"
echo "============================================="
echo ""
echo "Next steps:"
echo "  1. Note the asset IDs returned above"
echo "  2. Update VM31_ASSET_ID_FOR_TOKEN in addresses.ts"
echo "  3. Update .env with VM31 pool/bridge addresses"
echo "  4. Run the frontend to verify asset resolution"
echo ""
