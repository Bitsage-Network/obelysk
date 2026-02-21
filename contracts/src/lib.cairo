// Obelysk Protocol - Cairo Smart Contracts
// Privacy-first DeFi on Starknet
// Contracts copied from BitSage-Cairo-Smart-Contracts
//
// All 12 modules compile with sage_contracts as a Scarb path dependency.

// Core deployable contracts
mod shielded_swap_router;
mod confidential_transfer;
mod dark_pool_auction;
mod vm31_confidential_bridge;

// ElGamal cryptographic primitives (requires sage_contracts)
mod elgamal;
mod same_encryption;
mod pedersen_commitments;

// Privacy application contracts (requires sage_contracts::obelysk::lean_imt)
mod confidential_swap;
mod privacy_pools;
mod privacy_router;

// Stealth payments (included at launch)
mod stealth_payments;
mod stealth_registry;
