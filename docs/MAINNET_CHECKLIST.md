# Mainnet Deployment Checklist

Operational runbook for deploying Obelysk Protocol to Starknet mainnet.
Each section requires manual action with deployer keys, multisig coordination, or external service setup.

---

## 1. Multisig Setup

- [ ] Deploy or configure Argent multisig on Starknet mainnet
- [ ] Establish signing policy (recommended: 2-of-3 or 3-of-5)
- [ ] Document multisig address: `0x___`
- [ ] Verify all signers can sign transactions via Argent X / Braavos
- [ ] Test a dummy invoke from the multisig to confirm it works

## 2. Pre-Deploy Verification

- [ ] Run `cd contracts && scarb build` — confirm clean build
- [ ] Run `snforge test` — all tests pass
- [ ] Review all constructor parameters:
  - `upgrade_delay`: 172800 (48 hours)
  - `owner`: multisig address from step 1
  - Ekubo core: `0x00000005dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b`
- [ ] Verify SAGE token mainnet address exists and is correct
- [ ] Confirm deployer account has sufficient ETH/STRK for gas

## 3. Contract Deployment

Use the deployment script:

```bash
cd contracts
./scripts/deploy-mainnet.sh \
  --network mainnet \
  --owner 0x<MULTISIG_ADDRESS> \
  --sage-token 0x<SAGE_TOKEN_MAINNET> \
  --rpc-url "https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_7/<KEY>" \
  --account deployer
```

Deployment order (handled by script):
1. ConfidentialTransfer (standalone)
2. DarkPoolAuction (standalone)
3. ConfidentialSwapContract (standalone)
4. PrivacyRouter (needs SAGE token)
5. PrivacyPools x5 (SAGE, ETH, STRK, wBTC, USDC)
6. ShieldedSwapRouter (needs Ekubo core)
7. StealthRegistry (needs SAGE token)
8. VM31ConfidentialBridge (needs ConfidentialTransfer)

Post-deploy:
- [ ] Copy output addresses into `apps/web/src/lib/contracts/addresses.ts` (mainnet block)
- [ ] Update `PRIVACY_POOL_FOR_TOKEN` mainnet entries in addresses.ts
- [ ] Save deployment JSON from `contracts/deployment/` to version control

## 4. Ownership Transfer

Transfer ownership on ALL contracts from deployer to multisig:

```bash
# For each contract:
sncast invoke \
  --contract-address 0x<CONTRACT> \
  --function "transfer_ownership" \
  --calldata 0x<MULTISIG_ADDRESS> \
  --account deployer \
  --url <MAINNET_RPC>
```

Contracts requiring ownership transfer:
- [ ] ConfidentialTransfer
- [ ] DarkPoolAuction
- [ ] ConfidentialSwapContract
- [ ] PrivacyRouter
- [ ] PrivacyPools (SAGE)
- [ ] PrivacyPools (ETH)
- [ ] PrivacyPools (STRK)
- [ ] PrivacyPools (wBTC)
- [ ] PrivacyPools (USDC)
- [ ] ShieldedSwapRouter
- [ ] StealthRegistry
- [ ] VM31ConfidentialBridge

Then accept ownership from multisig:
- [ ] Each contract: `accept_ownership()` from multisig

## 5. Contract Verification

- [ ] Verify all contracts on Starkscan (https://starkscan.co)
- [ ] Confirm each contract's class hash matches the declared artifact
- [ ] Verify upgrade delay is 172800 on all upgradeable contracts
- [ ] Verify owner is multisig on all contracts

## 6. VM31 Relayer Infrastructure

- [ ] Build Rust relayer from `libs/stwo-ml/src/privacy/relayer.rs`
- [ ] Configure with mainnet contract addresses and HTTPS RPC
- [ ] Deploy to production server (container or VM)
- [ ] Test full cycle: deposit -> spend -> withdraw -> bridge
- [ ] Set up monitoring and alerting
- [ ] Configure relayer address in VM31ConfidentialBridge contract

## 7. Environment & DNS

- [ ] Set up dedicated mainnet RPC endpoint (Alchemy or Infura)
  - Set `NEXT_PUBLIC_MAINNET_RPC_URL` in production env
- [ ] Configure `NEXT_PUBLIC_AVNU_API_KEY` for mainnet paymaster
- [ ] Set `NEXT_PUBLIC_RELAY_URL` to production relay endpoint
- [ ] Configure production CORS origins in relay services:
  - `services/relay/src/server.ts` — update `corsOptions.origin`
  - `services/audit-relay/src/server.ts` — update CORS allowlist
- [ ] Set `NEXT_PUBLIC_STARKNET_NETWORK=mainnet` in production
- [ ] Verify CSP headers in `next.config.mjs` allow mainnet RPC domain

## 8. Frontend Activation

- [ ] Populate all 42 mainnet addresses in `addresses.ts`
- [ ] Update `PRIVACY_POOL_FOR_TOKEN.mainnet` entries
- [ ] Enable AVNU paymaster (verify eligibility check works on mainnet)
- [ ] Deploy frontend to production
- [ ] Smoke-test: connect wallet, view balances, attempt deposit/withdraw

## 9. Post-Launch Monitoring

- [ ] Monitor contract events for first 24 hours
- [ ] Verify upgrade timelock is enforced (attempt upgrade, confirm 48h delay)
- [ ] Check relay service health endpoints
- [ ] Monitor gas costs and paymaster budget
- [ ] Set up alerts for unusual activity (large deposits, rapid nullifier usage)

---

## Rollback Plan

If issues are discovered post-launch:
1. **Frontend**: Revert `NEXT_PUBLIC_STARKNET_NETWORK` to `sepolia`
2. **Contracts**: Use `pause()` on ConfidentialTransfer if available, or set upgrade delay to trigger emergency governance
3. **Relay**: Stop relayer service, transactions will queue but not process
4. **DNS**: Point mainnet relay URL to maintenance page
