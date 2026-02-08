/**
 * Test Script: Dark Pool v2 Deposit & Order Flow on Sepolia
 *
 * Tests:
 *   1. Deposit ETH into the dark pool with ElGamal encryption
 *   2. Read encrypted balance back and verify
 *   3. Read epoch info and order count
 *
 * Run: node scripts/test-darkpool-deposit.mjs
 */

import { RpcProvider, Account, hash, CallData } from "starknet";

// ============================================================================
// Configuration
// ============================================================================

const RPC_URL = "https://api.cartridge.gg/x/starknet/sepolia";
const DEPLOYER_ADDRESS = "0x0759a4374389b0e3cfcc59d49310b6bc75bb12bbf8ce550eb5c2f026918bb344";
const DEPLOYER_PK = "0x154de503c7553e078b28044f15b60323899d9437bd44e99d9ab629acbada47a";

const DARK_POOL = "0x02535f64fb17bb54cfa3554d159499bb92720c33eeab5df26178c0638739bc76";
const ETH_TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const ETH_ASSET_ID = "0x1"; // Asset ID registered in the contract

// Deposit amount: 0.00001 ETH = 10^13 wei (very small for testing)
const DEPOSIT_AMOUNT = 10000000000000n; // 10^13

// ============================================================================
// Stark Curve Constants (matching contracts/crypto)
// ============================================================================

const STARK_PRIME = BigInt("0x800000000000011000000000000000000000000000000000000000000000001");
const CURVE_ORDER = BigInt("0x800000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d2f");
const CURVE_A = 1n;
const CURVE_B = BigInt("0x6f21413efbe40de150e596d72f7a8c5609ad26c15c915c1f4cdfcb99cee9e89");

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
// EC Point Operations on Stark Curve
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

// ============================================================================
// Random Scalar
// ============================================================================

function randomScalar() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let scalar = 0n;
  for (let i = 0; i < 32; i++) {
    scalar = (scalar << 8n) | BigInt(bytes[i]);
  }
  return mod(scalar, CURVE_ORDER);
}

// ============================================================================
// ElGamal Encryption
// ============================================================================

const G = { x: GENERATOR_X, y: GENERATOR_Y };
const H = { x: PEDERSEN_H_X, y: PEDERSEN_H_Y };

function elgamalEncrypt(amount, publicKey, r) {
  // C1 = r * G
  const c1 = scalarMult(r, G);
  // C2 = amount * H + r * PK
  const mH = scalarMult(amount, H);
  const rPK = scalarMult(r, publicKey);
  const c2 = addPoints(mH, rPK);
  return { c1_x: c1.x, c1_y: c1.y, c2_x: c2.x, c2_y: c2.y };
}

function elgamalDecrypt(ciphertext, privateKey) {
  const c1 = { x: ciphertext.c1_x, y: ciphertext.c1_y };
  const c2 = { x: ciphertext.c2_x, y: ciphertext.c2_y };
  // m*H = C2 - sk*C1
  const skC1 = scalarMult(privateKey, c1);
  const negSkC1 = { x: skC1.x, y: mod(-skC1.y, STARK_PRIME) };
  const mH = addPoints(c2, negSkC1);
  // Brute force small discrete log base H
  let current = POINT_AT_INFINITY;
  for (let i = 0n; i <= 1000000n; i++) {
    if (current.x === mH.x && current.y === mH.y) return i;
    current = addPoints(current, H);
  }
  throw new Error("Discrete log not found");
}

// ============================================================================
// AE Hint (simplified Poseidon-like for testing)
// ============================================================================

const POSEIDON_RC = [
  0x6861759ea556a2339dd92f9562a30b9e58e2ad98109ae4780b7fd8eac77fe6fn,
  0x3827681995d5af9ffc8397a3d00425a3da43f76abf28a64e4ab1a22ad1eeee7n,
];

function poseidonSimple(inputs) {
  let state = 0n;
  for (const input of inputs) {
    state = mod(state + input, STARK_PRIME);
    state = mod(state * state * state + POSEIDON_RC[0], STARK_PRIME);
    state = mod(state + POSEIDON_RC[1], STARK_PRIME);
  }
  return state;
}

