/**
 * StarkGate Bridge Service
 *
 * Pure logic for L1<->L2 bridging via StarkGate contracts.
 * Uses window.ethereum for L1 and starknet.js Call[] for L2.
 * No React dependencies — consumed by useStarkGateBridge hook.
 *
 * Key protocol details (from starkgate-contracts source):
 *   - L1 deposit uses legacy `deposit(uint256 amount, uint256 l2Recipient)` payable
 *   - ETH deposit: msg.value = amount + messagingFee
 *   - ERC20 deposit: msg.value = messagingFee (token transferred via approve+transferFrom)
 *   - L2 withdrawal: call `initiate_token_withdraw` on the L2 BRIDGE contract
 *     (NOT the token contract). No approve needed — bridge uses permissioned_burn.
 */

import type { Call } from "starknet";
import {
  STARKGATE_BRIDGES,
  L1_TOKEN_ADDRESSES,
  ETHEREUM_CHAIN_CONFIG,
  TOKEN_METADATA,
  type BridgeTokenSymbol,
} from "@/lib/contracts/addresses";

// ============================================================================
// TYPES
// ============================================================================

export type BridgeDirection = "deposit" | "withdraw";

export type BridgeStage =
  | "idle"
  | "connecting"
  | "switching-chain"
  | "approving"
  | "depositing"
  | "confirming"
  | "l2-processing"
  | "confirmed"
  | "error";

export interface BridgeState {
  stage: BridgeStage;
  message: string;
  progress: number;
  error: string | null;
  l1TxHash: string | null;
  l2TxHash: string | null;
}

export interface BridgeDepositParams {
  token: BridgeTokenSymbol;
  amount: string;
  l2Recipient: string;
  network: "sepolia" | "mainnet";
}

export interface WithdrawParams {
  token: BridgeTokenSymbol;
  amount: string;
  l1Recipient: string;
  network: "sepolia" | "mainnet";
}

export interface GasEstimate {
  gasWei: bigint;
  gasEth: string;
  gasGwei: string;
}

// ============================================================================
// ETHEREUM PROVIDER TYPE
// ============================================================================

declare global {
  interface Window {
    ethereum?: unknown;
  }
}

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

function getEthereumProvider(): EthereumProvider {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("MetaMask or an Ethereum wallet is required for L1 bridging");
  }
  return window.ethereum as unknown as EthereumProvider;
}

// ============================================================================
// HEX ENCODING UTILITIES
// ============================================================================

/** Pad a hex value to 32 bytes (64 hex chars) */
function padHex32(hex: string): string {
  const clean = hex.replace(/^0x/i, "");
  return clean.padStart(64, "0");
}

/** Encode a uint256 amount as 32-byte hex */
function encodeUint256(amount: bigint): string {
  return padHex32(amount.toString(16));
}

/** Encode a Starknet address as 32-byte hex (for deposit's L2 recipient) */
function encodeStarknetAddress(starknetAddress: string): string {
  return padHex32(starknetAddress.replace(/^0x/i, ""));
}

/** Parse human-readable amount to raw bigint using token decimals */
export function parseAmount(amount: string, token: BridgeTokenSymbol): bigint {
  const decimals = TOKEN_METADATA[token]?.decimals ?? 18;
  const [whole = "0", frac = ""] = amount.split(".");
  const paddedFrac = frac.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole + paddedFrac);
}

// ============================================================================
// FUNCTION SELECTORS (keccak256 first 4 bytes)
// ============================================================================

// deposit(uint256 amount, uint256 l2Recipient) — legacy StarkGate bridge
// keccak256("deposit(uint256,uint256)") = 0xe2bbb158...
const DEPOSIT_SELECTOR = "0xe2bbb158";

// approve(address spender, uint256 amount) — ERC20
// keccak256("approve(address,uint256)") = 0x095ea7b3...
const APPROVE_SELECTOR = "0x095ea7b3";

// ============================================================================
// L1→L2 MESSAGING FEE
// ============================================================================

// StarkGate fee constants from contract source:
//   DEPOSIT_FEE_GAS = 20,000
//   DEFAULT_WEI_PER_GAS = 5 * 10^9
// Default fee = 20,000 * 5 * 10^9 = 10^14 wei = 0.0001 ETH
// We use a slightly higher value to account for gas price fluctuations.
const L1_TO_L2_MESSAGE_FEE = BigInt("200000000000000"); // 0.0002 ETH (safe margin)

