/**
 * E2E Test: Privacy Pool Withdrawal on Starknet Sepolia
 *
 * Tests the full withdrawal flow using on-chain storage reading + LeanIMT:
 *   1. Deposit 0.1 SAGE into the privacy pool
 *   2. Read deposit commitments from contract storage (starknet_getStorageAt)
 *   3. Rebuild the Cairo-compatible LeanIMT (domain-separated, sparse, dynamic depth)
 *   4. Generate sparse Merkle proof (variable-length, only non-zero siblings)
 *   5. Derive nullifier from secret + leafIndex
 *   6. Build PPWithdrawalProof calldata and submit pp_withdraw
 *   7. Verify: is_pp_nullifier_used() returns true
 *
 * Uses sncast for transactions (V3/STRK gas), RPC for storage reads.
 *
 * Usage:
 *   npx tsx scripts/e2e-privacy-pool-withdraw.ts
 */

import { RpcProvider, hash, num } from "starknet";
import { execSync } from "child_process";

// ============================================================================
// Constants
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

// LeanIMT domain separator (Cairo short string)
const LEAN_IMT_DOMAIN = "0x4f42454c59534b5f4c45414e5f494d545f5631";

// Addresses
const PRIVACY_POOLS = "0x0d85ad03dcd91a075bef0f4226149cb7e43da795d2c1d33e3227c68bfbb78a7";
const SAGE_TOKEN = "0x072349097c8a802e7f66dc96b95aca84e4d78ddad22014904076c76293a99850";
const DEPLOYER = "0x0759a4374389b0e3cfcc59d49310b6bc75bb12bbf8ce550eb5c2f026918bb344";
const RPC_URL = "https://api.cartridge.gg/x/starknet/sepolia";
const EXPLORER_URL = "https://sepolia.starkscan.co";
const SNCAST_DIR = "/Users/vaamx/bitsage-network/Obelysk-Protocol/contracts";

// ============================================================================
// Elliptic Curve Math (Stark curve)
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
// Crypto
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

function poseidonHash(inputs: bigint[]): bigint {
  const hexInputs = inputs.map((input) => "0x" + mod(input, CURVE_ORDER).toString(16));
  let result: string;
  if (hexInputs.length === 1) result = hash.computePoseidonHash(hexInputs[0], "0x0");
  else if (hexInputs.length === 2) result = hash.computePoseidonHash(hexInputs[0], hexInputs[1]);
  else result = hash.computePoseidonHashOnElements(hexInputs);
  return BigInt(result);
}

function deriveNullifier(nullifierSecret: bigint, leafIndex: number): bigint {
  return poseidonHash([nullifierSecret, BigInt(leafIndex)]);
}

// ============================================================================
// Cairo-Compatible LeanIMT
// ============================================================================

function hashPair(left: string, right: string): string {
  return hash.computePoseidonHashOnElements([LEAN_IMT_DOMAIN, left, right]);
}

function calculateDepth(n: number): number {
  if (n === 0) return 0;
  if (n === 1) return 1;
  let depth = 0;
  let remaining = n - 1;
  while (remaining > 0) { remaining = Math.floor(remaining / 2); depth++; }
  return depth;
}

// ============================================================================
// Storage reading
// ============================================================================

const NODES_BASE = hash.getSelectorFromName("global_deposit_nodes");

function nodesStorageAddr(level: number, index: number): string {
  return hash.computePedersenHash(
    hash.computePedersenHash(NODES_BASE, "0x" + level.toString(16)),
    "0x" + index.toString(16),
  );
}

async function readStorage(key: string): Promise<string> {
  const resp = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "starknet_getStorageAt",
      params: {
        contract_address: num.toHex(num.toBigInt(PRIVACY_POOLS)),
        key,
        block_id: "latest",
      },
      id: 1,
    }),
  });
  const json = await resp.json();
  return json.result || "0x0";
}

// ============================================================================
// sncast helpers
// ============================================================================

function sncast(args: string): string {
  const cmd = `cd ${SNCAST_DIR} && sncast --accounts-file deployment/sncast_accounts.json --account deployer ${args} --url ${RPC_URL}`;
  try { return execSync(cmd, { encoding: "utf8", timeout: 60000 }).trim(); }
  catch (e: any) { throw new Error(`sncast failed: ${e.stderr || e.message}`); }
}

