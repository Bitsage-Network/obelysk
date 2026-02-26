"use client";

import { ReactNode, useMemo } from "react";
import { sepolia, mainnet, type Chain } from "@starknet-react/chains";
import {
  StarknetConfig,
  publicProvider,
  jsonRpcProvider,
  argent,
  braavos,
  useInjectedConnectors,
  voyager,
} from "@starknet-react/core";
import { ObelyskWalletProvider } from "@/lib/obelysk/ObelyskWalletContext";
import { BitSageSDKProvider } from "@/lib/providers/BitSageSDKProvider";
import { NetworkProvider } from "@/lib/contexts/NetworkContext";
import { NETWORK_CONFIG } from "@/lib/contracts/addresses";
import { initializeWarningSuppression } from "@/lib/utils/suppressWarnings";

// Initialize warning suppression for library deprecation messages
initializeWarningSuppression();

/**
 * Inner wrapper that provides SDK context
 *
 * IMPORTANT: Always mount the SDK providers to avoid "must be used within provider"
 * errors when components use SDK hooks. The providers internally handle the
 * not-connected state by returning default/empty values.
 *
 * Previously we delayed mounting until wallet was connected, but this caused
 * React error boundaries to trigger re-renders when hooks were called outside
 * the provider context.
 */
function SDKWrapper({ children }: { children: ReactNode }) {
  // In demo mode, skip SDK providers entirely
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    return <>{children}</>;
  }

  // Always mount SDK providers - they handle the not-connected state internally
  // This prevents "must be used within provider" errors
  return (
    <BitSageSDKProvider>
      <ObelyskWalletProvider>
        {children}
      </ObelyskWalletProvider>
    </BitSageSDKProvider>
  );
}

// Check if demo mode is enabled
const IS_DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

// Custom devnet chain configuration
const devnet: Chain = {
  id: BigInt("0x534e5f5345504f4c4941"), // Uses Sepolia chain ID for compatibility
  network: "devnet",
  name: "Local Devnet",
  nativeCurrency: {
    address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    name: "Ethereum",
    symbol: "ETH",
    decimals: 18,
  },
  testnet: true,
  rpcUrls: {
    default: {
      http: ["http://localhost:5050"],
    },
    public: {
      http: ["http://localhost:5050"],
    },
  },
  paymasterRpcUrls: {
    default: {
      http: [],
    },
  },
};

interface StarknetProviderProps {
  children: ReactNode;
  network?: "devnet" | "sepolia" | "mainnet";
}

// Get network from env on client side
const getNetworkFromEnv = (): "devnet" | "sepolia" | "mainnet" => {
  if (typeof window !== "undefined") {
    return (process.env.NEXT_PUBLIC_STARKNET_NETWORK || "sepolia") as "devnet" | "sepolia" | "mainnet";
  }
  return "sepolia"; // Default for SSR
};

// CORS-friendly RPC provider factory — used for ALL networks
// BlastAPI (starknet-react default) blocks CORS from custom domains,
// so we always use Alchemy or env-configured RPC.
function corsProvider(network: "devnet" | "sepolia" | "mainnet") {
  if (network === "devnet") {
    return jsonRpcProvider({
      rpc: () => ({ nodeUrl: NETWORK_CONFIG.devnet.rpcUrl }),
    });
  }
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL
    || NETWORK_CONFIG[network]?.rpcUrl
    || "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/demo";
  return jsonRpcProvider({
    rpc: () => ({ nodeUrl: rpcUrl }),
  });
}

export function StarknetProvider({ children, network: networkProp }: StarknetProviderProps) {
  // Use env variable directly - NEXT_PUBLIC_* is available on both server and client
  const envNetwork = process.env.NEXT_PUBLIC_STARKNET_NETWORK as "devnet" | "sepolia" | "mainnet" | undefined;
  const network = networkProp || envNetwork || "sepolia";

  // Use injected connectors (ArgentX, Braavos, etc.)
  const { connectors } = useInjectedConnectors({
    recommended: [argent(), braavos()],
    includeRecommended: "always",
    order: "alphabetical",
    shimLegacyConnectors: ["braavos", "argentX"],
  });

  // Configure chains — only include the target network's chain.
  // Including multiple chains causes starknet-react to call
  // wallet_switchStarknetChain which many wallets (Braavos) don't support.
  // Users must switch networks in their wallet UI if needed.
  const chains = useMemo(() => {
    if (network === "devnet") {
      return [devnet];
    }
    if (network === "mainnet") {
      return [mainnet];
    }
    return [sepolia];
  }, [network]);

  // Always use CORS-friendly RPC — never fall back to publicProvider (BlastAPI)
  const provider = useMemo(() => corsProvider(network), [network]);

  return (
    <StarknetConfig
      chains={chains}
      provider={provider}
      connectors={connectors}
      explorer={voyager}
      autoConnect
    >
      <NetworkProvider network={network}>
        <SDKWrapper>{children}</SDKWrapper>
      </NetworkProvider>
    </StarknetConfig>
  );
}
