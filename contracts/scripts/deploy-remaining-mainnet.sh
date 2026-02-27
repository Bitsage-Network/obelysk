#!/usr/bin/env bash
# =============================================================================
# Obelysk Protocol — Deploy Remaining Mainnet Contracts
# =============================================================================
# Declares and deploys the 3 remaining undeployed mainnet contracts:
#   1. DarkPoolAuction       (constructor: owner)
#   2. ShieldedSwapRouter    (constructor: owner, ekubo_core)
#   3. StealthRegistry       (constructor: owner, sage_token)
#
# Already deployed (DO NOT redeploy):
#   - SAGE_TOKEN:             0x0098d563900789f934e610b67482ae58793a2efc373ba3a45af94cdbf931c799
#   - CONFIDENTIAL_TRANSFER:  0x0673685bdb01fbf57c390ec2c0d893e7c77316cdea315b0fbfbc85b9a9a979d2
#   - PRIVACY_ROUTER:         0x00f3fd871ba1b5b176270a7eb9e222c964c50fa8a31234394ea00ce70bfbdfbd
#   - VM31_POOL:              0x0230eb355e54a98b4511d86585d45d6a5b9075d0ec254877485047b6d651400d
#   - VM31_VERIFIER:          0x05071a9428cba9a7e4cbcbf3cee2d16caaaf2b6b9d270a8fb6089a4a97d330e8
#   - VM31_BRIDGE:            0x048f481c4ada306f5b62d7d223ddd0cf8055a423ffa2b278b3ff767ca9c0356c
#   - 5x PrivacyPools (SAGE, ETH, STRK, wBTC, USDC)
#
# Usage:
#   ./deploy-remaining-mainnet.sh --network mainnet --owner 0x<MULTISIG> --sage-token 0x<ADDR>
#   ./deploy-remaining-mainnet.sh --network mainnet --owner 0x<ADDR> --sage-token 0x<ADDR> --dry-run
#   ./deploy-remaining-mainnet.sh --network sepolia --owner 0x<DEPLOYER>
#
# Prerequisites:
#   - scarb build (artifacts in target/dev/)
#   - sncast configured with deployer account
#   - For mainnet: use --network mainnet (sncast profile [sncast.mainnet])
# =============================================================================

set -euo pipefail

# ─── Defaults ────────────────────────────────────────────────────────────────
NETWORK="sepolia"
OWNER=""
DRY_RUN=false
SNCAST_ACCOUNT="${SNCAST_ACCOUNT:-deployer}"
ARTIFACT_DIR="target/dev"
PACKAGE="obelysk_contracts"
SAGE_TOKEN_OVERRIDE=""
RPC_URL=""

# ─── Known Addresses ────────────────────────────────────────────────────────
MAINNET_SAGE_TOKEN="0x0098d563900789f934e610b67482ae58793a2efc373ba3a45af94cdbf931c799"
MAINNET_EKUBO_CORE="0x00000005dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b"
MAINNET_DEPLOYER="0x01f9ebd4b60101259df3ac877a27a1a017e7961995fa913be1a6f189af664660"

SEPOLIA_SAGE_TOKEN="0x072349097c8a802e7f66dc96b95aca84e4d78ddad22014904076c76293a99850"
SEPOLIA_EKUBO_CORE="0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384"

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
    *) echo "ERROR: Unknown option: $1"; exit 1 ;;
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
  SNCAST_ACCOUNT="mainnet-deployer"
  EKUBO_CORE="$MAINNET_EKUBO_CORE"
  SAGE_TOKEN="${SAGE_TOKEN_OVERRIDE:-$MAINNET_SAGE_TOKEN}"
else
  EKUBO_CORE="$SEPOLIA_EKUBO_CORE"
  SAGE_TOKEN="${SAGE_TOKEN_OVERRIDE:-$SEPOLIA_SAGE_TOKEN}"
fi

validate_address "sage_token" "$SAGE_TOKEN"
validate_address "ekubo_core" "$EKUBO_CORE"

if [[ ! -d "$ARTIFACT_DIR" ]]; then
  echo "ERROR: Artifact directory '$ARTIFACT_DIR' not found. Run 'scarb build' first."
  exit 1
fi