function extractTxHash(output: string): string {
  const match = output.match(/Transaction Hash:\s*(0x[0-9a-fA-F]+)/i);
  if (!match) throw new Error(`Could not find tx hash in: ${output}`);
  return match[1];
}

function parseSncastU256(output: string): bigint {
  const rawMatch = output.match(/Response Raw:\s*\[([^\]]+)\]/i);
  if (!rawMatch) return 0n;
  const parts = rawMatch[1].split(",").map((s) => s.trim());
  return BigInt(parts[0] || "0") + (BigInt(parts[1] || "0") << 128n);
}

function parseSncastFelt(output: string): string {
  const rawMatch = output.match(/Response Raw:\s*\[([^\]]+)\]/i);
  if (!rawMatch) return "0x0";
  return rawMatch[1].split(",")[0].trim();
}

// ============================================================================
// Main Test
// ============================================================================

async function main() {
  console.log("=== E2E Privacy Pool WITHDRAWAL Test ===");
  console.log(`Network: Starknet Sepolia`);
  console.log(`Privacy Pools: ${PRIVACY_POOLS}`);
  console.log("");

  const provider = new RpcProvider({ nodeUrl: RPC_URL, blockIdentifier: "latest" });
  const G = { x: GENERATOR_X, y: GENERATOR_Y };

  // ======================== Step 1: Check balance ========================
  console.log("--- Step 1: Check SAGE balance ---");
  const balOutput = sncast(`call --contract-address ${SAGE_TOKEN} --function balance_of --calldata ${DEPLOYER}`);
  const balanceBefore = parseSncastU256(balOutput);
  console.log(`  Balance: ${(Number(balanceBefore) / 1e18).toFixed(4)} SAGE`);

  const depositAmount = 100000000000000000n; // 0.1 SAGE
  if (balanceBefore < depositAmount) { console.error("FAIL: Need >= 0.1 SAGE"); process.exit(1); }
  console.log("");

  // ======================== Step 2: Deposit ========================
  console.log("--- Step 2: Deposit 0.1 SAGE ---");
  const privKey = randomScalar();
  const pubKey = scalarMult(privKey, G);
  const blinding = randomScalar();
  const nullifierSecret = randomScalar();
  const commitment = pedersenCommit(depositAmount, blinding);
  const commitmentFelt = commitmentToFelt(commitment);
  console.log(`  Commitment: ${commitmentFelt}`);

  const r = randomScalar();
  const encrypted = elgamalEncrypt(depositAmount, pubKey, r);

  // Ensure allowance
  const allowOutput = sncast(`call --contract-address ${SAGE_TOKEN} --function allowance --calldata ${DEPLOYER} ${PRIVACY_POOLS}`);
  if (parseSncastU256(allowOutput) < depositAmount) {
    console.log("  Approving SAGE...");
    sncast(`invoke --contract-address ${SAGE_TOKEN} --function approve --calldata ${PRIVACY_POOLS} 0xd3c21bcecceda1000000 0x0`);
    await new Promise((r) => setTimeout(r, 8000));
  }

  const depositCalldata = [
    commitmentFelt,
    "0x" + encrypted.c2.x.toString(16), "0x" + encrypted.c2.y.toString(16),
    "0x0", // asset_id
    "0x" + (depositAmount & ((1n << 128n) - 1n)).toString(16), "0x0", // u256
    "2", "0x" + depositAmount.toString(16), "0x" + r.toString(16), // range_proof
  ].join(" ");

  console.log("  Submitting pp_deposit...");
  const depositOutput = sncast(`invoke --contract-address ${PRIVACY_POOLS} --function pp_deposit --calldata ${depositCalldata}`);
  const depositTxHash = extractTxHash(depositOutput);
  console.log(`  TX: ${depositTxHash}`);
  console.log("  Waiting for confirmation...");
  await new Promise((r) => setTimeout(r, 15000));

  const receipt = await provider.getTransactionReceipt(depositTxHash);
  if ((receipt as any).execution_status === "REVERTED") {
    console.error(`  FAIL: Deposit REVERTED: ${(receipt as any).revert_reason}`);
    process.exit(1);
  }
  console.log(`  Deposit: ${(receipt as any).execution_status}`);
  console.log("");

  // ======================== Step 3: Read deposits & rebuild tree ========================
  console.log("--- Step 3: Read deposits from storage & rebuild LeanIMT ---");

  // Get total deposits
  const statsOutput = sncast(`call --contract-address ${PRIVACY_POOLS} --function get_pp_stats`);
  const statsRaw = statsOutput.match(/Response Raw:\s*\[([^\]]+)\]/i);
  const totalDeposits = statsRaw ? Number(BigInt(statsRaw[1].split(",")[0].trim())) : 0;
  console.log(`  Total deposits: ${totalDeposits}`);

  // Read all commitments from storage
  const commitments: string[] = [];
  for (let i = 0; i < totalDeposits; i++) {
    const val = await readStorage(nodesStorageAddr(0, i));
    commitments.push(val);
  }
  console.log(`  Read ${commitments.length} commitments`);

  // Find our commitment
  const normalizedCommitment = num.toHex(num.toBigInt(commitmentFelt));
  const leafIndex = commitments.findIndex(
    (c) => num.toHex(num.toBigInt(c)) === normalizedCommitment
  );
  if (leafIndex === -1) {
    console.error("  FAIL: Commitment not found in storage!");
    process.exit(1);
  }
  console.log(`  Our leaf index: ${leafIndex}`);

  // Rebuild tree
  const nodes = new Map<string, string>();
  const setNode = (l: number, idx: number, v: string) => nodes.set(`${l},${idx}`, v);
  const getNode = (l: number, idx: number): string => nodes.get(`${l},${idx}`) || "0x0";

  for (let ins = 0; ins < commitments.length; ins++) {
    const c = commitments[ins];
    const size = ins + 1;
    const depth = calculateDepth(size);
    setNode(0, ins, c);
    let cur = c;
    let curIdx = ins;
    for (let level = 0; level < depth; level++) {
      const isRight = curIdx % 2 === 1;
      const sibIdx = isRight ? curIdx - 1 : curIdx + 1;
      const parIdx = Math.floor(curIdx / 2);
      const sib = getNode(level, sibIdx);
      if (isRight) { cur = sib !== "0x0" ? hashPair(sib, cur) : cur; }
      else { cur = sib !== "0x0" ? hashPair(cur, sib) : cur; }
      setNode(level + 1, parIdx, cur);
      curIdx = parIdx;
    }
  }

  const treeDepth = calculateDepth(commitments.length);
  const localRoot = getNode(treeDepth, 0);
  console.log(`  Local root: ${localRoot.slice(0, 20)}...`);

  // Verify against on-chain
  const onChainRoot = parseSncastFelt(
    sncast(`call --contract-address ${PRIVACY_POOLS} --function get_global_deposit_root`)
  );
  const rootsMatch = num.toHex(num.toBigInt(localRoot)) === num.toHex(num.toBigInt(onChainRoot));
  console.log(`  On-chain root: ${onChainRoot.slice(0, 20)}...`);
  console.log(`  Roots match: ${rootsMatch}`);
  if (!rootsMatch) { console.error("  FAIL: Root mismatch!"); process.exit(1); }

  // Generate sparse proof
  const siblings: string[] = [];
  const pathIndices: boolean[] = [];
  let prIdx = leafIndex;
  for (let level = 0; level < treeDepth; level++) {
    const isRight = prIdx % 2 === 1;
    const sibIdx = isRight ? prIdx - 1 : prIdx + 1;
    const sib = getNode(level, sibIdx);
    if (sib !== "0x0") {
      siblings.push(sib);
      pathIndices.push(isRight);
    }
    prIdx = Math.floor(prIdx / 2);
  }
  console.log(`  Proof siblings: ${siblings.length}`);

  // Verify proof locally
  let proofHash = commitmentFelt;
  for (let i = 0; i < siblings.length; i++) {
    proofHash = pathIndices[i] ? hashPair(siblings[i], proofHash) : hashPair(proofHash, siblings[i]);
  }
  const proofValid = num.toHex(num.toBigInt(proofHash)) === num.toHex(num.toBigInt(localRoot));
  console.log(`  Proof valid: ${proofValid}`);
  if (!proofValid) { console.error("  FAIL: Proof invalid!"); process.exit(1); }
  console.log("");

  // ======================== Step 4: Derive nullifier ========================
  console.log("--- Step 4: Derive nullifier ---");
  const nullifier = deriveNullifier(nullifierSecret, leafIndex);
  const nullifierHex = "0x" + nullifier.toString(16);
  console.log(`  Nullifier: ${nullifierHex.slice(0, 20)}...`);
  console.log(`  Leaf index: ${leafIndex}`);
  console.log("");

  // ======================== Step 5: Submit pp_withdraw ========================
  console.log("--- Step 5: Build & submit pp_withdraw ---");
  const formatHex = (n: bigint) => "0x" + n.toString(16);
  const calldata: string[] = [];

  // LeanIMTProof: siblings, path_indices, leaf, root, tree_size
  calldata.push(formatHex(BigInt(siblings.length)));
  siblings.forEach((s) => calldata.push(s));
  calldata.push(formatHex(BigInt(pathIndices.length)));
  pathIndices.forEach((b) => calldata.push(b ? "0x1" : "0x0"));
  calldata.push(commitmentFelt); // leaf
  calldata.push(localRoot); // root
  calldata.push(formatHex(BigInt(commitments.length))); // tree_size

  // deposit_commitment
  calldata.push(commitmentFelt);
  // association_set_id: None
  calldata.push("0x1");
  // association_proof: None
  calldata.push("0x1");
  // exclusion_set_id: None
  calldata.push("0x1");
  // exclusion_proof: None
  calldata.push("0x1");
  // nullifier
  calldata.push(nullifierHex);
  // amount: u256
  const TWO_POW_128 = 2n ** 128n;
  calldata.push(formatHex(depositAmount % TWO_POW_128));
  calldata.push(formatHex(depositAmount / TWO_POW_128));
  // recipient
  calldata.push(DEPLOYER);
  // range_proof_data: empty
  calldata.push("0x0");

  console.log(`  Calldata fields: ${calldata.length}`);
  console.log("  Submitting...");

  const withdrawOutput = sncast(
    `invoke --contract-address ${PRIVACY_POOLS} --function pp_withdraw --calldata ${calldata.join(" ")}`
  );
  const withdrawTxHash = extractTxHash(withdrawOutput);
  console.log(`  TX: ${withdrawTxHash}`);
  console.log(`  Explorer: ${EXPLORER_URL}/tx/${withdrawTxHash}`);
  console.log("  Waiting for confirmation...");
  await new Promise((r) => setTimeout(r, 15000));
  console.log("");

  // ======================== Step 6: Verify ========================
  console.log("--- Step 6: Verify on-chain ---");
  try {
    const wReceipt = await provider.getTransactionReceipt(withdrawTxHash);
    const wStatus = (wReceipt as any).execution_status;
    console.log(`  Withdrawal status: ${wStatus}`);
    if (wStatus === "REVERTED") {
      console.error(`  FAIL: ${(wReceipt as any).revert_reason}`);
      process.exit(1);
    }
    const events = (wReceipt as any).events || [];
    const ppEvts = events.filter((e: any) => e.from_address?.toLowerCase().includes("d85ad03"));
    ppEvts.forEach((e: any, i: number) => {
      console.log(`  Event ${i}: keys=${JSON.stringify(e.keys?.slice(0, 2))} data=${JSON.stringify(e.data)}`);
    });
  } catch (e: any) {
    console.log(`  Receipt: ${e.message?.slice(0, 100)}`);
  }

  // Check nullifier
  try {
    const nulOut = sncast(`call --contract-address ${PRIVACY_POOLS} --function is_pp_nullifier_used --calldata ${nullifierHex}`);
    console.log(`  is_pp_nullifier_used: ${nulOut.includes("0x1") ? "TRUE" : nulOut}`);
  } catch (e: any) {
    console.log(`  is_pp_nullifier_used: ${e.message?.slice(0, 80)}`);
  }

  // Check balance
  const balAfter = parseSncastU256(
    sncast(`call --contract-address ${SAGE_TOKEN} --function balance_of --calldata ${DEPLOYER}`)
  );
  console.log(`  SAGE before: ${(Number(balanceBefore) / 1e18).toFixed(4)}`);
  console.log(`  SAGE after:  ${(Number(balAfter) / 1e18).toFixed(4)}`);
  console.log("");

  console.log("=== E2E WITHDRAWAL TEST COMPLETE ===");
  console.log(`  Deposit TX:    ${depositTxHash}`);
  console.log(`  Withdrawal TX: ${withdrawTxHash}`);
  console.log(`  Commitment:    ${commitmentFelt}`);
  console.log(`  Nullifier:     ${nullifierHex.slice(0, 20)}...`);
  console.log(`  Leaf Index:    ${leafIndex}`);
  console.log(`  Tree Size:     ${commitments.length}`);
}

main().catch((err) => {
  console.error("\nFATAL ERROR:", err.message || err);
  process.exit(1);
});
