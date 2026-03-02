# Obelysk Protocol Deployment Log

## Sepolia Testnet — 2026-02-05

### ShieldedSwapRouter
- **Class Hash**: `0x1f97f75107d4f86ce7227208e9774607582da05c23f779b3d510e38814707f9`
- **Contract Address**: `0x056b76b42487b943a0d33f5787437ee08af9fd61e1926de9602b3cfb5392f1d6`
- **Declare TX**: `0x0069d8ac578841ad58372db18371354b3822766bf8a662806601d51ce1450f26`
- **Deploy TX**: `0x056dcbaddb708140d145c5f34e878dff8a135643a196ca7fd27f998da571ff91`
- **Constructor Args**: owner=deployer, ekubo_core=0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384
- **Post-Deploy**: `register_pool(SAGE_TOKEN, PRIVACY_POOLS)` — TX: `0x01128a616b76b2cebdb95f24fcc272d15446d11cadde1ebd3041819ef25436f9`

### ConfidentialTransfer
- **Class Hash**: `0x7fe19305e2f2d2f49a82f037b642218a59782abc2b26b1ae19a4d45b6c2563a`
- **Contract Address**: `0x07ab4e4cf7ec2fca487573efe4573aee7e24c60a3aee080befc763cc0f400e86`
- **Declare TX**: `0x04156b0a28d33a5b247b7d8d860747e4afdd3aacd26d3fc6a497adb4e4bf19c4`
- **Deploy TX**: `0x02f083485afeedc21fa26ea9101a7693e51c250e587032d33ce31445962c19ea`
- **Constructor Args**: owner=deployer, auditor_key=(STARK generator G_X, G_Y)
- **Post-Deploy**: `add_asset(0x53414745, SAGE_TOKEN)` — TX: `0x02ba9cd7e729ce816969c459fca87ef6683f07dd4acc9ea3547b4ddac46b690c`

### Deployer
- **Address**: `0x0759a4374389b0e3cfcc59d49310b6bc75bb12bbf8ce550eb5c2f026918bb344`
- **Public Key**: `0x5ae8b012236dcc418e61fc86706f1b5c3c3c53eb379b2edbdbfcf306d1cb1ee`

### Tools
- scarb 2.12.0 (Scarb.toml: starknet=2.12.0, openzeppelin git v0.20.0)
- sncast 0.54.1

---

## Sepolia Testnet — 2026-02-06 (H Generator Upgrade)

Unified Pedersen H generator across all contracts.
H is now derived via hash-to-curve (Poseidon, domain "OBELYSK_PEDERSEN_H_V1")
with provably unknown discrete log. Previously used 2*G (known dlog).

### PrivacyPools (Upgrade)
- **Contract Address**: `0x0d85ad03dcd91a075bef0f4226149cb7e43da795d2c1d33e3227c68bfbb78a7`
- **Old Class Hash**: (deployed from BitSage-Cairo-Smart-Contracts repo)
- **New Class Hash**: `0x6c5e6e4371fec929933dca5473b7f9675d41e52e521b4d4166ad6fc62736ab5`
- **Declare TX**: `0x006cdb84ea7eda5ce291acd6e6344d15cd90a99cda64ec05561a8c7c1404e662`
- **Schedule TX**: `0x00032dd5f02c16425657c1541c0e64bbb13d8a313d2d5daf2e2881ddc86d38e6`
- **Execute TX**: `0x01c1286ea5a7e45cdb56f905617fd365ddc265deb5cf85004d4f626af2f58905`
- **Changes**: Unified H generator + STARK verification + World ID stubs

### PrivacyRouter (Upgrade)
- **Contract Address**: `0x7d1a6c242a4f0573696e117790f431fd60518a000b85fe5ee507456049ffc53`
- **Old Class Hash**: (deployed from BitSage-Cairo-Smart-Contracts repo)
- **New Class Hash**: `0x33818db1b729f9257d648afc175bbae92d31cf46489781642087962d15ba3d3`
- **Declare TX**: `0x0317062b361f6074f0c5d65726f7fb12a3b05bd6892c0c19dd624932c1201679`
- **Schedule TX**: `0x020ffc7dae96ad4d44ccfb26f2165bdcc7ddce8156fb4838d1280fc7fbec96b6`
- **Execute TX**: `0x0282b1b1ee3239f780f137d76b9480c1dd6bc040e047d46a248b5ce3b7e3689d`
- **Changes**: Unified H generator (via elgamal module dependency)

