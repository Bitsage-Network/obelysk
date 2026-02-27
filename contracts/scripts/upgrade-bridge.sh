#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# upgrade-bridge.sh
#
# Redeploy / upgrade the VM31ConfidentialBridge contract via its timelock
# mechanism (schedule -> 5-min delay -> execute).
#
# Usage:
#   ./upgrade-bridge.sh --network <mainnet|sepolia> --action <declare|schedule|execute|cancel|status> [OPTIONS]
#
# Options:
#   --network       mainnet | sepolia                (required)
#   --account       sncast account name              (default: mainnet-deployer | deployer)
#   --action        declare | schedule | execute | cancel | status  (required)
#   --class-hash    new class hash for schedule       (required for schedule)
#   --dry-run       print commands without executing
#
# Examples:
#   # 1. Declare the new class
#   ./upgrade-bridge.sh --network mainnet --action declare
#
#   # 2. Schedule the upgrade (starts 5-minute timer)
#   ./upgrade-bridge.sh --network mainnet --action schedule --class-hash 0xabc123...
#
#   # 3. Wait 5 minutes, then execute
#   ./upgrade-bridge.sh --network mainnet --action execute
#
#   # 4. Check pending upgrade status
#   ./upgrade-bridge.sh --network mainnet --action status
#
#   # 5. Cancel a pending upgrade
#   ./upgrade-bridge.sh --network mainnet --action cancel
###############################################################################

# ── Constants ────────────────────────────────────────────────────────────────

BRIDGE_MAINNET="0x048f481c4ada306f5b62d7d223ddd0cf8055a423ffa2b278b3ff767ca9c0356c"
BRIDGE_SEPOLIA="0x0"  # not deployed yet

DEPLOYER_MAINNET="0x01f9ebd4b60101259df3ac877a27a1a017e7961995fa913be1a6f189af664660"

UPGRADE_DELAY_SECONDS=300  # 5 minutes

SEPOLIA_RPC="https://api.cartridge.gg/x/starknet/sepolia"

CONTRACT_NAME="VM31ConfidentialBridge"

# ── Color helpers ────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

info()    { echo -e "${CYAN}[INFO]${NC}  $(date '+%Y-%m-%d %H:%M:%S')  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $(date '+%Y-%m-%d %H:%M:%S')  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S')  $*" >&2; }
success() { echo -e "${GREEN}[OK]${NC}    $(date '+%Y-%m-%d %H:%M:%S')  $*"; }

# ── Parse arguments ──────────────────────────────────────────────────────────

NETWORK=""
ACCOUNT=""
ACTION=""
CLASS_HASH=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --network)
            NETWORK="$2"
            shift 2
            ;;
        --account)
            ACCOUNT="$2"
            shift 2
            ;;
        --action)
            ACTION="$2"
            shift 2
            ;;
        --class-hash)
            CLASS_HASH="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        -h|--help)
            sed -n '/^# Usage:/,/^###/p' "$0" | head -n -1
            exit 0
            ;;
        *)
            error "Unknown argument: $1"
            exit 1
            ;;
    esac
done

# ── Validate required arguments ──────────────────────────────────────────────

if [[ -z "$NETWORK" ]]; then
    error "--network is required (mainnet | sepolia)"
    exit 1
fi

if [[ "$NETWORK" != "mainnet" && "$NETWORK" != "sepolia" ]]; then
    error "--network must be 'mainnet' or 'sepolia', got '$NETWORK'"
    exit 1
fi

if [[ -z "$ACTION" ]]; then
    error "--action is required (declare | schedule | execute | cancel | status)"
    exit 1
fi

case "$ACTION" in
    declare|schedule|execute|cancel|status) ;;
    *)
        error "Invalid --action '$ACTION'. Must be one of: declare, schedule, execute, cancel, status"
        exit 1
        ;;
esac

# ── Resolve network-specific values ─────────────────────────────────────────

if [[ "$NETWORK" == "mainnet" ]]; then
    BRIDGE_ADDRESS="$BRIDGE_MAINNET"
    NETWORK_FLAGS="--network mainnet"
    DEFAULT_ACCOUNT="mainnet-deployer"
else
    BRIDGE_ADDRESS="$BRIDGE_SEPOLIA"
    NETWORK_FLAGS="--url $SEPOLIA_RPC"
    DEFAULT_ACCOUNT="deployer"
fi

if [[ -z "$ACCOUNT" ]]; then
    ACCOUNT="$DEFAULT_ACCOUNT"
fi

# Validate bridge address for non-declare actions
if [[ "$ACTION" != "declare" && "$BRIDGE_ADDRESS" == "0x0" ]]; then
    error "Bridge contract is not deployed on $NETWORK. Cannot run '$ACTION'."
    error "Deploy the bridge first, then update BRIDGE_SEPOLIA in this script."
    exit 1
