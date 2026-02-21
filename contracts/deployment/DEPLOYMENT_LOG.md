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
