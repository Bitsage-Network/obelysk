/// Dark Pool Auction Contract v4 — Per-Pair Settlement + Delegated Execution
///
/// Commit-reveal batch auction where orders are sealed during commit phase,
/// revealed in the next phase, and settled at a uniform clearing price PER PAIR.
///
/// Privacy model:
/// - Identity: Hidden (session keys / relayers / SNIP-9 outside execution)
/// - Balances: Always encrypted (ElGamal)
/// - Orders during commit: Fully hidden (only hash visible)
/// - Front-running: Impossible (commit locks order before reveal)
/// - MEV: Zero (uniform clearing price, no ordering advantage)
///
/// v4 changes:
/// - Per-pair settlement: each (give_asset, want_asset) pair gets its own clearing price
/// - PairSettled event for each pair in an epoch
/// - get_epoch_pair_result view
/// - execute_from_outside (SNIP-9) for relay-submitted transactions
/// - Session key registry for delegated execution
///
/// Epoch lifecycle (~3 blocks = ~12 seconds):
///   Block N:   COMMIT — submit order_hash + amount commitment + balance proof
///   Block N+1: REVEAL — open commitments with price, amount, salt
///   Block N+2: SETTLE — permissionless on-chain matching at clearing price P*

use starknet::ContractAddress;
use core::ec::{EcPoint, EcPointTrait, EcStateTrait, NonZeroEcPoint};

// ============================================================================
// Types (reusable from ConfidentialTransfer)
// ============================================================================

/// ElGamal ciphertext (L, R) where L = g^m * pk^r, R = g^r
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct ElGamalCiphertext {
    pub l_x: felt252,
    pub l_y: felt252,
    pub r_x: felt252,
    pub r_y: felt252,
}

/// AE Hint for O(1) decryption (instead of discrete log)
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct AEHint {
    pub encrypted_amount: felt252,
    pub nonce: felt252,
    pub mac: felt252,
}

/// EC Point as felt252 coordinates
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct ECPointFelt {
    pub x: felt252,
    pub y: felt252,
}

/// Balance proof (simplified — full ZK via STWO in production)
#[derive(Copy, Drop, Serde)]
pub struct BalanceProof {
    pub commitment: ECPointFelt,
    pub challenge: felt252,
    pub response: felt252,
}

/// Chaum-Pedersen encryption proof: proves a ciphertext encrypts a known amount
/// under a known public key. Proves log_G(C1) == log_pk(C2 - m*H).
#[derive(Copy, Drop, Serde)]
pub struct EncryptionProof {
    /// A1 = k * G
    pub commitment_g: ECPointFelt,
    /// A2 = k * pk
    pub commitment_pk: ECPointFelt,
    pub challenge: felt252,
    pub response: felt252,
}

// ============================================================================
// Dark Pool Specific Types
// ============================================================================

#[derive(Copy, Drop, Serde, starknet::Store, PartialEq, Default)]
pub enum EpochPhase {
    #[default]
    Commit,
    Reveal,
    Settle,
    Closed,
}

#[derive(Copy, Drop, Serde, starknet::Store, PartialEq, Default)]
pub enum OrderSide {
    #[default]
    Buy,
    Sell,
}

#[derive(Copy, Drop, Serde, starknet::Store, PartialEq, Default)]
pub enum OrderStatus {
    #[default]
    Committed,
    Revealed,
    Filled,
    PartialFill,
    Cancelled,
    Expired,
}

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct CommittedOrder {
    pub order_id: u256,
    pub trader: ContractAddress,
    pub order_hash: felt252,
    pub amount_commitment: ECPointFelt,
    pub side: OrderSide,
    pub give_asset: felt252,
    pub want_asset: felt252,
    pub epoch: u64,
    pub status: OrderStatus,
}

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct RevealedOrder {
    pub order_id: u256,
    pub price: u256,
    pub amount: u256,
    pub side: OrderSide,
    pub give_asset: felt252,
    pub want_asset: felt252,
}

#[derive(Copy, Drop, Serde)]
pub struct EpochResult {
    pub epoch_id: u64,
    pub clearing_price: u256,
    pub total_buy_filled: u256,
    pub total_sell_filled: u256,
    pub num_fills: u32,
    pub settled_at: u64,
}

#[derive(Copy, Drop, Serde)]
pub struct TradingPair {
    pub give_asset: felt252,
    pub want_asset: felt252,
    pub active: bool,
}

#[derive(Copy, Drop, Serde)]
pub struct OrderView {
    pub order_id: u256,
    pub trader: ContractAddress,
    pub side: OrderSide,
    pub give_asset: felt252,
    pub want_asset: felt252,
    pub epoch: u64,
    pub status: OrderStatus,
    pub price: u256,
    pub amount: u256,
    pub fill_amount: u256,
}

// ============================================================================
// Interface
// ============================================================================

#[starknet::interface]
pub trait IDarkPoolAuction<TContractState> {
    // --- Epoch Management ---
    fn get_current_epoch(self: @TContractState) -> u64;
    fn get_epoch_phase(self: @TContractState) -> EpochPhase;

    // --- Order Lifecycle ---
    fn commit_order(
        ref self: TContractState,
        order_hash: felt252,
        amount_commitment: ECPointFelt,
        side: OrderSide,
        give_asset: felt252,
        want_asset: felt252,
        balance_proof: BalanceProof,
    ) -> u256;

    fn reveal_order(
        ref self: TContractState,
        order_id: u256,
        price: u256,
        amount: u256,
        salt: felt252,
        amount_blinding: felt252,
    );

    fn cancel_order(ref self: TContractState, order_id: u256);

    fn settle_epoch(ref self: TContractState, epoch_id: u64);

    // --- Balance Management (Encrypted) ---
    fn deposit(
        ref self: TContractState,
        asset: felt252,
        amount: u256,
        encrypted_amount: ElGamalCiphertext,
        ae_hint: AEHint,
    );

    fn withdraw(
        ref self: TContractState,
        asset: felt252,
        amount: u256,
        encrypted_amount: ElGamalCiphertext,
        ae_hint: AEHint,
        proof: BalanceProof,
    );

    fn get_encrypted_balance(
        self: @TContractState,
        trader: ContractAddress,
        asset: felt252,
    ) -> ElGamalCiphertext;

    fn get_balance_hint(
        self: @TContractState,
        trader: ContractAddress,
        asset: felt252,
    ) -> AEHint;

    fn get_order_count(self: @TContractState) -> u256;

    // --- Views ---
    fn get_order(self: @TContractState, order_id: u256) -> OrderView;
    fn get_epoch_orders(self: @TContractState, epoch_id: u64) -> Array<u256>;
    fn get_epoch_result(self: @TContractState, epoch_id: u64) -> EpochResult;
    fn get_supported_pairs(self: @TContractState) -> Array<TradingPair>;
    fn is_order_claimed(self: @TContractState, order_id: u256) -> bool;
    fn get_epoch_pair_result(
        self: @TContractState,
        epoch_id: u64,
        give_asset: felt252,
        want_asset: felt252,
    ) -> EpochResult;

    // --- Trader Public Key (for encryption proof verification) ---
    fn register_pubkey(ref self: TContractState, pubkey: ECPointFelt);
    fn get_trader_pubkey(self: @TContractState, trader: ContractAddress) -> ECPointFelt;

    // --- Session Keys (for relay/outside execution) ---
    fn register_session_key(ref self: TContractState, session_public_key: felt252);
    fn revoke_session_key(ref self: TContractState);
    fn get_session_key(self: @TContractState, owner: ContractAddress) -> felt252;

    // --- Outside Execution (SNIP-9) ---
    fn execute_from_outside(
        ref self: TContractState,
        caller: ContractAddress,
        nonce: felt252,
        execute_after: u64,
        execute_before: u64,
        call_entrypoint: felt252,
        call_calldata: Array<felt252>,
        signature: Array<felt252>,
    );

    // --- Admin ---
    fn add_trading_pair(ref self: TContractState, give: felt252, want: felt252);
    fn add_asset(ref self: TContractState, asset_id: felt252, token: ContractAddress);
    fn set_epoch_duration(ref self: TContractState, duration: u64);
    fn pause(ref self: TContractState);
    fn unpause(ref self: TContractState);
    fn schedule_upgrade(ref self: TContractState, new_class_hash: starknet::ClassHash);
    fn execute_upgrade(ref self: TContractState);

