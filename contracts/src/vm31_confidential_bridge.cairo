// ============================================================================
// VM31 <-> Confidential Transfer Bridge
// ============================================================================
//
// This adapter allows finalized VM31 withdrawals (paid to this bridge address)
// to be re-credited into ConfidentialTransfer encrypted balances.
//
// Security model (v2): relayer-driven, idempotent processing.
// - Relayer can only bridge finalized VM31 batches.
// - Asset mapping is pinned by owner and cross-checked against both contracts.
// - Each bridge operation has a deterministic bridge_key and is single-use.

use starknet::ContractAddress;
use crate::confidential_transfer::AEHint;

// Minimal VM31 pool interface required by this bridge.
#[starknet::interface]
pub trait IVM31PoolBridge<TContractState> {
    fn get_batch_status(self: @TContractState, batch_id: felt252) -> u8;
    fn get_asset_token(self: @TContractState, asset_id: felt252) -> ContractAddress;
    fn get_batch_withdrawal_binding_felt(
        self: @TContractState,
        batch_id: felt252,
        withdraw_idx: u32,
    ) -> felt252;
    fn compute_withdrawal_binding_felt(
        self: @TContractState,
        payout_recipient: ContractAddress,
        credit_recipient: ContractAddress,
        asset_id: felt252,
        amount_lo: u64,
        amount_hi: u64,
        withdraw_idx: u32,
    ) -> felt252;
}

// Minimal ConfidentialTransfer interface required by this bridge.
#[starknet::interface]
pub trait IConfidentialTransferBridge<TContractState> {
    fn get_asset(self: @TContractState, asset_id: felt252) -> ContractAddress;
    fn fund_for(
        ref self: TContractState,
        account: ContractAddress,
        asset_id: felt252,
        amount: u256,
        encryption_randomness: felt252,
        ae_hint: AEHint,
    );
}

// Minimal ERC20 interface required by this bridge.
#[starknet::interface]
pub trait IERC20<TContractState> {
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
}

#[starknet::interface]
pub trait IVM31ConfidentialBridge<TContractState> {
    // Bridge one finalized VM31 withdrawal into a confidential balance.
    fn bridge_withdrawal_to_confidential(
        ref self: TContractState,
        batch_id: felt252,
        withdrawal_idx: u32,
        payout_recipient: ContractAddress,
        credit_recipient: ContractAddress,
        token: ContractAddress,
        amount: u256,
        encryption_randomness: felt252,
        ae_hint: AEHint,
    ) -> felt252;

    // Admin
    fn set_relayer(ref self: TContractState, relayer: ContractAddress);
    fn set_vm31_pool(ref self: TContractState, vm31_pool: ContractAddress);
    fn set_confidential_transfer(ref self: TContractState, confidential_transfer: ContractAddress);
    fn register_asset_pair(
        ref self: TContractState,
        token: ContractAddress,
        vm31_asset_id: felt252,
        confidential_asset_id: felt252,
    );
    fn pause(ref self: TContractState);
    fn unpause(ref self: TContractState);

    // Upgradability (5-min timelock)
    fn schedule_upgrade(ref self: TContractState, new_class_hash: starknet::ClassHash);
    fn execute_upgrade(ref self: TContractState);
    fn cancel_upgrade(ref self: TContractState);
    fn get_pending_upgrade(self: @TContractState) -> (starknet::ClassHash, u64);

    // Views
    fn get_relayer(self: @TContractState) -> ContractAddress;
    fn get_vm31_pool(self: @TContractState) -> ContractAddress;
    fn get_confidential_transfer(self: @TContractState) -> ContractAddress;
    fn get_asset_pair(self: @TContractState, token: ContractAddress) -> (felt252, felt252);
    fn compute_bridge_key(
        self: @TContractState,
        batch_id: felt252,
        withdrawal_idx: u32,
        payout_recipient: ContractAddress,
        credit_recipient: ContractAddress,
        token: ContractAddress,
        amount: u256,
    ) -> felt252;
    fn is_bridge_key_processed(self: @TContractState, bridge_key: felt252) -> bool;
}

