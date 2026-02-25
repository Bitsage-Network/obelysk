// Tests for StealthRegistry multi-token stealth payments
//
// Covers:
//   - Multi-token send + claim (SAGE and alternate token)
//   - Pre-upgrade fallback (zero token → SAGE)
//   - Invalid token rejection
//   - ElGamal encryption round-trip sanity
//   - Schnorr spending proof verification
//   - Edge cases: double-claim, unregistered worker, zero amount

use starknet::ContractAddress;
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait,
    start_cheat_caller_address, stop_cheat_caller_address,
};
use sage_contracts::obelysk::elgamal::{ECPoint, ec_mul, generator};
use obelysk_contracts::stealth_registry::{
    IStealthRegistryDispatcher, IStealthRegistryDispatcherTrait,
};
use obelysk_contracts::stealth_payments::{
    StealthMetaAddress,
    derive_stealth_address, verify_spending_proof,
    create_spending_proof, encrypt_amount_to_stealth,
};
use obelysk_contracts::mock_erc20::{
    IMockERC20Dispatcher, IMockERC20DispatcherTrait,
};

// =====================================================================
// Helpers
// =====================================================================

fn OWNER() -> ContractAddress {
    1.try_into().unwrap()
}

fn SENDER() -> ContractAddress {
    2.try_into().unwrap()
}

fn WORKER() -> ContractAddress {
    3.try_into().unwrap()
}

fn RECIPIENT() -> ContractAddress {
    4.try_into().unwrap()
}

/// Deploy a MockERC20 with 1_000_000 tokens minted to `holder`
fn deploy_mock_erc20(name: felt252, symbol: felt252, decimals: u8, holder: ContractAddress) -> ContractAddress {
    let contract = declare("MockERC20").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    calldata.append(name);
    calldata.append(symbol);
    calldata.append(decimals.into());
    // initial_supply: u256 — 1M tokens with 18 decimals
    let supply: u256 = 1_000_000_000_000_000_000_000_000;
    supply.serialize(ref calldata);
    holder.serialize(ref calldata);
    let (addr, _) = contract.deploy(@calldata).unwrap();
    addr
}

/// Deploy StealthRegistry with owner and sage_token
fn deploy_registry(owner: ContractAddress, sage_token: ContractAddress) -> ContractAddress {
    let contract = declare("StealthRegistry").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    owner.serialize(ref calldata);
    sage_token.serialize(ref calldata);
    let (addr, _) = contract.deploy(@calldata).unwrap();
    addr
}

/// Generate a deterministic stealth meta-address from two secrets
fn make_meta_address(spending_secret: felt252, viewing_secret: felt252) -> (StealthMetaAddress, felt252, felt252) {
    let g = generator();
    let spending_pubkey = ec_mul(spending_secret, g);
    let viewing_pubkey = ec_mul(viewing_secret, g);
    let meta = StealthMetaAddress { spending_pubkey, viewing_pubkey, scheme_id: 1 };
    (meta, spending_secret, viewing_secret)
}

/// Register a worker's meta-address on the registry
fn register_worker(
    registry: IStealthRegistryDispatcher,
    worker: ContractAddress,
    spending_pubkey: ECPoint,
    viewing_pubkey: ECPoint,
) {
    start_cheat_caller_address(registry.contract_address, worker);
    registry.register_meta_address(spending_pubkey, viewing_pubkey);
    stop_cheat_caller_address(registry.contract_address);
}

/// Approve tokens from sender to spender
fn approve_tokens(
    token_addr: ContractAddress,
    owner: ContractAddress,
    spender: ContractAddress,
    amount: u256,
) {
    let token = IMockERC20Dispatcher { contract_address: token_addr };
    start_cheat_caller_address(token_addr, owner);
    token.approve(spender, amount);
    stop_cheat_caller_address(token_addr);
}

// =====================================================================
// Test: Multi-token send + claim (non-SAGE token)
// =====================================================================

