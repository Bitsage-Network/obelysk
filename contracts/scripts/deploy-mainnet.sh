#!/usr/bin/env bash
# =============================================================================
# Obelysk Protocol — Mainnet Deployment Script
# =============================================================================
# Declares and deploys all Obelysk contracts in dependency order using sncast.
#
# Usage:
#   ./deploy-mainnet.sh --network mainnet --owner 0x<MULTISIG_ADDRESS> --sage-token 0x<ADDR>
#   ./deploy-mainnet.sh --network sepolia --owner 0x<DEPLOYER_ADDRESS>
#   ./deploy-mainnet.sh --network mainnet --owner 0x<ADDR> --sage-token 0x<ADDR> --dry-run
#
# Prerequisites:
#   - scarb build (artifacts in target/dev/)
#   - sncast configured with deployer account (sncast account add ...)
#   - SNCAST_ACCOUNT env var set (or pass --account)
#   - RPC_URL env var set (or pass --rpc-url)
# =============================================================================

set -euo pipefail

# ─── Defaults ────────────────────────────────────────────────────────────────
NETWORK="sepolia"
OWNER=""
DRY_RUN=false
SNCAST_ACCOUNT="${SNCAST_ACCOUNT:-deployer}"
UPGRADE_DELAY=172800  # 48 hours (mainnet default)
ARTIFACT_DIR="target/dev"
PACKAGE="obelysk_contracts"
SAGE_TOKEN_OVERRIDE=""

# ─── Mainnet Token Addresses ────────────────────────────────────────────────
MAINNET_ETH="0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
MAINNET_STRK="0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
MAINNET_USDC="0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8"
MAINNET_WBTC="0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac"
MAINNET_EKUBO_CORE="0x00000005dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b"

# Sepolia Token Addresses
SEPOLIA_ETH="0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
SEPOLIA_STRK="0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
SEPOLIA_USDC="0x053b40A647CEDfca6cA84f542A0fe36736031905A9639a7f19A3C1e66bFd5080"
SEPOLIA_WBTC="0x00452bd5c0512a61df7c7be8cfea5e4f893cb40e126bdc40aee6054db955129e"
SEPOLIA_EKUBO_CORE="0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384"
SEPOLIA_SAGE_TOKEN="0x072349097c8a802e7f66dc96b95aca84e4d78ddad22014904076c76293a99850"

# ─── Parse Arguments ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)    NETWORK="$2"; shift 2 ;;
    --owner)      OWNER="$2"; shift 2 ;;
    --account)    SNCAST_ACCOUNT="$2"; shift 2 ;;
    --dry-run)    DRY_RUN=true; shift ;;
    --rpc-url)    RPC_URL="$2"; shift 2 ;;
    --sage-token) SAGE_TOKEN_OVERRIDE="$2"; shift 2 ;;
    --help)
      echo "Usage: $0 --network <sepolia|mainnet> --owner <0x...> [--sage-token <0x...>] [--dry-run] [--account <name>] [--rpc-url <url>]"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ─── Validation ──────────────────────────────────────────────────────────────
if [[ -z "$OWNER" ]]; then
  echo "ERROR: --owner is required (multisig address for mainnet, deployer for sepolia)"
  exit 1
fi

if [[ "$NETWORK" != "sepolia" && "$NETWORK" != "mainnet" ]]; then
  echo "ERROR: --network must be 'sepolia' or 'mainnet'"
  exit 1
fi

# Validate address format (must be 0x-prefixed hex)
validate_address() {
  local label="$1"
  local addr="$2"
  if [[ ! "$addr" =~ ^0x[0-9a-fA-F]+$ ]]; then
    echo "ERROR: Invalid address for $label: '$addr' (must be 0x-prefixed hex)"
    exit 1
  fi
}

validate_address "--owner" "$OWNER"

