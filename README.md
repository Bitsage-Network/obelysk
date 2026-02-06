<p align="center">
  <img src="apps/web/public/obelysk-logo.svg" alt="Obelysk" width="200" />
</p>

<h3 align="center">Obelysk Protocol</h3>

<p align="center">
  A privacy-first trading and transfer protocol on Starknet: dark-pool OTC execution for Bitcoin, shielded swaps through Ekubo, confidential transfers, and compliance-ready pools — powered by STWO zero-knowledge proofs and frictionless onboarding.
</p>

<p align="center">
  <a href="https://github.com/Bitsage-Network/obelysk/actions/workflows/ci.yml">
    <img src="https://github.com/Bitsage-Network/obelysk/actions/workflows/ci.yml/badge.svg" alt="CI" />
  </a>
  <a href="https://github.com/Bitsage-Network/obelysk/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License" />
  </a>
  <img src="https://img.shields.io/badge/starknet-sepolia-purple" alt="Network" />
  <img src="https://img.shields.io/badge/contracts-37%20deployed-green" alt="Contracts" />
</p>

---

## Overview

Obelysk is a privacy protocol built on Starknet that separates *identity* from *activity*. Users can trade, swap, and transfer tokens without exposing their wallet address, transaction amounts, or trading patterns — while still proving compliance through zero-knowledge proofs.

### What it does

| Feature | Description |
|---------|-------------|
| **Dark Pool OTC** | Peer-to-peer orderbook with encrypted order amounts and concealed counterparties |
| **Shielded Swaps** | Token swaps routed through Ekubo liquidity pools via an ILocker-based privacy router |
| **Confidential Transfers** | Private peer-to-peer token sends with ElGamal-encrypted amounts |
| **Privacy Pools** | Deposit/withdraw with Pedersen commitments, Merkle inclusion proofs, and nullifiers |
| **Stealth Payments** | One-time addresses derived from recipient's public key |
| **Compliance Proofs** | Prove transaction legitimacy without revealing details (source of funds, sanctions screening) |
| **Gasless Transactions** | AVNU Paymaster integration for sponsored or pay-in-token gas |
| **Social Login** | Frictionless onboarding — no seed phrase required |

### How it works

```
User → Social Login → Privacy Key Derivation
                          ↓
                    STWO Prover (GPU)
                    ┌──────────────────┐
                    │ Range Proofs     │
                    │ Balance Proofs   │  ← Circle STARKs over M31
                    │ Transfer Proofs  │
                    └──────────────────┘
                          ↓
              ┌───────────────────────┐
              │   Starknet Contracts  │
              │                       │
              │  Privacy Pools        │ ← Pedersen commitments + Merkle trees
              │  Confidential Swap    │ ← ElGamal encrypted amounts
              │  OTC Orderbook        │ ← Dark pool matching
              │  Shielded Router      │ ← Ekubo ILocker integration
              │  Stealth Registry     │ ← One-time addresses
              └───────────────────────┘
```

---

## Project Structure

```
obelysk/
├── apps/
│   └── web/                        # Next.js 14 frontend
│       ├── src/
│       │   ├── app/                 # App Router pages
│       │   │   ├── (app)/           # Authenticated routes
│       │   │   │   ├── wallet/      # Dashboard, privacy pool, stealth
│       │   │   │   ├── trade/       # OTC orderbook interface
│       │   │   │   ├── send/        # Public + private transfers
│       │   │   │   └── stake/       # SAGE staking
│       │   │   └── (auth)/          # Connect wallet / social login
│       │   ├── components/          # 100+ React components
│       │   │   ├── ui/              # Design system (Card, Modal, Table, ...)
│       │   │   ├── privacy/         # Proving flow, session cards, deposit panel
│       │   │   ├── bridge/          # StarkGate L1↔L2 bridge
│       │   │   └── swap/            # Shielded swap interface
│       │   └── lib/                 # Business logic
│       │       ├── crypto/          # ElGamal, Pedersen, Merkle, nullifiers
│       │       ├── prover/          # STWO GPU prover client
│       │       ├── paymaster/       # AVNU gasless transactions
│       │       ├── sessions/        # Privacy session management
│       │       ├── bridge/          # StarkGate bridge service
│       │       ├── swap/            # Ekubo shielded swap service
│       │       ├── contracts/       # ABIs + address registry
│       │       ├── hooks/           # 30 custom React hooks
│       │       └── providers/       # Starknet, React Query, WebSocket
│       └── public/                  # Static assets + token icons
├── packages/
│   ├── crypto/                      # @obelysk/crypto — shared cryptographic primitives
│   └── sdk/                         # @obelysk/sdk — protocol SDK (WIP)
├── contracts/                       # Cairo smart contracts
│   └── src/
│       ├── privacy_pools.cairo      # STARK-verified deposit/withdraw
│       ├── privacy_router.cairo     # Privacy-preserving transaction routing
│       ├── confidential_swap.cairo  # Encrypted amount swaps
│       ├── confidential_transfer.cairo # Private token transfers
│       ├── stealth_payments.cairo   # One-time address payments
│       ├── stealth_registry.cairo   # Stealth address registry
│       ├── elgamal.cairo            # ElGamal encryption scheme
│       ├── pedersen_commitments.cairo # Pedersen commitment scheme
│       └── same_encryption.cairo    # Encryption verification
├── .github/workflows/               # CI/CD pipelines
├── Dockerfile                       # Multi-stage production build
└── turbo.json                       # Monorepo orchestration
```