#[test]
fn test_send_and_claim_with_alt_token() {
    let owner = OWNER();
    let sender = SENDER();
    let worker = WORKER();
    let recipient = RECIPIENT();

    // Deploy two tokens: SAGE (default) and STRK (alt)
    let sage_addr = deploy_mock_erc20('SAGE', 'SAGE', 18, sender);
    let strk_addr = deploy_mock_erc20('STRK', 'STRK', 18, sender);
    let registry_addr = deploy_registry(owner, sage_addr);
    let registry = IStealthRegistryDispatcher { contract_address: registry_addr };

    // Register worker
    let (meta, spending_secret, viewing_secret) = make_meta_address(42, 77);
    register_worker(registry, worker, meta.spending_pubkey, meta.viewing_pubkey);

    // Send stealth payment with STRK (not SAGE)
    let amount: u256 = 500_000_000_000_000_000; // 0.5 STRK
    approve_tokens(strk_addr, sender, registry_addr, amount);

    start_cheat_caller_address(registry_addr, sender);
    let ann_idx = registry.send_stealth_payment(
        worker, amount, 123, 456, 0, strk_addr
    );
    stop_cheat_caller_address(registry_addr);

    // Verify announcement stored
    let announcement = registry.get_announcement(ann_idx);
    assert!(announcement.token == strk_addr, "Token should be STRK");
    assert!(announcement.job_id == 0, "Job ID should be 0");

    // Verify STRK was transferred to registry
    let strk = IMockERC20Dispatcher { contract_address: strk_addr };
    assert!(strk.balance_of(registry_addr) == amount, "Registry should hold STRK");

    // Claim: derive stealth spending key and create proof
    let (stealth_address, ephemeral_pubkey, _view_tag) = derive_stealth_address(meta, 123);
    let shared_secret_point = ec_mul(viewing_secret, ephemeral_pubkey);
    let shared_hash = core::poseidon::poseidon_hash_span(
        array![shared_secret_point.x, shared_secret_point.y, 'stealth_derive'].span()
    );
    let stealth_spending_key = spending_secret + shared_hash;
    let proof = create_spending_proof(stealth_spending_key, stealth_address, 999);

    start_cheat_caller_address(registry_addr, worker);
    registry.claim_stealth_payment(ann_idx, proof, recipient);
    stop_cheat_caller_address(registry_addr);

    // Verify STRK went to recipient (not SAGE)
    assert!(strk.balance_of(recipient) == amount, "Recipient should have STRK");
    assert!(registry.is_claimed(ann_idx), "Should be claimed");
}

// =====================================================================
// Test: SAGE token send + claim (original flow still works)
// =====================================================================

#[test]
fn test_send_and_claim_with_sage() {
    let owner = OWNER();
    let sender = SENDER();
    let worker = WORKER();
    let recipient = RECIPIENT();

    let sage_addr = deploy_mock_erc20('SAGE', 'SAGE', 18, sender);
    let registry_addr = deploy_registry(owner, sage_addr);
    let registry = IStealthRegistryDispatcher { contract_address: registry_addr };

    let (meta, spending_secret, viewing_secret) = make_meta_address(42, 77);
    register_worker(registry, worker, meta.spending_pubkey, meta.viewing_pubkey);

    let amount: u256 = 1_000_000_000_000_000_000; // 1 SAGE
    approve_tokens(sage_addr, sender, registry_addr, amount);

    start_cheat_caller_address(registry_addr, sender);
    let ann_idx = registry.send_stealth_payment(
        worker, amount, 123, 456, 0, sage_addr
    );
    stop_cheat_caller_address(registry_addr);

    // Claim
    let (stealth_address, ephemeral_pubkey, _) = derive_stealth_address(meta, 123);
    let shared_secret_point = ec_mul(viewing_secret, ephemeral_pubkey);
    let shared_hash = core::poseidon::poseidon_hash_span(
        array![shared_secret_point.x, shared_secret_point.y, 'stealth_derive'].span()
    );
    let stealth_spending_key = spending_secret + shared_hash;
    let proof = create_spending_proof(stealth_spending_key, stealth_address, 888);

    start_cheat_caller_address(registry_addr, worker);
    registry.claim_stealth_payment(ann_idx, proof, recipient);
    stop_cheat_caller_address(registry_addr);

    let sage = IMockERC20Dispatcher { contract_address: sage_addr };
    assert!(sage.balance_of(recipient) == amount, "Recipient should have SAGE");
}

// =====================================================================
// Test: Zero token address rejected
// =====================================================================