# Set network-specific values
if [[ "$NETWORK" == "mainnet" ]]; then
  RPC_URL="${RPC_URL:-${MAINNET_RPC_URL:-}}"
  ETH_TOKEN="$MAINNET_ETH"
  STRK_TOKEN="$MAINNET_STRK"
  USDC_TOKEN="$MAINNET_USDC"
  WBTC_TOKEN="$MAINNET_WBTC"
  EKUBO_CORE="$MAINNET_EKUBO_CORE"
  SAGE_TOKEN="${SAGE_TOKEN_OVERRIDE}"
  if [[ -z "$SAGE_TOKEN" ]]; then
    echo "ERROR: --sage-token is required for mainnet (SAGE token contract address)"
    exit 1
  fi
else
  RPC_URL="${RPC_URL:-${SEPOLIA_RPC_URL:-https://starknet-sepolia.public.blastapi.io}}"
  ETH_TOKEN="$SEPOLIA_ETH"
  STRK_TOKEN="$SEPOLIA_STRK"
  USDC_TOKEN="$SEPOLIA_USDC"
  WBTC_TOKEN="$SEPOLIA_WBTC"
  EKUBO_CORE="$SEPOLIA_EKUBO_CORE"
  SAGE_TOKEN="${SAGE_TOKEN_OVERRIDE:-$SEPOLIA_SAGE_TOKEN}"
  UPGRADE_DELAY=300  # 5 minutes for testnet
fi

if [[ -z "$RPC_URL" ]]; then
  echo "ERROR: RPC_URL env var or --rpc-url is required"
  exit 1
fi

validate_address "--sage-token" "$SAGE_TOKEN"

if [[ ! -d "$ARTIFACT_DIR" ]]; then
  echo "ERROR: Artifact directory '$ARTIFACT_DIR' not found. Run 'scarb build' first."
  exit 1
fi

# ─── Helpers ─────────────────────────────────────────────────────────────────
SNCAST_BASE="sncast --account $SNCAST_ACCOUNT --url $RPC_URL"

# Auditor key placeholder (zero point = no auditor)
AUDITOR_KEY_X="0x0"
AUDITOR_KEY_Y="0x0"

# Output file for deployed addresses
OUTPUT_FILE="deployment/${NETWORK}-addresses-$(date +%Y%m%d-%H%M%S).json"
mkdir -p deployment
chmod 700 deployment

# Deployed addresses (simple variables instead of associative arrays for bash 3 compat)
ADDR_ConfidentialTransfer=""
ADDR_DarkPoolAuction=""
ADDR_ConfidentialSwapContract=""
ADDR_PrivacyRouter=""
ADDR_ShieldedSwapRouter=""
ADDR_StealthRegistry=""
ADDR_VM31ConfidentialBridge=""
ADDR_PP_SAGE=""
ADDR_PP_ETH=""
ADDR_PP_STRK=""
ADDR_PP_WBTC=""
ADDR_PP_USDC=""

# Class hashes
CH_ConfidentialTransfer=""
CH_DarkPoolAuction=""
CH_ConfidentialSwapContract=""
CH_PrivacyRouter=""
CH_PrivacyPools=""
CH_ShieldedSwapRouter=""
CH_StealthRegistry=""
CH_VM31ConfidentialBridge=""

log() { echo "[$(date +%H:%M:%S)] $*"; }

run_sncast() {
  if $DRY_RUN; then
    echo "  [DRY-RUN] sncast $*"
    echo "0x_dry_run_hash"
  else
    $SNCAST_BASE "$@"
  fi
}

extract_class_hash() {
  local output="$1"
  local hash=""

  # Try standard output format
  hash=$(echo "$output" | grep -oE 'class_hash: 0x[0-9a-fA-F]+' | grep -oE '0x[0-9a-fA-F]+' || true)

  # Handle "already declared" case
  if [[ -z "$hash" ]]; then
    hash=$(echo "$output" | grep -oE '0x[0-9a-fA-F]+' | head -1 || true)
  fi

  echo "$hash"
}

extract_address() {
  local output="$1"
  echo "$output" | grep -oE 'contract_address: 0x[0-9a-fA-F]+' | grep -oE '0x[0-9a-fA-F]+' || true
}

# ═══════════════════════════════════════════════════════════════════════════════
# DEPLOYMENT
# ═══════════════════════════════════════════════════════════════════════════════

