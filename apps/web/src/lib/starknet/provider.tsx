"use client";

import { ReactNode, useMemo } from "react";
import { sepolia, mainnet, type Chain } from "@starknet-react/chains";
import {
  StarknetConfig,
  jsonRpcProvider,
  argent,
  braavos,
  useInjectedConnectors,
  useNetwork as useStarknetNetwork,
  voyager,
} from "@starknet-react/core";
import { ObelyskWalletProvider } from "@/lib/obelysk/ObelyskWalletContext";
import { BitSageSDKProvider } from "@/lib/providers/BitSageSDKProvider";
import { NetworkProvider } from "@/lib/contexts/NetworkContext";
import { NETWORK_CONFIG } from "@/lib/contracts/addresses";
import { initializeWarningSuppression } from "@/lib/utils/suppressWarnings";

// Initialize warning suppression for library deprecation messages
initializeWarningSuppression();

// Starknet chain IDs
const SN_MAIN = BigInt("0x534e5f4d41494e");
const SN_SEPOLIA = BigInt("0x534e5f5345504f4c4941");

/**
 * Inner wrapper that provides SDK context
 */
function SDKWrapper({ children }: { children: ReactNode }) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    return <>{children}</>;
  }
  return (
    <BitSageSDKProvider>
      <ObelyskWalletProvider>
        {children}
      </ObelyskWalletProvider>
    </BitSageSDKProvider>
  );
}

/**
 * Detects the connected wallet's network and provides it via NetworkContext.
 * Falls back to env var default when no wallet is connected.
 */
function NetworkDetector({ children, defaultNetwork }: { children: ReactNode; defaultNetwork: "devnet" | "sepolia" | "mainnet" }) {
  const { chain } = useStarknetNetwork();

  const network = useMemo(() => {
    if (!chain?.id) return defaultNetwork;
    if (chain.id === SN_MAIN) return "mainnet";
    if (chain.id === SN_SEPOLIA) return "sepolia";
    return defaultNetwork;
  }, [chain?.id, defaultNetwork]);

  return (
    <NetworkProvider network={network}>
      <SDKWrapper>{children}</SDKWrapper>
    </NetworkProvider>
  );
}

// Custom devnet chain configuration
const devnet: Chain = {
  id: SN_SEPOLIA, // Uses Sepolia chain ID for compatibility
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

// CORS-friendly RPC provider factory that handles BOTH mainnet and sepolia.
// starknet-react calls the provider function with each chain to get the RPC URL,
// so we return the correct URL based on the chain being configured.
function multiNetworkProvider() {
  const mainnetRpc = process.env.NEXT_PUBLIC_MAINNET_RPC_URL
    || process.env.NEXT_PUBLIC_RPC_URL
    || NETWORK_CONFIG.mainnet?.rpcUrl
    || "https://rpc.starknet.lava.build";

  const sepoliaRpc = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL
    || NETWORK_CONFIG.sepolia?.rpcUrl
    || "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/demo";

  return jsonRpcProvider({
    rpc: (chain: Chain) => {
      if (chain.id === SN_MAIN) {
        return { nodeUrl: mainnetRpc };
      }
      // Sepolia / devnet / anything else
      return { nodeUrl: sepoliaRpc };
    },
  });
}

export function StarknetProvider({ children, network: networkProp }: StarknetProviderProps) {
  const envNetwork = process.env.NEXT_PUBLIC_STARKNET_NETWORK as "devnet" | "sepolia" | "mainnet" | undefined;
  const defaultNetwork = networkProp || envNetwork || "sepolia";

  // Use injected connectors (ArgentX, Braavos, etc.)
  const { connectors: rawConnectors } = useInjectedConnectors({
    recommended: [argent(), braavos()],
    includeRecommended: "always",
    order: "alphabetical",
    shimLegacyConnectors: ["braavos", "argentX"],
  });

  // Patch connectors to gracefully handle wallet_switchStarknetChain failures.
  // Braavos (and some other wallets) don't support this RPC method, causing
  // "Unsupported dApp request" errors on connect. We wrap switchChain to
  // catch and silently ignore the error — the wallet stays on its current chain.
  const connectors = useMemo(() => {
    return rawConnectors.map((connector) => {
      const proto = Object.getPrototypeOf(connector);
      if (proto && typeof proto.switchChain === "function" && !proto._switchChainPatched) {
        const originalSwitchChain = proto.switchChain;
        proto.switchChain = async function (chainId: bigint) {
          try {
            await originalSwitchChain.call(this, chainId);
          } catch {
            // wallet_switchStarknetChain not supported — ignore silently
          }
        };
        proto._switchChainPatched = true;
      }
      return connector;
    });
  }, [rawConnectors]);

  // Include BOTH mainnet and sepolia chains so the app works with either wallet.
  // The switchChain patch above prevents errors from wallets that don't support
  // wallet_switchStarknetChain. NetworkDetector auto-detects which chain the
  // wallet is on and sets the correct network context.
  const chains = useMemo(() => {
    if (defaultNetwork === "devnet") {
      return [devnet];
    }
    // Default chain first (preferred), other chain as fallback
    if (defaultNetwork === "mainnet") {
      return [mainnet, sepolia];
    }
    return [sepolia, mainnet];
  }, [defaultNetwork]);

  const provider = useMemo(() => multiNetworkProvider(), []);

  return (
    <StarknetConfig
      chains={chains}
      provider={provider}
      connectors={connectors}
      explorer={voyager}
      autoConnect
    >
      <NetworkDetector defaultNetwork={defaultNetwork}>
        {children}
      </NetworkDetector>
    </StarknetConfig>
  );
}