### ShieldedSwapRouter — No upgrade needed
- Does not use elgamal module or H generator

### ConfidentialTransfer — No upgrade needed (source-only fix)
- Had unused H_X/H_Y constants (dead code, not referenced in function bodies)
- Source updated for consistency but compiled artifact unchanged

---

## Sepolia Testnet — 2026-02-16 (DarkPool + Bridge)

### DarkPoolAuction
- **Class Hash**: `0x047df902481a78ab8bc2e3e29d10ec04cf77368e32f4c54bf1a46d9db07d9495`
- **CASM Hash**: `0x0316eeadcf3b25bff98f2cfc8763afb18fa6013b032646df08f436ebd2cdade7`
- **Contract Address**: `0x047765422c66c23d1639a2d93c9c4b91dc41da6273dd4baeab030b4b6ada0d46`
- **Declare TX**: `0x0766a51f22eb358c15fce91e76323d89856f353882e38ce08f8a918eff171cdc`
- **Deploy TX**: `0x029685524265d32d4878a9f911f1496046150b0426724303515c6d1440ebeb33`
- **Constructor Args**: owner=deployer (`0x0759a4...b344`)
- **Upgradability**: 5-min timelocked (`schedule_upgrade` / `execute_upgrade`)
- **Features**: Per-pair commit-reveal batch auction, ElGamal encrypted balances, session keys, SNIP-9 outside execution, pausable

### VM31ConfidentialBridge
- **Class Hash**: `0x03b5186a25f140040eb8a58e2bc3c2733bad6af0c8399b0d5bb962f92f8e9617`
- **CASM Hash**: `0x0766eb88c06444e133c908f3719d5acbaee65d1e3c72ceeab677a19419407362`
- **Contract Address**: `0x025a45900864ac136ae56338dc481e2de7bfd9a4ff83ffcceff8439fa1f630a7`
- **Declare TX**: `0x0745aca5c90cbe0da1e9877d67556db25c9285ae8bb86af20abfc1e5ff233baf`
- **Deploy TX**: `0x05f239a484770568d94c7e3da0ee467410239ad018c0434c4797fe1564e0cda4`
- **Constructor Args**: owner=deployer, relayer=deployer, vm31_pool=`0x07cf94...e1f9`, confidential_transfer=`0x07ab4e...0e86`
- **Upgradability**: 5-min timelocked (`schedule_upgrade` / `execute_upgrade` / `cancel_upgrade`)
- **Features**: Bridges finalized VM31 withdrawals into ConfidentialTransfer encrypted balances, idempotent bridge keys, reentrancy guard, pausable

---

## Starknet Mainnet — 2026-02-26

Mainnet deployment of core SAGE Token + Obelysk privacy contracts.
Owner/Deployer (Braavos): `0x01f9ebd4b60101259df3ac877a27a1a017e7961995fa913be1a6f189af664660`

### SAGE Token (BitSage-Cairo-Smart-Contracts)
- **Class Hash**: `0x5e17a261a36e447ffdc2771d8b9fd73e92fe630900c1b106a4e8ffaf44ab5b7`
- **Contract Address**: `0x0098d563900789f934e610b67482ae58793a2efc373ba3a45af94cdbf931c799`
- **Constructor Args**: owner=deployer, job_manager=0x0, cdc_pool=0x0, paymaster=0x0, treasury=deployer, team=deployer, liquidity=deployer
- **TGE**: 110,000,000 SAGE minted (100M to liquidity_beneficiary=deployer, 10M to owner=deployer)
- **Verified**: `name()=BitSage Token`, `symbol()=SAGE`, `total_supply()=110000000e18`

### ConfidentialTransfer (Obelysk-Protocol)
- **Class Hash**: `0x5399d938717e3f3887d2e96c01332aa256e6ed9e7c114c6c4ce050d316234b9`
- **Contract Address**: `0x0673685bdb01fbf57c390ec2c0d893e7c77316cdea315b0fbfbc85b9a9a979d2`
- **Constructor Args**: owner=deployer, auditor_key_x=0x0, auditor_key_y=0x0, upgrade_delay=172800 (48h)
- **Verified**: `owner()=deployer`