echo "============================================"
echo "  Obelysk Protocol — Contract Deployment"
echo "============================================"
echo "  Network:       $NETWORK"
echo "  Owner:         $OWNER"
echo "  Account:       $SNCAST_ACCOUNT"
echo "  RPC:           $RPC_URL"
echo "  Upgrade Delay: ${UPGRADE_DELAY}s"
echo "  Dry Run:       $DRY_RUN"
echo "  SAGE Token:    $SAGE_TOKEN"
echo "============================================"
echo ""

if [[ "$NETWORK" == "mainnet" && "$DRY_RUN" == "false" ]]; then
  echo "*** MAINNET DEPLOYMENT ***"
  echo "You have 10 seconds to cancel (Ctrl+C)..."
  sleep 10
fi

# ─── Phase 1: Declare All Contracts ──────────────────────────────────────────
log "=== Phase 1: Declaring all contract classes ==="

declare_one() {
  local name="$1"
  local artifact="${ARTIFACT_DIR}/${PACKAGE}_${name}.contract_class.json"

  if [[ ! -f "$artifact" ]]; then
    echo "ERROR: Artifact not found: $artifact"
    exit 1
  fi

  log "Declaring $name..."
  local output
  output=$(run_sncast declare --contract-name "$name" 2>&1)
  local class_hash
  class_hash=$(extract_class_hash "$output")

  if [[ -z "$class_hash" && "$DRY_RUN" == "true" ]]; then
    class_hash="0x_dry_run_class_${name}"
  fi

  if [[ -z "$class_hash" ]]; then
    echo "ERROR: Failed to get class hash for $name"
    echo "Output: $output"
    exit 1
  fi

  log "  Class hash: $class_hash"
  echo "$class_hash"
}

CH_ConfidentialTransfer=$(declare_one "ConfidentialTransfer")
CH_PrivacyPools=$(declare_one "PrivacyPools")
CH_PrivacyRouter=$(declare_one "PrivacyRouter")
CH_ConfidentialSwapContract=$(declare_one "ConfidentialSwapContract")
CH_DarkPoolAuction=$(declare_one "DarkPoolAuction")
CH_ShieldedSwapRouter=$(declare_one "ShieldedSwapRouter")
CH_StealthRegistry=$(declare_one "StealthRegistry")
CH_VM31ConfidentialBridge=$(declare_one "VM31ConfidentialBridge")

log "All classes declared."
echo ""

# ─── Phase 2: Deploy in Dependency Order ─────────────────────────────────────
log "=== Phase 2: Deploying contracts in dependency order ==="

deploy_one() {
  local class_hash="$1"
  shift
  local calldata="$*"

  local output
  if [[ -n "$calldata" ]]; then
    output=$(run_sncast deploy --class-hash "$class_hash" --constructor-calldata $calldata 2>&1)
  else
    output=$(run_sncast deploy --class-hash "$class_hash" 2>&1)
  fi

  local address
  address=$(extract_address "$output")

  if [[ -z "$address" && "$DRY_RUN" == "true" ]]; then
    address="0x_dry_run_$(echo "$class_hash" | tail -c 12)"
  fi

  if [[ -z "$address" ]]; then
    echo "ERROR: Failed to deploy. Output: $output" >&2
    exit 1
  fi

  echo "$address"
}

# Layer 1: ConfidentialTransfer (standalone)
# constructor(owner, auditor_key{x,y}, upgrade_delay)
log "Deploying ConfidentialTransfer..."
ADDR_ConfidentialTransfer=$(deploy_one "$CH_ConfidentialTransfer" \
  "$OWNER" "$AUDITOR_KEY_X" "$AUDITOR_KEY_Y" "$UPGRADE_DELAY")
log "  ConfidentialTransfer: $ADDR_ConfidentialTransfer"

# Layer 2: DarkPoolAuction (standalone)
# constructor(owner)
log "Deploying DarkPoolAuction..."
ADDR_DarkPoolAuction=$(deploy_one "$CH_DarkPoolAuction" "$OWNER")
log "  DarkPoolAuction: $ADDR_DarkPoolAuction"

# Layer 3: ConfidentialSwap (standalone)
# constructor(owner)
log "Deploying ConfidentialSwapContract..."
ADDR_ConfidentialSwapContract=$(deploy_one "$CH_ConfidentialSwapContract" "$OWNER")
log "  ConfidentialSwapContract: $ADDR_ConfidentialSwapContract"