// ============================================================================
// L1 OPERATIONS
// ============================================================================

/** Get the current chain ID from MetaMask */
export async function getCurrentChainId(): Promise<string> {
  const provider = getEthereumProvider();
  const chainId = await provider.request({ method: "eth_chainId" });
  return chainId as string;
}

/** Get connected L1 accounts */
export async function getL1Accounts(): Promise<string[]> {
  const provider = getEthereumProvider();
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  return accounts as string[];
}

/** Ensure MetaMask is on the correct Ethereum chain */
export async function ensureCorrectChain(
  network: "sepolia" | "mainnet"
): Promise<void> {
  const provider = getEthereumProvider();
  const config = ETHEREUM_CHAIN_CONFIG[network];
  const currentChainId = await getCurrentChainId();

  if (currentChainId.toLowerCase() === config.chainId.toLowerCase()) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: config.chainId }],
    });
  } catch (switchError: unknown) {
    // Chain not added — add it
    if ((switchError as { code?: number })?.code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: config.chainId,
            chainName: config.name,
            nativeCurrency: config.currency,
            rpcUrls: [config.rpcUrl],
            blockExplorerUrls: [config.explorerUrl],
          },
        ],
      });
    } else {
      throw switchError;
    }
  }
}

/** Approve L1 ERC20 token for the bridge contract */
export async function approveL1Token(
  token: BridgeTokenSymbol,
  amount: bigint,
  network: "sepolia" | "mainnet"
): Promise<string> {
  const provider = getEthereumProvider();
  const l1Token = L1_TOKEN_ADDRESSES[network][token];
  if (!l1Token) throw new Error(`${token} is native ETH — no approval needed`);

  const bridge = STARKGATE_BRIDGES[network][token];
  const accounts = await getL1Accounts();

  // approve(address spender, uint256 amount)
  const data =
    APPROVE_SELECTOR +
    padHex32(bridge.l1Bridge.replace(/^0x/i, "")) +
    encodeUint256(amount);

  const txHash = await provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: accounts[0],
        to: l1Token,
        data,
      },
    ],
  });

  return txHash as string;
}

/**
 * Deposit tokens from L1 to L2 via StarkGate.
 *
 * Protocol requirements:
 *   - ETH:   msg.value = depositAmount + messagingFee
 *   - ERC20: msg.value = messagingFee (token is pulled via transferFrom)
 *   - Function: deposit(uint256 amount, uint256 l2Recipient) payable
 */
export async function depositToL2(
  params: BridgeDepositParams
): Promise<string> {
  const provider = getEthereumProvider();
  const { token, amount, l2Recipient, network } = params;
  const bridge = STARKGATE_BRIDGES[network][token];
  const accounts = await getL1Accounts();
  const rawAmount = parseAmount(amount, token);

  // deposit(uint256 amount, uint256 l2Recipient)
  const data =
    DEPOSIT_SELECTOR +
    encodeUint256(rawAmount) +
    encodeStarknetAddress(l2Recipient);

  // Calculate msg.value:
  //   ETH:   amount + messaging fee (bridge receives ETH + fee in one tx)
  //   ERC20: messaging fee only (tokens already approved via transferFrom)
  const msgValue =
    token === "ETH"
      ? rawAmount + L1_TO_L2_MESSAGE_FEE
      : L1_TO_L2_MESSAGE_FEE;

  const txHash = await provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: accounts[0],
        to: bridge.l1Bridge,
        data,
        value: "0x" + msgValue.toString(16),
      },
    ],
  });

  return txHash as string;
}