# ─── sncast Command Builder ─────────────────────────────────────────────────
# Mainnet profile has no url in snfoundry.toml (Alchemy v0.10 incompatibility),
# so we use --network mainnet flag. For sepolia, use the default profile with --url.
build_sncast_cmd() {
  if [[ "$NETWORK" == "mainnet" ]]; then
    if [[ -n "$RPC_URL" ]]; then
      echo "sncast --account $SNCAST_ACCOUNT --url $RPC_URL"
    else
      echo "sncast --account $SNCAST_ACCOUNT --network mainnet"
    fi
  else
    local url="${RPC_URL:-https://api.cartridge.gg/x/starknet/sepolia}"
    echo "sncast --account $SNCAST_ACCOUNT --url $url"
  fi
}

SNCAST_BASE=$(build_sncast_cmd)

# ─── Helpers ─────────────────────────────────────────────────────────────────
# Output file for deployed addresses
OUTPUT_FILE="deployment/${NETWORK}-remaining-$(date +%Y%m%d-%H%M%S).json"
mkdir -p deployment
chmod 700 deployment

# Deployed addresses
ADDR_DarkPoolAuction=""
ADDR_ShieldedSwapRouter=""
ADDR_StealthRegistry=""

# Class hashes
CH_DarkPoolAuction=""
CH_ShieldedSwapRouter=""
CH_StealthRegistry=""

log() { echo "[$(date +%H:%M:%S)] $*"; }

run_sncast() {
  if $DRY_RUN; then
    echo "  [DRY-RUN] $SNCAST_BASE $*"
    echo "0x_dry_run_hash"
  else
    $SNCAST_BASE "$@"
  fi
}

extract_class_hash() {
  local output="$1"
  local hash=""

  # Try standard output format: "class_hash: 0x..."
  hash=$(echo "$output" | grep -oE 'class_hash: 0x[0-9a-fA-F]+' | grep -oE '0x[0-9a-fA-F]+' || true)

  # Handle "already declared" case — grab first hex
  if [[ -z "$hash" ]]; then
    hash=$(echo "$output" | grep -oE '0x[0-9a-fA-F]+' | head -1 || true)
  fi

  echo "$hash"
}

extract_address() {
  local output="$1"
  echo "$output" | grep -oE 'contract_address: 0x[0-9a-fA-F]+' | grep -oE '0x[0-9a-fA-F]+' || true
}

declare_one() {
  local name="$1"
  local artifact="${ARTIFACT_DIR}/${PACKAGE}_${name}.contract_class.json"

  if [[ ! -f "$artifact" ]]; then
    echo "ERROR: Artifact not found: $artifact"
    echo "  Run 'scarb build' in the contracts directory first."
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
    echo "ERROR: Failed to extract class hash for $name"
    echo "Output: $output"
    exit 1
  fi

  log "  Class hash: $class_hash"
  echo "$class_hash"
}

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

# ═══════════════════════════════════════════════════════════════════════════════
# DEPLOYMENT
# ═══════════════════════════════════════════════════════════════════════════════

echo "============================================================"
echo "  Obelysk Protocol — Deploy Remaining Mainnet Contracts"
echo "============================================================"
echo "  Network:       $NETWORK"
echo "  Owner:         $OWNER"
echo "  Account:       $SNCAST_ACCOUNT"
echo "  sncast base:   $SNCAST_BASE"
echo "  Dry Run:       $DRY_RUN"
echo "  SAGE Token:    $SAGE_TOKEN"
echo "  Ekubo Core:    $EKUBO_CORE"
echo "============================================================"
echo ""
echo "  Contracts to deploy:"
echo "    1. DarkPoolAuction       (constructor: owner)"
echo "    2. ShieldedSwapRouter    (constructor: owner, ekubo_core)"
echo "    3. StealthRegistry       (constructor: owner, sage_token)"
echo ""

if [[ "$NETWORK" == "mainnet" && "$DRY_RUN" == "false" ]]; then
  echo "*** MAINNET DEPLOYMENT — REAL FUNDS AT RISK ***"
  echo "You have 10 seconds to cancel (Ctrl+C)..."
  for i in $(seq 10 -1 1); do
    printf "\r  %2d seconds remaining..." "$i"
    sleep 1
  done
  printf "\r  Proceeding with deployment.      \n"
  echo ""
fi

# ─── Phase 1: Declare All 3 Contract Classes ─────────────────────────────────
log "=== Phase 1: Declaring contract classes ==="

CH_DarkPoolAuction=$(declare_one "DarkPoolAuction")
CH_ShieldedSwapRouter=$(declare_one "ShieldedSwapRouter")
CH_StealthRegistry=$(declare_one "StealthRegistry")

