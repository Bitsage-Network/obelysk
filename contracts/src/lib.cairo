// Obelysk Protocol - Cairo Smart Contracts
// Privacy-first DeFi on Starknet
// Contracts copied from BitSage-Cairo-Smart-Contracts
//
// NOTE: Only shielded_swap_router and confidential_transfer compile in this repo.
// Other contracts depend on sage_contracts::obelysk::lean_imt which lives in
// BitSage-Cairo-Smart-Contracts — they are already deployed on Sepolia.

// Deployable contracts (self-contained, OZ deps only)
mod shielded_swap_router;
mod confidential_transfer;
mod dark_pool_auction;

// The following modules require sage_contracts dependency to compile:
// mod elgamal;
// mod same_encryption;
// mod pedersen_commitments;
// mod confidential_swap;
// mod privacy_pools;
// mod privacy_router;
// mod stealth_payments;
// mod stealth_registry;
