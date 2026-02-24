// Contract addresses for BitSage Network
// Deployed to Starknet Sepolia - Last updated 2025-12-31
// ALL 37 CONTRACTS DEPLOYED WITH CORRECT OWNER
// Owner/Deployer: 0x0759a4374389b0e3cfcc59d49310b6bc75bb12bbf8ce550eb5c2f026918bb344

export const CONTRACTS = {
  // Local Devnet - For development and testing
  // NOTE: These addresses change on every devnet restart (state is not persisted)
  // Last deployed: 2025-12-30
  devnet: {
    // Core Token
    SAGE_TOKEN: "0x049877d762b2cf79f808b59b5fbdc872c9c02a4a11a593412823b1f1d507e874",

    // Staking & Validation
    STAKING: "0x0605ca31565dc2993180032b98d45c9443a19f22bbbac7e8cff754d99c559ac5", // ProverStaking
    WORKER_STAKING: "0x0", // Not deployed yet
    VALIDATOR_REGISTRY: "0x02dbffc7e794142344eaa69914a8070fe2ea90c67fd39fd773f6c657faf5e433",

    // Jobs & Workers
    JOB_MANAGER: "0x0", // Not deployed yet
    CDC_POOL: "0x0", // Not deployed yet
    REPUTATION: "0x0", // Not deployed yet

    // Payments
    PAYMENT_ROUTER: "0x0",
    PROOF_GATED_PAYMENT: "0x0",
    METERED_BILLING: "0x0",
    ESCROW: "0x0",
    FEE_MANAGER: "0x0",

    // Proofs & Verification
    PROOF_VERIFIER: "0x0",
    STWO_VERIFIER: "0x0",
    OPTIMISTIC_TEE: "0x0",
    FRAUD_PROOF: "0x0",

    // Privacy (Obelysk) - Not deployed yet
    PRIVACY_ROUTER: "0x0",
    PROVER_REGISTRY: "0x0",
    WORKER_PRIVACY: "0x0",

    // Utility
    FAUCET: "0x02b4a1ea9b1fc310fa4e8bf5b18c0bb893f6b6a1a365ddf2d1eaf36d68bf4b5d",
    GAMIFICATION: "0x0",
    COLLATERAL: "0x0",

    // Governance & Treasury
    GOVERNANCE_TREASURY: "0x0",
    TREASURY_TIMELOCK: "0x0",
    BURN_MANAGER: "0x0",

    // Vesting
    REWARD_VESTING: "0x0",
    LINEAR_VESTING: "0x0",
    MILESTONE_VESTING: "0x0",

    // Oracle
    ORACLE_WRAPPER: "0x0",

    // NEW contracts (added 2025-12-31)
    OTC_ORDERBOOK: "0x0",
    PRIVACY_POOLS: "0x0",
    CONFIDENTIAL_SWAP: "0x0",
    MIXING_ROUTER: "0x0",
    STEGANOGRAPHIC_ROUTER: "0x0",
    REFERRAL_SYSTEM: "0x0",
    ADDRESS_REGISTRY: "0x0",
    DYNAMIC_PRICING: "0x0",
    SHIELDED_SWAP_ROUTER: "0x0",
    CONFIDENTIAL_TRANSFER: "0x0",

    // Session Management (Wallet-Agnostic AA)
    SESSION_MANAGER: "0x0",

    // Per-token Privacy Pools
    SAGE_PRIVACY_POOL: "0x0",
    ETH_PRIVACY_POOL: "0x0",
    STRK_PRIVACY_POOL: "0x0",
    WBTC_PRIVACY_POOL: "0x0",
    USDC_PRIVACY_POOL: "0x0",
    STEALTH_REGISTRY: "0x0",

    // Dark Pool (Commit-Reveal Batch Auction)
    DARK_POOL: "0x0",

    // VM31 UTXO Privacy (BTC Vault + general shielded assets)
    VM31_POOL: "0x0",
    VM31_VERIFIER: "0x0",
    VM31_BRIDGE: "0x0",
  },

  // Sepolia Testnet - ALL 37 CONTRACTS DEPLOYED
  // Redeployed 2025-12-31 with correct owner
  // Owner: 0x0759a4374389b0e3cfcc59d49310b6bc75bb12bbf8ce550eb5c2f026918bb344
  sepolia: {
    // Core Token
    SAGE_TOKEN: "0x072349097c8a802e7f66dc96b95aca84e4d78ddad22014904076c76293a99850",

    // Staking & Validation
    STAKING: "0x3287a0af5ab2d74fbf968204ce2291adde008d645d42bc363cb741ebfa941b", // ProverStaking
    WORKER_STAKING: "0x28caa5962266f2bf9320607da6466145489fed9dae8e346473ba1e847437613",
    VALIDATOR_REGISTRY: "0x431a8b6afb9b6f3ffa2fa9e58519b64dbe9eb53c6ac8fb69d3dcb8b9b92f5d9",

    // Jobs & Workers
    JOB_MANAGER: "0x355b8c5e9dd3310a3c361559b53cfcfdc20b2bf7d5bd87a84a83389b8cbb8d3",
    CDC_POOL: "0x1f978cad424f87a6cea8aa27cbcbba10b9a50d41e296ae07e1c635392a2339",
    REPUTATION: "0x4ef80990256fb016381f57c340a306e37376c1de70fa11147a4f1fc57a834de",

    // Payments
    PAYMENT_ROUTER: "0x6a0639e673febf90b6a6e7d3743c81f96b39a3037b60429d479c62c5d20d41",
    PROOF_GATED_PAYMENT: "0x7e74d191b1cca7cac00adc03bc64eaa6236b81001f50c61d1d70ec4bfde8af0",
    METERED_BILLING: "0x1adb19d21f28f56ae9a8852d19f2e2af728764846d30002da8782d571ae01b2",
    ESCROW: "0x7d7b5aa04b8eec7676568c8b55acd5682b8f7cb051f69c1876f0e5a6d8edfd4",
    FEE_MANAGER: "0x74344374490948307360e6a8376d656190773115a4fca4d049366cea7edde39",

    // Proofs & Verification
    PROOF_VERIFIER: "0x17ada59ab642b53e6620ef2026f21eb3f2d1a338d6e85cb61d5bcd8dfbebc8b",
    STWO_VERIFIER: "0x52963fe2f1d2d2545cbe18b8230b739c8861ae726dc7b6f0202cc17a369bd7d",
    OPTIMISTIC_TEE: "0x4238502196d7dab552e2af5d15219c8227c9f4dc69f0df1fa2ca9f8cb29eb33",
    FRAUD_PROOF: "0x5d5bc1565e4df7c61c811b0c494f1345fc0f964e154e57e829c727990116b50",

    // Privacy (Obelysk)
    PRIVACY_ROUTER: "0x7d1a6c242a4f0573696e117790f431fd60518a000b85fe5ee507456049ffc53",
    PROVER_REGISTRY: "0x34a02ecafacfa81be6d23ad5b5e061e92c2b8884cfb388f95b57122a492b3e9",
    WORKER_PRIVACY: "0x1ce38bdbf4b036a31f9313282783b1d1f19cc3942512029e17bb817a87953c",

    // Utility
    FAUCET: "0x62d3231450645503345e2e022b60a96aceff73898d26668f3389547a61471d3",
    GAMIFICATION: "0x3beb685db6a20804ee0939948cee05c42de655b6b78a93e1e773447ce981cde",
    COLLATERAL: "0x4f5405d65d93afb71743e5ac20e4d9ef2667f256f08e61de734992ebd58603",

    // Governance & Treasury
    GOVERNANCE_TREASURY: "0xdf4c3ced8c8eafe33532965fe29081e6f94fb7d54bc976721985c647a7ef92",
    TREASURY_TIMELOCK: "0x4cc9603d7e72469de22aa84d9ac20ddcbaa7309d7eb091f75cd7f7a9e087947",
    BURN_MANAGER: "0x69eb2419e6eee4ed8a9031f2371f0d9682b91f7c5fb6e0823c48b6c725d6a4",

    // Vesting
    REWARD_VESTING: "0x52e086edb779dbe2a9bb2989be63e8847a791cb1628ad5b81e73d6c6f448016",
    LINEAR_VESTING: "0xc0e5f7a55aca4656f3cc76c7e9db0982ada98cd52a71c2062335b3cdc89d35",
    MILESTONE_VESTING: "0xdfd25e74636e4000c6410dc097b008461989b66322cbeb703159e5a99ba16a",

    // Oracle
    ORACLE_WRAPPER: "0x4d86bb472cb462a45d68a705a798b5e419359a5758d84b24af4bbe5441b6e5a",

    // OTC Trading
    OTC_ORDERBOOK: "0x7b2b59d93764ccf1ea85edca2720c37bba7742d05a2791175982eaa59cedef0",

    // Privacy (Additional)
    PRIVACY_POOLS: "0xd85ad03dcd91a075bef0f4226149cb7e43da795d2c1d33e3227c68bfbb78a7",
    CONFIDENTIAL_SWAP: "0x29516b3abfbc56fdf0c1f136c971602325cbabf07ad8f984da582e2106ad2af",
    MIXING_ROUTER: "0x4a4e05233271f5203791321f2ba92b2de73ad051f788e7b605f204b5a43b8d1",
    STEGANOGRAPHIC_ROUTER: "0x47ab97833df3f77d807a4699ca0f0245d533a4d9e0664f809a04cee3ec720dc",

    // Growth
    REFERRAL_SYSTEM: "0x1d400338a38fca24e67c113bcecac4875ec1b85a00b14e4e541ed224fee59e4",

    // Registry
    ADDRESS_REGISTRY: "0x78f99c76731eb0d8d7a6102855772d8560bff91a1f71b59ff0571dfa7ee54c6",
    DYNAMIC_PRICING: "0x28881df510544345d29e12701b6b6366441219364849a43d3443f37583bc0df",

    // Shielded Swap Router (Ekubo AMM integration)
    // Deployed: 2026-02-05 via sncast — class hash 0x1f97f75107d4f86ce7227208e9774607582da05c23f779b3d510e38814707f9
    SHIELDED_SWAP_ROUTER: "0x056b76b42487b943a0d33f5787437ee08af9fd61e1926de9602b3cfb5392f1d6",

    // Confidential Transfer (Tongo-style encrypted balances)
    // Deployed: 2026-02-05 via sncast — class hash 0x7fe19305e2f2d2f49a82f037b642218a59782abc2b26b1ae19a4d45b6c2563a
    CONFIDENTIAL_TRANSFER: "0x07ab4e4cf7ec2fca487573efe4573aee7e24c60a3aee080befc763cc0f400e86",

    // Session Management (Wallet-Agnostic AA)
    // Redeployed 2025-12-31 with upgradability
    // Class hash: 0x05e7b97b3eb3045c07c27993d20a1be6b11e0d86f9f0fce320523ce1d342324b
    SESSION_MANAGER: "0x058aac71e4ac202c6d89bce205eca6669c4d2c4d37d67a87e72cf435a077601e",

    // Per-token Privacy Pools (deployed 2026-02-06)
    SAGE_PRIVACY_POOL: "0x0d85ad03dcd91a075bef0f4226149cb7e43da795d2c1d33e3227c68bfbb78a7",
    ETH_PRIVACY_POOL: "0x07ad28f81b8e90e9e7ae0a2bd5692d54df7fc9df91bbc2d403845698caf0fe67",
    STRK_PRIVACY_POOL: "0x03624fd7adc5e5b82e0925c68dd4714fde4031da4a9222ca7bd223ef71418e2b",
    // Deployed: 2026-02-07 via sncast — class hash 0x6c5e6e4371fec929933dca5473b7f9675d41e52e521b4d4166ad6fc62736ab5
    WBTC_PRIVACY_POOL: "0x06ca244b53fea7ebee5a169f6f3a26ff22cd57c772f3f563ed1bafc367555263",
    // Deployed: 2026-02-08 via sncast — class hash 0x6c5e6e4371fec929933dca5473b7f9675d41e52e521b4d4166ad6fc62736ab5
    USDC_PRIVACY_POOL: "0x02bcb455a7e356ef3ff1422d33d0742e633e4b8b4eb9fa6c15e62e8fd16b7e50",

    // Stealth Registry (stealth meta-addresses + payment announcements)
    // Deployed: 2026-02-21 via sncast — class hash 0x13e7dc7fe0527efee756f68fa7169fad90df80f27676ec7f2c0d1a2d27cfc88
    STEALTH_REGISTRY: "0x0515da02daf6debb3807f1706d1f3675000bb06b14fe0e2a07627d15594920d5",

    // Dark Pool (Commit-Reveal Batch Auction) v3
    // Redeployed: 2026-02-08 — class hash 0x38cebbcf4485a369113d4b75c61683a9d9ffad8ab43e0a272eb3073737acbca
    // Added: is_order_claimed view, 5min upgrade delay
    DARK_POOL: "0x03534599fbdfc28e12148560363fbe2551a6dfdea9901a9189f27e1f22b4ef94",

    // VM31 UTXO Privacy (BTC Vault + general shielded assets)
    // TODO: Deploy VM31Pool, VM31Verifier, VM31ConfidentialBridge to Sepolia
    VM31_POOL: "0x0",
    VM31_VERIFIER: "0x0",
    VM31_BRIDGE: "0x0",
  },
  // Mainnet - Not yet deployed
  mainnet: {
    SAGE_TOKEN: "0x0",
    STAKING: "0x0",
    WORKER_STAKING: "0x0",
    VALIDATOR_REGISTRY: "0x0",
    JOB_MANAGER: "0x0",
    CDC_POOL: "0x0",
    REPUTATION: "0x0",
    PAYMENT_ROUTER: "0x0",
    PROOF_GATED_PAYMENT: "0x0",
    METERED_BILLING: "0x0",
    ESCROW: "0x0",
    FEE_MANAGER: "0x0",
    PROOF_VERIFIER: "0x0",
    STWO_VERIFIER: "0x0",
    OPTIMISTIC_TEE: "0x0",
    FRAUD_PROOF: "0x0",
    PRIVACY_ROUTER: "0x0",
    PROVER_REGISTRY: "0x0",
    WORKER_PRIVACY: "0x0",
    FAUCET: "0x0",
    GAMIFICATION: "0x0",
    COLLATERAL: "0x0",
    GOVERNANCE_TREASURY: "0x0",
    TREASURY_TIMELOCK: "0x0",
    BURN_MANAGER: "0x0",
    REWARD_VESTING: "0x0",
    LINEAR_VESTING: "0x0",
    MILESTONE_VESTING: "0x0",
    ORACLE_WRAPPER: "0x0",
    // NEW contracts (added 2025-12-31)
    OTC_ORDERBOOK: "0x0",
    PRIVACY_POOLS: "0x0",
    CONFIDENTIAL_SWAP: "0x0",
    MIXING_ROUTER: "0x0",
    STEGANOGRAPHIC_ROUTER: "0x0",
    REFERRAL_SYSTEM: "0x0",
    ADDRESS_REGISTRY: "0x0",
    DYNAMIC_PRICING: "0x0",
    SHIELDED_SWAP_ROUTER: "0x0",
    CONFIDENTIAL_TRANSFER: "0x0",

    // Session Management (Wallet-Agnostic AA)
    SESSION_MANAGER: "0x0",

    // Per-token Privacy Pools
    SAGE_PRIVACY_POOL: "0x0",
    ETH_PRIVACY_POOL: "0x0",
    STRK_PRIVACY_POOL: "0x0",
    WBTC_PRIVACY_POOL: "0x0",
    USDC_PRIVACY_POOL: "0x0",
    STEALTH_REGISTRY: "0x0",

    // Dark Pool (Commit-Reveal Batch Auction)
    DARK_POOL: "0x0",

    // VM31 UTXO Privacy (BTC Vault + general shielded assets)
    VM31_POOL: "0x0",
    VM31_VERIFIER: "0x0",
    VM31_BRIDGE: "0x0",
  },
} as const;