log "All 3 classes declared."
echo ""

# ─── Phase 2: Deploy in Order ────────────────────────────────────────────────
log "=== Phase 2: Deploying contracts ==="

# 1. DarkPoolAuction — constructor(owner)
log "Deploying DarkPoolAuction..."
ADDR_DarkPoolAuction=$(deploy_one "$CH_DarkPoolAuction" "$OWNER")
log "  DarkPoolAuction: $ADDR_DarkPoolAuction"
echo ""

# 2. ShieldedSwapRouter — constructor(owner, ekubo_core)
log "Deploying ShieldedSwapRouter..."
ADDR_ShieldedSwapRouter=$(deploy_one "$CH_ShieldedSwapRouter" "$OWNER" "$EKUBO_CORE")
log "  ShieldedSwapRouter: $ADDR_ShieldedSwapRouter"
echo ""

# 3. StealthRegistry — constructor(owner, sage_token)
log "Deploying StealthRegistry..."
ADDR_StealthRegistry=$(deploy_one "$CH_StealthRegistry" "$OWNER" "$SAGE_TOKEN")
log "  StealthRegistry: $ADDR_StealthRegistry"
echo ""

log "All 3 contracts deployed."
echo ""

# ─── Phase 3: Write Deployment Output ────────────────────────────────────────
log "=== Phase 3: Writing deployment addresses ==="

cat > "$OUTPUT_FILE" << ADDRESSES_EOF
{
  "network": "$NETWORK",
  "deployed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "owner": "$OWNER",
  "script": "deploy-remaining-mainnet.sh",
  "contracts": {
    "DARK_POOL": {
      "address": "$ADDR_DarkPoolAuction",
      "class_hash": "$CH_DarkPoolAuction",
      "constructor": "owner=$OWNER"
    },
    "SHIELDED_SWAP_ROUTER": {
      "address": "$ADDR_ShieldedSwapRouter",
      "class_hash": "$CH_ShieldedSwapRouter",
      "constructor": "owner=$OWNER, ekubo_core=$EKUBO_CORE"
    },
    "STEALTH_REGISTRY": {
      "address": "$ADDR_StealthRegistry",
      "class_hash": "$CH_StealthRegistry",
      "constructor": "owner=$OWNER, sage_token=$SAGE_TOKEN"
    }
  },
  "references": {
    "sage_token": "$SAGE_TOKEN",
    "ekubo_core": "$EKUBO_CORE"
  }
}
ADDRESSES_EOF

chmod 600 "$OUTPUT_FILE"
log "Addresses written to: $OUTPUT_FILE (mode 600)"
echo ""

# ─── Artifact SHA-256 Hashes ─────────────────────────────────────────────────
log "=== Artifact SHA-256 hashes ==="
for contract_name in DarkPoolAuction ShieldedSwapRouter StealthRegistry; do
  artifact="${ARTIFACT_DIR}/${PACKAGE}_${contract_name}.contract_class.json"
  if [[ -f "$artifact" ]]; then
    HASH=$(shasum -a 256 "$artifact" | cut -d' ' -f1)
    log "  ${contract_name}: $HASH"
  fi
done
echo ""

# ─── Summary: Paste into addresses.ts ────────────────────────────────────────
echo "============================================================"
echo "  Paste into addresses.ts (${NETWORK} block)"
echo "============================================================"
echo ""
echo "    DARK_POOL: \"$ADDR_DarkPoolAuction\","
echo "    SHIELDED_SWAP_ROUTER: \"$ADDR_ShieldedSwapRouter\","
echo "    STEALTH_REGISTRY: \"$ADDR_StealthRegistry\","
echo ""
echo "============================================================"
echo ""

# ─── Verification Commands ───────────────────────────────────────────────────
echo "============================================================"
echo "  Verify on explorer (copy-paste these URLs)"
echo "============================================================"
if [[ "$NETWORK" == "mainnet" ]]; then
  EXPLORER="https://voyager.online"
else
  EXPLORER="https://sepolia.voyager.online"
fi
echo ""
echo "  DarkPoolAuction:    ${EXPLORER}/contract/${ADDR_DarkPoolAuction}"
echo "  ShieldedSwapRouter: ${EXPLORER}/contract/${ADDR_ShieldedSwapRouter}"
echo "  StealthRegistry:    ${EXPLORER}/contract/${ADDR_StealthRegistry}"
echo ""
echo "============================================================"
echo "  Deployment complete!"
echo "============================================================"
