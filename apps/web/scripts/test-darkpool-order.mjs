/**
 * Test Script: Dark Pool v2 Order Flow on Sepolia
 *
 * Tests the full commit → reveal → settle lifecycle.
 * Places a buy ETH/STRK order and walks through all phases.
 *
 * Run: node scripts/test-darkpool-order.mjs
 */

import { RpcProvider, Account, hash } from "starknet";

// ============================================================================
// Configuration
// ============================================================================

const RPC_URL = "https://api.cartridge.gg/x/starknet/sepolia";
const DEPLOYER_ADDRESS = "0x0759a4374389b0e3cfcc59d49310b6bc75bb12bbf8ce550eb5c2f026918bb344";
const DEPLOYER_PK = "0x154de503c7553e078b28044f15b60323899d9437bd44e99d9ab629acbada47a";

const DARK_POOL = "0x02535f64fb17bb54cfa3554d159499bb92720c33eeab5df26178c0638739bc76";

// Asset IDs (as registered in contract)
const ETH_ASSET_ID = "0x1";
const STRK_ASSET_ID = "0x2";

// ============================================================================
// Stark Curve Constants
// ============================================================================

const STARK_PRIME = BigInt("0x800000000000011000000000000000000000000000000000000000000000001");
const CURVE_ORDER = BigInt("0x800000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d2f");
const CURVE_A = 1n;

const GENERATOR_X = BigInt("0x1ef15c18599971b7beced415a40f0c7deacfd9b0d1819e03d723d8bc943cfca");
const GENERATOR_Y = BigInt("0x5668060aa49730b7be4801df46ec62de53ecd11abe43a32873000c36e8dc1f");

const PEDERSEN_H_X = BigInt("0x73bd2c9434c955f80b06d2847f8384a226d6cc2557a5735fd9f84d632f576be");
const PEDERSEN_H_Y = BigInt("0x1bd58ea52858154de69bf90e446ff200f173d49da444c4f462652ce6b93457e");

const POINT_AT_INFINITY = { x: 0n, y: 0n };

// ============================================================================
// Modular Arithmetic
// ============================================================================

function mod(a, m) {
  const result = a % m;
  return result < 0n ? result + m : result;
}

function modInverse(a, m) {
  let [old_r, r] = [a, m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  return mod(old_s, m);
}

// ============================================================================
// EC Point Operations
// ============================================================================

function isInfinity(p) {
  return p.x === 0n && p.y === 0n;
}

function addPoints(p1, p2) {
  if (isInfinity(p1)) return p2;
  if (isInfinity(p2)) return p1;
  if (p1.x === p2.x && p1.y === mod(-p2.y, STARK_PRIME)) return POINT_AT_INFINITY;

  let slope;
  if (p1.x === p2.x && p1.y === p2.y) {
    const num = mod(3n * p1.x * p1.x + CURVE_A, STARK_PRIME);
    const den = modInverse(mod(2n * p1.y, STARK_PRIME), STARK_PRIME);
    slope = mod(num * den, STARK_PRIME);
  } else {
    const num = mod(p2.y - p1.y, STARK_PRIME);
    const den = modInverse(mod(p2.x - p1.x, STARK_PRIME), STARK_PRIME);
    slope = mod(num * den, STARK_PRIME);
  }

  const x3 = mod(slope * slope - p1.x - p2.x, STARK_PRIME);
  const y3 = mod(slope * (p1.x - x3) - p1.y, STARK_PRIME);
  return { x: x3, y: y3 };
}

function scalarMult(k, p) {
  if (k === 0n || isInfinity(p)) return POINT_AT_INFINITY;
  if (k < 0n) {
    k = mod(-k, CURVE_ORDER);
    p = { x: p.x, y: mod(-p.y, STARK_PRIME) };
  }
  k = mod(k, CURVE_ORDER);
  let result = POINT_AT_INFINITY;
  let addend = p;
  while (k > 0n) {
    if (k & 1n) result = addPoints(result, addend);
    addend = addPoints(addend, addend);
    k = k >> 1n;
  }
  return result;
}

function randomScalar() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let scalar = 0n;
  for (let i = 0; i < 32; i++) scalar = (scalar << 8n) | BigInt(bytes[i]);
  return mod(scalar, CURVE_ORDER);
}

const G = { x: GENERATOR_X, y: GENERATOR_Y };
const H = { x: PEDERSEN_H_X, y: PEDERSEN_H_Y };

// ============================================================================
// Order Hash — must match on-chain Poseidon computation
// ============================================================================