export type NetworkType = keyof typeof CONTRACTS;
export type ContractName = keyof (typeof CONTRACTS)["sepolia"];

export function getContractAddress(
  network: NetworkType,
  contract: ContractName
): string {
  return CONTRACTS[network][contract];
}

// Token decimals
export const SAGE_DECIMALS = 18;

// ============================================
// External Token Addresses (Starknet Native)
// Official addresses from starknet-io/starknet-addresses
// https://github.com/starknet-io/starknet-addresses
// ============================================

export const EXTERNAL_TOKENS = {
  sepolia: {
    // Native ETH on Starknet
    ETH: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    // Starknet Token (STRK)
    STRK: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    // USDC on Starknet (Circle native)
    USDC: "0x053b40A647CEDfca6cA84f542A0fe36736031905A9639a7f19A3C1e66bFd5080",
    // Wrapped BTC on Starknet (via StarkGate)
    wBTC: "0x00452bd5c0512a61df7c7be8cfea5e4f893cb40e126bdc40aee6054db955129e",
    // BTC variants — not yet deployed on Sepolia
    LBTC: "0x0",    // Lombard Staked BTC
    tBTC: "0x0",    // Threshold BTC
    SolvBTC: "0x0", // Solv BTC
  },
  mainnet: {
    // Native ETH on Starknet Mainnet
    ETH: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    // Starknet Token (STRK) - Same on mainnet
    STRK: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    // Native USDC on Starknet Mainnet (Circle)
    USDC: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
    // Wrapped BTC on Starknet Mainnet
    wBTC: "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac",
    // BTC variants — Live on Starknet Mainnet (via StarkGate)
    // Source: https://github.com/starknet-io/starknet-addresses/blob/master/bridged_tokens/mainnet.json
    LBTC: "0x036834a40984312f7f7de8d31e3f6305b325389eaeea5b1c0664b2fb936461a4",    // Lombard Staked BTC (8 decimals)
    tBTC: "0x04daa17763b286d1e59b97c283c0b8c949994c361e426a28f743c67bdfe9a32f",    // Threshold BTC (18 decimals)
    SolvBTC: "0x0593e034dda23eea82d2ba9a30960ed42cf4a01502cc2351dc9b9881f9931a68", // Solv BTC (18 decimals)
  },
  devnet: {
    // Devnet uses same addresses but they may not be deployed
    ETH: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    STRK: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    USDC: "0x0",
    wBTC: "0x0",
    LBTC: "0x0",
    tBTC: "0x0",
    SolvBTC: "0x0",
  },
} as const;

