#!/usr/bin/env bash
# =============================================================================
# Obelysk Protocol — Ownership Transfer Script (Step 1 of 2)
# =============================================================================
# Transfers ownership of all deployed Obelysk mainnet contracts from the
# deployer EOA to a multisig address using OpenZeppelin's 2-step transfer.
#
# This script executes STEP 1 ONLY: transfer_ownership(new_owner)
# STEP 2 (accept_ownership) must be called FROM THE MULTISIG separately.
#
# Usage:
#   ./transfer-ownership.sh --network mainnet --new-owner 0x<MULTISIG_ADDR>
#   ./transfer-ownership.sh --network mainnet --new-owner 0x<MULTISIG_ADDR> --dry-run
#   ./transfer-ownership.sh --network sepolia --new-owner 0x<TEST_ADDR> --account deployer
#
# Prerequisites:
#   - sncast configured with current owner account
#   - For mainnet: sncast profile [sncast.mainnet] with account=mainnet-deployer
#   - For sepolia: deployer account configured
# =============================================================================
#
# !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
# !!                                                                          !!
# !!   WARNING: OWNERSHIP TRANSFER IS IRREVERSIBLE                            !!
# !!                                                                          !!
# !!   Once the multisig calls accept_ownership(), the deployer EOA will      !!
# !!   permanently lose all admin privileges on these contracts.               !!
# !!                                                                          !!
# !!   Make absolutely sure:                                                   !!
# !!     1. The multisig address is correct and accessible                     !!
# !!     2. The multisig has enough signers to meet quorum                     !!
# !!     3. The multisig can call accept_ownership() on each contract          !!
# !!     4. You have tested this on Sepolia first                              !!
# !!                                                                          !!
# !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

set -euo pipefail

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ─── Defaults ────────────────────────────────────────────────────────────────
NETWORK="sepolia"
NEW_OWNER=""
DRY_RUN=false
SNCAST_ACCOUNT=""

# ─── Deployed Contract Addresses ─────────────────────────────────────────────
SAGE_TOKEN="0x0098d563900789f934e610b67482ae58793a2efc373ba3a45af94cdbf931c799"
CONFIDENTIAL_TRANSFER="0x0673685bdb01fbf57c390ec2c0d893e7c77316cdea315b0fbfbc85b9a9a979d2"
PRIVACY_ROUTER="0x00f3fd871ba1b5b176270a7eb9e222c964c50fa8a31234394ea00ce70bfbdfbd"
SAGE_PRIVACY_POOL="0x0224977344d123eb5c20fd088f15b62d0541f8282f4a23dd87bdf9839aac724f"
ETH_PRIVACY_POOL="0x06d0b41c96809796faa02a5eac2f74e090effd09ccab7274054b90aa671e82b5"
STRK_PRIVACY_POOL="0x02c348e89b355691ba5e4ece681fd6b497f8ab2ba670fa5842208b251a3c9cf1"
WBTC_PRIVACY_POOL="0x030fcfd4ae4f022e720e52f54359258a02517e11701c153ae46ab2cf10d5e5e2"
USDC_PRIVACY_POOL="0x05d36d7fd19d094ee0fd454e461061d68eb9f4fd0b241e2d1c94320b46d4d59b"
VM31_POOL="0x0230eb355e54a98b4511d86585d45d6a5b9075d0ec254877485047b6d651400d"
VM31_VERIFIER="0x05071a9428cba9a7e4cbcbf3cee2d16caaaf2b6b9d270a8fb6089a4a97d330e8"
VM31_BRIDGE="0x048f481c4ada306f5b62d7d223ddd0cf8055a423ffa2b278b3ff767ca9c0356c"

# Mainnet deployer (current owner)
MAINNET_DEPLOYER="0x01f9ebd4b60101259df3ac877a27a1a017e7961995fa913be1a6f189af664660"

# All contracts in transfer order
declare -a CONTRACT_NAMES=(
  "SAGE_TOKEN"
  "CONFIDENTIAL_TRANSFER"
  "PRIVACY_ROUTER"
  "SAGE_PRIVACY_POOL"
  "ETH_PRIVACY_POOL"
  "STRK_PRIVACY_POOL"
  "WBTC_PRIVACY_POOL"
  "USDC_PRIVACY_POOL"
  "VM31_POOL"
  "VM31_VERIFIER"
  "VM31_BRIDGE"
)

