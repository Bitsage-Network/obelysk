/**
 * ERC20 Bridge Provider (Phase 1)
 *
 * Trivial passthrough for BTC-backed ERC20 tokens already on Starknet.
 * No actual bridging — the token is already on-chain, so the user just
 * needs to approve the VM31Pool to spend it, then call deposit().
 *
 * This implements the BtcBridgeProvider interface so Phase 2 can swap
 * in an AtomiqProvider or GardenProvider that handles native BTC → Starknet.
 */

import type { BtcBridgeProvider, BridgeEstimate, BridgeParams, BridgeResult } from "./types";

export class Erc20BridgeProvider implements BtcBridgeProvider {
  readonly name = "erc20" as const;
  readonly displayName = "Starknet ERC20 (Direct)";
  readonly supportedAssets = ["wBTC", "LBTC", "tBTC", "SolvBTC"];

  private tokenAddresses: Record<string, string>;

  constructor(tokenAddresses: Record<string, string>) {
    this.tokenAddresses = tokenAddresses;
  }

  async estimateBridge(amount: bigint, sourceAsset: string): Promise<BridgeEstimate> {
    const tokenAddress = this.tokenAddresses[sourceAsset];
    if (!tokenAddress || tokenAddress === "0x0") {
      throw new Error(`${sourceAsset} is not available on Starknet`);
    }

    // No bridging needed — zero fee, instant
    return {
      outputAmount: amount,
      fee: 0n,
      estimatedTime: 0,
      tokenAddress,
    };
  }

  async executeBridge(params: BridgeParams): Promise<BridgeResult> {
    const tokenAddress = this.tokenAddresses[params.sourceAsset];
    if (!tokenAddress || tokenAddress === "0x0") {
      return {
        success: false,
        outputAmount: 0n,
        error: `${params.sourceAsset} is not available on Starknet`,
      };
    }

    // ERC20 tokens are already on Starknet — no bridge operation needed.
    // The caller handles ERC20 approve + VM31Pool.deposit() separately.
    return {
      success: true,
      outputAmount: params.amount,
    };
  }
}