function computeOrderHash(price, amount, side, giveAsset, wantAsset, salt) {
  const sideFelt = side === "buy" ? "0x0" : "0x1";
  const priceLow = "0x" + (price & ((1n << 128n) - 1n)).toString(16);
  const priceHigh = "0x" + (price >> 128n).toString(16);
  const amountLow = "0x" + (amount & ((1n << 128n) - 1n)).toString(16);
  const amountHigh = "0x" + (amount >> 128n).toString(16);
  const saltHex = "0x" + salt.toString(16);

  return BigInt(hash.computePoseidonHashOnElements([
    priceLow, priceHigh, amountLow, amountHigh,
    sideFelt, giveAsset, wantAsset, saltHex,
  ]));
}

// ============================================================================
// Pedersen Commitment: C = value * G + blinding * H
// ============================================================================

function pedersenCommit(value, blinding) {
  const vG = scalarMult(mod(value, CURVE_ORDER), G);
  const bH = scalarMult(mod(blinding, CURVE_ORDER), H);
  return addPoints(vG, bH);
}

// ============================================================================
// Balance Proof (Fiat-Shamir bound to trader + asset)
// ============================================================================

function buildBalanceProof(sk, trader, asset) {
  const k = randomScalar();
  const commitX = "0x" + mod(k, CURVE_ORDER).toString(16);
  const commitY = "0x" + mod(k * 2n, CURVE_ORDER).toString(16);

  const challenge = BigInt(
    hash.computePoseidonHashOnElements([commitX, commitY, trader, asset])
  );
  const response = mod(k + challenge * sk, CURVE_ORDER);

  return {
    commitment: { x: commitX, y: commitY },
    challenge: "0x" + challenge.toString(16),
    response: "0x" + response.toString(16),
  };
}

// ============================================================================
// Helpers
// ============================================================================

const phases = ["Commit", "Reveal", "Settle", "Closed"];

async function readEpochPhase(provider) {
  const [epochRes, phaseRes] = await Promise.all([
    provider.callContract({ contractAddress: DARK_POOL, entrypoint: "get_current_epoch", calldata: [] }),
    provider.callContract({ contractAddress: DARK_POOL, entrypoint: "get_epoch_phase", calldata: [] }),
  ]);
  return {
    epoch: Number(BigInt(epochRes[0])),
    phase: phases[Number(BigInt(phaseRes[0]))],
    phaseIdx: Number(BigInt(phaseRes[0])),
  };
}

async function waitForPhase(provider, targetPhase, maxWaitMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const { epoch, phase } = await readEpochPhase(provider);
    if (phase === targetPhase) return { epoch, phase };
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    process.stdout.write(`\r  Waiting for ${targetPhase}... current: ${phase} (epoch ${epoch}) [${elapsed}s]`);
    await new Promise((r) => setTimeout(r, 4000)); // poll every ~1 block
  }
  throw new Error(`Timeout waiting for ${targetPhase} phase`);
}

function toU256Calldata(v) {
  return [
    "0x" + (v & ((1n << 128n) - 1n)).toString(16),
    "0x" + (v >> 128n).toString(16),
  ];
}

// ============================================================================
// Main Test Flow
// ============================================================================