# Layer 4: PrivacyRouter (needs SAGE token + payment router)
# constructor(owner, sage_token, payment_router)
log "Deploying PrivacyRouter..."
ADDR_PrivacyRouter=$(deploy_one "$CH_PrivacyRouter" "$OWNER" "$SAGE_TOKEN" "0x0")
log "  PrivacyRouter: $ADDR_PrivacyRouter"

# Layer 5: PrivacyPools x5 (no constructor — uses initialize())
for TOKEN_LABEL in SAGE ETH STRK WBTC USDC; do
  log "Deploying PrivacyPools ($TOKEN_LABEL)..."
  PP_ADDR=$(deploy_one "$CH_PrivacyPools")
  log "  PrivacyPools ($TOKEN_LABEL): $PP_ADDR"

  # Store in the right variable (no eval — explicit case for safety)
  case "$TOKEN_LABEL" in
    SAGE) ADDR_PP_SAGE="$PP_ADDR" ;;
    ETH)  ADDR_PP_ETH="$PP_ADDR" ;;
    STRK) ADDR_PP_STRK="$PP_ADDR" ;;
    WBTC) ADDR_PP_WBTC="$PP_ADDR" ;;
    USDC) ADDR_PP_USDC="$PP_ADDR" ;;
  esac
done

# Layer 6: ShieldedSwapRouter (needs Ekubo core)
# constructor(owner, ekubo_core)
log "Deploying ShieldedSwapRouter..."
ADDR_ShieldedSwapRouter=$(deploy_one "$CH_ShieldedSwapRouter" "$OWNER" "$EKUBO_CORE")
log "  ShieldedSwapRouter: $ADDR_ShieldedSwapRouter"

# Layer 7: StealthRegistry (needs SAGE token)
# constructor(owner, sage_token)
log "Deploying StealthRegistry..."
ADDR_StealthRegistry=$(deploy_one "$CH_StealthRegistry" "$OWNER" "$SAGE_TOKEN")
log "  StealthRegistry: $ADDR_StealthRegistry"

# Layer 8: VM31ConfidentialBridge (needs ConfidentialTransfer)
# constructor(owner, relayer, vm31_pool, confidential_transfer)
log "Deploying VM31ConfidentialBridge..."
ADDR_VM31ConfidentialBridge=$(deploy_one "$CH_VM31ConfidentialBridge" \
  "$OWNER" "0x0" "0x0" "$ADDR_ConfidentialTransfer")
log "  VM31ConfidentialBridge: $ADDR_VM31ConfidentialBridge"

log "All contracts deployed."
echo ""

# ─── Phase 3: Post-Deploy Initialization ─────────────────────────────────────
log "=== Phase 3: Post-deploy initialization ==="

# Initialize each PrivacyPools instance
# initialize(owner, token_address, privacy_router)
for TOKEN_LABEL in SAGE ETH STRK WBTC USDC; do
  # Resolve PP address (no eval — explicit case for safety)
  case "$TOKEN_LABEL" in
    SAGE) PP_ADDR="$ADDR_PP_SAGE"; TOKEN_ADDR="$SAGE_TOKEN" ;;
    ETH)  PP_ADDR="$ADDR_PP_ETH";  TOKEN_ADDR="$ETH_TOKEN" ;;
    STRK) PP_ADDR="$ADDR_PP_STRK"; TOKEN_ADDR="$STRK_TOKEN" ;;
    WBTC) PP_ADDR="$ADDR_PP_WBTC"; TOKEN_ADDR="$WBTC_TOKEN" ;;
    USDC) PP_ADDR="$ADDR_PP_USDC"; TOKEN_ADDR="$USDC_TOKEN" ;;
  esac

  if [[ -z "$PP_ADDR" ]]; then
    echo "ERROR: PrivacyPools ($TOKEN_LABEL) address is empty — deploy may have failed"
    exit 1
  fi

  log "Initializing PrivacyPools ($TOKEN_LABEL) at $PP_ADDR..."
  run_sncast invoke \
    --contract-address "$PP_ADDR" \
    --function "initialize" \
    --calldata "$OWNER" "$TOKEN_ADDR" "$ADDR_PrivacyRouter"