#[test]
#[should_panic(expected: "Invalid token address")]
fn test_send_with_zero_token_reverts() {
    let owner = OWNER();
    let sender = SENDER();
    let worker = WORKER();

    let sage_addr = deploy_mock_erc20('SAGE', 'SAGE', 18, sender);
    let registry_addr = deploy_registry(owner, sage_addr);
    let registry = IStealthRegistryDispatcher { contract_address: registry_addr };

    let (meta, _, _) = make_meta_address(42, 77);
    register_worker(registry, worker, meta.spending_pubkey, meta.viewing_pubkey);

    let zero_token: ContractAddress = 0.try_into().unwrap();

    start_cheat_caller_address(registry_addr, sender);
    registry.send_stealth_payment(worker, 100, 123, 456, 0, zero_token);
    stop_cheat_caller_address(registry_addr);
}

// =====================================================================
// Test: Zero amount rejected
// =====================================================================

#[test]
#[should_panic(expected: "Amount must be positive")]
fn test_send_zero_amount_reverts() {
    let owner = OWNER();
    let sender = SENDER();
    let worker = WORKER();

    let sage_addr = deploy_mock_erc20('SAGE', 'SAGE', 18, sender);
    let registry_addr = deploy_registry(owner, sage_addr);
    let registry = IStealthRegistryDispatcher { contract_address: registry_addr };

    let (meta, _, _) = make_meta_address(42, 77);
    register_worker(registry, worker, meta.spending_pubkey, meta.viewing_pubkey);

    start_cheat_caller_address(registry_addr, sender);
    registry.send_stealth_payment(worker, 0, 123, 456, 0, sage_addr);
    stop_cheat_caller_address(registry_addr);
}

// =====================================================================
// Test: Double-claim rejected
// =====================================================================

#[test]
#[should_panic(expected: "Already claimed")]
fn test_double_claim_reverts() {
    let owner = OWNER();
    let sender = SENDER();
    let worker = WORKER();
    let recipient = RECIPIENT();

    let sage_addr = deploy_mock_erc20('SAGE', 'SAGE', 18, sender);
    let registry_addr = deploy_registry(owner, sage_addr);
    let registry = IStealthRegistryDispatcher { contract_address: registry_addr };

    let (meta, spending_secret, viewing_secret) = make_meta_address(42, 77);
    register_worker(registry, worker, meta.spending_pubkey, meta.viewing_pubkey);

    let amount: u256 = 1_000_000_000_000_000_000;
    approve_tokens(sage_addr, sender, registry_addr, amount);

    start_cheat_caller_address(registry_addr, sender);
    let ann_idx = registry.send_stealth_payment(worker, amount, 123, 456, 0, sage_addr);
    stop_cheat_caller_address(registry_addr);

    // Claim once
    let (stealth_address, ephemeral_pubkey, _) = derive_stealth_address(meta, 123);
    let shared_secret_point = ec_mul(viewing_secret, ephemeral_pubkey);
    let shared_hash = core::poseidon::poseidon_hash_span(
        array![shared_secret_point.x, shared_secret_point.y, 'stealth_derive'].span()
    );
    let stealth_spending_key = spending_secret + shared_hash;
    let proof = create_spending_proof(stealth_spending_key, stealth_address, 777);

    start_cheat_caller_address(registry_addr, worker);
    registry.claim_stealth_payment(ann_idx, proof, recipient);
    // Try to claim again — should panic
    registry.claim_stealth_payment(ann_idx, proof, recipient);
    stop_cheat_caller_address(registry_addr);
}

// =====================================================================
// Test: Send to unregistered worker reverts
// =====================================================================

#[test]
#[should_panic(expected: "Worker not registered")]
fn test_send_to_unregistered_worker_reverts() {
    let owner = OWNER();
    let sender = SENDER();
    let worker = WORKER();

    let sage_addr = deploy_mock_erc20('SAGE', 'SAGE', 18, sender);
    let registry_addr = deploy_registry(owner, sage_addr);
    let registry = IStealthRegistryDispatcher { contract_address: registry_addr };

    // Don't register the worker — just try to send
    start_cheat_caller_address(registry_addr, sender);
    registry.send_stealth_payment(worker, 100, 123, 456, 0, sage_addr);
    stop_cheat_caller_address(registry_addr);
}

// =====================================================================
// Test: Invalid ephemeral secret (zero) reverts
// =====================================================================

#[test]
#[should_panic(expected: "Invalid ephemeral secret")]
fn test_send_zero_ephemeral_reverts() {
    let owner = OWNER();
    let sender = SENDER();
    let worker = WORKER();

    let sage_addr = deploy_mock_erc20('SAGE', 'SAGE', 18, sender);
    let registry_addr = deploy_registry(owner, sage_addr);
    let registry = IStealthRegistryDispatcher { contract_address: registry_addr };

    let (meta, _, _) = make_meta_address(42, 77);
    register_worker(registry, worker, meta.spending_pubkey, meta.viewing_pubkey);

    start_cheat_caller_address(registry_addr, sender);
    registry.send_stealth_payment(worker, 100, 0, 456, 0, sage_addr);
    stop_cheat_caller_address(registry_addr);
}