declare -a CONTRACT_ADDRS=(
  "$SAGE_TOKEN"
  "$CONFIDENTIAL_TRANSFER"
  "$PRIVACY_ROUTER"
  "$SAGE_PRIVACY_POOL"
  "$ETH_PRIVACY_POOL"
  "$STRK_PRIVACY_POOL"
  "$WBTC_PRIVACY_POOL"
  "$USDC_PRIVACY_POOL"
  "$VM31_POOL"
  "$VM31_VERIFIER"
  "$VM31_BRIDGE"
)

# ─── Parse Arguments ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)
      NETWORK="$2"; shift 2 ;;
    --new-owner)
      NEW_OWNER="$2"; shift 2 ;;
    --dry-run)
      DRY_RUN=true; shift ;;
    --account)
      SNCAST_ACCOUNT="$2"; shift 2 ;;
    --help)
      echo "Usage: $0 --network <sepolia|mainnet> --new-owner <0x...> [--dry-run] [--account <name>]"
      echo ""
      echo "Options:"
      echo "  --network    Target network: 'sepolia' or 'mainnet' (default: sepolia)"
      echo "  --new-owner  Multisig address to receive ownership (required)"
      echo "  --dry-run    Print commands without executing them"
      echo "  --account    sncast account name (default: mainnet-deployer for mainnet, deployer for sepolia)"
      echo "  --help       Show this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}ERROR: Unknown option: $1${NC}"
      echo "Run '$0 --help' for usage."
      exit 1
      ;;
  esac
done

# ─── Validation ──────────────────────────────────────────────────────────────

# Validate address format (must be 0x-prefixed hex)
validate_address() {
  local label="$1"
  local addr="$2"
  if [[ ! "$addr" =~ ^0x[0-9a-fA-F]{1,65}$ ]]; then
    echo -e "${RED}ERROR: Invalid address for $label: '$addr' (must be 0x-prefixed hex)${NC}"
    exit 1
  fi
}

if [[ -z "$NEW_OWNER" ]]; then
  echo -e "${RED}ERROR: --new-owner is required (multisig address)${NC}"
  echo "Run '$0 --help' for usage."
  exit 1
fi

if [[ "$NETWORK" != "sepolia" && "$NETWORK" != "mainnet" ]]; then
  echo -e "${RED}ERROR: --network must be 'sepolia' or 'mainnet'${NC}"
  exit 1
fi

validate_address "new-owner" "$NEW_OWNER"

# Prevent transferring to the deployer itself (no-op)
if [[ "$NEW_OWNER" == "$MAINNET_DEPLOYER" ]]; then
  echo -e "${RED}ERROR: --new-owner is the same as the current deployer. Nothing to transfer.${NC}"
  exit 1
fi

# Prevent transferring to zero address
if [[ "$NEW_OWNER" =~ ^0x0+$ ]]; then
  echo -e "${RED}ERROR: Cannot transfer ownership to the zero address.${NC}"
  exit 1
fi

# Set default account based on network
if [[ -z "$SNCAST_ACCOUNT" ]]; then
  if [[ "$NETWORK" == "mainnet" ]]; then
    SNCAST_ACCOUNT="mainnet-deployer"
  else
    SNCAST_ACCOUNT="deployer"
  fi
fi

# ─── Build sncast Command ────────────────────────────────────────────────────
build_sncast_cmd() {
  local cmd="sncast --account $SNCAST_ACCOUNT"
  if [[ "$NETWORK" == "mainnet" ]]; then
    # Mainnet: use --network flag (no --url due to Alchemy v0.10 incompatibility)
    cmd="$cmd --network mainnet"
  else
    # Sepolia: use explicit URL
    cmd="$cmd --url https://api.cartridge.gg/x/starknet/sepolia"
  fi
  echo "$cmd"
}

SNCAST_BASE=$(build_sncast_cmd)

# ─── Print Summary ───────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}=============================================================================${NC}"
echo -e "${BOLD}  Obelysk Protocol — Ownership Transfer (Step 1 of 2)${NC}"
echo -e "${BOLD}=============================================================================${NC}"
echo ""
echo -e "  ${CYAN}Network:${NC}         $NETWORK"
echo -e "  ${CYAN}Current Owner:${NC}   $MAINNET_DEPLOYER"
echo -e "  ${CYAN}New Owner:${NC}       ${YELLOW}$NEW_OWNER${NC}"
echo -e "  ${CYAN}Account:${NC}         $SNCAST_ACCOUNT"
echo -e "  ${CYAN}Dry Run:${NC}         $DRY_RUN"
echo ""
echo -e "  ${BOLD}Contracts to transfer (${#CONTRACT_NAMES[@]} total):${NC}"
echo ""

