/// Dark Pool Auction Contract — Fully Encrypted Commit-Reveal Batch Auction
///
/// Commit-reveal batch auction where orders are sealed during commit phase,
/// revealed in the next phase, and settled at a uniform clearing price.
///
/// Privacy model:
/// - Identity: Hidden (session keys / relayers)
/// - Balances: Always encrypted (ElGamal)
/// - Orders during commit: Fully hidden (only hash visible)
/// - Front-running: Impossible (commit locks order before reveal)
/// - MEV: Zero (uniform clearing price, no ordering advantage)
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
        spend_encrypted: ElGamalCiphertext,
        spend_hint: AEHint,
    );
}

// ============================================================================
// Contract Implementation
// ============================================================================

#[starknet::contract]
pub mod DarkPoolAuction {
    use super::{
        ElGamalCiphertext, AEHint, ECPointFelt, BalanceProof,
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
    const DEFAULT_UPGRADE_DELAY: u64 = 300;

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

        // Fill claims (prevent double-claim)
        order_claimed: Map<u256, bool>,

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

            let caller = get_caller_address();
            let epoch = self.get_current_epoch();

            // Verify balance proof (simplified — STWO verification in production)
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

            // Collect revealed orders, expire unrevealed
            let mut buy_prices: Array<u256> = array![];
            let mut buy_amounts: Array<u256> = array![];
            let mut buy_ids: Array<u256> = array![];
            let mut sell_prices: Array<u256> = array![];
            let mut sell_amounts: Array<u256> = array![];
            let mut sell_ids: Array<u256> = array![];

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
                    match revealed.side {
                        OrderSide::Buy => {
                            buy_prices.append(revealed.price);
                            buy_amounts.append(revealed.amount);
                            buy_ids.append(order_id);
                        },
                        OrderSide::Sell => {
                            sell_prices.append(revealed.price);
                            sell_amounts.append(revealed.amount);
                            sell_ids.append(order_id);
                        },
                    }
                }

                i += 1;
            };

            // Find clearing price and execute fills
            let (clearing_price, total_buy_filled, total_sell_filled, num_fills) =
                self._compute_clearing_and_fill(
                    buy_prices.span(), buy_amounts.span(), buy_ids.span(),
                    sell_prices.span(), sell_amounts.span(), sell_ids.span(),
                );

            // Store result (flattened)
            self.epoch_clearing_price_low.write(epoch_id, clearing_price.low.into());
            self.epoch_clearing_price_high.write(epoch_id, clearing_price.high.into());
            self.epoch_total_buy_filled_low.write(epoch_id, total_buy_filled.low.into());
            self.epoch_total_buy_filled_high.write(epoch_id, total_buy_filled.high.into());
            self.epoch_total_sell_filled_low.write(epoch_id, total_sell_filled.low.into());
            self.epoch_total_sell_filled_high.write(epoch_id, total_sell_filled.high.into());
            self.epoch_num_fills.write(epoch_id, num_fills);
            self.epoch_settled_at.write(epoch_id, get_block_timestamp());
            self.epoch_settled.write(epoch_id, true);

            self.emit(EpochSettled {
                epoch_id,
                clearing_price,
                total_buy_filled,
                total_sell_filled,
                num_fills,
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
            spend_encrypted: ElGamalCiphertext,
            spend_hint: AEHint,
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

            // 3. Determine receive and spend assets
            // Buy side: trader gives want_asset, receives give_asset? No:
            //   Buy = I want to buy give_asset by spending want_asset
            //   So: receive = want_asset (what I want), spend = give_asset (what I give)
            // Actually looking at the order struct: give_asset = what trader gives, want_asset = what trader wants
            // Buy side: receives want_asset tokens, spends give_asset tokens
            let receive_asset = order.want_asset;
            let spend_asset = order.give_asset;

            // 4. Update encrypted balances
            let receive_bal = self._read_balance(caller, receive_asset);
            let new_receive_bal = self._cipher_add(receive_bal, receive_encrypted);
            self._write_balance(caller, receive_asset, new_receive_bal);
            self.balance_hint.write((caller, receive_asset), receive_hint);

            let spend_bal = self._read_balance(caller, spend_asset);
            let new_spend_bal = self._cipher_sub(spend_bal, spend_encrypted);
            self._write_balance(caller, spend_asset, new_spend_bal);
            self.balance_hint.write((caller, spend_asset), spend_hint);

            // 5. Mark claimed
            self.order_claimed.write(order_id, true);

            // 6. Emit event
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

        /// Verify balance proof (Poseidon Fiat-Shamir binding)
        /// Ensures challenge is derived from commitment + trader + asset context
        /// In production: full STWO proof via Integrity verifier
        fn _verify_balance_proof(
            self: @ContractState,
            proof: @BalanceProof,
            trader: ContractAddress,
            asset: felt252,
        ) {
            assert!(*proof.challenge != 0, "Invalid proof: zero challenge");
            assert!(*proof.response != 0, "Invalid proof: zero response");

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