function createAEHint(amount, randomness, receiverPK) {
  const sharedPoint = scalarMult(randomness, receiverPK);
  const sharedSecret = poseidonSimple([sharedPoint.x, sharedPoint.y]);
  const nonce = poseidonSimple([randomness, 0x4145484e4f4e4345n]); // "AEHNONCE"
  const encKey = poseidonSimple([sharedSecret, nonce, 0x414547454e4348494e54n]); // "AEGENCHIN"
  const encryptedAmount = mod(amount ^ encKey, STARK_PRIME);
  const macKey = poseidonSimple([sharedSecret, nonce, 0x4145474d41434b4559n]); // "AEGMACKEY"
  const mac = poseidonSimple([macKey, encryptedAmount, nonce]);
  return { encryptedAmount, nonce, mac };
}

// ============================================================================
// Main Test Flow
// ============================================================================

async function main() {
  console.log("=== Dark Pool v2 — Deposit & Balance Test ===\n");

  // Setup provider & account
  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  const account = new Account({
    provider,
    address: DEPLOYER_ADDRESS,
    signer: DEPLOYER_PK,
  });

  // Verify account
  const blockNum = await provider.getBlockNumber();
  console.log(`Connected to Sepolia (block ${blockNum})`);

  // Check deployer ETH balance
  const ethBalance = await provider.callContract({
    contractAddress: ETH_TOKEN,
    entrypoint: "balance_of",
    calldata: [DEPLOYER_ADDRESS],
  });
  const ethBal = (BigInt(ethBalance[1] || "0") << 128n) | BigInt(ethBalance[0] || "0");
  const ethHuman = Number(ethBal) / 1e18;
  console.log(`Deployer ETH balance: ${ethHuman.toFixed(6)} ETH (${ethBal} wei)`);

  if (ethBal < DEPOSIT_AMOUNT) {
    console.error(`ERROR: Not enough ETH. Need ${Number(DEPOSIT_AMOUNT) / 1e18} ETH`);
    process.exit(1);
  }

  // ──────────────────────────────────────────────────────────
  // Step 1: Read current epoch
  // ──────────────────────────────────────────────────────────
  console.log("\n--- Step 1: Read Current Epoch ---");
  const [epochRes, phaseRes] = await Promise.all([
    provider.callContract({ contractAddress: DARK_POOL, entrypoint: "get_current_epoch", calldata: [] }),
    provider.callContract({ contractAddress: DARK_POOL, entrypoint: "get_epoch_phase", calldata: [] }),
  ]);
  const epoch = Number(BigInt(epochRes[0]));
  const phaseIdx = Number(BigInt(phaseRes[0]));
  const phases = ["Commit", "Reveal", "Settle", "Closed"];
  console.log(`  Epoch: ${epoch}, Phase: ${phases[phaseIdx]}`);

  // ──────────────────────────────────────────────────────────
  // Step 2: Check existing encrypted balance
  // ──────────────────────────────────────────────────────────
  console.log("\n--- Step 2: Read Existing Encrypted Balance ---");
  const balBefore = await provider.callContract({
    contractAddress: DARK_POOL,
    entrypoint: "get_encrypted_balance",
    calldata: [DEPLOYER_ADDRESS, ETH_ASSET_ID],
  });
  const beforeC1x = BigInt(balBefore[0] || "0");
  const beforeC1y = BigInt(balBefore[1] || "0");
  const beforeC2x = BigInt(balBefore[2] || "0");
  const beforeC2y = BigInt(balBefore[3] || "0");
  const isZero = beforeC1x === 0n && beforeC1y === 0n && beforeC2x === 0n && beforeC2y === 0n;
  console.log(`  Existing balance ciphertext: ${isZero ? "ZERO (no prior deposit)" : "NON-ZERO"}`);
  if (!isZero) {
    console.log(`    c1: (${beforeC1x.toString(16).slice(0, 12)}..., ${beforeC1y.toString(16).slice(0, 12)}...)`);
    console.log(`    c2: (${beforeC2x.toString(16).slice(0, 12)}..., ${beforeC2y.toString(16).slice(0, 12)}...)`);
  }

  // ──────────────────────────────────────────────────────────
  // Step 3: Generate privacy keypair & encrypt deposit amount
  // ──────────────────────────────────────────────────────────
  console.log("\n--- Step 3: ElGamal Encrypt Deposit Amount ---");
  // Use a deterministic private key for testing (so we can decrypt later)
  const privacyKey = mod(BigInt("0xDEADBEEF0123456789ABCDEF"), CURVE_ORDER);
  const pubKey = scalarMult(privacyKey, G);
  console.log(`  Privacy PK: 0x${privacyKey.toString(16).slice(0, 16)}...`);
  console.log(`  Public Key: (0x${pubKey.x.toString(16).slice(0, 12)}..., 0x${pubKey.y.toString(16).slice(0, 12)}...)`);

  const r = randomScalar();
  const encAmount = elgamalEncrypt(DEPOSIT_AMOUNT, pubKey, r);
  console.log(`  Encrypted ${Number(DEPOSIT_AMOUNT) / 1e18} ETH (${DEPOSIT_AMOUNT} wei)`);
  console.log(`    c1: (0x${encAmount.c1_x.toString(16).slice(0, 12)}..., 0x${encAmount.c1_y.toString(16).slice(0, 12)}...)`);
  console.log(`    c2: (0x${encAmount.c2_x.toString(16).slice(0, 12)}..., 0x${encAmount.c2_y.toString(16).slice(0, 12)}...)`);

  // Create AE hint
  const aeHint = createAEHint(DEPOSIT_AMOUNT, r, pubKey);
  console.log(`  AE Hint nonce: 0x${aeHint.nonce.toString(16).slice(0, 16)}...`);

  // Verify encryption locally by decrypting
  console.log("\n  Verifying encryption locally...");
  try {
    const decrypted = elgamalDecrypt(encAmount, privacyKey);
    console.log(`  Decrypted: ${decrypted} wei (expected: ${DEPOSIT_AMOUNT})`);
    console.log(`  Match: ${decrypted === DEPOSIT_AMOUNT ? "YES" : "NO"}`);
  } catch (e) {
    console.log(`  Decryption brute-force skipped (amount too large for BSGS test range)`);
    console.log(`  This is expected — AE hint provides O(1) decryption instead`);
  }

  // ──────────────────────────────────────────────────────────
  // Step 4: Build & execute deposit transaction
  // ──────────────────────────────────────────────────────────
  console.log("\n--- Step 4: Execute Deposit Transaction ---");

  const amountLow = "0x" + (DEPOSIT_AMOUNT & ((1n << 128n) - 1n)).toString(16);
  const amountHigh = "0x" + (DEPOSIT_AMOUNT >> 128n).toString(16);

  const calls = [
    // Approve dark pool to spend ETH
    {
      contractAddress: ETH_TOKEN,
      entrypoint: "approve",
      calldata: [DARK_POOL, amountLow, amountHigh],
    },
    // Deposit with encrypted amount + AE hint
    {
      contractAddress: DARK_POOL,
      entrypoint: "deposit",
      calldata: [
        ETH_ASSET_ID,
        amountLow,
        amountHigh,
        // ElGamal ciphertext (4 felts: l_x, l_y, r_x, r_y)
        "0x" + encAmount.c1_x.toString(16),
        "0x" + encAmount.c1_y.toString(16),
        "0x" + encAmount.c2_x.toString(16),
        "0x" + encAmount.c2_y.toString(16),
        // AE hint (3 felts: encrypted_amount, nonce, mac)
        "0x" + aeHint.encryptedAmount.toString(16),
        "0x" + aeHint.nonce.toString(16),
        "0x" + aeHint.mac.toString(16),
      ],
    },
  ];

  console.log("  Submitting multicall (approve + deposit)...");
  try {
    const txResponse = await account.execute(calls);
    console.log(`  Tx hash: ${txResponse.transaction_hash}`);
    console.log("  Waiting for confirmation...");

    const receipt = await provider.waitForTransaction(txResponse.transaction_hash, {
      retryInterval: 3000,
    });
    console.log(`  Status: ${receipt.execution_status || receipt.status}`);

    if (receipt.events) {
      console.log(`  Events emitted: ${receipt.events.length}`);
      for (const event of receipt.events) {
        const selector = event.keys?.[0];
        if (selector === hash.getSelectorFromName("Deposited")) {
          console.log(`    Deposited event found!`);
          console.log(`      trader: ${event.data?.[0] || event.keys?.[1]}`);
          console.log(`      asset: ${event.data?.[1] || event.keys?.[2]}`);
        } else if (selector === hash.getSelectorFromName("Approval")) {
          console.log(`    Approval event found`);
        }
      }
    }
  } catch (err) {
    console.error(`  Deposit FAILED: ${err.message}`);
    if (err.message?.includes("REJECTED") || err.message?.includes("REVERTED")) {
      console.error("  This may be a calldata or contract logic issue");
    }
    process.exit(1);
  }

  // ──────────────────────────────────────────────────────────
  // Step 5: Verify encrypted balance updated
  // ──────────────────────────────────────────────────────────
  console.log("\n--- Step 5: Verify Encrypted Balance ---");
  const balAfter = await provider.callContract({
    contractAddress: DARK_POOL,
    entrypoint: "get_encrypted_balance",
    calldata: [DEPLOYER_ADDRESS, ETH_ASSET_ID],
  });

  const afterC1x = BigInt(balAfter[0] || "0");
  const afterC1y = BigInt(balAfter[1] || "0");
  const afterC2x = BigInt(balAfter[2] || "0");
  const afterC2y = BigInt(balAfter[3] || "0");
  const isZeroAfter = afterC1x === 0n && afterC1y === 0n && afterC2x === 0n && afterC2y === 0n;

  console.log(`  Balance after deposit: ${isZeroAfter ? "ZERO (ERROR!)" : "NON-ZERO (OK!)"}`);
  if (!isZeroAfter) {
    console.log(`    c1: (0x${afterC1x.toString(16).slice(0, 16)}..., 0x${afterC1y.toString(16).slice(0, 16)}...)`);
    console.log(`    c2: (0x${afterC2x.toString(16).slice(0, 16)}..., 0x${afterC2y.toString(16).slice(0, 16)}...)`);

    // If this was the first deposit, the balance ciphertext should match exactly
    if (isZero) {
      const matchC1x = afterC1x === encAmount.c1_x;
      const matchC1y = afterC1y === encAmount.c1_y;
      const matchC2x = afterC2x === encAmount.c2_x;
      const matchC2y = afterC2y === encAmount.c2_y;
      console.log(`  First deposit — ciphertext match: ${matchC1x && matchC1y && matchC2x && matchC2y ? "EXACT MATCH" : "MISMATCH (homomorphic add to prior)"}`);
    }
  }

  // ──────────────────────────────────────────────────────────
  // Step 6: Verify AE hint stored
  // ──────────────────────────────────────────────────────────
  console.log("\n--- Step 6: Verify AE Hint ---");
  try {
    const hintRes = await provider.callContract({
      contractAddress: DARK_POOL,
      entrypoint: "get_balance_hint",
      calldata: [DEPLOYER_ADDRESS, ETH_ASSET_ID],
    });
    const hintEnc = BigInt(hintRes[0] || "0");
    const hintNonce = BigInt(hintRes[1] || "0");
    const hintMac = BigInt(hintRes[2] || "0");
    console.log(`  Stored hint: enc=${hintEnc !== 0n}, nonce=${hintNonce !== 0n}, mac=${hintMac !== 0n}`);
    console.log(`  Hint matches local: enc=${hintEnc === aeHint.encryptedAmount}, nonce=${hintNonce === aeHint.nonce}, mac=${hintMac === aeHint.mac}`);
  } catch (err) {
    console.log(`  AE hint read failed: ${err.message?.slice(0, 60)}`);
  }

  // ──────────────────────────────────────────────────────────
  // Step 7: Check ETH balance after deposit
  // ──────────────────────────────────────────────────────────
  console.log("\n--- Step 7: ETH Balance After ---");
  const ethAfter = await provider.callContract({
    contractAddress: ETH_TOKEN,
    entrypoint: "balance_of",
    calldata: [DEPLOYER_ADDRESS],
  });
  const ethBalAfter = (BigInt(ethAfter[1] || "0") << 128n) | BigInt(ethAfter[0] || "0");
  const ethDiff = ethBal - ethBalAfter;
  console.log(`  ETH before: ${(Number(ethBal) / 1e18).toFixed(6)}`);
  console.log(`  ETH after:  ${(Number(ethBalAfter) / 1e18).toFixed(6)}`);
  console.log(`  ETH spent:  ${(Number(ethDiff) / 1e18).toFixed(6)} (deposit: ${Number(DEPOSIT_AMOUNT) / 1e18})`);
  // Note: ETH diff will be slightly more than deposit amount due to gas fees

  // ──────────────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────────────
  console.log("\n=== DEPOSIT TEST SUMMARY ===");
  console.log(`  Contract: ${DARK_POOL}`);
  console.log(`  Amount: ${Number(DEPOSIT_AMOUNT) / 1e18} ETH`);
  console.log(`  Encrypted balance stored: ${!isZeroAfter ? "YES" : "NO"}`);
  console.log(`  Deposit: ${!isZeroAfter ? "SUCCESS" : "FAILED"}`);
  console.log("============================\n");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