for i in "${!CONTRACT_NAMES[@]}"; do
  printf "    %-24s %s\n" "${CONTRACT_NAMES[$i]}" "${CONTRACT_ADDRS[$i]}"
done

echo ""
echo -e "${BOLD}─────────────────────────────────────────────────────────────────────────────${NC}"
echo ""

# ─── Warning Banner ──────────────────────────────────────────────────────────
echo -e "${RED}${BOLD}  +======================================================================+${NC}"
echo -e "${RED}${BOLD}  |                                                                      |${NC}"
echo -e "${RED}${BOLD}  |   WARNING: THIS ACTION INITIATES AN IRREVERSIBLE OWNERSHIP TRANSFER  |${NC}"
echo -e "${RED}${BOLD}  |                                                                      |${NC}"
echo -e "${RED}${BOLD}  |   After this script runs:                                            |${NC}"
echo -e "${RED}${BOLD}  |     - A pending ownership transfer will be set on each contract      |${NC}"
echo -e "${RED}${BOLD}  |     - The multisig MUST call accept_ownership() to complete it        |${NC}"
echo -e "${RED}${BOLD}  |     - Once accepted, the deployer EOA loses ALL admin privileges      |${NC}"
echo -e "${RED}${BOLD}  |     - There is NO way to reverse an accepted transfer                 |${NC}"
echo -e "${RED}${BOLD}  |                                                                      |${NC}"
echo -e "${RED}${BOLD}  |   The new owner must call accept_ownership() on each contract         |${NC}"
echo -e "${RED}${BOLD}  |   separately. Until accepted, the current owner retains control.      |${NC}"
echo -e "${RED}${BOLD}  |                                                                      |${NC}"
echo -e "${RED}${BOLD}  +======================================================================+${NC}"
echo ""

# ─── Dry Run Mode ────────────────────────────────────────────────────────────
if [[ "$DRY_RUN" == true ]]; then
  echo -e "${YELLOW}[DRY RUN] The following commands would be executed:${NC}"
  echo ""
  for i in "${!CONTRACT_NAMES[@]}"; do
    echo -e "  ${CYAN}# ${CONTRACT_NAMES[$i]}${NC}"
    echo "  $SNCAST_BASE invoke \\"
    echo "    --contract-address ${CONTRACT_ADDRS[$i]} \\"
    echo "    --function \"transfer_ownership\" \\"
    echo "    --calldata $NEW_OWNER"
    echo ""
  done
  echo -e "${YELLOW}[DRY RUN] No transactions were sent.${NC}"
  echo ""
  echo -e "${BOLD}After running without --dry-run, the multisig must execute Step 2:${NC}"
  echo ""
  for i in "${!CONTRACT_NAMES[@]}"; do
    echo -e "  ${CYAN}# ${CONTRACT_NAMES[$i]}${NC}"
    echo "  sncast invoke --contract-address ${CONTRACT_ADDRS[$i]} --function \"accept_ownership\""
  done
  echo ""
  exit 0
fi

# ─── Mainnet Countdown ───────────────────────────────────────────────────────
if [[ "$NETWORK" == "mainnet" ]]; then
  echo -e "${RED}${BOLD}  You are about to transfer ownership on MAINNET.${NC}"
  echo -e "${RED}${BOLD}  This will affect ${#CONTRACT_NAMES[@]} production contracts.${NC}"
  echo ""
  echo -e "${YELLOW}  Starting in 15 seconds. Press Ctrl+C to abort.${NC}"
  echo ""

  for i in $(seq 15 -1 1); do
    printf "\r  ${YELLOW}Proceeding in %2d seconds...${NC}" "$i"
    sleep 1
  done
  printf "\r  ${GREEN}Proceeding now.                ${NC}\n"
  echo ""
fi