/** Estimate gas for a deposit */
export async function estimateDepositGas(
  params: BridgeDepositParams
): Promise<GasEstimate> {
  const provider = getEthereumProvider();
  const { token, amount, l2Recipient, network } = params;
  const bridge = STARKGATE_BRIDGES[network][token];
  const accounts = await getL1Accounts();
  const rawAmount = parseAmount(amount, token);

  const data =
    DEPOSIT_SELECTOR +
    encodeUint256(rawAmount) +
    encodeStarknetAddress(l2Recipient);

  const msgValue =
    token === "ETH"
      ? rawAmount + L1_TO_L2_MESSAGE_FEE
      : L1_TO_L2_MESSAGE_FEE;

  try {
    const gasHex = (await provider.request({
      method: "eth_estimateGas",
      params: [
        {
          from: accounts[0],
          to: bridge.l1Bridge,
          data,
          value: "0x" + msgValue.toString(16),
        },
      ],
    })) as string;

    const gasPriceHex = (await provider.request({
      method: "eth_gasPrice",
    })) as string;

    const gas = BigInt(gasHex);
    const gasPrice = BigInt(gasPriceHex);
    const totalWei = gas * gasPrice;

    return {
      gasWei: totalWei,
      gasEth: (Number(totalWei) / 1e18).toFixed(6),
      gasGwei: (Number(gasPrice) / 1e9).toFixed(1),
    };
  } catch {
    // Fallback estimate
    return {
      gasWei: BigInt(0),
      gasEth: "~0.001",
      gasGwei: "—",
    };
  }
}

// ============================================================================
// L1 TX STATUS
// ============================================================================

/** Check L1 transaction receipt */
export async function checkL1TxStatus(
  txHash: string
): Promise<{ confirmed: boolean; success: boolean }> {
  const provider = getEthereumProvider();
  const receipt = (await provider.request({
    method: "eth_getTransactionReceipt",
    params: [txHash],
  })) as { status: string } | null;

  if (!receipt) return { confirmed: false, success: false };
  return {
    confirmed: true,
    success: receipt.status === "0x1",
  };
}

/** Poll for L1 confirmation (5s intervals, up to maxAttempts) */
export async function waitForL1Confirmation(
  txHash: string,
  maxAttempts = 60,
  onPoll?: (attempt: number) => void
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    onPoll?.(i + 1);
    const { confirmed, success } = await checkL1TxStatus(txHash);
    if (confirmed) return success;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("L1 transaction confirmation timed out");
}

// ============================================================================
// L2 OPERATIONS (starknet.js Call[])
// ============================================================================

/**
 * Build L2 withdrawal call.
 *
 * StarkGate L2 bridge uses `permissioned_burn` — NO approve needed.
 * The call goes to the L2 BRIDGE contract (not the token contract).
 *
 * Entrypoint: initiate_token_withdraw(l1_token, l1_recipient, amount)
 *   - l1_token:     The L1 ERC20 address (or ETH sentinel 0x455448)
 *   - l1_recipient: Ethereum address to receive funds
 *   - amount:       u256 (low, high)
 */
export function buildL2WithdrawCalls(params: WithdrawParams): Call[] {
  const { token, amount, l1Recipient, network } = params;
  const bridge = STARKGATE_BRIDGES[network][token];
  const rawAmount = parseAmount(amount, token);

  // L1 token address for the bridge call parameter
  // ETH uses a sentinel address: 0x0000000000000000000000000000000000455448
  const l1TokenAddress =
    L1_TOKEN_ADDRESSES[network][token] ??
    "0x0000000000000000000000000000000000455448";

  return [
    {
      contractAddress: bridge.l2Bridge,
      entrypoint: "initiate_token_withdraw",
      calldata: [
        l1TokenAddress, // l1_token (felt — EthAddress)
        l1Recipient,    // l1_recipient (felt — EthAddress)
        rawAmount.toString(), // amount low (u256)
        "0",                  // amount high (u256)
      ],
    },
  ];
}

/** Build single multicall for L2 withdrawal */
export function buildL2WithdrawMulticall(params: WithdrawParams): Call[] {
  return buildL2WithdrawCalls(params);
}

// ============================================================================
// TIMING ESTIMATES
// ============================================================================

export function getBridgeTimingEstimate(direction: BridgeDirection): string {
  if (direction === "deposit") {
    return "~12-20 minutes (L1 confirmation + L2 processing)";
  }
  return "~2-6 hours (L2 finalization + L1 claim)";
}

/** Messaging fee displayed to user */
export function getMessagingFeeDisplay(): string {
  return (Number(L1_TO_L2_MESSAGE_FEE) / 1e18).toFixed(4) + " ETH";
}

// ============================================================================
// VALIDATION
// ============================================================================

/** Validate an Ethereum L1 address */
export function isValidEthereumAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

/** Validate a Starknet L2 address */
export function isValidStarknetAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{1,64}$/.test(address);
}