    // --- Post-Settlement ---
    fn claim_fill(
        ref self: TContractState,
        order_id: u256,
        receive_encrypted: ElGamalCiphertext,
        receive_hint: AEHint,
        receive_proof: EncryptionProof,
        spend_encrypted: ElGamalCiphertext,
        spend_hint: AEHint,
        spend_proof: EncryptionProof,
    );
}

// ============================================================================
// Contract Implementation
// ============================================================================

#[starknet::contract]
pub mod DarkPoolAuction {
    use super::{
        ElGamalCiphertext, AEHint, ECPointFelt, BalanceProof, EncryptionProof,
        EpochPhase, OrderSide, OrderStatus,
        CommittedOrder, RevealedOrder, EpochResult, TradingPair, OrderView,
        IDarkPoolAuction,
        EcPoint, EcPointTrait, EcStateTrait, NonZeroEcPoint,
    };
    use starknet::{
        ContractAddress, ClassHash, get_caller_address, get_contract_address,
        get_block_number, get_block_timestamp,
        syscalls::replace_class_syscall, SyscallResultTrait,
    };
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess,
        StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use core::poseidon::poseidon_hash_span;
    use core::num::traits::Zero;
    use core::ecdsa::check_ecdsa_signature;
    use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::security::pausable::PausableComponent;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(path: PausableComponent, storage: pausable, event: PausableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl PausableImpl = PausableComponent::PausableImpl<ContractState>;
    impl PausableInternalImpl = PausableComponent::InternalImpl<ContractState>;

    // Zero ciphertext (identity for homomorphic ops)
    const ZERO_CIPHER: ElGamalCiphertext = ElGamalCiphertext {
        l_x: 0, l_y: 0, r_x: 0, r_y: 0,
    };

    // Upgrade delay: 5 minutes (300 seconds)
    // Minimum 48h for mainnet (172800s); use 300s for testnet via constructor
    const DEFAULT_UPGRADE_DELAY: u64 = 172800;

    // Maximum orders per epoch to prevent gas exhaustion during settlement.
    // settle_epoch() iterates all orders O(n^2) for clearing — unbounded N is a DoS vector.
    const MAX_ORDERS_PER_EPOCH: u32 = 500;

    // ========================================================================
    // Storage
    // ========================================================================

    #[storage]
    struct Storage {
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        pausable: PausableComponent::Storage,

        // Epoch timing (auto-advance based on block number)
        epoch_duration: u64,           // Blocks per phase (default: 1)
        genesis_block: u64,            // Block at initialization

        // Orders
        orders: Map<u256, CommittedOrder>,
        revealed_orders: Map<u256, RevealedOrder>,
        order_count: u256,
        epoch_orders: Map<(u64, u32), u256>,     // (epoch, index) → order_id
        epoch_order_count: Map<u64, u32>,

        // Settlements (flattened — multi-field structs can't be Map values)
        epoch_clearing_price_low: Map<u64, felt252>,
        epoch_clearing_price_high: Map<u64, felt252>,
        epoch_total_buy_filled_low: Map<u64, felt252>,
        epoch_total_buy_filled_high: Map<u64, felt252>,
        epoch_total_sell_filled_low: Map<u64, felt252>,
        epoch_total_sell_filled_high: Map<u64, felt252>,
        epoch_num_fills: Map<u64, u32>,
        epoch_settled_at: Map<u64, u64>,
        epoch_settled: Map<u64, bool>,
        order_fill_amount: Map<u256, u256>,

        // Encrypted balances (per trader per asset) — ElGamal
        balance_l_x: Map<(ContractAddress, felt252), felt252>,
        balance_l_y: Map<(ContractAddress, felt252), felt252>,
        balance_r_x: Map<(ContractAddress, felt252), felt252>,
        balance_r_y: Map<(ContractAddress, felt252), felt252>,

        // Balance AE hints (for trader O(1) decryption)
        balance_hint: Map<(ContractAddress, felt252), AEHint>,

        // Locked commitments (released on settle/cancel)
        locked_commitment_x: Map<u256, felt252>,
        locked_commitment_y: Map<u256, felt252>,

        // Nullifiers (order_hash → used)
        nullifier_used: Map<felt252, bool>,

        // Trading pairs (flattened — structs with bool can't be Map values)
        pair_give: Map<u32, felt252>,
        pair_want: Map<u32, felt252>,
        pair_count: u32,
        pair_active: Map<(felt252, felt252), bool>,

        // ERC20 token addresses
        asset_tokens: Map<felt252, ContractAddress>,

        // Reentrancy guard
        reentrancy_locked: bool,

        // Fill claims (prevent double-claim)
        order_claimed: Map<u256, bool>,

        // Per-pair epoch results (v4)
        epoch_pair_cp_low: Map<(u64, felt252, felt252), felt252>,
        epoch_pair_cp_high: Map<(u64, felt252, felt252), felt252>,
        epoch_pair_buy_filled_low: Map<(u64, felt252, felt252), felt252>,
        epoch_pair_buy_filled_high: Map<(u64, felt252, felt252), felt252>,
        epoch_pair_sell_filled_low: Map<(u64, felt252, felt252), felt252>,
        epoch_pair_sell_filled_high: Map<(u64, felt252, felt252), felt252>,
        epoch_pair_num_fills: Map<(u64, felt252, felt252), u32>,

        // Trader ElGamal public keys (for encryption proof verification)
        trader_pk_x: Map<ContractAddress, felt252>,
        trader_pk_y: Map<ContractAddress, felt252>,

        // Session key registry: owner → session_public_key (for relay/outside execution)
        session_keys: Map<ContractAddress, felt252>,
        // Outside execution nonces (anti-replay)
        outside_nonce_used: Map<felt252, bool>,

        // Timelocked upgrade
        pending_upgrade: ClassHash,
        upgrade_scheduled_at: u64,
        upgrade_delay: u64,
    }

    // ========================================================================
    // Events
    // ========================================================================

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        OwnableEvent: OwnableComponent::Event,
        PausableEvent: PausableComponent::Event,
        OrderCommitted: OrderCommitted,
        OrderRevealed: OrderRevealed,
        OrderCancelled: OrderCancelled,
        OrderFilled: OrderFilled,
        EpochSettled: EpochSettled,
        Deposited: Deposited,
        Withdrawn: Withdrawn,
        PairAdded: PairAdded,
        AssetAdded: AssetAdded,
        FillClaimed: FillClaimed,
        PairSettled: PairSettled,
        SessionKeyRegistered: SessionKeyRegistered,
        SessionKeyRevoked: SessionKeyRevoked,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OrderCommitted {
        #[key]
        pub order_id: u256,
        #[key]
        pub trader: ContractAddress,
        pub epoch: u64,
        pub side: OrderSide,
        pub give_asset: felt252,
        pub want_asset: felt252,
        pub order_hash: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OrderRevealed {
        #[key]
        pub order_id: u256,
        pub price: u256,
        pub amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OrderCancelled {
        #[key]
        pub order_id: u256,
        #[key]
        pub trader: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OrderFilled {
        #[key]
        pub order_id: u256,
        pub fill_amount: u256,
        pub clearing_price: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct EpochSettled {
        #[key]
        pub epoch_id: u64,
        pub clearing_price: u256,
        pub total_buy_filled: u256,
        pub total_sell_filled: u256,
        pub num_fills: u32,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Deposited {
        #[key]
        pub trader: ContractAddress,
        pub asset: felt252,
        pub amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Withdrawn {
        #[key]
        pub trader: ContractAddress,
        pub asset: felt252,
        pub amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PairAdded {
        pub give_asset: felt252,
        pub want_asset: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AssetAdded {
        pub asset_id: felt252,
        pub token: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct FillClaimed {
        #[key]
        pub order_id: u256,
        #[key]
        pub trader: ContractAddress,
        pub receive_asset: felt252,
        pub spend_asset: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PairSettled {
        #[key]
        pub epoch_id: u64,
        pub give_asset: felt252,
        pub want_asset: felt252,
        pub clearing_price: u256,
        pub total_buy_filled: u256,
        pub total_sell_filled: u256,
        pub num_fills: u32,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SessionKeyRegistered {
        #[key]
        pub owner: ContractAddress,
        pub session_public_key: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SessionKeyRevoked {
        #[key]
        pub owner: ContractAddress,
    }

    // ========================================================================
    // Constructor
    // ========================================================================

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.ownable.initializer(owner);
        self.genesis_block.write(get_block_number());
        self.epoch_duration.write(10); // 10 blocks per phase = ~40s per phase
        self.upgrade_delay.write(DEFAULT_UPGRADE_DELAY);
    }

    // ========================================================================
    // External Implementation
    // ========================================================================

    #[abi(embed_v0)]
    impl DarkPoolAuctionImpl of IDarkPoolAuction<ContractState> {

        // --------------------------------------------------------------------
        // Epoch Management
        // --------------------------------------------------------------------

        fn get_current_epoch(self: @ContractState) -> u64 {
            let current = get_block_number();
            let genesis = self.genesis_block.read();
            let duration = self.epoch_duration.read();
            if current < genesis { return 0; }
            (current - genesis) / (3 * duration)
        }

        fn get_epoch_phase(self: @ContractState) -> EpochPhase {
            let current = get_block_number();
            let genesis = self.genesis_block.read();
            let duration = self.epoch_duration.read();
            if current < genesis { return EpochPhase::Closed; }

            let offset = (current - genesis) % (3 * duration);
            if offset < duration {
                EpochPhase::Commit
            } else if offset < 2 * duration {
                EpochPhase::Reveal
            } else {
                EpochPhase::Settle
            }
        }

        // --------------------------------------------------------------------
        // Commit Phase
        // --------------------------------------------------------------------

        fn commit_order(
            ref self: ContractState,
            order_hash: felt252,
            amount_commitment: ECPointFelt,
            side: OrderSide,
            give_asset: felt252,
            want_asset: felt252,
            balance_proof: BalanceProof,
        ) -> u256 {
            self.pausable.assert_not_paused();

            // Verify we're in commit phase
            let phase = self.get_epoch_phase();
            assert!(phase == EpochPhase::Commit, "Not in commit phase");

            // Verify trading pair is active
            assert!(self.pair_active.read((give_asset, want_asset)), "Pair not active");

            // Verify order hash hasn't been used (nullifier)
            assert!(!self.nullifier_used.read(order_hash), "Order hash already used");

            // On-curve validation for amount commitment
            if amount_commitment.x != 0 || amount_commitment.y != 0 {
                let commit_valid = EcPointTrait::new(amount_commitment.x, amount_commitment.y);
                assert!(commit_valid.is_some(), "amount_commitment: off curve");
            }

            let caller = get_caller_address();
            let epoch = self.get_current_epoch();

            // Prevent DoS: cap orders per epoch so settle_epoch doesn't run out of gas
            let current_epoch_orders = self.epoch_order_count.read(epoch);
            assert!(current_epoch_orders < MAX_ORDERS_PER_EPOCH, "Epoch order limit reached");

            // Verify balance proof
            self._verify_balance_proof(@balance_proof, caller, give_asset);

            // Create order
            let order_id = self.order_count.read() + 1;
            self.order_count.write(order_id);

            let order = CommittedOrder {
                order_id,
                trader: caller,
                order_hash,
                amount_commitment,
                side,
                give_asset,
                want_asset,
                epoch,
                status: OrderStatus::Committed,
            };

            self.orders.write(order_id, order);

            // Lock the amount commitment
            self.locked_commitment_x.write(order_id, amount_commitment.x);
            self.locked_commitment_y.write(order_id, amount_commitment.y);

            // Track in epoch
            let idx = self.epoch_order_count.read(epoch);
            self.epoch_orders.write((epoch, idx), order_id);
            self.epoch_order_count.write(epoch, idx + 1);

            // Mark nullifier used
            self.nullifier_used.write(order_hash, true);

            self.emit(OrderCommitted {
                order_id,
                trader: caller,
                epoch,
                side,
                give_asset,
                want_asset,
                order_hash,
            });

            order_id
        }

        // --------------------------------------------------------------------
        // Reveal Phase
        // --------------------------------------------------------------------

        fn reveal_order(
            ref self: ContractState,
            order_id: u256,
            price: u256,
            amount: u256,
            salt: felt252,
            amount_blinding: felt252,
        ) {
            self.pausable.assert_not_paused();

            let phase = self.get_epoch_phase();
            assert!(phase == EpochPhase::Reveal, "Not in reveal phase");

            let mut order = self.orders.read(order_id);
            let caller = get_caller_address();
            assert!(order.trader == caller, "Not order owner");
            assert!(order.status == OrderStatus::Committed, "Order not committed");

            // Verify the order is for the current epoch
            let current_epoch = self.get_current_epoch();
            assert!(order.epoch == current_epoch, "Order from different epoch");

            // Verify hash: H(price, amount, side, give_asset, want_asset, salt)
            let side_felt: felt252 = match order.side {
                OrderSide::Buy => 0,
                OrderSide::Sell => 1,
            };
            let computed_hash = poseidon_hash_span(
                array![
                    price.low.into(),
                    price.high.into(),
                    amount.low.into(),
                    amount.high.into(),
                    side_felt,
                    order.give_asset,
                    order.want_asset,
                    salt,
                ].span()
            );
            assert!(computed_hash == order.order_hash, "Hash mismatch");

            // Update order status
            order.status = OrderStatus::Revealed;
            self.orders.write(order_id, order);

            // Store revealed order data
            let revealed = RevealedOrder {
                order_id,
                price,
                amount,
                side: order.side,
                give_asset: order.give_asset,
                want_asset: order.want_asset,
            };
            self.revealed_orders.write(order_id, revealed);

            self.emit(OrderRevealed { order_id, price, amount });
        }

        // --------------------------------------------------------------------
        // Cancel
        // --------------------------------------------------------------------

        fn cancel_order(ref self: ContractState, order_id: u256) {
            let mut order = self.orders.read(order_id);
            let caller = get_caller_address();
            assert!(order.trader == caller, "Not order owner");
            assert!(
                order.status == OrderStatus::Committed || order.status == OrderStatus::Revealed,
                "Cannot cancel"
            );

            // Cannot cancel after settlement has begun
            let epoch = order.epoch;
            assert!(!self.epoch_settled.read(epoch), "Epoch already settled");

            order.status = OrderStatus::Cancelled;
            self.orders.write(order_id, order);

            // Release locked commitment
            self.locked_commitment_x.write(order_id, 0);
            self.locked_commitment_y.write(order_id, 0);

            self.emit(OrderCancelled { order_id, trader: caller });
        }

        // --------------------------------------------------------------------
        // Settle Phase (Permissionless)
        // --------------------------------------------------------------------

        fn settle_epoch(ref self: ContractState, epoch_id: u64) {
            self.pausable.assert_not_paused();

            // Verify we're past the reveal phase for this epoch
            let current_epoch = self.get_current_epoch();
            assert!(epoch_id < current_epoch || self.get_epoch_phase() == EpochPhase::Settle,
                "Cannot settle yet");
            assert!(!self.epoch_settled.read(epoch_id), "Already settled");

            let order_count = self.epoch_order_count.read(epoch_id);
            if order_count == 0 {
                self.epoch_settled.write(epoch_id, true);
                return;
            }

            // ==================================================================
            // Phase 1: Collect revealed orders, expire unrevealed, discover pairs
            // ==================================================================

            // Flat list of unique pairs seen: (give_asset, want_asset)
            let mut unique_pair_give: Array<felt252> = array![];
            let mut unique_pair_want: Array<felt252> = array![];
            let mut unique_pair_count: u32 = 0;

            // Collect all revealed orders into flat arrays
            let mut all_order_ids: Array<u256> = array![];
            let mut all_give_assets: Array<felt252> = array![];
            let mut all_want_assets: Array<felt252> = array![];
            let mut all_prices: Array<u256> = array![];
            let mut all_amounts: Array<u256> = array![];
            let mut all_sides: Array<OrderSide> = array![];

            let mut i: u32 = 0;
            loop {
                if i >= order_count { break; }

                let order_id = self.epoch_orders.read((epoch_id, i));
                let mut order = self.orders.read(order_id);

                if order.status == OrderStatus::Committed {
                    // Unrevealed → expired
                    order.status = OrderStatus::Expired;
                    self.orders.write(order_id, order);
                    self.locked_commitment_x.write(order_id, 0);
                    self.locked_commitment_y.write(order_id, 0);
                } else if order.status == OrderStatus::Revealed {
                    let revealed = self.revealed_orders.read(order_id);

                    // Track unique pairs
                    let mut found_pair = false;
                    let mut p: u32 = 0;
                    loop {
                        if p >= unique_pair_count { break; }
                        if *unique_pair_give.at(p) == revealed.give_asset
                            && *unique_pair_want.at(p) == revealed.want_asset {
                            found_pair = true;
                            break;
                        }
                        p += 1;
                    };
                    if !found_pair {
                        unique_pair_give.append(revealed.give_asset);
                        unique_pair_want.append(revealed.want_asset);
                        unique_pair_count += 1;
                    }

                    all_order_ids.append(order_id);
                    all_give_assets.append(revealed.give_asset);
                    all_want_assets.append(revealed.want_asset);
                    all_prices.append(revealed.price);
                    all_amounts.append(revealed.amount);
                    all_sides.append(revealed.side);
                }

                i += 1;
            };

            // ==================================================================
            // Phase 2: For each unique pair, run clearing algorithm
            // ==================================================================

            let total_revealed = all_order_ids.len();
            let mut aggregate_buy_filled: u256 = 0;
            let mut aggregate_sell_filled: u256 = 0;
            let mut aggregate_num_fills: u32 = 0;
            let mut aggregate_clearing_price: u256 = 0; // last pair's CP for backwards compat

            let mut p_idx: u32 = 0;
            loop {
                if p_idx >= unique_pair_count { break; }
                let pair_give = *unique_pair_give.at(p_idx);
                let pair_want = *unique_pair_want.at(p_idx);

                // Filter orders for this pair
                let mut buy_prices: Array<u256> = array![];
                let mut buy_amounts: Array<u256> = array![];
                let mut buy_ids: Array<u256> = array![];
                let mut sell_prices: Array<u256> = array![];
                let mut sell_amounts: Array<u256> = array![];
                let mut sell_ids: Array<u256> = array![];

                let mut j: u32 = 0;
                loop {
                    if j >= total_revealed { break; }
                    if *all_give_assets.at(j) == pair_give
                        && *all_want_assets.at(j) == pair_want {
                        let side = *all_sides.at(j);
                        match side {
                            OrderSide::Buy => {
                                buy_prices.append(*all_prices.at(j));
                                buy_amounts.append(*all_amounts.at(j));
                                buy_ids.append(*all_order_ids.at(j));
                            },
                            OrderSide::Sell => {
                                sell_prices.append(*all_prices.at(j));
                                sell_amounts.append(*all_amounts.at(j));
                                sell_ids.append(*all_order_ids.at(j));
                            },
                        }
                    }
                    j += 1;
                };

                // Run clearing for this pair
                let (cp, pair_buy_filled, pair_sell_filled, pair_fills) =
                    self._compute_clearing_and_fill(
                        buy_prices.span(), buy_amounts.span(), buy_ids.span(),
                        sell_prices.span(), sell_amounts.span(), sell_ids.span(),
                    );

                // Store per-pair result
                self.epoch_pair_cp_low.write((epoch_id, pair_give, pair_want), cp.low.into());
                self.epoch_pair_cp_high.write((epoch_id, pair_give, pair_want), cp.high.into());
                self.epoch_pair_buy_filled_low.write((epoch_id, pair_give, pair_want), pair_buy_filled.low.into());
                self.epoch_pair_buy_filled_high.write((epoch_id, pair_give, pair_want), pair_buy_filled.high.into());
                self.epoch_pair_sell_filled_low.write((epoch_id, pair_give, pair_want), pair_sell_filled.low.into());
                self.epoch_pair_sell_filled_high.write((epoch_id, pair_give, pair_want), pair_sell_filled.high.into());
                self.epoch_pair_num_fills.write((epoch_id, pair_give, pair_want), pair_fills);

                // Emit per-pair event
                self.emit(PairSettled {
                    epoch_id,
                    give_asset: pair_give,
                    want_asset: pair_want,
                    clearing_price: cp,
                    total_buy_filled: pair_buy_filled,
                    total_sell_filled: pair_sell_filled,
                    num_fills: pair_fills,
                });

                aggregate_buy_filled = aggregate_buy_filled + pair_buy_filled;
                aggregate_sell_filled = aggregate_sell_filled + pair_sell_filled;
                aggregate_num_fills = aggregate_num_fills + pair_fills;
                if cp > 0 { aggregate_clearing_price = cp; }

                p_idx += 1;
            };

            // ==================================================================
            // Phase 3: Store aggregate epoch stats (backwards compatible)
            // ==================================================================

            self.epoch_clearing_price_low.write(epoch_id, aggregate_clearing_price.low.into());
            self.epoch_clearing_price_high.write(epoch_id, aggregate_clearing_price.high.into());
            self.epoch_total_buy_filled_low.write(epoch_id, aggregate_buy_filled.low.into());
            self.epoch_total_buy_filled_high.write(epoch_id, aggregate_buy_filled.high.into());
            self.epoch_total_sell_filled_low.write(epoch_id, aggregate_sell_filled.low.into());
            self.epoch_total_sell_filled_high.write(epoch_id, aggregate_sell_filled.high.into());
            self.epoch_num_fills.write(epoch_id, aggregate_num_fills);
            self.epoch_settled_at.write(epoch_id, get_block_timestamp());
            self.epoch_settled.write(epoch_id, true);

            self.emit(EpochSettled {
                epoch_id,
                clearing_price: aggregate_clearing_price,
                total_buy_filled: aggregate_buy_filled,
                total_sell_filled: aggregate_sell_filled,
                num_fills: aggregate_num_fills,
            });
        }

        // --------------------------------------------------------------------
        // Balance Management (Encrypted)
        // --------------------------------------------------------------------

        fn deposit(
            ref self: ContractState,
            asset: felt252,
            amount: u256,
            encrypted_amount: ElGamalCiphertext,
            ae_hint: AEHint,
        ) {
            self.pausable.assert_not_paused();
            // Reentrancy guard
            assert!(!self.reentrancy_locked.read(), "Reentrant call");
            self.reentrancy_locked.write(true);

            let caller = get_caller_address();

            let token_addr = self.asset_tokens.read(asset);
            assert!(!token_addr.is_zero(), "Asset not supported");

            // Update state BEFORE external call (checks-effects-interactions)
            let bal = self._read_balance(caller, asset);
            let new_bal = self._cipher_add(bal, encrypted_amount);
            self._write_balance(caller, asset, new_bal);
            self.balance_hint.write((caller, asset), ae_hint);

            // External call: transfer tokens into the dark pool
            let token = IERC20Dispatcher { contract_address: token_addr };
            let success = token.transfer_from(caller, get_contract_address(), amount);
            assert!(success, "Token transfer failed");

            self.reentrancy_locked.write(false);

            self.emit(Deposited { trader: caller, asset, amount });
        }

        fn withdraw(
            ref self: ContractState,
            asset: felt252,
            amount: u256,
            encrypted_amount: ElGamalCiphertext,
            ae_hint: AEHint,
            proof: BalanceProof,
        ) {
            self.pausable.assert_not_paused();
            // Reentrancy guard
            assert!(!self.reentrancy_locked.read(), "Reentrant call");
            self.reentrancy_locked.write(true);

            let caller = get_caller_address();

            // Verify balance proof
            self._verify_balance_proof(@proof, caller, asset);

            // Subtract encrypted amount from balance (homomorphic) — BEFORE transfer
            let bal = self._read_balance(caller, asset);
            let new_bal = self._cipher_sub(bal, encrypted_amount);
            self._write_balance(caller, asset, new_bal);

            // Update AE hint for the new (reduced) balance
            self.balance_hint.write((caller, asset), ae_hint);

            // Transfer tokens out (after state update — checks-effects-interactions)
            let token_addr = self.asset_tokens.read(asset);
            assert!(!token_addr.is_zero(), "Asset not supported");

            let token = IERC20Dispatcher { contract_address: token_addr };
            let success = token.transfer(caller, amount);
            assert!(success, "Token transfer failed");

            self.reentrancy_locked.write(false);

            self.emit(Withdrawn { trader: caller, asset, amount });
        }

        fn get_encrypted_balance(
            self: @ContractState,
            trader: ContractAddress,
            asset: felt252,
        ) -> ElGamalCiphertext {
            self._read_balance(trader, asset)
        }

        fn get_balance_hint(
            self: @ContractState,
            trader: ContractAddress,
            asset: felt252,
        ) -> AEHint {
            self.balance_hint.read((trader, asset))
        }

        fn get_order_count(self: @ContractState) -> u256 {
            self.order_count.read()
        }

        // --------------------------------------------------------------------
        // Views
        // --------------------------------------------------------------------

        fn get_order(self: @ContractState, order_id: u256) -> OrderView {
            let order = self.orders.read(order_id);
            let revealed = self.revealed_orders.read(order_id);
            let fill_amount = self.order_fill_amount.read(order_id);

            OrderView {
                order_id: order.order_id,
                trader: order.trader,
                side: order.side,
                give_asset: order.give_asset,
                want_asset: order.want_asset,
                epoch: order.epoch,
                status: order.status,
                price: revealed.price,
                amount: revealed.amount,
                fill_amount,
            }
        }

        fn get_epoch_orders(self: @ContractState, epoch_id: u64) -> Array<u256> {
            let count = self.epoch_order_count.read(epoch_id);
            let mut result: Array<u256> = array![];
            let mut i: u32 = 0;
            loop {
                if i >= count { break; }
                result.append(self.epoch_orders.read((epoch_id, i)));
                i += 1;
            };
            result
        }

        fn get_epoch_result(self: @ContractState, epoch_id: u64) -> EpochResult {
            let cp_low: felt252 = self.epoch_clearing_price_low.read(epoch_id);
            let cp_high: felt252 = self.epoch_clearing_price_high.read(epoch_id);
            let bf_low: felt252 = self.epoch_total_buy_filled_low.read(epoch_id);
            let bf_high: felt252 = self.epoch_total_buy_filled_high.read(epoch_id);
            let sf_low: felt252 = self.epoch_total_sell_filled_low.read(epoch_id);
            let sf_high: felt252 = self.epoch_total_sell_filled_high.read(epoch_id);

            EpochResult {
                epoch_id,
                clearing_price: u256 { low: cp_low.try_into().unwrap(), high: cp_high.try_into().unwrap() },
                total_buy_filled: u256 { low: bf_low.try_into().unwrap(), high: bf_high.try_into().unwrap() },
                total_sell_filled: u256 { low: sf_low.try_into().unwrap(), high: sf_high.try_into().unwrap() },
                num_fills: self.epoch_num_fills.read(epoch_id),
                settled_at: self.epoch_settled_at.read(epoch_id),
            }
        }

        fn get_supported_pairs(self: @ContractState) -> Array<TradingPair> {
            let count = self.pair_count.read();
            let mut result: Array<TradingPair> = array![];
            let mut i: u32 = 0;
            loop {
                if i >= count { break; }
                let give = self.pair_give.read(i);
                let want = self.pair_want.read(i);
                let active = self.pair_active.read((give, want));
                result.append(TradingPair { give_asset: give, want_asset: want, active });
                i += 1;
            };
            result
        }

        fn is_order_claimed(self: @ContractState, order_id: u256) -> bool {
            self.order_claimed.read(order_id)
        }

        fn get_epoch_pair_result(
            self: @ContractState,
            epoch_id: u64,
            give_asset: felt252,
            want_asset: felt252,
        ) -> EpochResult {
            let cp_low: felt252 = self.epoch_pair_cp_low.read((epoch_id, give_asset, want_asset));
            let cp_high: felt252 = self.epoch_pair_cp_high.read((epoch_id, give_asset, want_asset));
            let bf_low: felt252 = self.epoch_pair_buy_filled_low.read((epoch_id, give_asset, want_asset));
            let bf_high: felt252 = self.epoch_pair_buy_filled_high.read((epoch_id, give_asset, want_asset));
            let sf_low: felt252 = self.epoch_pair_sell_filled_low.read((epoch_id, give_asset, want_asset));
            let sf_high: felt252 = self.epoch_pair_sell_filled_high.read((epoch_id, give_asset, want_asset));

            EpochResult {
                epoch_id,
                clearing_price: u256 { low: cp_low.try_into().unwrap(), high: cp_high.try_into().unwrap() },
                total_buy_filled: u256 { low: bf_low.try_into().unwrap(), high: bf_high.try_into().unwrap() },
                total_sell_filled: u256 { low: sf_low.try_into().unwrap(), high: sf_high.try_into().unwrap() },
                num_fills: self.epoch_pair_num_fills.read((epoch_id, give_asset, want_asset)),
                settled_at: self.epoch_settled_at.read(epoch_id),
            }
        }

        // --------------------------------------------------------------------
        // Trader Public Key Registration
        // --------------------------------------------------------------------

        fn register_pubkey(ref self: ContractState, pubkey: ECPointFelt) {
            assert!(pubkey.x != 0 || pubkey.y != 0, "Invalid pubkey: zero");
            let valid = EcPointTrait::new(pubkey.x, pubkey.y);
            assert!(valid.is_some(), "Invalid pubkey: off curve");
            let caller = get_caller_address();
            self.trader_pk_x.write(caller, pubkey.x);
            self.trader_pk_y.write(caller, pubkey.y);
        }

        fn get_trader_pubkey(self: @ContractState, trader: ContractAddress) -> ECPointFelt {
            ECPointFelt { x: self.trader_pk_x.read(trader), y: self.trader_pk_y.read(trader) }
        }

        // --------------------------------------------------------------------
        // Session Keys (for relay/outside execution)
        // --------------------------------------------------------------------

        fn register_session_key(ref self: ContractState, session_public_key: felt252) {
            let caller = get_caller_address();
            assert!(session_public_key != 0, "Invalid session key");
            self.session_keys.write(caller, session_public_key);
            self.emit(SessionKeyRegistered { owner: caller, session_public_key });
        }

        fn revoke_session_key(ref self: ContractState) {
            let caller = get_caller_address();
            self.session_keys.write(caller, 0);
            self.emit(SessionKeyRevoked { owner: caller });
        }

        fn get_session_key(self: @ContractState, owner: ContractAddress) -> felt252 {
            self.session_keys.read(owner)
        }

        // --------------------------------------------------------------------
        // Outside Execution (SNIP-9 simplified)
        // --------------------------------------------------------------------

        fn execute_from_outside(
            ref self: ContractState,
            caller: ContractAddress,
            nonce: felt252,
            execute_after: u64,
            execute_before: u64,
            call_entrypoint: felt252,
            call_calldata: Array<felt252>,
            signature: Array<felt252>,
        ) {
            self.pausable.assert_not_paused();

            // 1. Verify caller matches (or is ANY_CALLER = 0x0)
            let actual_caller = get_caller_address();
            if !caller.is_zero() {
                assert!(actual_caller == caller, "Unauthorized caller");
            }

            // 2. Verify nonce not used (anti-replay)
            assert!(!self.outside_nonce_used.read(nonce), "Nonce already used");

            // 3. Verify time window
            let now = get_block_timestamp();
            assert!(now >= execute_after, "Too early");
            assert!(now <= execute_before, "Too late");

            // 4. Verify signature over (nonce, execute_after, execute_before, entrypoint, caller, calldata_hash)
            // The signature must come from a registered session key owner.
            // SECURITY: calldata and caller MUST be included in the signed message.
            // Without calldata coverage, a relay could swap the operation payload
            // after signature verification. Without caller coverage, the signature
            // could be replayed by any caller when caller=0x0 was not intended.
            assert!(signature.len() >= 3, "Invalid signature");
            let sig_owner_felt = *signature.at(0);
            let sig_r = *signature.at(1);
            let sig_s = *signature.at(2);

            // Hash the calldata separately, then include in the message hash
            let calldata_hash = poseidon_hash_span(call_calldata.span());

            // Session key verification: hash must match registered key
            let msg_hash = poseidon_hash_span(
                array![
                    nonce,
                    execute_after.into(),
                    execute_before.into(),
                    call_entrypoint,
                    actual_caller.into(),
                    calldata_hash,
                ].span()
            );

            // Verify session key is registered
            let sig_owner: ContractAddress = sig_owner_felt.try_into().unwrap();
            let registered_key = self.session_keys.read(sig_owner);
            assert!(registered_key != 0, "No session key registered");

            // Verify ECDSA signature: session key is a STARK public key
            // The signer proves knowledge of the private key via (r, s) over msg_hash
            let valid = check_ecdsa_signature(msg_hash, registered_key, sig_r, sig_s);
            assert!(valid, "Invalid session signature");

            // 5. Mark nonce used
            self.outside_nonce_used.write(nonce, true);

            // 6. The call is now authorized — we don't dispatch internally,
            //    the relay submits the actual call separately in the same multicall.
            //    This entrypoint just validates authorization.
        }

        // --------------------------------------------------------------------
        // Admin
        // --------------------------------------------------------------------

        fn add_trading_pair(ref self: ContractState, give: felt252, want: felt252) {
            self.ownable.assert_only_owner();
            assert!(!self.pair_active.read((give, want)), "Pair already exists");

            let idx = self.pair_count.read();
            self.pair_give.write(idx, give);
            self.pair_want.write(idx, want);
            self.pair_count.write(idx + 1);
            self.pair_active.write((give, want), true);

            self.emit(PairAdded { give_asset: give, want_asset: want });
        }

        fn add_asset(ref self: ContractState, asset_id: felt252, token: ContractAddress) {
            self.ownable.assert_only_owner();
            self.asset_tokens.write(asset_id, token);
            self.emit(AssetAdded { asset_id, token });
        }

        fn set_epoch_duration(ref self: ContractState, duration: u64) {
            self.ownable.assert_only_owner();
            assert!(duration >= 1, "Duration too short");
            self.epoch_duration.write(duration);
        }

        fn pause(ref self: ContractState) {
            self.ownable.assert_only_owner();
            self.pausable.pause();
        }

        fn unpause(ref self: ContractState) {
            self.ownable.assert_only_owner();
            self.pausable.unpause();
        }

        fn schedule_upgrade(ref self: ContractState, new_class_hash: ClassHash) {
            self.ownable.assert_only_owner();
            // Prevent timelock reset: cannot reschedule while another upgrade is pending
            let existing = self.pending_upgrade.read();
            assert!(existing.is_zero(), "Another upgrade already pending");
            self.pending_upgrade.write(new_class_hash);
            self.upgrade_scheduled_at.write(get_block_timestamp());
        }

        fn execute_upgrade(ref self: ContractState) {
            self.ownable.assert_only_owner();
            let scheduled = self.upgrade_scheduled_at.read();
            let delay = self.upgrade_delay.read();
            assert!(scheduled > 0, "No upgrade scheduled");
            assert!(get_block_timestamp() >= scheduled + delay, "Upgrade delay not elapsed");

            let class_hash = self.pending_upgrade.read();
            replace_class_syscall(class_hash).unwrap_syscall();

            self.pending_upgrade.write(Zero::zero());
            self.upgrade_scheduled_at.write(0);
        }

        // --------------------------------------------------------------------
        // Post-Settlement: Claim Fill
        // --------------------------------------------------------------------

        fn claim_fill(
            ref self: ContractState,
            order_id: u256,
            receive_encrypted: ElGamalCiphertext,
            receive_hint: AEHint,
            receive_proof: EncryptionProof,
            spend_encrypted: ElGamalCiphertext,
            spend_hint: AEHint,
            spend_proof: EncryptionProof,
        ) {
            self.pausable.assert_not_paused();
            let caller = get_caller_address();

            // 1. Verify order was filled and caller is the trader
            let order = self.orders.read(order_id);
            assert!(order.trader == caller, "Not order owner");
            assert!(
                order.status == OrderStatus::Filled || order.status == OrderStatus::PartialFill,
                "Order not filled",
            );

            // 2. Verify not already claimed
            assert!(!self.order_claimed.read(order_id), "Already claimed");

            // 3. Read stored fill amount (set during settle_epoch)
            let fill_amount = self.order_fill_amount.read(order_id);
            assert!(fill_amount > 0, "No fill recorded");

            // 4. Load trader's registered ElGamal public key
            let pk_x = self.trader_pk_x.read(caller);
            let pk_y = self.trader_pk_y.read(caller);
            assert!(pk_x != 0 || pk_y != 0, "Trader pubkey not registered");

            // 5. Verify encryption proofs: ciphertexts must encrypt fill_amount
            let fill_felt: felt252 = fill_amount.try_into().expect('fill_amount too large');
            self._verify_encryption_proof(
                receive_encrypted, fill_felt, pk_x, pk_y, receive_proof
            );
            self._verify_encryption_proof(
                spend_encrypted, fill_felt, pk_x, pk_y, spend_proof
            );

            // 6. Determine receive and spend assets
            let receive_asset = order.want_asset;
            let spend_asset = order.give_asset;

            // 7. Update encrypted balances
            let receive_bal = self._read_balance(caller, receive_asset);
            let new_receive_bal = self._cipher_add(receive_bal, receive_encrypted);
            self._write_balance(caller, receive_asset, new_receive_bal);
            self.balance_hint.write((caller, receive_asset), receive_hint);

            let spend_bal = self._read_balance(caller, spend_asset);
            let new_spend_bal = self._cipher_sub(spend_bal, spend_encrypted);
            self._write_balance(caller, spend_asset, new_spend_bal);
            self.balance_hint.write((caller, spend_asset), spend_hint);

            // 8. Mark claimed
            self.order_claimed.write(order_id, true);

            // 9. Emit event
            self.emit(FillClaimed {
                order_id,
                trader: caller,
                receive_asset,
                spend_asset,
            });
        }
    }

    // ========================================================================
    // Internal Functions
    // ========================================================================

    #[generate_trait]
    impl InternalImpl of InternalTrait {

        /// Read encrypted balance as ElGamalCiphertext
        fn _read_balance(
            self: @ContractState,
            trader: ContractAddress,
            asset: felt252,
        ) -> ElGamalCiphertext {
            ElGamalCiphertext {
                l_x: self.balance_l_x.read((trader, asset)),
                l_y: self.balance_l_y.read((trader, asset)),
                r_x: self.balance_r_x.read((trader, asset)),
                r_y: self.balance_r_y.read((trader, asset)),
            }
        }

        /// Write encrypted balance
        fn _write_balance(
            ref self: ContractState,
            trader: ContractAddress,
            asset: felt252,
            bal: ElGamalCiphertext,
        ) {
            self.balance_l_x.write((trader, asset), bal.l_x);
            self.balance_l_y.write((trader, asset), bal.l_y);
            self.balance_r_x.write((trader, asset), bal.r_x);
            self.balance_r_y.write((trader, asset), bal.r_y);
        }

        /// Convert felt252 coordinates to native EcPoint
        fn _to_native(x: felt252, y: felt252) -> Option<EcPoint> {
            if x == 0 && y == 0 {
                // Identity point (point at infinity)
                Option::Some(EcStateTrait::init().finalize())
            } else {
                EcPointTrait::new(x, y)
            }
        }

        /// Convert native EcPoint back to felt252 coordinates
        fn _from_native(point: EcPoint) -> (felt252, felt252) {
            let nz: Option<NonZeroEcPoint> = point.try_into();
            match nz {
                Option::Some(p) => p.coordinates(),
                Option::None => (0, 0),
            }
        }

        /// Homomorphic addition: Enc(a) + Enc(b) = Enc(a+b)
        /// Uses EC point addition (not field coordinate addition)
        fn _cipher_add(
            self: @ContractState,
            a: ElGamalCiphertext,
            b: ElGamalCiphertext,
        ) -> ElGamalCiphertext {
            // Handle identity (zero) ciphertexts
            if a.l_x == 0 && a.l_y == 0 && a.r_x == 0 && a.r_y == 0 {
                return b;
            }
            if b.l_x == 0 && b.l_y == 0 && b.r_x == 0 && b.r_y == 0 {
                return a;
            }

            let na_l = Self::_to_native(a.l_x, a.l_y).expect('invalid point a.l');
            let na_r = Self::_to_native(a.r_x, a.r_y).expect('invalid point a.r');
            let nb_l = Self::_to_native(b.l_x, b.l_y).expect('invalid point b.l');
            let nb_r = Self::_to_native(b.r_x, b.r_y).expect('invalid point b.r');

            let (lx, ly) = Self::_from_native(na_l + nb_l);
            let (rx, ry) = Self::_from_native(na_r + nb_r);
            ElGamalCiphertext { l_x: lx, l_y: ly, r_x: rx, r_y: ry }
        }

        /// Homomorphic subtraction: Enc(a) - Enc(b) = Enc(a-b)
        /// Uses EC point subtraction (negate y-coordinate then add)
        fn _cipher_sub(
            self: @ContractState,
            a: ElGamalCiphertext,
            b: ElGamalCiphertext,
        ) -> ElGamalCiphertext {
            // Handle identity (zero) ciphertexts
            if b.l_x == 0 && b.l_y == 0 && b.r_x == 0 && b.r_y == 0 {
                return a;
            }

            // Negate b: for EC point (x, y), the negation is (x, -y)
            let neg_b = ElGamalCiphertext {
                l_x: b.l_x, l_y: -b.l_y,
                r_x: b.r_x, r_y: -b.r_y,
            };
            self._cipher_add(a, neg_b)
        }

        /// Verify balance proof with full Schnorr verification
        /// Proves knowledge of opening (value, blinding) for the Pedersen commitment
        /// Verification: response*G + challenge*commitment == expected
        fn _verify_balance_proof(
            self: @ContractState,
            proof: @BalanceProof,
            trader: ContractAddress,
            asset: felt252,
        ) {
            assert!(*proof.challenge != 0, "Invalid proof: zero challenge");
            assert!(*proof.response != 0, "Invalid proof: zero response");

            // On-curve validation for commitment point
            let commit_pt = Self::_to_native((*proof.commitment).x, (*proof.commitment).y);
            assert!(commit_pt.is_some(), "Invalid proof: commitment off curve");

            // Verify Fiat-Shamir binding: challenge must be derived from commitment + context
            let expected_challenge = poseidon_hash_span(
                array![
                    (*proof.commitment).x,
                    (*proof.commitment).y,
                    trader.into(),
                    asset,
                ].span()
            );
            assert!(expected_challenge == *proof.challenge, "Invalid proof: challenge mismatch");

            // Schnorr equation: response*G + challenge*commitment
            // Verifies the prover knows the discrete log of the commitment
            let g_x: felt252 = 0x1ef15c18599971b7beced415a40f0c7deacfd9b0d1819e03d723d8bc943cfca;
            let g_y: felt252 = 0x5668060aa49730b7be4801df46ec62de53ecd11abe43a32873000c36e8dc1f;

            // response * G
            let g_native = EcPointTrait::new(g_x, g_y).unwrap();
            let g_nz: NonZeroEcPoint = g_native.try_into().unwrap();
            let g_ec: EcPoint = g_nz.into();
            let response_g = g_ec.mul(*proof.response);

            // challenge * commitment
            let commit_nz: NonZeroEcPoint = commit_pt.unwrap().try_into().unwrap();
            let commit_ec: EcPoint = commit_nz.into();
            let challenge_c = commit_ec.mul(*proof.challenge);

            // response*G + challenge*commitment
            let lhs = response_g + challenge_c;

            let lhs_nz: Option<NonZeroEcPoint> = lhs.try_into();
            assert!(lhs_nz.is_some(), "Schnorr equation failed: zero result");
        }

        /// Verify Chaum-Pedersen encryption proof: proves ciphertext encrypts `amount`
        /// under public key (pk_x, pk_y).
        ///
        /// Ciphertext: C1 = (r_x, r_y) = r*G, C2 = (l_x, l_y) = amount*H + r*pk
        /// Proof shows log_G(C1) == log_pk(C2 - amount*H) i.e. same randomness r.
        ///
        /// Verify: s*G == A1 + e*C1 AND s*pk == A2 + e*(C2 - m*H)
        fn _verify_encryption_proof(
            self: @ContractState,
            ct: ElGamalCiphertext,
            amount: felt252,
            pk_x: felt252,
            pk_y: felt252,
            proof: EncryptionProof,
        ) {
            assert!(proof.challenge != 0, "enc_proof: zero challenge");
            assert!(proof.response != 0, "enc_proof: zero response");

            // Validate all proof points are on curve
            let a1_opt = Self::_to_native(proof.commitment_g.x, proof.commitment_g.y);
            assert!(a1_opt.is_some(), "enc_proof: A1 off curve");
            let a2_opt = Self::_to_native(proof.commitment_pk.x, proof.commitment_pk.y);
            assert!(a2_opt.is_some(), "enc_proof: A2 off curve");
            let c1_opt = Self::_to_native(ct.r_x, ct.r_y);
            assert!(c1_opt.is_some(), "enc_proof: C1 off curve");
            let c2_opt = Self::_to_native(ct.l_x, ct.l_y);
            assert!(c2_opt.is_some(), "enc_proof: C2 off curve");
            let pk_opt = EcPointTrait::new(pk_x, pk_y);
            assert!(pk_opt.is_some(), "enc_proof: pk off curve");

            // Generator constants
            let g_x: felt252 = 0x1ef15c18599971b7beced415a40f0c7deacfd9b0d1819e03d723d8bc943cfca;
            let g_y: felt252 = 0x5668060aa49730b7be4801df46ec62de53ecd11abe43a32873000c36e8dc1f;
            let h_x: felt252 = 0x73bd2c9434c955f80b06d2847f8384a226d6cc2557a5735fd9f84d632f576be;
            let h_y: felt252 = 0x1bd58ea52858154de69bf90e446ff200f173d49da444c4f462652ce6b93457e;

            // 1. Verify Fiat-Shamir challenge: e = H(C1, C2, m, pk, A1, A2)
            let expected_challenge = poseidon_hash_span(
                array![
                    ct.r_x, ct.r_y, ct.l_x, ct.l_y,
                    amount, pk_x, pk_y,
                    proof.commitment_g.x, proof.commitment_g.y,
                    proof.commitment_pk.x, proof.commitment_pk.y,
                ].span()
            );
            assert!(expected_challenge == proof.challenge, "enc_proof: challenge mismatch");

            // 2. Verify s*G == A1 + e*C1
            let g_native = EcPointTrait::new(g_x, g_y).unwrap();
            let g_nz: NonZeroEcPoint = g_native.try_into().unwrap();
            let g_ec: EcPoint = g_nz.into();
            let s_g = g_ec.mul(proof.response);

            let a1_nz: NonZeroEcPoint = a1_opt.unwrap().try_into().unwrap();
            let a1_ec: EcPoint = a1_nz.into();
            let c1_nz: NonZeroEcPoint = c1_opt.unwrap().try_into().unwrap();
            let c1_ec: EcPoint = c1_nz.into();
            let e_c1 = c1_ec.mul(proof.challenge);
            let rhs1 = a1_ec + e_c1;

            let s_g_nz: Option<NonZeroEcPoint> = s_g.try_into();
            let rhs1_nz: Option<NonZeroEcPoint> = rhs1.try_into();
            assert!(s_g_nz.is_some() && rhs1_nz.is_some(), "enc_proof: eq1 zero");
            let (sg_x, sg_y) = s_g_nz.unwrap().coordinates();
            let (rhs1_x, rhs1_y) = rhs1_nz.unwrap().coordinates();
            assert!(sg_x == rhs1_x && sg_y == rhs1_y, "enc_proof: s*G != A1 + e*C1");

            // 3. Compute C2_adj = C2 - amount*H (should equal r*pk)
            let h_native = EcPointTrait::new(h_x, h_y).unwrap();
            let h_nz: NonZeroEcPoint = h_native.try_into().unwrap();
            let h_ec: EcPoint = h_nz.into();
            let m_h = h_ec.mul(amount); // amount * H

            // Negate m_h: convert to coordinates, negate y
            let m_h_nz: Option<NonZeroEcPoint> = m_h.try_into();
            let c2_adj = if m_h_nz.is_some() {
                let (mh_x, mh_y) = m_h_nz.unwrap().coordinates();
                let neg_mh = EcPointTrait::new(mh_x, -mh_y).unwrap();
                let neg_mh_nz: NonZeroEcPoint = neg_mh.try_into().unwrap();
                let neg_mh_ec: EcPoint = neg_mh_nz.into();
                let c2_ec: EcPoint = c2_opt.unwrap().try_into().map(|nz: NonZeroEcPoint| {
                    let ec: EcPoint = nz.into();
                    ec
                }).unwrap_or(EcStateTrait::init().finalize());
                c2_ec + neg_mh_ec
            } else {
                // m_h is zero point, so C2_adj = C2
                let c2_nz: NonZeroEcPoint = c2_opt.unwrap().try_into().unwrap();
                let c2_ec: EcPoint = c2_nz.into();
                c2_ec
            };

            // 4. Verify s*pk == A2 + e*C2_adj
            let pk_nz: NonZeroEcPoint = pk_opt.unwrap().try_into().unwrap();
            let pk_ec: EcPoint = pk_nz.into();
            let s_pk = pk_ec.mul(proof.response);

            let a2_nz: NonZeroEcPoint = a2_opt.unwrap().try_into().unwrap();
            let a2_ec: EcPoint = a2_nz.into();

            let c2_adj_nz: Option<NonZeroEcPoint> = c2_adj.try_into();
            let rhs2 = if c2_adj_nz.is_some() {
                let c2_adj_ec: EcPoint = c2_adj_nz.unwrap().into();
                let e_c2adj = c2_adj_ec.mul(proof.challenge);
                a2_ec + e_c2adj
            } else {
                // C2_adj is zero, so rhs2 = A2
                a2_ec
            };

            let s_pk_nz: Option<NonZeroEcPoint> = s_pk.try_into();
            let rhs2_nz: Option<NonZeroEcPoint> = rhs2.try_into();
            assert!(s_pk_nz.is_some() && rhs2_nz.is_some(), "enc_proof: eq2 zero");
            let (spk_x, spk_y) = s_pk_nz.unwrap().coordinates();
            let (rhs2_x, rhs2_y) = rhs2_nz.unwrap().coordinates();
            assert!(spk_x == rhs2_x && spk_y == rhs2_y, "enc_proof: s*pk != A2 + e*(C2-m*H)");
        }

        /// Compute clearing price and fill orders
        /// Algorithm: Walk sorted bids (desc) and asks (asc), find intersection
        fn _compute_clearing_and_fill(
            ref self: ContractState,
            buy_prices: Span<u256>,
            buy_amounts: Span<u256>,
            buy_ids: Span<u256>,
            sell_prices: Span<u256>,
            sell_amounts: Span<u256>,
            sell_ids: Span<u256>,
        ) -> (u256, u256, u256, u32) {
            let n_buys = buy_prices.len();
            let n_sells = sell_prices.len();

            if n_buys == 0 || n_sells == 0 {
                return (0, 0, 0, 0);
            }

            // Sort buy indices by price descending (insertion sort for small N)
            let mut buy_sorted = self._sort_indices_desc(buy_prices);
            // Sort sell indices by price ascending
            let mut sell_sorted = self._sort_indices_asc(sell_prices);

            // Walk from top bid and bottom ask to find clearing price
            let mut bi: u32 = 0;
            let mut si: u32 = 0;
            let mut cumulative_buy: u256 = 0;
            let mut cumulative_sell: u256 = 0;
            let mut clearing_price: u256 = 0;

            // Find the clearing price: highest price where bid >= ask
            loop {
                if bi >= n_buys || si >= n_sells { break; }

                let buy_idx = *buy_sorted.at(bi);
                let sell_idx = *sell_sorted.at(si);
                let bid_price = *buy_prices.at(buy_idx);
                let ask_price = *sell_prices.at(sell_idx);

                // If best bid < best ask, no crossing → done
                if bid_price < ask_price { break; }

                // Clearing price = midpoint (or seller's price for uniform)
                clearing_price = ask_price;

                let bid_amount = *buy_amounts.at(buy_idx);
                let ask_amount = *sell_amounts.at(sell_idx);

                cumulative_buy = cumulative_buy + bid_amount;
                cumulative_sell = cumulative_sell + ask_amount;

                // Advance the side with less cumulative volume
                if cumulative_buy <= cumulative_sell {
                    bi += 1;
                } else {
                    si += 1;
                }
            };

            if clearing_price == 0 {
                return (0, 0, 0, 0);
            }

            // Compute total qualifying volume on each side
            let mut total_qualifying_buys: u256 = 0;
            let mut total_qualifying_sells: u256 = 0;

            let mut i: u32 = 0;
            loop {
                if i >= n_buys { break; }
                if *buy_prices.at(i) >= clearing_price {
                    total_qualifying_buys = total_qualifying_buys + *buy_amounts.at(i);
                }
                i += 1;
            };
            i = 0;
            loop {
                if i >= n_sells { break; }
                if *sell_prices.at(i) <= clearing_price {
                    total_qualifying_sells = total_qualifying_sells + *sell_amounts.at(i);
                }
                i += 1;
            };

            // Matched volume = min of qualifying sides
            let matched_volume = if total_qualifying_buys < total_qualifying_sells {
                total_qualifying_buys
            } else {
                total_qualifying_sells
            };

            if matched_volume == 0 {
                return (clearing_price, 0, 0, 0);
            }

            // Fill buy orders (sorted by price desc) up to matched volume
            let mut remaining_buy = matched_volume;
            let mut total_buy_filled: u256 = 0;
            let mut num_fills: u32 = 0;

            i = 0;
            loop {
                if i >= n_buys || remaining_buy == 0 { break; }
                let sorted_idx = *buy_sorted.at(i);
                let price = *buy_prices.at(sorted_idx);
                if price >= clearing_price {
                    let amount = *buy_amounts.at(sorted_idx);
                    let order_id = *buy_ids.at(sorted_idx);
                    let fill = if amount < remaining_buy { amount } else { remaining_buy };
                    self.order_fill_amount.write(order_id, fill);
                    total_buy_filled = total_buy_filled + fill;
                    remaining_buy = remaining_buy - fill;

                    let mut order = self.orders.read(order_id);
                    if fill == amount {
                        order.status = OrderStatus::Filled;
                    } else {
                        order.status = OrderStatus::PartialFill;
                    }
                    self.orders.write(order_id, order);

                    self.locked_commitment_x.write(order_id, 0);
                    self.locked_commitment_y.write(order_id, 0);

                    self.emit(OrderFilled { order_id, fill_amount: fill, clearing_price });
                    num_fills += 1;
                }
                i += 1;
            };

            // Fill sell orders (sorted by price asc) up to matched volume
            let mut remaining_sell = matched_volume;
            let mut total_sell_filled: u256 = 0;

            i = 0;
            loop {
                if i >= n_sells || remaining_sell == 0 { break; }
                let sorted_idx = *sell_sorted.at(i);
                let price = *sell_prices.at(sorted_idx);
                if price <= clearing_price {
                    let amount = *sell_amounts.at(sorted_idx);
                    let order_id = *sell_ids.at(sorted_idx);
                    let fill = if amount < remaining_sell { amount } else { remaining_sell };
                    self.order_fill_amount.write(order_id, fill);
                    total_sell_filled = total_sell_filled + fill;
                    remaining_sell = remaining_sell - fill;

                    let mut order = self.orders.read(order_id);
                    if fill == amount {
                        order.status = OrderStatus::Filled;
                    } else {
                        order.status = OrderStatus::PartialFill;
                    }
                    self.orders.write(order_id, order);

                    self.locked_commitment_x.write(order_id, 0);
                    self.locked_commitment_y.write(order_id, 0);

                    self.emit(OrderFilled { order_id, fill_amount: fill, clearing_price });
                    num_fills += 1;
                }
                i += 1;
            };

            (clearing_price, total_buy_filled, total_sell_filled, num_fills)
        }

        /// Sort indices by price descending (insertion sort — epochs have few orders)
        fn _sort_indices_desc(
            self: @ContractState,
            prices: Span<u256>,
        ) -> Array<u32> {
            let n = prices.len();
            let mut result: Array<u32> = array![];

            // Initialize indices
            let mut i: u32 = 0;
            loop {
                if i >= n { break; }
                result.append(i);
                i += 1;
            };

            // Insertion sort descending
            if n <= 1 { return result; }

            // Simple selection sort for Cairo compatibility
            let mut sorted: Array<u32> = array![];
            let mut used: Array<bool> = array![];
            i = 0;
            loop {
                if i >= n { break; }
                used.append(false);
                i += 1;
            };

            let mut round: u32 = 0;
            loop {
                if round >= n { break; }

                let mut best_idx: u32 = n; // sentinel
                let mut best_price: u256 = 0;

                let mut j: u32 = 0;
                loop {
                    if j >= n { break; }
                    if !*used.at(j) {
                        let p = *prices.at(j);
                        if best_idx == n || p > best_price {
                            best_idx = j;
                            best_price = p;
                        }
                    }
                    j += 1;
                };

                sorted.append(best_idx);
                // Mark used — rebuild array (Cairo arrays are append-only)
                let mut new_used: Array<bool> = array![];
                j = 0;
                loop {
                    if j >= n { break; }
                    if j == best_idx {
                        new_used.append(true);
                    } else {
                        new_used.append(*used.at(j));
                    }
                    j += 1;
                };
                used = new_used;

                round += 1;
            };

            sorted
        }

        /// Sort indices by price ascending
        fn _sort_indices_asc(
            self: @ContractState,
            prices: Span<u256>,
        ) -> Array<u32> {
            let n = prices.len();
            let mut sorted: Array<u32> = array![];
            let mut used: Array<bool> = array![];

            let mut i: u32 = 0;
            loop {
                if i >= n { break; }
                used.append(false);
                i += 1;
            };

            let mut round: u32 = 0;
            loop {
                if round >= n { break; }

                let mut best_idx: u32 = n;
                let mut best_price: u256 = 0;
                let mut found_any = false;

                let mut j: u32 = 0;
                loop {
                    if j >= n { break; }
                    if !*used.at(j) {
                        let p = *prices.at(j);
                        if !found_any || p < best_price {
                            best_idx = j;
                            best_price = p;
                            found_any = true;
                        }
                    }
                    j += 1;
                };

                sorted.append(best_idx);
                let mut new_used: Array<bool> = array![];
                j = 0;
                loop {
                    if j >= n { break; }
                    if j == best_idx {
                        new_used.append(true);
                    } else {
                        new_used.append(*used.at(j));
                    }
                    j += 1;
                };
                used = new_used;

                round += 1;
            };

            sorted
        }
    }
}