done

log "Initialization complete."
echo ""

# ─── Phase 4: Output Addresses ──────────────────────────────────────────────
log "=== Phase 4: Writing deployment addresses ==="

cat > "$OUTPUT_FILE" << ADDRESSES_EOF
{
  "network": "$NETWORK",
  "deployed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "owner": "$OWNER",
  "upgrade_delay": $UPGRADE_DELAY,
  "contracts": {
    "CONFIDENTIAL_TRANSFER": "$ADDR_ConfidentialTransfer",
    "DARK_POOL": "$ADDR_DarkPoolAuction",
    "CONFIDENTIAL_SWAP": "$ADDR_ConfidentialSwapContract",
    "PRIVACY_ROUTER": "$ADDR_PrivacyRouter",
    "SAGE_PRIVACY_POOL": "$ADDR_PP_SAGE",
    "ETH_PRIVACY_POOL": "$ADDR_PP_ETH",
    "STRK_PRIVACY_POOL": "$ADDR_PP_STRK",
    "WBTC_PRIVACY_POOL": "$ADDR_PP_WBTC",
    "USDC_PRIVACY_POOL": "$ADDR_PP_USDC",
    "SHIELDED_SWAP_ROUTER": "$ADDR_ShieldedSwapRouter",
    "STEALTH_REGISTRY": "$ADDR_StealthRegistry",
    "VM31_CONFIDENTIAL_BRIDGE": "$ADDR_VM31ConfidentialBridge"
  },
  "class_hashes": {
    "ConfidentialTransfer": "$CH_ConfidentialTransfer",
    "PrivacyPools": "$CH_PrivacyPools",
    "PrivacyRouter": "$CH_PrivacyRouter",
    "ConfidentialSwapContract": "$CH_ConfidentialSwapContract",
    "DarkPoolAuction": "$CH_DarkPoolAuction",
    "ShieldedSwapRouter": "$CH_ShieldedSwapRouter",
    "StealthRegistry": "$CH_StealthRegistry",
    "VM31ConfidentialBridge": "$CH_VM31ConfidentialBridge"
  }
}
ADDRESSES_EOF

chmod 600 "$OUTPUT_FILE"
log "Addresses written to: $OUTPUT_FILE (mode 600)"

# Log artifact hashes for reproducibility
log "=== Artifact SHA-256 hashes ==="
for artifact in "${ARTIFACT_DIR}/${PACKAGE}_"*.contract_class.json; do
  if [[ -f "$artifact" ]]; then
    HASH=$(shasum -a 256 "$artifact" | cut -d' ' -f1)
    log "  $(basename "$artifact"): $HASH"
  fi
done
echo ""

# ─── Summary for addresses.ts ────────────────────────────────────────────────
echo "============================================"
echo "  Paste into addresses.ts (${NETWORK} block)"
echo "============================================"
echo ""
echo "    CONFIDENTIAL_TRANSFER: \"$ADDR_ConfidentialTransfer\","
echo "    DARK_POOL: \"$ADDR_DarkPoolAuction\","
echo "    CONFIDENTIAL_SWAP: \"$ADDR_ConfidentialSwapContract\","
echo "    PRIVACY_ROUTER: \"$ADDR_PrivacyRouter\","
echo "    SAGE_PRIVACY_POOL: \"$ADDR_PP_SAGE\","
echo "    ETH_PRIVACY_POOL: \"$ADDR_PP_ETH\","
echo "    STRK_PRIVACY_POOL: \"$ADDR_PP_STRK\","
echo "    WBTC_PRIVACY_POOL: \"$ADDR_PP_WBTC\","
echo "    USDC_PRIVACY_POOL: \"$ADDR_PP_USDC\","
echo "    SHIELDED_SWAP_ROUTER: \"$ADDR_ShieldedSwapRouter\","
echo "    STEALTH_REGISTRY: \"$ADDR_StealthRegistry\","
echo ""
echo "============================================"
echo "  Deployment complete!"
echo "============================================"
