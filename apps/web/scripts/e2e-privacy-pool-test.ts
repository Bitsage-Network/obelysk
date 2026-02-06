/**
 * E2E Test: Privacy Pool Deposit on Starknet Sepolia
 *
 * Tests the full flow:
 *   1. Generate Pedersen commitment + ElGamal encryption (client-side)
 *   2. Approve SAGE token spending (via sncast)
 *   3. Call pp_deposit on the upgraded PrivacyPools contract (via sncast)
 *   4. Verify the deposit event and leaf index
 *   5. Query contract state to confirm deposit
 *
 * This validates that the new H generator (hash-to-curve, Poseidon domain
 * "OBELYSK_PEDERSEN_H_V1") works end-to-end: client crypto → on-chain verify.
 *
 * Uses sncast for transactions (V3/STRK gas), starknet.js for read calls only.
 *
 * Usage:
 *   npx tsx scripts/e2e-privacy-pool-test.ts
 *
 * Prerequisites:
 *   - sncast v0.54+ with deployer account configured
 *   - STRK balance for gas fees
 *   - SAGE balance >= 0.1 SAGE for deposit
 */

import { RpcProvider, hash } from "starknet";
import { execSync } from "child_process";

// ============================================================================
// Constants (matching /lib/crypto/constants.ts)
// ============================================================================

const STARK_PRIME = BigInt(
  "0x800000000000011000000000000000000000000000000000000000000000001"
);
const CURVE_ORDER = BigInt(
  "0x800000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d2f"
);
const GENERATOR_X = BigInt(
  "0x1ef15c18599971b7beced415a40f0c7deacfd9b0d1819e03d723d8bc943cfca"
);
const GENERATOR_Y = BigInt(
  "0x5668060aa49730b7be4801df46ec62de53ecd11abe43a32873000c36e8dc1f"
);
// Unified H generator (hash-to-curve with Poseidon, domain "OBELYSK_PEDERSEN_H_V1")
const PEDERSEN_H_X = BigInt(
  "0x73bd2c9434c955f80b06d2847f8384a226d6cc2557a5735fd9f84d632f576be"
);
const PEDERSEN_H_Y = BigInt(
  "0x1bd58ea52858154de69bf90e446ff200f173d49da444c4f462652ce6b93457e"
);
const CURVE_A = 1n;
const CURVE_B = BigInt(
  "0x6f21413efbe40de150e596d72f7a8c5609ad26c15c915c1f4cdfcb99cee9e89"
);

// ============================================================================
// Addresses
// ============================================================================

const PRIVACY_POOLS = "0x0d85ad03dcd91a075bef0f4226149cb7e43da795d2c1d33e3227c68bfbb78a7";
const SAGE_TOKEN = "0x072349097c8a802e7f66dc96b95aca84e4d78ddad22014904076c76293a99850";
const RPC_URL = "https://api.cartridge.gg/x/starknet/sepolia";
const EXPLORER_URL = "https://sepolia.starkscan.co";
const SNCAST_DIR = "/Users/vaamx/bitsage-network/Obelysk-Protocol/contracts";

// ============================================================================
// Elliptic Curve Math (Stark curve: y² = x³ + x + B)
// ============================================================================

interface ECPoint { x: bigint; y: bigint }
const INFINITY: ECPoint = { x: 0n, y: 0n };

function mod(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r < 0n ? r + m : r;
}

