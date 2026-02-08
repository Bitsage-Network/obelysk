/**
 * Deploy Per-Token Privacy Pool Instances on Starknet Sepolia
 *
 * The PrivacyPools contract is a single-token contract — each instance handles
 * one ERC20 token. The SAGE pool is already deployed. This script deploys
 * additional pool instances for ETH and STRK so that shielded swaps work.
 *
 * Steps:
 *   1. Fetch the class hash from the existing PrivacyPools deployment
 *   2. Deploy new contract instances (same class hash, empty constructor)
 *   3. Call initialize() on each with the respective token address
 *   4. Output the new addresses for PRIVACY_POOL_REGISTRY
 *
 * Usage:
 *   npx tsx scripts/deploy-per-token-pools.ts
 *
 * Prerequisites:
 *   - sncast v0.54+ with deployer account configured
 *   - STRK balance for gas fees
 */

import { RpcProvider, Contract, CallData } from "starknet";
import { execSync } from "child_process";

// ============================================================================
// Config
// ============================================================================

const RPC_URL = "https://api.cartridge.gg/x/starknet/sepolia";
const EXPLORER_URL = "https://sepolia.starkscan.co";
const SNCAST_DIR = "/Users/vaamx/bitsage-network/Obelysk-Protocol/contracts";

// Existing contracts
const EXISTING_PRIVACY_POOLS = "0x0d85ad03dcd91a075bef0f4226149cb7e43da795d2c1d33e3227c68bfbb78a7";
const PRIVACY_ROUTER = "0x7d1a6c242a4f0573696e117790f431fd60518a000b85fe5ee507456049ffc53";

// Deployer is the owner for initialize()
const DEPLOYER_ADDRESS = "0x0759a4374389b0e3cfcc59d49310b6bc75bb12bbf8ce550eb5c2f026918bb344";

// Token addresses (Sepolia)
const TOKENS: Record<string, string> = {
  ETH: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  STRK: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  USDC: "0x053b40A647CEDfca6cA84f542A0fe36736031905A9639a7f19A3C1e66bFd5080",
};

const provider = new RpcProvider({ nodeUrl: RPC_URL });

// ============================================================================
// Helpers
// ============================================================================

function sncast(args: string): string {
  const cmd = `cd "${SNCAST_DIR}" && sncast --wait ${args}`;
  console.log(`  $ ${cmd}`);
  try {
    const output = execSync(cmd, { encoding: "utf-8", timeout: 120_000 });
    return output.trim();
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    console.error("sncast failed:", err.stderr || err.stdout);
    throw e;
  }
}

function extractField(output: string, field: string): string | null {
  // sncast outputs "Contract Address: 0x..." (capitalized, with space)
  // Also handle snake_case and JSON formats
  const fieldVariants = [
    field,
    field.replace(/_/g, " "),                    // contract_address -> contract address
    field.replace(/_(\w)/g, (_, c) => " " + c),  // keep lowercase
    field.replace(/_(\w)/g, (_, c: string) => " " + c.toUpperCase()), // Contract Address
    field.split("_").map((w: string) => w[0].toUpperCase() + w.slice(1)).join(" "), // Contract Address
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
  console.log("=== Deploy Per-Token Privacy Pools ===\n");

  // Step 1: Get class hash from existing deployment
  console.log("Step 1: Fetching class hash from existing PrivacyPools...");
  const classHash = await provider.getClassHashAt(EXISTING_PRIVACY_POOLS);
  console.log(`  Class hash: ${classHash}\n`);

  const results: Record<string, string> = {};

  for (const [symbol, tokenAddress] of Object.entries(TOKENS)) {
    console.log(`\n--- Deploying ${symbol} Privacy Pool ---`);

    // Step 2: Deploy new instance (no constructor args)
    console.log(`Step 2: Deploying new PrivacyPools instance for ${symbol}...`);
    const deployOutput = sncast(
      `deploy --class-hash ${classHash}`
    );
    console.log(deployOutput);

    const newAddress = extractField(deployOutput, "contract_address");
    if (!newAddress) {
      console.error(`ERROR: Could not extract contract_address from deploy output`);
      console.error("Output was:", deployOutput);
      continue;
    }
    console.log(`  Deployed at: ${newAddress}`);
    console.log(`  Explorer: ${EXPLORER_URL}/contract/${newAddress}`);

    // Step 3: Call initialize(owner, sage_token, privacy_router)
    // Note: "sage_token" param is actually the pool's ERC20 token
    console.log(`Step 3: Initializing with token=${symbol} (${tokenAddress})...`);
    const initCalldata = [DEPLOYER_ADDRESS, tokenAddress, PRIVACY_ROUTER].join(" ");
    const initOutput = sncast(
      `invoke --contract-address ${newAddress} --function initialize --calldata ${initCalldata}`
    );
    console.log(initOutput);

    const txHash = extractField(initOutput, "transaction_hash");
    if (txHash) {
      console.log(`  Init tx: ${EXPLORER_URL}/tx/${txHash}`);
    }

    // Step 4: Verify initialization
    console.log(`Step 4: Verifying initialization...`);
    try {
      const result = await provider.callContract({
        contractAddress: newAddress,
        entrypoint: "is_initialized",
        calldata: [],
      });
      const isInit = result[0] !== "0x0";
      console.log(`  is_initialized: ${isInit}`);
      if (!isInit) {
        console.error(`  WARNING: Contract at ${newAddress} is NOT initialized!`);
      }
    } catch (e) {
      console.error(`  Could not verify (might need block confirmation):`, e);
    }

    results[symbol] = newAddress;
  }

  // Summary
  console.log("\n\n=== DEPLOYMENT COMPLETE ===\n");
  console.log("Update PRIVACY_POOL_REGISTRY in src/lib/swap/shieldedSwap.ts:\n");
  console.log("sepolia: {");
  console.log(`  SAGE: "${EXISTING_PRIVACY_POOLS}",`);
  for (const [symbol, addr] of Object.entries(results)) {
    console.log(`  ${symbol}: "${addr}",`);
  }
  console.log("}");
  console.log("\nAlso update CONTRACTS in src/lib/contracts/addresses.ts if needed.");
}

main().catch(console.error);