# ─── Execute Transfers ───────────────────────────────────────────────────────
TOTAL=${#CONTRACT_NAMES[@]}
SUCCESS=0
FAILED=0
declare -a FAILED_CONTRACTS=()
declare -a TX_HASHES=()

echo -e "${BOLD}Executing transfer_ownership on $TOTAL contracts...${NC}"
echo ""

for i in "${!CONTRACT_NAMES[@]}"; do
  name="${CONTRACT_NAMES[$i]}"
  addr="${CONTRACT_ADDRS[$i]}"
  step=$(( i + 1 ))

  echo -e "  [${step}/${TOTAL}] ${CYAN}${name}${NC}"
  echo -e "         Address:  ${addr}"
  echo -e "         Function: transfer_ownership(${NEW_OWNER})"

  # Build the invoke command
  INVOKE_CMD="$SNCAST_BASE invoke --contract-address $addr --function transfer_ownership --calldata $NEW_OWNER"

  echo -e "         ${YELLOW}Sending transaction...${NC}"

  # Execute and capture output
  if OUTPUT=$($INVOKE_CMD 2>&1); then
    # Extract transaction hash from sncast output
    TX_HASH=$(echo "$OUTPUT" | grep -i "transaction_hash" | head -1 | awk '{print $NF}' || true)
    if [[ -z "$TX_HASH" ]]; then
      TX_HASH=$(echo "$OUTPUT" | grep -oE '0x[0-9a-fA-F]{60,}' | head -1 || true)
    fi
    if [[ -z "$TX_HASH" ]]; then
      TX_HASH="(see output)"
    fi

    echo -e "         ${GREEN}SUCCESS${NC} — tx: ${TX_HASH}"
    TX_HASHES+=("$TX_HASH")
    SUCCESS=$(( SUCCESS + 1 ))
  else
    echo -e "         ${RED}FAILED${NC}"
    echo -e "         Error: $OUTPUT"
    FAILED=$(( FAILED + 1 ))
    FAILED_CONTRACTS+=("$name")
    TX_HASHES+=("FAILED")
  fi

  echo ""

  # Small delay between transactions to avoid nonce issues
  if [[ $step -lt $TOTAL ]]; then
    sleep 2
  fi
done

# ─── Results Summary ─────────────────────────────────────────────────────────
echo -e "${BOLD}=============================================================================${NC}"
echo -e "${BOLD}  Transfer Summary${NC}"
echo -e "${BOLD}=============================================================================${NC}"
echo ""
echo -e "  ${GREEN}Succeeded:${NC} $SUCCESS / $TOTAL"
if [[ $FAILED -gt 0 ]]; then
  echo -e "  ${RED}Failed:${NC}    $FAILED / $TOTAL"
fi
echo ""

# Print per-contract results
echo -e "  ${BOLD}Contract                    Status     Transaction Hash${NC}"
echo    "  ─────────────────────────────────────────────────────────────────────"
for i in "${!CONTRACT_NAMES[@]}"; do
  tx="${TX_HASHES[$i]:-N/A}"
  if [[ "$tx" == "FAILED" ]]; then
    printf "  %-27s ${RED}FAILED${NC}     -\n" "${CONTRACT_NAMES[$i]}"
  else
    printf "  %-27s ${GREEN}OK${NC}         %s\n" "${CONTRACT_NAMES[$i]}" "$tx"
  fi
done
echo ""

# Print failed contracts for retry
if [[ $FAILED -gt 0 ]]; then
  echo -e "${RED}${BOLD}  The following contracts failed and need to be retried:${NC}"
  for name in "${FAILED_CONTRACTS[@]}"; do
    echo -e "    - $name"
  done
  echo ""
fi

# ─── Next Steps ──────────────────────────────────────────────────────────────
echo -e "${BOLD}=============================================================================${NC}"
echo -e "${BOLD}  NEXT STEPS (REQUIRED)${NC}"
echo -e "${BOLD}=============================================================================${NC}"
echo ""
echo -e "  ${YELLOW}Step 2: The multisig at ${NEW_OWNER}${NC}"
echo -e "  ${YELLOW}must call accept_ownership() on each contract to finalize the transfer.${NC}"
echo ""
echo -e "  Until accept_ownership() is called, the current owner RETAINS control."
echo -e "  The pending transfer can be overwritten by calling transfer_ownership()"
echo -e "  again with a different address (only the current owner can do this)."
echo ""
echo -e "  ${BOLD}Commands for the multisig to execute:${NC}"
echo ""

for i in "${!CONTRACT_NAMES[@]}"; do
  tx="${TX_HASHES[$i]:-N/A}"
  if [[ "$tx" != "FAILED" ]]; then
    echo -e "  ${CYAN}# ${CONTRACT_NAMES[$i]}${NC}"
    echo "  sncast invoke --contract-address ${CONTRACT_ADDRS[$i]} --function \"accept_ownership\""
    echo ""
  fi
done

echo -e "${BOLD}=============================================================================${NC}"

# Exit with error if any transfers failed
if [[ $FAILED -gt 0 ]]; then
  exit 1
fi

echo -e "${GREEN}${BOLD}  All ownership transfers initiated successfully.${NC}"
echo -e "${GREEN}${BOLD}  Waiting for multisig to call accept_ownership() on each contract.${NC}"
echo ""