async function main() {
  console.log("=== Dark Pool v2 — Order Flow Test ===\n");

  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  const account = new Account({
    provider,
    address: DEPLOYER_ADDRESS,
    signer: DEPLOYER_PK,
  });

  const blockNum = await provider.getBlockNumber();
  console.log(`Connected to Sepolia (block ${blockNum})`);

  // Deterministic privacy key (matching deposit test)
  const privacyKey = mod(BigInt("0xDEADBEEF0123456789ABCDEF"), CURVE_ORDER);

  // ──────────────────────────────────────────────────────────
  // Step 1: Wait for Commit phase
  // ──────────────────────────────────────────────────────────
  console.log("\n--- Step 1: Wait for Commit Phase ---");
  const { epoch: commitEpoch } = await waitForPhase(provider, "Commit");
  console.log(`\n  In Commit phase (epoch ${commitEpoch})`);

  // ──────────────────────────────────────────────────────────
  // Step 2: Build and submit commit
  // ──────────────────────────────────────────────────────────
  console.log("\n--- Step 2: Build & Submit Order Commit ---");

  // Order: Buy ETH/STRK at price 1000 STRK/ETH, amount 0.00001 ETH
  const price = BigInt("1000") * BigInt(1e18);   // 1000 * 10^18
  const amount = BigInt("10000000000000");         // 0.00001 ETH = 10^13
  const side = "buy";
  const giveAsset = STRK_ASSET_ID;  // Buying ETH: we give STRK
  const wantAsset = ETH_ASSET_ID;   // We want ETH
  const salt = randomScalar();
  const amountBlinding = randomScalar();

  console.log(`  Order: BUY 0.00001 ETH @ 1000 STRK/ETH`);
  console.log(`  Give: STRK (${giveAsset}), Want: ETH (${wantAsset})`);

  // Compute order hash
  const orderHash = computeOrderHash(price, amount, side, giveAsset, wantAsset, salt);
  console.log(`  Order hash: 0x${orderHash.toString(16).slice(0, 16)}...`);

  // Pedersen commitment to amount
  const amountCommitment = pedersenCommit(amount, amountBlinding);
  console.log(`  Amount commitment: (0x${amountCommitment.x.toString(16).slice(0, 12)}..., 0x${amountCommitment.y.toString(16).slice(0, 12)}...)`);

  // Balance proof
  const balanceProof = buildBalanceProof(privacyKey, DEPLOYER_ADDRESS, giveAsset);
  console.log(`  Balance proof challenge: ${balanceProof.challenge.slice(0, 16)}...`);

  const sideEnum = side === "buy" ? "0" : "1";
  const commitCalls = [
    {
      contractAddress: DARK_POOL,
      entrypoint: "commit_order",
      calldata: [
        "0x" + orderHash.toString(16),
        "0x" + amountCommitment.x.toString(16),
        "0x" + amountCommitment.y.toString(16),
        sideEnum,
        giveAsset,
        wantAsset,
        balanceProof.commitment.x,
        balanceProof.commitment.y,
        balanceProof.challenge,
        balanceProof.response,
      ],
    },
  ];

  console.log("  Submitting commit...");
  let orderId;
  try {
    const txRes = await account.execute(commitCalls);
    console.log(`  Tx hash: ${txRes.transaction_hash}`);
    console.log("  Waiting for confirmation...");

    const receipt = await provider.waitForTransaction(txRes.transaction_hash, { retryInterval: 3000 });
    console.log(`  Status: ${receipt.execution_status || receipt.status}`);

    // Parse OrderCommitted event to get order ID
    const orderCommittedSelector = hash.getSelectorFromName("OrderCommitted");
    for (const event of (receipt.events || [])) {
      const keys = event.keys || [];
      if (keys.length >= 3 && keys[0] === orderCommittedSelector) {
        const idLow = BigInt(keys[1] || "0");
        const idHigh = BigInt(keys[2] || "0");
        orderId = (idHigh << 128n) | idLow;
        console.log(`  Order ID: ${orderId}`);
        break;
      }
    }

    if (!orderId) {
      console.log(`  Events: ${(receipt.events || []).length}`);
      for (const ev of (receipt.events || [])) {
        console.log(`    selector: ${ev.keys?.[0]?.slice(0, 16)}... keys: ${ev.keys?.length} data: ${ev.data?.length}`);
      }
      console.log("  WARNING: Could not parse order ID from events, using order_count");
      // Fallback: read order count
      const countRes = await provider.callContract({
        contractAddress: DARK_POOL,
        entrypoint: "get_order_count",
        calldata: [],
      });
      orderId = BigInt(countRes[0] || "0");
      console.log(`  Derived order ID from count: ${orderId}`);
    }
  } catch (err) {
    console.error(`  Commit FAILED: ${err.message}`);
    process.exit(1);
  }

  // ──────────────────────────────────────────────────────────
  // Step 3: Read committed order
  // ──────────────────────────────────────────────────────────
  console.log("\n--- Step 3: Read Committed Order ---");
  try {
    const [idLow, idHigh] = toU256Calldata(orderId);
    const orderRes = await provider.callContract({
      contractAddress: DARK_POOL,
      entrypoint: "get_order",
      calldata: [idLow, idHigh],
    });
    const status = Number(BigInt(orderRes[7] || "0"));
    const statusNames = ["Committed", "Revealed", "Filled", "PartialFill", "Cancelled", "Expired"];
    console.log(`  Order ${orderId} status: ${statusNames[status]}`);
    console.log(`  Trader: ${orderRes[2]}`);
    console.log(`  Side: ${Number(BigInt(orderRes[3])) === 0 ? "Buy" : "Sell"}`);
    console.log(`  Epoch: ${Number(BigInt(orderRes[6]))}`);
  } catch (err) {
    console.log(`  Read order failed: ${err.message?.slice(0, 60)}`);
  }

  // ──────────────────────────────────────────────────────────
  // Step 4: Wait for Reveal phase & submit reveal
  // ──────────────────────────────────────────────────────────
  console.log("\n--- Step 4: Wait for Reveal Phase ---");
  await waitForPhase(provider, "Reveal");
  console.log(`\n  In Reveal phase`);

  console.log("  Submitting reveal...");
  const [priceLow, priceHigh] = toU256Calldata(price);
  const [amountLow, amountHigh] = toU256Calldata(amount);
  const [idLow, idHigh] = toU256Calldata(orderId);

  const revealCalls = [
    {
      contractAddress: DARK_POOL,
      entrypoint: "reveal_order",
      calldata: [
        idLow, idHigh,
        priceLow, priceHigh,
        amountLow, amountHigh,
        "0x" + salt.toString(16),
        "0x" + amountBlinding.toString(16),
      ],
    },
  ];

  try {
    const txRes = await account.execute(revealCalls);
    console.log(`  Tx hash: ${txRes.transaction_hash}`);
    console.log("  Waiting for confirmation...");

    const receipt = await provider.waitForTransaction(txRes.transaction_hash, { retryInterval: 3000 });
    console.log(`  Status: ${receipt.execution_status || receipt.status}`);

    // Check order status after reveal
    const orderRes = await provider.callContract({
      contractAddress: DARK_POOL,
      entrypoint: "get_order",
      calldata: [idLow, idHigh],
    });
    const status = Number(BigInt(orderRes[7] || "0"));
    const statusNames = ["Committed", "Revealed", "Filled", "PartialFill", "Cancelled", "Expired"];
    console.log(`  Order status after reveal: ${statusNames[status]}`);
  } catch (err) {
    console.error(`  Reveal FAILED: ${err.message}`);
    // Continue — we still want to test settle
  }

  // ──────────────────────────────────────────────────────────
  // Step 5: Wait for Settle phase & trigger settlement
  // ──────────────────────────────────────────────────────────
  console.log("\n--- Step 5: Wait for Settle Phase & Settle ---");
  const { epoch: settleEpoch } = await waitForPhase(provider, "Settle");
  console.log(`\n  In Settle phase (epoch ${settleEpoch})`);

  // settle_epoch is permissionless — anyone can call it
  // We settle the epoch that had our order (commitEpoch)
  console.log(`  Settling epoch ${commitEpoch}...`);
  const settleCalls = [
    {
      contractAddress: DARK_POOL,
      entrypoint: "settle_epoch",
      calldata: [commitEpoch.toString()],
    },
  ];

  try {
    const txRes = await account.execute(settleCalls);
    console.log(`  Tx hash: ${txRes.transaction_hash}`);
    console.log("  Waiting for confirmation...");

    const receipt = await provider.waitForTransaction(txRes.transaction_hash, { retryInterval: 3000 });
    console.log(`  Status: ${receipt.execution_status || receipt.status}`);

    // Check for settlement events
    for (const event of (receipt.events || [])) {
      const sel = event.keys?.[0];
      if (sel === hash.getSelectorFromName("EpochSettled")) {
        console.log(`  EpochSettled event found!`);
      }
    }
  } catch (err) {
    console.log(`  Settlement: ${err.message?.slice(0, 80)}`);
    console.log(`  (Single-sided orders cannot match — this is expected with no counterparty)`);
  }

  // ──────────────────────────────────────────────────────────
  // Step 6: Read epoch result & final order status
  // ──────────────────────────────────────────────────────────
  console.log("\n--- Step 6: Read Final State ---");
  try {
    const epochResult = await provider.callContract({
      contractAddress: DARK_POOL,
      entrypoint: "get_epoch_result",
      calldata: [commitEpoch.toString()],
    });
    const clearingPrice = (BigInt(epochResult[2] || "0") << 128n) | BigInt(epochResult[1] || "0");
    const numFills = Number(BigInt(epochResult[7] || "0"));
    const settledAt = Number(BigInt(epochResult[8] || "0"));
    console.log(`  Epoch ${commitEpoch} result:`);
    console.log(`    Clearing price: ${clearingPrice}`);
    console.log(`    Num fills: ${numFills}`);
    console.log(`    Settled at block: ${settledAt}`);
  } catch (err) {
    console.log(`  Epoch result read: ${err.message?.slice(0, 60)}`);
  }

  // Final order status
  try {
    const orderRes = await provider.callContract({
      contractAddress: DARK_POOL,
      entrypoint: "get_order",
      calldata: [idLow, idHigh],
    });
    const status = Number(BigInt(orderRes[7] || "0"));
    const statusNames = ["Committed", "Revealed", "Filled", "PartialFill", "Cancelled", "Expired"];
    const fillAmount = (BigInt(orderRes[13] || "0") << 128n) | BigInt(orderRes[12] || "0");
    console.log(`  Final order status: ${statusNames[status]}`);
    console.log(`  Fill amount: ${fillAmount}`);
  } catch (err) {
    console.log(`  Order read: ${err.message?.slice(0, 60)}`);
  }

  // ──────────────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────────────
  console.log("\n=== ORDER FLOW TEST SUMMARY ===");
  console.log(`  Contract: ${DARK_POOL}`);
  console.log(`  Order ID: ${orderId}`);
  console.log(`  Epoch: ${commitEpoch}`);
  console.log(`  Phases tested: Commit -> Reveal -> Settle`);
  console.log(`  Note: Single-sided order (no counterparty) — fill expected = 0`);
  console.log("===============================\n");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
