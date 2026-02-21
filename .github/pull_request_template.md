## Summary

<!-- Brief description of what this PR does and why -->

## Changes

<!-- Bulleted list of key changes -->

-

## Type

- [ ] Bug fix
- [ ] New feature
- [ ] Security hardening
- [ ] Contract change (Cairo)
- [ ] Frontend change
- [ ] Infrastructure / CI/CD
- [ ] Documentation

## Security Checklist

<!-- For contract or crypto changes, all applicable items MUST be checked -->

- [ ] No fake/stub proof verification (all Schnorr equations compute `s*G + e*pk`)
- [ ] Reentrancy guards on all functions with external ERC20 calls
- [ ] CEI pattern: state updates before external calls
- [ ] EC point inputs validated on-curve via `EcPointTrait::new().is_some()`
- [ ] Modular arithmetic uses `reduce_mod_n()` for curve order (not raw felt252)
- [ ] No private keys, amounts, or note data in logs or error messages
- [ ] Upgrade timelock >= 48 hours for mainnet contracts

## Testing

<!-- How was this tested? -->

- [ ] `scarb build` passes
- [ ] `scarb test` passes
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] Manual testing on Sepolia
- [ ] N/A

## Deploy Notes

<!-- Any special deployment considerations? Network-specific config? Migration steps? -->

None.