### PrivacyRouter (Obelysk-Protocol)
- **Class Hash**: `0x5e59ee1d08a3fa74c7743795515b31c1dec460984348a62d3d32880a4cdb796`
- **Contract Address**: `0x00f3fd871ba1b5b176270a7eb9e222c964c50fa8a31234394ea00ce70bfbdfbd`
- **Constructor Args**: owner=deployer, sage_token=SAGE_MAINNET, payment_router=0x0

### PrivacyPools x5 (Obelysk-Protocol)
- **Class Hash**: `0x66d5a299c8d28eb02a2a057a73fc648e1a84d10167ba6c68c998a97aa0f2b8b`
- All instances deployed then initialized via `initialize(owner, token_address, privacy_router)`

| Pool | Contract Address | Token |
|------|-----------------|-------|
| **SAGE** | `0x0224977344d123eb5c20fd088f15b62d0541f8282f4a23dd87bdf9839aac724f` | SAGE `0x0098d5...c799` |
| **ETH** | `0x06d0b41c96809796faa02a5eac2f74e090effd09ccab7274054b90aa671e82b5` | ETH `0x049d36...dc7` |
| **STRK** | `0x02c348e89b355691ba5e4ece681fd6b497f8ab2ba670fa5842208b251a3c9cf1` | STRK `0x04718f...938d` |
| **wBTC** | `0x030fcfd4ae4f022e720e52f54359258a02517e11701c153ae46ab2cf10d5e5e2` | wBTC `0x03fe2b...7ac` |
| **USDC** | `0x05d36d7fd19d094ee0fd454e461061d68eb9f4fd0b241e2d1c94320b46d4d59b` | USDC `0x053c91...8a8` |

- **Verified**: All 5 pools return `is_initialized()=true`, `get_pp_stats()=(0,0,0,0)` (fresh)

### Frontend Updates
- `addresses.ts`: All mainnet addresses populated (CONTRACTS.mainnet, PRIVACY_POOL_FOR_TOKEN.mainnet, EXTERNAL_TOKENS.mainnet)
- `usePrivacyPool.ts`: HARDCODED_POOLS_BY_NETWORK.mainnet + HARDCODED_TOKENS_BY_NETWORK.mainnet added
- Network selection: `NEXT_PUBLIC_STARKNET_NETWORK=mainnet` activates mainnet paths

---

## Starknet Mainnet — 2026-03-01 (Fee Infrastructure + ProverStaking)

Protocol fee parameters added to 3 existing contracts (PrivacyPools, ShieldedSwapRouter, DarkPoolAuction)
and ProverStaking deployed fresh to mainnet.

**Deployer**: `0x01f9ebd4b60101259df3ac877a27a1a017e7961995fa913be1a6f189af664660` (Braavos)
**RPC**: Alchemy v0_10
**Full record**: `deployment/mainnet-fees-staking-20260301.json`

### Fee Infrastructure — Contract Changes

All 3 contracts received identical fee patterns:
- Storage: `withdrawal_fee_bps` (u16), `fee_recipient` (ContractAddress), `accumulated_fees` (u256 or Map)
- Fee deduction before token transfer out (CEI pattern maintained)
- Admin functions: `set_*_fee_bps()` (max 500 = 5% cap), `set_fee_recipient()`, `collect_fees()`, `get_fee_info()`
- Event: `FeesCollected { recipient, amount, timestamp }`
- **Default: 0 bps** — upgrade doesn't change behavior until owner explicitly sets fee