#[starknet::contract]
pub mod VM31ConfidentialBridge {
    use super::{
        IVM31ConfidentialBridge,
        IVM31PoolBridgeDispatcher, IVM31PoolBridgeDispatcherTrait,
        IConfidentialTransferBridgeDispatcher, IConfidentialTransferBridgeDispatcherTrait,
        IERC20Dispatcher, IERC20DispatcherTrait,
        AEHint,
    };
    use starknet::{
        ContractAddress, ClassHash, get_caller_address, get_contract_address, get_block_timestamp,
        syscalls::replace_class_syscall, SyscallResultTrait,
    };
    use starknet::storage::{
        Map,
        StorageMapReadAccess, StorageMapWriteAccess,
        StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use core::poseidon::poseidon_hash_span;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::security::pausable::PausableComponent;

    // VM31Pool batch status constants.
    const BATCH_STATUS_FINALIZED: u8 = 2;

    // Upgrade delay: 5 minutes (300 seconds)
    const UPGRADE_DELAY: u64 = 300;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(path: PausableComponent, storage: pausable, event: PausableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl PausableImpl = PausableComponent::PausableImpl<ContractState>;
    impl PausableInternalImpl = PausableComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        relayer: ContractAddress,
        vm31_pool: ContractAddress,
        confidential_transfer: ContractAddress,

        // token -> internal asset ids in each system
        vm31_asset_for_token: Map<ContractAddress, felt252>,
        confidential_asset_for_token: Map<ContractAddress, felt252>,

        // idempotency key -> processed
        processed_bridge_key: Map<felt252, bool>,

        // Reentrancy guard around external calls
        reentrancy_locked: bool,

        // Timelocked upgrade
        pending_upgrade: ClassHash,
        upgrade_scheduled_at: u64,

        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        pausable: PausableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        BridgeExecuted: BridgeExecuted,
        RelayerUpdated: RelayerUpdated,
        VM31PoolUpdated: VM31PoolUpdated,
        ConfidentialTransferUpdated: ConfidentialTransferUpdated,
        AssetPairRegistered: AssetPairRegistered,
        UpgradeScheduled: UpgradeScheduled,
        UpgradeExecuted: UpgradeExecuted,
        UpgradeCancelled: UpgradeCancelled,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        PausableEvent: PausableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct UpgradeScheduled {
        pub new_class_hash: ClassHash,
        pub scheduled_at: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct UpgradeExecuted {
        pub new_class_hash: ClassHash,
        pub executed_at: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct UpgradeCancelled {
        pub cancelled_class_hash: ClassHash,
    }

    /// Opaque bridge event — emits only batch-level identifiers and timing.
    /// Recipient, token, and amount fields are intentionally omitted to prevent
    /// on-chain metadata leaking (privacy gap #2). The contract still validates
    /// all fields internally; only the event is redacted.
    #[derive(Drop, starknet::Event)]
    pub struct BridgeExecuted {
        #[key]
        pub bridge_key: felt252,
        /// Poseidon hash of the VM31 batch ID (opaque identifier)
        pub batch_id_hash: felt252,
        /// The withdrawal binding digest (already opaque)
        pub withdrawal_binding: felt252,
        /// Block timestamp for ordering only
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RelayerUpdated {
        pub old_relayer: ContractAddress,
        pub new_relayer: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct VM31PoolUpdated {
        pub old_vm31_pool: ContractAddress,
        pub new_vm31_pool: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ConfidentialTransferUpdated {
        pub old_confidential_transfer: ContractAddress,
        pub new_confidential_transfer: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AssetPairRegistered {
        pub token: ContractAddress,
        pub vm31_asset_id: felt252,
        pub confidential_asset_id: felt252,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        relayer: ContractAddress,
        vm31_pool: ContractAddress,
        confidential_transfer: ContractAddress,
    ) {
        self.ownable.initializer(owner);

        let relayer_felt: felt252 = relayer.into();
        let vm31_pool_felt: felt252 = vm31_pool.into();
        let confidential_felt: felt252 = confidential_transfer.into();
        assert(relayer_felt != 0, 'Invalid relayer');
        assert(vm31_pool_felt != 0, 'Invalid VM31 pool');
        assert(confidential_felt != 0, 'Invalid confidential transfer');

        self.relayer.write(relayer);
        self.vm31_pool.write(vm31_pool);
        self.confidential_transfer.write(confidential_transfer);
    }

    #[abi(embed_v0)]
    impl VM31ConfidentialBridgeImpl of IVM31ConfidentialBridge<ContractState> {
        fn bridge_withdrawal_to_confidential(
            ref self: ContractState,
            batch_id: felt252,
            withdrawal_idx: u32,
            payout_recipient: ContractAddress,
            credit_recipient: ContractAddress,
            token: ContractAddress,
            amount: u256,
            encryption_randomness: felt252,
            ae_hint: AEHint,
        ) -> felt252 {
            self.pausable.assert_not_paused();
            assert(!self.reentrancy_locked.read(), 'Reentrant call');
            assert(get_caller_address() == self.relayer.read(), 'Relayer only');

            let payout_recipient_felt: felt252 = payout_recipient.into();
            let credit_recipient_felt: felt252 = credit_recipient.into();
            let token_felt: felt252 = token.into();
            assert(payout_recipient_felt != 0, 'Invalid payout recipient');
            assert(credit_recipient_felt != 0, 'Invalid credit recipient');
            assert(token_felt != 0, 'Invalid token');
            assert(
                payout_recipient == get_contract_address(),
                'Payout recipient must be bridge',
            );

            let vm31_asset_id = self.vm31_asset_for_token.read(token);
            let confidential_asset_id = self.confidential_asset_for_token.read(token);
            assert(vm31_asset_id != 0, 'VM31 pair missing');
            assert(confidential_asset_id != 0, 'CT pair missing');

            let bridge_key = InternalImpl::compute_bridge_key_internal(
                batch_id,
                withdrawal_idx,
                payout_recipient,
                credit_recipient,
                token,
                amount,
                vm31_asset_id,
                confidential_asset_id,
            );
            assert(!self.processed_bridge_key.read(bridge_key), 'Already bridged');

            // Enforce finalized VM31 batch and pinned asset mapping.
            let vm31_dispatcher = IVM31PoolBridgeDispatcher {
                contract_address: self.vm31_pool.read(),
            };
            let batch_status = vm31_dispatcher.get_batch_status(batch_id);
            assert(batch_status == BATCH_STATUS_FINALIZED, 'VM31 batch not finalized');
            assert(
                vm31_dispatcher.get_asset_token(vm31_asset_id) == token,
                'VM31 asset/token mismatch'
            );
            // Enforce proof-bound withdrawal binding so payout/credit assignment is not relayer-controlled.
            assert(amount.high == 0, 'Amount too large');
            assert(amount.low <= 0xFFFFFFFFFFFFFFFF, 'Amount > u64');
            let amount_u64: u64 = amount.low.try_into().unwrap();
            let amount_lo: u64 = amount_u64 & 0x7FFFFFFF;
            let amount_hi: u64 = amount_u64 / 0x80000000;
            let bound_felt = vm31_dispatcher.get_batch_withdrawal_binding_felt(
                batch_id,
                withdrawal_idx,
            );
            let expected_binding = vm31_dispatcher.compute_withdrawal_binding_felt(
                payout_recipient,
                credit_recipient,
                vm31_asset_id,
                amount_lo,
                amount_hi,
                withdrawal_idx,
            );
            assert(bound_felt != 0, 'Missing withdraw bind');
            assert(bound_felt == expected_binding, 'Withdraw bind mismatch');

            let confidential_dispatcher = IConfidentialTransferBridgeDispatcher {
                contract_address: self.confidential_transfer.read(),
            };
            assert(
                confidential_dispatcher.get_asset(confidential_asset_id) == token,
                'CT asset mismatch'
            );

            // Move bridge-held token balance into credit recipient's confidential balance.
            // The bridge must already hold tokens from prior VM31 withdrawals.
            self.reentrancy_locked.write(true);
            let token_dispatcher = IERC20Dispatcher { contract_address: token };
            let zero_amount: u256 = 0.into();
            token_dispatcher.approve(self.confidential_transfer.read(), zero_amount);
            let approved = token_dispatcher.approve(self.confidential_transfer.read(), amount);
            assert(approved, 'ERC20 approve failed');

            confidential_dispatcher.fund_for(
                credit_recipient,
                confidential_asset_id,
                amount,
                encryption_randomness,
                ae_hint,
            );
            self.reentrancy_locked.write(false);

            self.processed_bridge_key.write(bridge_key, true);

            // Emit opaque event — no recipient, token, or amount leaked on-chain.
            // Only the batch-level hash, withdrawal binding, and timestamp are visible.
            self.emit(BridgeExecuted {
                bridge_key,
                batch_id_hash: poseidon_hash_span(array![batch_id].span()),
                withdrawal_binding: bound_felt,
                timestamp: get_block_timestamp(),
            });

            bridge_key
        }

        fn set_relayer(ref self: ContractState, relayer: ContractAddress) {
            self.ownable.assert_only_owner();
            let relayer_felt: felt252 = relayer.into();
            assert(relayer_felt != 0, 'Invalid relayer');
            let old_relayer = self.relayer.read();
            self.relayer.write(relayer);
            self.emit(RelayerUpdated { old_relayer, new_relayer: relayer });
        }

        fn set_vm31_pool(ref self: ContractState, vm31_pool: ContractAddress) {
            self.ownable.assert_only_owner();
            let vm31_pool_felt: felt252 = vm31_pool.into();
            assert(vm31_pool_felt != 0, 'Invalid VM31 pool');
            let old_vm31_pool = self.vm31_pool.read();
            self.vm31_pool.write(vm31_pool);
            self.emit(VM31PoolUpdated { old_vm31_pool, new_vm31_pool: vm31_pool });
        }

        fn set_confidential_transfer(ref self: ContractState, confidential_transfer: ContractAddress) {
            self.ownable.assert_only_owner();
            let confidential_felt: felt252 = confidential_transfer.into();
            assert(confidential_felt != 0, 'Invalid confidential transfer');
            let old_confidential_transfer = self.confidential_transfer.read();
            self.confidential_transfer.write(confidential_transfer);
            self.emit(ConfidentialTransferUpdated {
                old_confidential_transfer,
                new_confidential_transfer: confidential_transfer,
            });
        }

        fn register_asset_pair(
            ref self: ContractState,
            token: ContractAddress,
            vm31_asset_id: felt252,
            confidential_asset_id: felt252,
        ) {
            self.ownable.assert_only_owner();

            let token_felt: felt252 = token.into();
            assert(token_felt != 0, 'Invalid token');
            assert(vm31_asset_id != 0, 'Invalid VM31 asset id');
            assert(confidential_asset_id != 0, 'Invalid confidential asset id');

            let vm31_dispatcher = IVM31PoolBridgeDispatcher {
                contract_address: self.vm31_pool.read(),
            };
            assert(
                vm31_dispatcher.get_asset_token(vm31_asset_id) == token,
                'VM31 asset/token mismatch'
            );

            let confidential_dispatcher = IConfidentialTransferBridgeDispatcher {
                contract_address: self.confidential_transfer.read(),
            };
            assert(
                confidential_dispatcher.get_asset(confidential_asset_id) == token,
                'CT asset mismatch'
            );

            self.vm31_asset_for_token.write(token, vm31_asset_id);
            self.confidential_asset_for_token.write(token, confidential_asset_id);

            self.emit(AssetPairRegistered {
                token,
                vm31_asset_id,
                confidential_asset_id,
            });
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
            let existing: felt252 = self.pending_upgrade.read().into();
            assert(existing == 0, 'Upgrade already pending');
            let now = get_block_timestamp();
            self.pending_upgrade.write(new_class_hash);
            self.upgrade_scheduled_at.write(now);
            self.emit(UpgradeScheduled { new_class_hash, scheduled_at: now });
        }

        fn execute_upgrade(ref self: ContractState) {
            self.ownable.assert_only_owner();
            let class_hash = self.pending_upgrade.read();
            let class_hash_felt: felt252 = class_hash.into();
            assert(class_hash_felt != 0, 'No upgrade scheduled');
            let scheduled = self.upgrade_scheduled_at.read();
            let now = get_block_timestamp();
            assert(now >= scheduled + UPGRADE_DELAY, 'Upgrade delay not elapsed');

            self.pending_upgrade.write(core::num::traits::Zero::zero());
            self.upgrade_scheduled_at.write(0);

            self.emit(UpgradeExecuted { new_class_hash: class_hash, executed_at: now });
            replace_class_syscall(class_hash).unwrap_syscall();
        }

        fn cancel_upgrade(ref self: ContractState) {
            self.ownable.assert_only_owner();
            let class_hash = self.pending_upgrade.read();
            let class_hash_felt: felt252 = class_hash.into();
            assert(class_hash_felt != 0, 'No upgrade pending');

            self.pending_upgrade.write(core::num::traits::Zero::zero());
            self.upgrade_scheduled_at.write(0);
            self.emit(UpgradeCancelled { cancelled_class_hash: class_hash });
        }

        fn get_pending_upgrade(self: @ContractState) -> (ClassHash, u64) {
            (self.pending_upgrade.read(), self.upgrade_scheduled_at.read())
        }

        fn get_relayer(self: @ContractState) -> ContractAddress {
            self.relayer.read()
        }

        fn get_vm31_pool(self: @ContractState) -> ContractAddress {
            self.vm31_pool.read()
        }

        fn get_confidential_transfer(self: @ContractState) -> ContractAddress {
            self.confidential_transfer.read()
        }

        fn get_asset_pair(self: @ContractState, token: ContractAddress) -> (felt252, felt252) {
            (
                self.vm31_asset_for_token.read(token),
                self.confidential_asset_for_token.read(token),
            )
        }

        fn compute_bridge_key(
            self: @ContractState,
            batch_id: felt252,
            withdrawal_idx: u32,
            payout_recipient: ContractAddress,
            credit_recipient: ContractAddress,
            token: ContractAddress,
            amount: u256,
        ) -> felt252 {
            let vm31_asset_id = self.vm31_asset_for_token.read(token);
            let confidential_asset_id = self.confidential_asset_for_token.read(token);
            InternalImpl::compute_bridge_key_internal(
                batch_id,
                withdrawal_idx,
                payout_recipient,
                credit_recipient,
                token,
                amount,
                vm31_asset_id,
                confidential_asset_id,
            )
        }

        fn is_bridge_key_processed(self: @ContractState, bridge_key: felt252) -> bool {
            self.processed_bridge_key.read(bridge_key)
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn compute_bridge_key_internal(
            batch_id: felt252,
            withdrawal_idx: u32,
            payout_recipient: ContractAddress,
            credit_recipient: ContractAddress,
            token: ContractAddress,
            amount: u256,
            vm31_asset_id: felt252,
            confidential_asset_id: felt252,
        ) -> felt252 {
            poseidon_hash_span(
                array![
                    batch_id,
                    withdrawal_idx.into(),
                    payout_recipient.into(),
                    credit_recipient.into(),
                    token.into(),
                    vm31_asset_id,
                    confidential_asset_id,
                    amount.low.into(),
                    amount.high.into(),
                ]
                .span(),
            )
        }
    }
}