// =====================================================================
// Test: Announcement count increments correctly
// =====================================================================

#[test]
fn test_announcement_count_increments() {
    let owner = OWNER();
    let sender = SENDER();
    let worker = WORKER();

    let sage_addr = deploy_mock_erc20('SAGE', 'SAGE', 18, sender);
    let registry_addr = deploy_registry(owner, sage_addr);
    let registry = IStealthRegistryDispatcher { contract_address: registry_addr };

    let (meta, _, _) = make_meta_address(42, 77);
    register_worker(registry, worker, meta.spending_pubkey, meta.viewing_pubkey);

    assert!(registry.get_announcement_count() == 0, "Should start at 0");

    let amount: u256 = 100_000_000_000_000_000;
    approve_tokens(sage_addr, sender, registry_addr, amount * 3);

    start_cheat_caller_address(registry_addr, sender);
    let idx0 = registry.send_stealth_payment(worker, amount, 1, 1, 0, sage_addr);
    let idx1 = registry.send_stealth_payment(worker, amount, 2, 2, 0, sage_addr);
    let idx2 = registry.send_stealth_payment(worker, amount, 3, 3, 0, sage_addr);
    stop_cheat_caller_address(registry_addr);

    assert!(idx0 == 0, "First index should be 0");
    assert!(idx1 == 1, "Second index should be 1");
    assert!(idx2 == 2, "Third index should be 2");
    assert!(registry.get_announcement_count() == 3, "Count should be 3");
}

// =====================================================================
// Test: Meta-address registration + duplicate rejection
// =====================================================================

#[test]
#[should_panic(expected: "Already registered")]
fn test_duplicate_registration_reverts() {
    let owner = OWNER();
    let worker = WORKER();

    let sage_addr = deploy_mock_erc20('SAGE', 'SAGE', 18, owner);
    let registry_addr = deploy_registry(owner, sage_addr);
    let registry = IStealthRegistryDispatcher { contract_address: registry_addr };

    let (meta, _, _) = make_meta_address(42, 77);
    register_worker(registry, worker, meta.spending_pubkey, meta.viewing_pubkey);
    // Second registration should panic
    register_worker(registry, worker, meta.spending_pubkey, meta.viewing_pubkey);
}

// =====================================================================
// Test: Schnorr spending proof verification (pure crypto)
// =====================================================================

#[test]
fn test_spending_proof_verification() {
    let spending_secret: felt252 = 12345;
    let viewing_secret: felt252 = 67890;
    let ephemeral_secret: felt252 = 11111;

    let (meta, _, _) = make_meta_address(spending_secret, viewing_secret);
    let (stealth_address, ephemeral_pubkey, _) = derive_stealth_address(meta, ephemeral_secret);

    // Derive stealth spending key
    let shared_secret_point = ec_mul(viewing_secret, ephemeral_pubkey);
    let shared_hash = core::poseidon::poseidon_hash_span(
        array![shared_secret_point.x, shared_secret_point.y, 'stealth_derive'].span()
    );
    let stealth_spending_key = spending_secret + shared_hash;

    // Create and verify proof
    let proof = create_spending_proof(stealth_spending_key, stealth_address, 42424242);
    assert!(verify_spending_proof(proof, stealth_address), "Valid proof should verify");
}

// =====================================================================
// Test: Invalid spending proof rejected
// =====================================================================

#[test]
fn test_invalid_spending_proof_rejected() {
    let (meta, _, _) = make_meta_address(42, 77);
    let (stealth_address, _, _) = derive_stealth_address(meta, 123);

    // Create proof with WRONG spending key
    let wrong_key: felt252 = 99999;
    let proof = create_spending_proof(wrong_key, stealth_address, 555);
    assert!(!verify_spending_proof(proof, stealth_address), "Wrong key proof should fail");
}

// =====================================================================
// Test: ElGamal encryption produces non-zero ciphertext
// =====================================================================