fi

# Validate class hash for schedule action
if [[ "$ACTION" == "schedule" && -z "$CLASS_HASH" ]]; then
    error "--class-hash is required for the 'schedule' action."
    error "First run: ./upgrade-bridge.sh --network $NETWORK --action declare"
    error "Then use the declared class hash with --class-hash."
    exit 1
fi

# ── Resolve project root ────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Helper: run or print command ─────────────────────────────────────────────

run_cmd() {
    if [[ "$DRY_RUN" == true ]]; then
        echo -e "${YELLOW}[DRY-RUN]${NC} $*"
        return 0
    fi
    info "Executing: $*"
    eval "$@"
}

# ── Print session header ────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}========================================================${NC}"
echo -e "${BOLD}  VM31ConfidentialBridge Upgrade Tool${NC}"
echo -e "${BOLD}========================================================${NC}"
echo ""
info "Network:       $NETWORK"
info "Account:       $ACCOUNT"
info "Action:        $ACTION"
info "Bridge:        $BRIDGE_ADDRESS"
info "Dry run:       $DRY_RUN"
if [[ -n "$CLASS_HASH" ]]; then
    info "Class hash:    $CLASS_HASH"
fi
info "Timestamp:     $(date '+%Y-%m-%d %H:%M:%S %Z')"
info "Unix time:     $(date '+%s')"
echo ""

# ── Action: declare ──────────────────────────────────────────────────────────

action_declare() {
    info "Step 1/2: Building contracts..."
    run_cmd "cd '$CONTRACTS_DIR' && scarb build"
    echo ""

    info "Step 2/2: Declaring $CONTRACT_NAME on $NETWORK..."
    run_cmd "cd '$CONTRACTS_DIR' && sncast $NETWORK_FLAGS --account $ACCOUNT declare --contract-name $CONTRACT_NAME"

    echo ""
    success "Declaration complete."
    echo ""
    echo -e "${BOLD}Next step:${NC}"
    echo "  Copy the class hash from above and run:"
    echo ""
    echo "  ./upgrade-bridge.sh --network $NETWORK --action schedule --class-hash <NEW_CLASS_HASH>"
    echo ""
}

# ── Action: schedule ─────────────────────────────────────────────────────────

action_schedule() {
    local now_ts
    now_ts=$(date '+%s')
    local execute_after=$((now_ts + UPGRADE_DELAY_SECONDS))
    local execute_time
    execute_time=$(date -r "$execute_after" '+%Y-%m-%d %H:%M:%S %Z' 2>/dev/null \
        || date -d "@$execute_after" '+%Y-%m-%d %H:%M:%S %Z' 2>/dev/null \
        || echo "~$(( UPGRADE_DELAY_SECONDS / 60 )) minutes from now")

    info "Scheduling upgrade to class hash: $CLASS_HASH"
    info "Timelock delay: ${UPGRADE_DELAY_SECONDS}s (5 minutes)"
    echo ""
    echo -e "${YELLOW}  +---------------------------------------------------------+${NC}"
    echo -e "${YELLOW}  |  IMPORTANT: After this TX confirms, you must wait at     |${NC}"
    echo -e "${YELLOW}  |  least 5 minutes before calling 'execute'.               |${NC}"
    echo -e "${YELLOW}  |                                                          |${NC}"
    echo -e "${YELLOW}  |  Earliest execute time: $execute_time  |${NC}"
    echo -e "${YELLOW}  |  Current time:          $(date '+%Y-%m-%d %H:%M:%S %Z')  |${NC}"
    echo -e "${YELLOW}  +---------------------------------------------------------+${NC}"
    echo ""

    if [[ "$DRY_RUN" == false ]]; then
        read -r -p "Proceed with scheduling the upgrade? (y/N): " confirm
        if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
            warn "Aborted by user."
            exit 0
        fi
    fi

    run_cmd "cd '$CONTRACTS_DIR' && sncast $NETWORK_FLAGS --account $ACCOUNT invoke --contract-address $BRIDGE_ADDRESS --function 'schedule_upgrade' --calldata $CLASS_HASH"

    echo ""
    success "Upgrade scheduled."
    echo ""
    echo -e "${BOLD}Upgrade timeline:${NC}"
    echo "  Scheduled at:     $(date '+%Y-%m-%d %H:%M:%S %Z') (unix: $now_ts)"
    echo "  Earliest execute: $execute_time (unix: $execute_after)"
    echo ""
    echo -e "${BOLD}Next steps:${NC}"
    echo "  1. Wait at least 5 minutes for the timelock to expire."
    echo "  2. Check status:"
    echo "       ./upgrade-bridge.sh --network $NETWORK --action status"
    echo "  3. Execute the upgrade:"
    echo "       ./upgrade-bridge.sh --network $NETWORK --action execute"
    echo ""
    echo "  To cancel instead:"
    echo "       ./upgrade-bridge.sh --network $NETWORK --action cancel"
    echo ""
}

