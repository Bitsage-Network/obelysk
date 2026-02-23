/**
 * Garden Finance Bridge Provider (Phase 2)
 *
 * Implements BtcBridgeProvider for native BTC → Starknet wBTC bridging
 * via Garden Finance's HTLC protocol.
 *
 * Unlike the ERC20 passthrough provider, this handles real cross-chain bridging:
 * 1. Get quote from Garden API
 * 2. Create order → receive BTC deposit address (HTLC)
 * 3. User sends BTC → Garden swaps → wBTC lands on Starknet
 * 4. Caller continues with VM31 deposit (ERC20 approve → relayer submit)
 */

import type {
  BtcBridgeProvider,
  BridgeEstimate,
  BridgeParams,
  BridgeResult,
  GardenBridgeParams,
  GardenBridgeResult,
} from "./types";
import {
  getQuote,
  createBtcToStarknetOrder,
  GARDEN_ASSETS,
  type GardenNetwork,
} from "./gardenApi";
import { EXTERNAL_TOKENS } from "../contracts/addresses";

export class GardenBridgeProvider implements BtcBridgeProvider {
  readonly name = "garden" as const;
  readonly displayName = "Garden Finance (Native BTC)";
  readonly supportedAssets = ["BTC"];

  constructor(private network: GardenNetwork) {}

  private get wbtcAddress(): string {
    const tokens = EXTERNAL_TOKENS[this.network as keyof typeof EXTERNAL_TOKENS];
    return (tokens as Record<string, string>)?.["wBTC"] || "0x0";
  }

  private get assets() {
    return GARDEN_ASSETS[this.network];
  }

  async estimateBridge(amount: bigint, _sourceAsset: string): Promise<BridgeEstimate> {
    const quotes = await getQuote(
      this.assets.btc,
      this.assets.wbtc,
      amount.toString(),
      this.network,
    );

    if (!quotes || quotes.length === 0) {
      throw new Error("No Garden quotes available for this amount");
    }

    const best = quotes[0];
    return {
      outputAmount: BigInt(best.destination.amount),
      fee: BigInt(best.fee),
      estimatedTime: best.estimated_time,
      tokenAddress: this.wbtcAddress,
    };
  }

  async executeBridge(params: BridgeParams): Promise<BridgeResult> {
    const gardenParams = params as GardenBridgeParams;
    if (!gardenParams.btcAddress) {
      return {
        success: false,
        outputAmount: 0n,
        error: "BTC source address is required for Garden bridge",
      };
    }

    try {
      const order = await createBtcToStarknetOrder(
        {
          asset: this.assets.btc,
          owner: gardenParams.btcAddress,
          amount: params.amount.toString(),
        },
        {
          asset: this.assets.wbtc,
          owner: params.recipient,
          amount: gardenParams.receiveAmount || params.amount.toString(),
        },
        this.network,
      );

      const result: GardenBridgeResult = {
        success: true,
        outputAmount: params.amount,
        orderId: order.order_id,
        depositAddress: order.to,
        depositAmount: order.amount,
      };

      return result;
    } catch (err) {
      return {
        success: false,
        outputAmount: 0n,
        error: err instanceof Error ? err.message : "Garden order creation failed",
      };
    }
  }
}