---

## Getting Started

### Prerequisites

- Node.js >= 18
- npm >= 10
- [Scarb 2.7.0](https://docs.swmansion.com/scarb/) (for contract development)

### Install & Run

```bash
# Clone
git clone https://github.com/Bitsage-Network/obelysk.git
cd obelysk

# Install dependencies
npm install

# Start development server
npm run dev
```

The app runs at [http://localhost:3000](http://localhost:3000).

### Build

```bash
# Typecheck + build all workspaces
npm run build

# Build contracts
cd contracts && scarb build
```

### Docker

```bash
docker build -t obelysk .
docker run -p 3001:3001 obelysk
```

---

## Smart Contracts

10 Cairo contracts deployed across 37 instances on **Starknet Sepolia**.

| Contract | Address | Description |
|----------|---------|-------------|
| SAGE Token | `0x0723...9850` | Protocol governance and utility token |
| Privacy Pools | `0x0d85...78a7` | Deposit/withdraw with ZK verification |
| Privacy Router | `0x7d1a...fc53` | Privacy-preserving transaction routing |
| OTC Orderbook | `0x7b2b...def0` | Dark pool peer-to-peer order matching |

### Cairo Modules

```
privacy_pools        — STARK-verified deposits with Merkle inclusion proofs
privacy_router       — Multi-hop privacy routing with nullifier tracking
confidential_swap    — Token swaps with ElGamal-encrypted amounts
confidential_transfer — Private peer-to-peer token transfers
stealth_payments     — Ephemeral one-time address generation
stealth_registry     — Public registry of stealth meta-addresses
elgamal              — Exponential ElGamal over Stark curve
pedersen_commitments  — Binding and hiding commitment scheme
same_encryption      — Proof of consistent encryption across ciphertexts
```

Built with **Cairo 2.7.0** and **Starknet 2.7.0**.

---

## Cryptography

### Zero-Knowledge Proofs — STWO

Obelysk uses StarkWare's [STWO prover](https://github.com/starkware-libs/stwo) for client-side proof generation:

- **Circle STARKs** over the Mersenne-31 field (2^31 - 1)
- **GPU acceleration** via ICICLE backend (4-7x speedup)
- **100x** more efficient than the Stone prover
- **Proof types**: range proofs, balance proofs, transfer proofs

### Encryption

| Primitive | Usage |
|-----------|-------|
| **ElGamal** | Encrypt transaction amounts (additively homomorphic) |
| **Pedersen Commitments** | Hide deposit amounts in privacy pools |
| **Merkle Trees** | Prove deposit inclusion without revealing which deposit |
| **Nullifiers** | Prevent double-spending without linking to deposits |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 14, React 18, TypeScript, Tailwind CSS |
| **State** | Zustand, TanStack React Query |
| **Animation** | Framer Motion |
| **Blockchain** | Starknet.js 6.17, starknet-react 3.7 |
| **Contracts** | Cairo 2.7.0, Scarb |
| **Proofs** | STWO 2.0 (Circle STARKs, M31 field) |
| **Gasless** | AVNU Paymaster |
| **Bridge** | StarkGate (ETH, STRK, USDC, wBTC) |
| **Swaps** | Ekubo Protocol (ILocker router) |
| **Build** | Turborepo, Docker |
| **CI/CD** | GitHub Actions, GHCR |

---

## Environment Variables

Copy `.env.example` and configure:

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_STARKNET_RPC_URL` | Yes | Starknet RPC endpoint (Alchemy, Infura) |
| `NEXT_PUBLIC_NETWORK` | Yes | `sepolia` or `mainnet` |
| `NEXT_PUBLIC_API_URL` | No | Coordinator API (falls back to on-chain only) |
| `NEXT_PUBLIC_PROVER_URL` | No | STWO prover WebSocket endpoint |

---

## CI/CD

| Workflow | Trigger | Jobs |
|----------|---------|------|
| **CI** | Push/PR to `main`, `develop` | Typecheck, Build, Contract compilation |
| **Deploy** | Push to `main` | Docker build → GHCR push → VPS deploy |
| **Release** | Tags `v*` | Build + GitHub Release with changelog |

---

## Architecture Decisions

- **ILocker, not IExtension** — Shielded swaps use Ekubo's existing liquidity pools rather than deploying custom pool contracts. Identity is hidden; amounts are visible on-chain.
- **Per-token privacy pools** — Each token has its own privacy pool instance due to the single-token contract constraint. The shielded swap router coordinates cross-pool operations.
- **Client-side proving** — ZK proofs are generated in the user's browser (or via GPU prover node), so the protocol never sees plaintext amounts.
- **Compliance by design** — Privacy pools support Association Set Provider (ASP) registries for opt-in compliance proofs, similar to the [Privacy Pools](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4563364) paper by Buterin et al.
- **No mixer** — Obelysk is not a tumbler. Funds flow through verifiable smart contracts with on-chain state roots, not through an opaque mixing service.

---

## License

Apache 2.0 — see [LICENSE](LICENSE).

---

<p align="center">
  Built by <a href="https://github.com/Bitsage-Network">BitSage Network</a>
</p>