#### PrivacyPools (5 instances) — Withdrawal Fee
- **File**: `contracts/src/privacy_pools.cairo`
- **New Class Hash**: `0x3726a3cd5e7f7fae32bc6f38cef113dd5f3699e4ab92dcbd25aa76c0a885098`
- **Declare TX**: [`0x0068602a...`](https://starkscan.co/tx/0x0068602afe1c74786366d116605925abbc1cb5f49aa19b6108b4b766f34cff0d)
- **Previous Class**: `0x26ca3c2b684ae9c8d43b225050a63b8e617cc8290b8e771c7b253df0fab4bb`
- **Fee location**: `pp_withdraw()` — deducts `amount * fee_bps / 10000` before transfer
- **Upgrade needed on**: All 5 pool instances (SAGE, ETH, STRK, wBTC, USDC)

#### ShieldedSwapRouter — Swap Fee
- **File**: `contracts/src/shielded_swap_router.cairo`
- **New Class Hash**: `0x38cef3fd4a98b98083b3cca087efc31b95875575087f9423d88b7d1779f4b79`
- **Declare TX**: [`0x006157fa...`](https://starkscan.co/tx/0x006157fa358500ff21e1456abf974ee002f297c3f97418f997d96f1983ec7c55)
- **Previous Class**: `0x04d87268dfc6008434ca39698196522db6d39c71d03123d8f15ab3715d8375d3`
- **Contract**: `0x05a7f8a6ab74ee6ab41169118ca2ea21070dc6594bae5a39f5bb9ac50629725b`
- **Fee location**: `locked()` callback — deducts from output amount before depositing into dest pool
- **Per-token**: `accumulated_fees` is `Map<ContractAddress, u256>` (one balance per output token)

#### DarkPoolAuction — Withdrawal Fee
- **File**: `contracts/src/dark_pool_auction.cairo`
- **New Class Hash**: `0x534771577c63adaac3f999a4fb320eb7cdf55dabd06a6e72fca44f667d323d1`
- **Declare TX**: [`0x015fc935...`](https://starkscan.co/tx/0x015fc9356216e81fd52fa439d4fe7ceda6e47eadb2035c0d73a8ff25554de326)
- **Previous Class**: `0x0563d4a5d412fcc14264088763f126c9518476a299f4459cf2b2fbcf168efd41`
- **Contract**: `0x0230b5822556f0d9afca7b02f01e37cb9cf2a7e8d590a9020e9bbca183ea7727`
- **Fee location**: `withdraw()` — deducts before token transfer out
- **Per-asset**: `accumulated_fees` is `Map<felt252, u256>` (one balance per asset_id)

### Upgrade Activation Sequence
```
# For each contract (7 total: 5 pools + swap router + dark pool):
sncast -p mainnet invoke --url <RPC> --contract-address <ADDR> --function schedule_upgrade --calldata <NEW_CLASS_HASH>
# Wait 48 hours (172800 seconds)
sncast -p mainnet invoke --url <RPC> --contract-address <ADDR> --function execute_upgrade

# After upgrade, activate fees:
sncast -p mainnet invoke --url <RPC> --contract-address <ADDR> --function set_fee_recipient --calldata <RECIPIENT>
sncast -p mainnet invoke --url <RPC> --contract-address <ADDR> --function set_withdrawal_fee_bps --calldata <BPS>
```

### ProverStaking (Fresh Deploy)
- **Source**: `BitSage-Cairo-Smart-Contracts/src/staking/prover_staking.cairo`
- **Class Hash**: `0x5b5e162892d3eaca1b365ae52b410c444d3dc319c2724cf7c309e1592acb9c1`
- **Contract Address**: `0x07d2ecff4a4d7ca6c75df367d8dbc7cc12ea583f88813f7020832a7cf7f293e3`
- **Declare TX**: [`0x00ded1fa...`](https://starkscan.co/tx/0x00ded1fa3fc5f2bdf574cd9c1a9445cd813538a761b9c40da5d0f6c796d593ab)
- **Deploy TX**: [`0x05fa25ee...`](https://starkscan.co/tx/0x05fa25ee6422a0df5e7c46e9f5886d4b2a7a3ac07212cae26d237657140dee31)
- **Constructor Args**: owner=deployer, sage_token=`0x0098d5...c799`, treasury=deployer
- **Features**: SAGE staking at 15% APY, GPU tier min-stakes, slashing, timelocked upgrades
- **Verified**: `get_stake(deployer)` returns default WorkerStake (contract responding)

### Post-Deploy: SAGE Approval for Staking Rewards
- Treasury (deployer) approved ProverStaking to spend 10,000,000 SAGE
- **TX**: [`0x025a3aff...`](https://starkscan.co/tx/0x025a3aff4b80bc8d3af5d91d6574b04fbfc4e59fd598cd4aedcd52e234a0026f)
- **Verified**: `allowance(deployer, staking) = 10,000,000e18`

### Frontend Updates
- `addresses.ts`: mainnet `STAKING` set to `0x07d2ecff4a4d7ca6c75df367d8dbc7cc12ea583f88813f7020832a7cf7f293e3`
