/**
 * Core relay logic
 *
 * Validates, constructs, and submits dark pool transactions
 * on behalf of users via a dedicated relayer account.
 */

import { Account, RpcProvider, hash, type Call } from "starknet";
import { config } from "./config";
import { checkRateLimit } from "./rateLimiter";
import type { RelayPayload } from "./validation";

// Singleton provider and account
let provider: RpcProvider | null = null;
let relayerAccount: Account | null = null;

function getProvider(): RpcProvider {
  if (!provider) {
    provider = new RpcProvider({ nodeUrl: config.rpcUrl });
  }
  return provider;
}

function getRelayerAccount(): Account {
  if (!relayerAccount) {
    if (!config.relayPrivateKey || !config.relayAccountAddress) {
      throw new Error("Relayer account not configured");
    }
    const p = getProvider();
    relayerAccount = new Account(p, config.relayAccountAddress, config.relayPrivateKey);
  }
  return relayerAccount;
}

export interface RelayResult {
  transactionHash: string;
  status: "submitted" | "error";
  error?: string;
}

/**
 * Submit a relay transaction
 *
 * Flow:
 * 1. Rate limit check
 * 2. Build execute_from_outside call + the actual operation calls
 * 3. Submit via relayer account
 * 4. Wait for inclusion
 */
export async function submitRelay(payload: RelayPayload): Promise<RelayResult> {
  // 1. Rate limit
  if (!checkRateLimit(payload.ownerAddress)) {
    return {
      transactionHash: "",
      status: "error",
      error: "Rate limit exceeded. Try again in a few minutes.",
    };
  }

  try {
    const account = getRelayerAccount();

    // 2. Build the execute_from_outside authorization call
    //
    // Contract signature:
    //   execute_from_outside(caller, nonce, execute_after, execute_before,
    //     call_entrypoint: felt252, call_calldata: Array<felt252>, signature: Array<felt252>)
    //
    // The entrypoint must be a felt252 selector (starknet_keccak), not a string.
    // Timestamps must be hex felt strings. Arrays use length-prefix encoding.

    const firstCall = payload.outsideExecution.calls[0];
    const entrypointSelector = firstCall
      ? hash.getSelectorFromName(firstCall.entrypoint)
      : "0x0";
    const callCalldata = firstCall?.calldata ?? [];

    const authCall: Call = {
      contractAddress: config.darkPoolAddress,
      entrypoint: "execute_from_outside",
      calldata: [
        payload.outsideExecution.caller,                          // caller: ContractAddress
        payload.outsideExecution.nonce,                            // nonce: felt252
        "0x" + payload.outsideExecution.executeAfter.toString(16), // execute_after: u64
        "0x" + payload.outsideExecution.executeBefore.toString(16), // execute_before: u64
        entrypointSelector,                                        // call_entrypoint: felt252
        // call_calldata: Array<felt252> — length prefix + elements
        callCalldata.length.toString(),
        ...callCalldata,
        // signature: Array<felt252> — length prefix + elements
        payload.signature.length.toString(),
        ...payload.signature,
      ],
    };

    // 3. Build the actual dark pool calls (submitted alongside auth in a multicall)
    const operationCalls: Call[] = payload.outsideExecution.calls.map((c) => ({
      contractAddress: c.contractAddress,
      entrypoint: c.entrypoint,
      calldata: c.calldata,
    }));

    // 4. Submit multicall: auth + operations
    const allCalls = [authCall, ...operationCalls];
    const response = await account.execute(allCalls);

    // 5. Return tx hash immediately — don't block on confirmation
    // Clients can poll /status/:txHash for confirmation status
    return {
      transactionHash: response.transaction_hash,
      status: "submitted",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown relay error";
    console.error("[Relay] Submission failed:", message);
    return {
      transactionHash: "",
      status: "error",
      error: message,
    };
  }
}

/**
 * Get the relayer account's STRK balance (for monitoring)
 */
export async function getRelayerBalance(): Promise<string> {
  try {
    const p = getProvider();
    const strkAddress = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

    const result = await p.callContract({
      contractAddress: strkAddress,
      entrypoint: "balance_of",
      calldata: [config.relayAccountAddress],
    });

    const low = BigInt(result[0] || "0");
    const high = BigInt(result[1] || "0");
    const balance = (high << 128n) | low;
    const strkBalance = Number(balance) / 1e18;
    return strkBalance.toFixed(4);
  } catch {
    return "unknown";
  }
}