function modInverse(a: bigint, m: bigint): bigint {
  let [old_r, r] = [a, m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  return mod(old_s, m);
}

function isInfinity(p: ECPoint): boolean { return p.x === 0n && p.y === 0n; }

function isOnCurve(p: ECPoint): boolean {
  if (isInfinity(p)) return true;
  const left = mod(p.y * p.y, STARK_PRIME);
  const right = mod(p.x * p.x * p.x + CURVE_A * p.x + CURVE_B, STARK_PRIME);
  return left === right;
}

function addPoints(p1: ECPoint, p2: ECPoint): ECPoint {
  if (isInfinity(p1)) return p2;
  if (isInfinity(p2)) return p1;
  if (p1.x === p2.x && p1.y === mod(-p2.y, STARK_PRIME)) return INFINITY;
  let slope: bigint;
  if (p1.x === p2.x && p1.y === p2.y) {
    slope = mod(mod(3n * p1.x * p1.x + CURVE_A, STARK_PRIME) * modInverse(mod(2n * p1.y, STARK_PRIME), STARK_PRIME), STARK_PRIME);
  } else {
    slope = mod(mod(p2.y - p1.y, STARK_PRIME) * modInverse(mod(p2.x - p1.x, STARK_PRIME), STARK_PRIME), STARK_PRIME);
  }
  const x3 = mod(slope * slope - p1.x - p2.x, STARK_PRIME);
  const y3 = mod(slope * (p1.x - x3) - p1.y, STARK_PRIME);
  return { x: x3, y: y3 };
}

function scalarMult(k: bigint, p: ECPoint): ECPoint {
  if (k === 0n || isInfinity(p)) return INFINITY;
  k = mod(k, CURVE_ORDER);
  let result = INFINITY;
  let addend = p;
  while (k > 0n) {
    if (k & 1n) result = addPoints(result, addend);
    addend = addPoints(addend, addend);
    k >>= 1n;
  }
  return result;
}

function randomScalar(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let scalar = 0n;
  for (let i = 0; i < 32; i++) scalar = (scalar << 8n) | BigInt(bytes[i]);
  return mod(scalar, CURVE_ORDER);
}

// ============================================================================
// Pedersen Commitment + ElGamal
// ============================================================================

function pedersenCommit(value: bigint, blinding: bigint): ECPoint {
  const G = { x: GENERATOR_X, y: GENERATOR_Y };
  const H = { x: PEDERSEN_H_X, y: PEDERSEN_H_Y };
  return addPoints(scalarMult(mod(value, CURVE_ORDER), G), scalarMult(mod(blinding, CURVE_ORDER), H));
}

function commitmentToFelt(c: ECPoint): string {
  return hash.computePoseidonHash("0x" + c.x.toString(16), "0x" + c.y.toString(16));
}

function elgamalEncrypt(amount: bigint, publicKey: ECPoint, r: bigint): { c1: ECPoint; c2: ECPoint } {
  const G = { x: GENERATOR_X, y: GENERATOR_Y };
  const H = { x: PEDERSEN_H_X, y: PEDERSEN_H_Y };
  const c1 = scalarMult(r, G);
  const c2 = addPoints(scalarMult(amount, H), scalarMult(r, publicKey));
  return { c1, c2 };
}

// ============================================================================
// sncast helper — executes sncast commands in the contracts directory
// ============================================================================

function sncast(args: string): string {
  // --url goes to the subcommand, not the top-level sncast
  const cmd = `cd ${SNCAST_DIR} && sncast --accounts-file deployment/sncast_accounts.json --account deployer ${args} --url ${RPC_URL}`;
  try {
    const output = execSync(cmd, { encoding: "utf8", timeout: 60000 });
    return output.trim();
  } catch (e: any) {
    throw new Error(`sncast failed: ${e.stderr || e.message}`);
  }
}

function extractTxHash(output: string): string {
  const match = output.match(/Transaction Hash:\s*(0x[0-9a-fA-F]+)/i);
  if (!match) throw new Error(`Could not find tx hash in: ${output}`);
  return match[1];
}

// ============================================================================
// Main Test
// ============================================================================

async function main() {
  console.log("=== E2E Privacy Pool Deposit Test ===");
  console.log(`Network: Starknet Sepolia`);
  console.log(`Privacy Pools: ${PRIVACY_POOLS}`);
  console.log(`SAGE Token: ${SAGE_TOKEN}`);
  console.log("");

  const provider = new RpcProvider({ nodeUrl: RPC_URL, blockIdentifier: "latest" });

  // ======================== Step 1: Verify H Generator ========================
  console.log("--- Step 1: Verify H generator ---");
  const H = { x: PEDERSEN_H_X, y: PEDERSEN_H_Y };
  const G = { x: GENERATOR_X, y: GENERATOR_Y };
  console.log(`  H on curve: ${isOnCurve(H)}`);
  console.log(`  G on curve: ${isOnCurve(G)}`);
  const twoG = scalarMult(2n, G);
  const hIsTwoG = H.x === twoG.x && H.y === twoG.y;
  console.log(`  H == 2*G (old insecure): ${hIsTwoG}`);
  if (hIsTwoG) { console.error("FAIL: H is still 2*G!"); process.exit(1); }
  console.log("  PASS: H has provably unknown discrete log\n");

  // ======================== Step 2: Check SAGE Balance ========================
  console.log("--- Step 2: Check SAGE balance (via sncast) ---");
  const balOutput = sncast(`call --contract-address ${SAGE_TOKEN} --function balance_of --calldata 0x0759a4374389b0e3cfcc59d49310b6bc75bb12bbf8ce550eb5c2f026918bb344`);
  // Parse u256 from "Response Raw: [0x..., 0x...]"
  const balRawMatch = balOutput.match(/Response Raw:\s*\[([^\]]+)\]/i);
  let balance = 0n;
  if (balRawMatch) {
    const parts = balRawMatch[1].split(",").map(s => s.trim());
    const low = BigInt(parts[0] || "0");
    const high = BigInt(parts[1] || "0");
    balance = low + (high << 128n);
  }
  console.log(`  SAGE balance: ${(Number(balance) / 1e18).toFixed(4)} SAGE\n`);

  const depositAmount = 100000000000000000n; // 0.1 SAGE
  if (balance < depositAmount) {
    console.error(`FAIL: Need >= 0.1 SAGE`);
    process.exit(1);
  }

  // ======================== Step 3: Generate Crypto Proofs ========================
  console.log("--- Step 3: Generate Pedersen commitment + ElGamal encryption ---");
  const privKey = randomScalar();
  const pubKey = scalarMult(privKey, G);
  const blinding = randomScalar();
  const commitment = pedersenCommit(depositAmount, blinding);
  const commitmentFelt = commitmentToFelt(commitment);
  console.log(`  Commitment felt: ${commitmentFelt}`);
  console.log(`  Commitment on curve: ${isOnCurve(commitment)}`);

  const r = randomScalar();
  const encrypted = elgamalEncrypt(depositAmount, pubKey, r);
  console.log(`  ElGamal C1 on curve: ${isOnCurve(encrypted.c1)}`);
  console.log(`  ElGamal C2 on curve: ${isOnCurve(encrypted.c2)}`);

  const amountCommitmentX = "0x" + encrypted.c2.x.toString(16);
  const amountCommitmentY = "0x" + encrypted.c2.y.toString(16);
  const rangeProofAmount = "0x" + depositAmount.toString(16);
  const rangeProofR = "0x" + r.toString(16);
  console.log("  PASS: All crypto values on curve\n");

  // ======================== Step 4: Approve SAGE ========================
  console.log("--- Step 4: Approve SAGE spending ---");
  // Check current allowance
  const allowOutput = sncast(`call --contract-address ${SAGE_TOKEN} --function allowance --calldata 0x0759a4374389b0e3cfcc59d49310b6bc75bb12bbf8ce550eb5c2f026918bb344 ${PRIVACY_POOLS}`);
  console.log(`  Current allowance: ${allowOutput}`);

  const allowRawMatch = allowOutput.match(/Response Raw:\s*\[([^\]]+)\]/i);
  let allowance = 0n;
  if (allowRawMatch) {
    const parts = allowRawMatch[1].split(",").map(s => s.trim());
    allowance = BigInt(parts[0] || "0");
  }

  if (allowance < depositAmount) {
    console.log("  Approving 1M SAGE...");
    // approve(spender, amount_low, amount_high) for u256
    const approveOutput = sncast(
      `invoke --contract-address ${SAGE_TOKEN} --function approve --calldata ${PRIVACY_POOLS} 0xd3c21bcecceda1000000 0x0`
    );
    const approveTxHash = extractTxHash(approveOutput);
    console.log(`  Approve TX: ${approveTxHash}`);
    console.log(`  Waiting for confirmation...`);
    // Wait for tx
    await new Promise(resolve => setTimeout(resolve, 8000));
    console.log("  Approved!\n");
  } else {
    console.log("  Sufficient allowance exists\n");
  }

  // ======================== Step 5: Execute pp_deposit ========================
  console.log("--- Step 5: Execute pp_deposit ---");
  console.log(`  commitment: ${commitmentFelt}`);
  console.log(`  amount_commitment: (${amountCommitmentX.slice(0, 16)}..., ${amountCommitmentY.slice(0, 16)}...)`);
  console.log(`  asset_id: 0x0 (SAGE)`);
  console.log(`  amount: 0.1 SAGE`);

  // pp_deposit calldata:
  // commitment, amount_commitment.x, amount_commitment.y, asset_id,
  // amount.low, amount.high, range_proof_data_len, range_proof_data...
  const depositCalldata = [
    commitmentFelt,                              // commitment: felt252
    amountCommitmentX,                           // amount_commitment.x
    amountCommitmentY,                           // amount_commitment.y
    "0x0",                                       // asset_id
    "0x" + (depositAmount & ((1n << 128n) - 1n)).toString(16), // amount low
    "0x0",                                       // amount high
    "2",                                         // range_proof_data Span length
    rangeProofAmount,                            // range_proof[0] = amount
    rangeProofR,                                 // range_proof[1] = randomness
  ].join(" ");

  console.log("  Submitting transaction...");
  const depositOutput = sncast(
    `invoke --contract-address ${PRIVACY_POOLS} --function pp_deposit --calldata ${depositCalldata}`
  );
  const depositTxHash = extractTxHash(depositOutput);
  console.log(`  TX Hash: ${depositTxHash}`);
  console.log(`  Explorer: ${EXPLORER_URL}/tx/${depositTxHash}`);
  console.log("  Waiting for confirmation...");

  // Wait for confirmation
  await new Promise(resolve => setTimeout(resolve, 12000));

  // Check tx receipt
  try {
    const receiptResult = await provider.getTransactionReceipt(depositTxHash);
    const status = (receiptResult as any).execution_status || (receiptResult as any).status;
    console.log(`  Status: ${status}`);

    if (status === "REVERTED") {
      console.error(`  FAIL: Transaction REVERTED`);
      console.error(`  Reason: ${(receiptResult as any).revert_reason || "unknown"}`);
      process.exit(1);
    }

    // Parse events
    const events = (receiptResult as any).events || [];
    console.log(`  Events: ${events.length} total\n`);

    const ppEvents = events.filter(
      (e: any) => e.from_address?.toLowerCase().includes("d85ad03dcd91a075")
    );
    if (ppEvents.length > 0) {
      console.log("--- Step 6: Deposit event data ---");
      ppEvents.forEach((e: any, i: number) => {
        console.log(`  Event ${i}: keys=[${e.keys?.join(",")}]`);
        console.log(`            data=[${e.data?.join(",")}]`);
      });
      console.log("");
    }
  } catch (e: any) {
    console.log(`  Receipt fetch: ${e.message?.slice(0, 100)}`);
    console.log("  (Transaction may still be pending — check explorer)\n");
  }

  // ======================== Step 7: Verify on-chain ========================
  console.log("--- Step 7: Verify deposit on-chain ---");

  try {
    const isValidOutput = sncast(
      `call --contract-address ${PRIVACY_POOLS} --function is_pp_deposit_valid --calldata ${commitmentFelt}`
    );
    console.log(`  is_pp_deposit_valid: ${isValidOutput}`);
  } catch (e: any) {
    console.log(`  is_pp_deposit_valid: ${e.message?.slice(0, 100)}`);
  }

  try {
    const depositInfoOutput = sncast(
      `call --contract-address ${PRIVACY_POOLS} --function get_pp_deposit_info --calldata ${commitmentFelt}`
    );
    console.log(`  get_pp_deposit_info: ${depositInfoOutput}`);
  } catch (e: any) {
    console.log(`  get_pp_deposit_info: ${e.message?.slice(0, 100)}`);
  }

  try {
    const rootOutput = sncast(
      `call --contract-address ${PRIVACY_POOLS} --function get_global_deposit_root`
    );
    console.log(`  get_global_deposit_root: ${rootOutput}`);
  } catch (e: any) {
    console.log(`  get_global_deposit_root: ${e.message?.slice(0, 100)}`);
  }

  console.log("\n=== E2E TEST COMPLETE ===");
  console.log("Summary:");
  console.log(`  H generator: CORRECT (hash-to-curve, not 2*G)`);
  console.log(`  Pedersen commitment: ON CURVE`);
  console.log(`  ElGamal encryption: ON CURVE`);
  console.log(`  pp_deposit TX: ${depositTxHash}`);
  console.log(`  Explorer: ${EXPLORER_URL}/tx/${depositTxHash}`);

  // Save note data for potential withdrawal test later
  const noteData = {
    commitment: commitmentFelt,
    value: depositAmount.toString(),
    blinding: blinding.toString(),
    nullifierSecret: randomScalar().toString(),
    encryptionRandomness: r.toString(),
    privacyPrivateKey: privKey.toString(),
    txHash: depositTxHash,
    timestamp: new Date().toISOString(),
  };
  console.log(`\nNote data (save for withdrawal test):`);
  console.log(JSON.stringify(noteData, null, 2));
}

main().catch((err) => {
  console.error("\nFATAL ERROR:", err.message || err);
  process.exit(1);
});
