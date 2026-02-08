/**
 * Deploy StealthRegistry Contract on Starknet Sepolia
 *
 * The StealthRegistry stores stealth meta-addresses and announces
 * stealth payments for private receiving.
 *
 * Steps:
 *   1. Declare the class (if not already declared)
 *   2. Deploy new contract instance with constructor args
 *   3. Output the new contract address
 *
 * Usage:
 *   npx tsx scripts/deploy-stealth-registry.ts
 *
 * Prerequisites:
 *   - sncast v0.54+ with deployer account configured
 *   - STRK balance for gas fees
 *   - Contract compiled in ../contracts/
 */

import { execSync } from "child_process";

// ============================================================================
// Config
// ============================================================================

const EXPLORER_URL = "https://sepolia.starkscan.co";
const SNCAST_DIR = "/Users/vaamx/bitsage-network/Obelysk-Protocol/contracts";

// Constructor args
const DEPLOYER_ADDRESS = "0x0759a4374389b0e3cfcc59d49310b6bc75bb12bbf8ce550eb5c2f026918bb344";
const SAGE_TOKEN = "0x072349097c8a802e7f66dc96b95aca84e4d78ddad22014904076c76293a99850";

// ============================================================================
// Helpers
// ============================================================================

function sncast(args: string): string {
  const cmd = `cd "${SNCAST_DIR}" && sncast --wait ${args}`;
  console.log(`  $ ${cmd}`);
  try {
    const output = execSync(cmd, { encoding: "utf-8", timeout: 180_000 });
    return output.trim();
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    console.error("sncast failed:", err.stderr || err.stdout);
    throw e;
  }
}

function extractField(output: string, field: string): string | null {
  const fieldVariants = [
    field,
    field.replace(/_/g, " "),
    field.replace(/_(\w)/g, (_, c) => " " + c),
    field.replace(/_(\w)/g, (_, c: string) => " " + c.toUpperCase()),
    field.split("_").map((w: string) => w[0].toUpperCase() + w.slice(1)).join(" "),
  ];
  for (const variant of fieldVariants) {
    const patterns = [
      new RegExp(`${variant}:\\s*(0x[a-fA-F0-9]+)`, "i"),
      new RegExp(`"${variant}"\\s*:\\s*"?(0x[a-fA-F0-9]+)"?`, "i"),
    ];
    for (const p of patterns) {
      const m = output.match(p);
      if (m) return m[1];
    }
  }
  return null;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("=== Deploy StealthRegistry ===\n");

  // Step 1: Declare the class
  console.log("Step 1: Declaring StealthRegistry class...");
  let classHash: string | null = null;

  try {
    const declareOutput = sncast(
      `declare --contract-name StealthRegistry`
    );
    console.log(declareOutput);
    classHash = extractField(declareOutput, "class_hash");
  } catch (e: unknown) {
    // Check if already declared
    const err = e as { stdout?: string; stderr?: string };
    const output = (err.stdout || "") + (err.stderr || "");
    classHash = extractField(output, "class_hash");
    if (classHash) {
      console.log(`  Class already declared: ${classHash}`);
    } else {
      throw e;
    }
  }

  if (!classHash) {
    console.error("ERROR: Could not extract class_hash");
    process.exit(1);
  }
  console.log(`  Class hash: ${classHash}\n`);

  // Step 2: Deploy with constructor(owner, sage_token)
  console.log("Step 2: Deploying StealthRegistry...");
  const constructorCalldata = `${DEPLOYER_ADDRESS} ${SAGE_TOKEN}`;
  const deployOutput = sncast(
    `deploy --class-hash ${classHash} --constructor-calldata ${constructorCalldata}`
  );
  console.log(deployOutput);

  const contractAddress = extractField(deployOutput, "contract_address");
  if (!contractAddress) {
    console.error("ERROR: Could not extract contract_address");
    console.error("Output was:", deployOutput);
    process.exit(1);
  }

  console.log(`\n=== DEPLOYMENT COMPLETE ===\n`);
  console.log(`StealthRegistry: ${contractAddress}`);
  console.log(`Class hash: ${classHash}`);
  console.log(`Explorer: ${EXPLORER_URL}/contract/${contractAddress}`);
  console.log(`\nUpdate CONTRACTS in src/lib/contracts/addresses.ts:`);
  console.log(`  STEALTH_REGISTRY: "${contractAddress}",`);
}

main().catch(console.error);