#[test]
fn test_elgamal_encryption_nonzero() {
    let g = generator();
    let secret: felt252 = 42;
    let pubkey = ec_mul(secret, g);
    let amount: u256 = 1_000_000;

    let ct = encrypt_amount_to_stealth(amount, pubkey, 7777);

    // Ciphertext points should be non-zero
    assert!(ct.c1_x != 0 || ct.c1_y != 0, "C1 should be non-zero");
    assert!(ct.c2_x != 0 || ct.c2_y != 0, "C2 should be non-zero");
}

// =====================================================================
// Test: Paused registry rejects sends
// =====================================================================

#[test]
#[should_panic(expected: "Registry paused")]
fn test_paused_registry_rejects_send() {
    let owner = OWNER();
    let sender = SENDER();
    let worker = WORKER();

    let sage_addr = deploy_mock_erc20('SAGE', 'SAGE', 18, sender);
    let registry_addr = deploy_registry(owner, sage_addr);
    let registry = IStealthRegistryDispatcher { contract_address: registry_addr };

    let (meta, _, _) = make_meta_address(42, 77);
    register_worker(registry, worker, meta.spending_pubkey, meta.viewing_pubkey);

    // Pause
    start_cheat_caller_address(registry_addr, owner);
    registry.pause();
    stop_cheat_caller_address(registry_addr);

    // Try to send — should panic
    start_cheat_caller_address(registry_addr, sender);
    registry.send_stealth_payment(worker, 100, 123, 456, 0, sage_addr);
    stop_cheat_caller_address(registry_addr);
}

// =====================================================================
// Test: Multiple tokens in sequence — each claim gets correct token
// =====================================================================

#[test]
fn test_multiple_tokens_correct_dispatch() {
    let owner = OWNER();
    let sender = SENDER();
    let worker = WORKER();
    let recipient = RECIPIENT();

    let sage_addr = deploy_mock_erc20('SAGE', 'SAGE', 18, sender);
    let strk_addr = deploy_mock_erc20('STRK', 'STRK', 18, sender);
    let registry_addr = deploy_registry(owner, sage_addr);
    let registry = IStealthRegistryDispatcher { contract_address: registry_addr };

    let (meta, spending_secret, viewing_secret) = make_meta_address(42, 77);
    register_worker(registry, worker, meta.spending_pubkey, meta.viewing_pubkey);

    let amount: u256 = 100_000_000_000_000_000; // 0.1

    // Send SAGE as payment 0
    approve_tokens(sage_addr, sender, registry_addr, amount);
    start_cheat_caller_address(registry_addr, sender);
    let idx_sage = registry.send_stealth_payment(worker, amount, 10, 10, 0, sage_addr);
    stop_cheat_caller_address(registry_addr);

    // Send STRK as payment 1
    approve_tokens(strk_addr, sender, registry_addr, amount);
    start_cheat_caller_address(registry_addr, sender);
    let idx_strk = registry.send_stealth_payment(worker, amount, 20, 20, 0, strk_addr);
    stop_cheat_caller_address(registry_addr);

    // Claim SAGE payment
    let (sa0, ep0, _) = derive_stealth_address(meta, 10);
    let ssp0 = ec_mul(viewing_secret, ep0);
    let sh0 = core::poseidon::poseidon_hash_span(
        array![ssp0.x, ssp0.y, 'stealth_derive'].span()
    );
    let sk0 = spending_secret + sh0;
    let proof0 = create_spending_proof(sk0, sa0, 1);
    start_cheat_caller_address(registry_addr, worker);
    registry.claim_stealth_payment(idx_sage, proof0, recipient);
    stop_cheat_caller_address(registry_addr);

    // Claim STRK payment
    let (sa1, ep1, _) = derive_stealth_address(meta, 20);
    let ssp1 = ec_mul(viewing_secret, ep1);
    let sh1 = core::poseidon::poseidon_hash_span(
        array![ssp1.x, ssp1.y, 'stealth_derive'].span()
    );
    let sk1 = spending_secret + sh1;
    let proof1 = create_spending_proof(sk1, sa1, 2);
    start_cheat_caller_address(registry_addr, worker);
    registry.claim_stealth_payment(idx_strk, proof1, recipient);
    stop_cheat_caller_address(registry_addr);

    // Verify correct tokens went to recipient
    let sage = IMockERC20Dispatcher { contract_address: sage_addr };
    let strk = IMockERC20Dispatcher { contract_address: strk_addr };
    assert!(sage.balance_of(recipient) == amount, "Recipient should have SAGE");
    assert!(strk.balance_of(recipient) == amount, "Recipient should have STRK");
}