// ============================================
// StarkGate Bridge Addresses
// Official L1<->L2 bridge contracts
// https://github.com/starknet-io/starknet-addresses
// ============================================

export type BridgeTokenSymbol = "ETH" | "STRK" | "USDC" | "wBTC";

// Each token has:
//   l1Bridge  — L1 bridge contract (where to call deposit on Ethereum)
//   l2Bridge  — L2 bridge contract (where to call initiate_token_withdraw on Starknet)
//   l2Token   — L2 ERC20 token address on Starknet
// Verified against https://github.com/starknet-io/starknet-addresses/blob/master/bridged_tokens/
export const STARKGATE_BRIDGES = {
  sepolia: {
    ETH: {
      l1Bridge: "0x8453FC6Cd1bCfE8D4dFC069C400B433054d47bDc",
      l2Bridge: "0x04c5772d1914fe6ce891b64eb35bf3522aeae1315647314aac58b01137607f3f",
      l2Token:  "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    },
    STRK: {
      l1Bridge: "0xcE5485Cfb26914C5dcE00B9BAF0580364daFC7a4",
      l2Bridge: "0x0594c1582459ea03f77deaf9eb7e3917d6994a03c13405ba42867f83d85f085d",
      l2Token:  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    },
    USDC: {
      l1Bridge: "0x86dC0B32a5045FFa48D9a60B7e7Ca32F11faCd7B",
      l2Bridge: "0x0028729b12ce1140cbc1e7cbc7245455d3c15fa0c7f5d2e9fc8e0441567f6b50",
      l2Token:  "0x053b40A647CEDfca6cA84f542A0fe36736031905A9639a7f19A3C1e66bFd5080",
    },
    wBTC: {
      l1Bridge: "0x5387FFC865D03924567f7E7BA2aa4F929ce8eEC9",
      l2Bridge: "0x025a3820179262679392e872d7daaa44986af7caae1f41b7eedee561ca35a169",
      l2Token:  "0x00452bd5c0512a61df7c7be8cfea5e4f893cb40e126bdc40aee6054db955129e",
    },
  },
  mainnet: {
    ETH: {
      l1Bridge: "0xae0Ee0A63A2cE6BaeEFFE56e7714FB4EFE48D419",
      l2Bridge: "0x073314940630fd6dcda0d772d4c972c4e0a9946bef9dabf4ef84eda8ef542b82",
      l2Token:  "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    },
    STRK: {
      l1Bridge: "0xcB4a7569a71D48C5c6578C6EBfB1dA70b5a38e51",
      l2Bridge: "0x0594c1582459ea03f77deaf9eb7e3917d6994a03c13405ba42867f83d85f085d",
      l2Token:  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    },
    USDC: {
      l1Bridge: "0xF6080D9fbEEbcd44D89aFfBFd42F098cbFf92816",
      l2Bridge: "0x05cd48fccbfd8aa2773fe22c217e808319ffcc1c5a6a463f7d8fa2da48218196",
      l2Token:  "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
    },
    wBTC: {
      l1Bridge: "0x283751A21eafBFcD52297820D27C1f1963D9b5b5",
      l2Bridge: "0x07aeec4870975311a7396069033796b61cd66ed49d22a786cba12a8d76717302",
      l2Token:  "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac",
    },
  },
} as const;

// L1 (Ethereum) token addresses for ERC20 approve before deposit
export const L1_TOKEN_ADDRESSES = {
  sepolia: {
    ETH: null, // Native ETH — no approve needed
    STRK: "0xCa14007Eff0dB1f8135f4C25B34De49AB0d42766",
    USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    wBTC: "0x92f3B59a79bFf5dc60c0d59eA13a44D082B2bdFC",
  },
  mainnet: {
    ETH: null,
    STRK: "0xCa14007Eff0dB1f8135f4C25B34De49AB0d42766",
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    wBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
  },
} as const;

// Ethereum L1 chain configuration
export const ETHEREUM_CHAIN_CONFIG = {
  sepolia: {
    chainId: "0xaa36a7", // 11155111
    chainIdDecimal: 11155111,
    name: "Ethereum Sepolia",
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    explorerUrl: "https://sepolia.etherscan.io",
    currency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
  },
  mainnet: {
    chainId: "0x1", // 1
    chainIdDecimal: 1,
    name: "Ethereum Mainnet",
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    explorerUrl: "https://etherscan.io",
    currency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
} as const;

export function getStarkGateBridgeAddresses(
  network: "sepolia" | "mainnet",
  token: BridgeTokenSymbol
) {
  return STARKGATE_BRIDGES[network][token];
}

export function getEthereumChainConfig(network: "sepolia" | "mainnet") {
  return ETHEREUM_CHAIN_CONFIG[network];
}

// Token metadata for display
export const TOKEN_METADATA = {
  SAGE: {
    symbol: "SAGE",
    name: "BitSage Token",
    decimals: 18,
    logo: "/tokens/sage.svg",
    coingeckoId: null, // Not listed yet
  },
  ETH: {
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    logo: "/tokens/eth.svg",
    coingeckoId: "ethereum",
  },
  STRK: {
    symbol: "STRK",
    name: "Starknet Token",
    decimals: 18,
    logo: "/tokens/strk.svg",
    coingeckoId: "starknet",
  },
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    logo: "/tokens/usdc.svg",
    coingeckoId: "usd-coin",
  },
  wBTC: {
    symbol: "wBTC",
    name: "Wrapped Bitcoin",
    decimals: 8,
    logo: "/tokens/wbtc.svg",
    coingeckoId: "wrapped-bitcoin",
  },
} as const;

export type TokenSymbol = keyof typeof TOKEN_METADATA;

// Helper to get token address
export function getTokenAddress(
  network: NetworkType,
  token: keyof typeof EXTERNAL_TOKENS["sepolia"]
): string {
  return EXTERNAL_TOKENS[network][token];
}

// Network configuration
export const NETWORK_CONFIG = {
  devnet: {
    chainId: "0x534e5f5345504f4c4941",
    name: "Local Devnet",
    rpcUrl: "http://localhost:5050",
    explorerUrl: "",
  },
  sepolia: {
    chainId: "0x534e5f5345504f4c4941",
    name: "Starknet Sepolia",
    rpcUrl: "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/demo",
    explorerUrl: "https://sepolia.voyager.online",
  },
  mainnet: {
    chainId: "0x534e5f4d41494e",
    name: "Starknet Mainnet",
    rpcUrl: process.env.NEXT_PUBLIC_MAINNET_RPC_URL || "https://starknet-mainnet.public.blastapi.io",
    explorerUrl: "https://voyager.online",
  },
};

// ============================================
// Ekubo AMM Core — Singleton router for swaps
// https://docs.ekubo.org/
// ============================================

export const EKUBO_CORE = {
  sepolia: "0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384",
  mainnet: "0x00000005dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b",
} as const;

// External links
export const EXTERNAL_LINKS = {
  starkgate: "https://starkgate.starknet.io",
  avnu: "https://app.avnu.fi",
  explorer: (network: NetworkType = "sepolia") => NETWORK_CONFIG[network]?.explorerUrl || "https://voyager.online",
  docs: "https://docs.bitsage.network",
  discord: "https://discord.gg/bitsage",
  twitter: "https://twitter.com/bitsage",
  github: "https://github.com/bitsage-network",
};

// App URLs for cross-app linking
export const APP_URLS = {
  validator: "https://validator.bitsage.network",
  obelysk: "https://obelysk.bitsage.network",
  governance: "https://governance.bitsage.network",
  faucet: "https://faucet.bitsage.network",
};

// ============================================
// Per-Token Privacy Pool Mapping
// Centralized mapping: token symbol → privacy pool contract address
// ============================================

export const PRIVACY_POOL_FOR_TOKEN: Record<string, Record<string, string>> = {
  sepolia: {
    SAGE: CONTRACTS.sepolia.SAGE_PRIVACY_POOL,
    ETH: CONTRACTS.sepolia.ETH_PRIVACY_POOL,
    STRK: CONTRACTS.sepolia.STRK_PRIVACY_POOL,
    wBTC: CONTRACTS.sepolia.WBTC_PRIVACY_POOL,
    USDC: CONTRACTS.sepolia.USDC_PRIVACY_POOL,
  },
  mainnet: {
    SAGE: "0x0",
    ETH: "0x0",
    STRK: "0x0",
    wBTC: "0x0",
    USDC: "0x0",
  },
};

// On-chain asset IDs used in privacy pool deposit calldata
export const ASSET_ID_FOR_TOKEN: Record<string, string> = {
  SAGE: "0x0",
  ETH: "0x1",
  STRK: "0x2",
  USDC: "0x3",
  wBTC: "0x4",
};

// VM31 UTXO pool asset IDs (assigned by VM31Pool.register_asset())
// Populated after on-chain registration via register-btc-vault-assets.sh
export const VM31_ASSET_ID_FOR_TOKEN: Record<string, number> = {
  wBTC: 0,     // TODO: Update after register_asset() returns the assigned ID
  LBTC: 0,     // Not yet registered
  tBTC: 0,     // Not yet registered
  SolvBTC: 0,  // Not yet registered
};

/**
 * Get the privacy pool address for a given token on a network.
 */
export function getPrivacyPoolAddress(
  network: NetworkType,
  tokenSymbol: string,
): string {
  return PRIVACY_POOL_FOR_TOKEN[network]?.[tokenSymbol] || "0x0";
}

/**
 * Get the explorer transaction URL for a given network.
 * Uses NETWORK_CONFIG explorerUrl (per-network).
 */
export function getExplorerTxUrl(txHash: string, network: NetworkType): string {
  const explorerUrl = NETWORK_CONFIG[network]?.explorerUrl;
  if (!explorerUrl) return "";
  return `${explorerUrl}/tx/${txHash}`;
}

/**
 * Get the token address for a symbol (including SAGE).
 */
export function getTokenAddressForSymbol(
  network: NetworkType,
  tokenSymbol: string,
): string {
  if (tokenSymbol === "SAGE") return CONTRACTS[network]?.SAGE_TOKEN || "0x0";
  return EXTERNAL_TOKENS[network]?.[tokenSymbol as keyof (typeof EXTERNAL_TOKENS)["sepolia"]] || "0x0";
}

/**
 * Get the RPC URL for a given network.
 * On mainnet, requires NEXT_PUBLIC_MAINNET_RPC_URL to be set.
 * Falls back to NETWORK_CONFIG values.
 */
export function getRpcUrl(network: NetworkType): string {
  if (network === "mainnet") {
    const mainnetRpc = process.env.NEXT_PUBLIC_MAINNET_RPC_URL;
    if (!mainnetRpc) throw new Error("NEXT_PUBLIC_MAINNET_RPC_URL is required for mainnet");
    return mainnetRpc;
  }
  return process.env.NEXT_PUBLIC_RPC_URL || NETWORK_CONFIG[network]?.rpcUrl || NETWORK_CONFIG.sepolia.rpcUrl;
}

/**
 * Get the Starknet chain ID string for SNIP-12 typed data domains.
 */
export function getStarknetChainId(network?: NetworkType): string {
  const net = network || (process.env.NEXT_PUBLIC_STARKNET_NETWORK as NetworkType) || "sepolia";
  return net === "mainnet" ? "SN_MAIN" : "SN_SEPOLIA";
}