# ── Action: execute ──────────────────────────────────────────────────────────

action_execute() {
    info "Checking pending upgrade status before executing..."
    echo ""

    # Query the pending upgrade first
    local status_output
    if [[ "$DRY_RUN" == false ]]; then
        status_output=$(cd "$CONTRACTS_DIR" && sncast $NETWORK_FLAGS call \
            --contract-address "$BRIDGE_ADDRESS" \
            --function "get_pending_upgrade" 2>&1) || true
        echo "  Pending upgrade response: $status_output"
        echo ""

        # Check if there's actually a pending upgrade (non-zero class hash)
        if echo "$status_output" | grep -q "0x0000000000000000000000000000000000000000000000000000000000000000"; then
            error "No pending upgrade found. Schedule one first with --action schedule."
            exit 1
        fi
    fi

    local now_ts
    now_ts=$(date '+%s')

    echo -e "${YELLOW}  +---------------------------------------------------------+${NC}"
    echo -e "${YELLOW}  |  WARNING: This will irreversibly upgrade the bridge      |${NC}"
    echo -e "${YELLOW}  |  contract. Ensure the new class hash has been audited    |${NC}"
    echo -e "${YELLOW}  |  and tested on Sepolia first.                            |${NC}"
    echo -e "${YELLOW}  +---------------------------------------------------------+${NC}"
    echo ""

    if [[ "$DRY_RUN" == false ]]; then
        read -r -p "Execute the upgrade NOW? This is irreversible. (y/N): " confirm
        if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
            warn "Aborted by user."
            exit 0
        fi
    fi

    info "Executing upgrade..."
    run_cmd "cd '$CONTRACTS_DIR' && sncast $NETWORK_FLAGS --account $ACCOUNT invoke --contract-address $BRIDGE_ADDRESS --function 'execute_upgrade'"

    echo ""
    success "Upgrade executed at $(date '+%Y-%m-%d %H:%M:%S %Z') (unix: $now_ts)"
    echo ""
    echo -e "${BOLD}Post-upgrade checklist:${NC}"
    echo "  1. Verify the new class hash on Starkscan/Voyager:"
    if [[ "$NETWORK" == "mainnet" ]]; then
        echo "       https://starkscan.co/contract/$BRIDGE_ADDRESS"
    else
        echo "       https://sepolia.starkscan.co/contract/$BRIDGE_ADDRESS"
    fi
    echo "  2. Run smoke tests against the bridge (deposit, withdraw, batch)."
    echo "  3. Monitor relayer logs for any errors."
    echo "  4. Update MEMORY.md with the new class hash."
    echo ""
}

# ── Action: cancel ───────────────────────────────────────────────────────────

action_cancel() {
    info "Cancelling pending upgrade on bridge $BRIDGE_ADDRESS..."
    echo ""

    if [[ "$DRY_RUN" == false ]]; then
        read -r -p "Cancel the pending upgrade? (y/N): " confirm
        if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
            warn "Aborted by user."
            exit 0
        fi
    fi

    run_cmd "cd '$CONTRACTS_DIR' && sncast $NETWORK_FLAGS --account $ACCOUNT invoke --contract-address $BRIDGE_ADDRESS --function 'cancel_upgrade'"

    echo ""
    success "Upgrade cancelled."
    echo ""
}

# ── Action: status ───────────────────────────────────────────────────────────

action_status() {
    info "Querying pending upgrade on bridge $BRIDGE_ADDRESS..."
    echo ""

    run_cmd "cd '$CONTRACTS_DIR' && sncast $NETWORK_FLAGS call --contract-address $BRIDGE_ADDRESS --function 'get_pending_upgrade'"

    echo ""
    info "If the class hash is 0x0, there is no pending upgrade."
    info "If non-zero, an upgrade is scheduled. The second value is the"
    info "earliest execution timestamp (unix seconds)."
    echo ""

    local now_ts
    now_ts=$(date '+%s')
    info "Current unix timestamp: $now_ts ($(date '+%Y-%m-%d %H:%M:%S %Z'))"
    echo ""
}

# ── Dispatch ─────────────────────────────────────────────────────────────────

case "$ACTION" in
    declare)  action_declare  ;;
    schedule) action_schedule ;;
    execute)  action_execute  ;;
    cancel)   action_cancel   ;;
    status)   action_status   ;;
esac

echo -e "${BOLD}Done.${NC}"
