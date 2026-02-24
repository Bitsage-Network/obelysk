/**
 * AVNU DEX Aggregator — Quote & Build Service (Hardened)
 *
 * Fetches quotes from AVNU's aggregation API (routes across Ekubo, JediSwap,
 * MySwap, 10kSwap, and market makers) and builds ready-to-execute swap calldata.
 *
 * Hardening:
 *  - AbortController timeouts on all fetches (10s quotes, 15s build)
 *  - Response schema validation (rejects malformed API responses)
 *  - Input sanitization (hex address format, uint256 bounds, non-zero amounts)
 *  - Retry with exponential backoff for transient errors (429, 503, network)
 *  - BigInt-safe amount formatting (no Number precision loss)
 *  - Starknet address validation (0x-prefixed hex, 1-66 chars)
 */

import { AVNU_API_URLS } from "@/lib/paymaster/avnuPaymaster";
import {
  EXTERNAL_TOKENS,
  CONTRACTS,
  TOKEN_METADATA,
  type NetworkType,
  type TokenSymbol,
} from "@/lib/contracts/addresses";

// ============================================================================
// CONSTANTS
// ============================================================================

const QUOTE_TIMEOUT_MS = 10_000;
const BUILD_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_BASE_MS = 1_000;
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

/** Build common headers for AVNU API requests (includes API key when available) */
function getAvnuHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = process.env.NEXT_PUBLIC_AVNU_API_KEY;
  if (apiKey) {
    headers["x-paymaster-api-key"] = apiKey;
  }
  return headers;
}

/** Maximum u256 on Starknet (2^256 - 1) */
const MAX_U256 = (1n << 256n) - 1n;

/** Minimum swap amount to prevent dust (1 unit of smallest decimals) */
const MIN_SWAP_AMOUNT = 1n;

// ============================================================================
// TYPES
// ============================================================================

export interface AvnuRoute {
  name: string;
  percent: number;
  sellTokenAddress: string;
  buyTokenAddress: string;
}

export interface AvnuQuote {
  quoteId: string;
  sellTokenAddress: string;
  buyTokenAddress: string;
  sellAmount: string;
  buyAmount: string;
  buyAmountInUsd: number;
  sellAmountInUsd: number;
  gasFees: string;
  gasFeesInUsd: number;
  /** Price impact / estimated slippage (0-1 scale) */
  priceImpact: number;
  estimatedSlippage?: number;
  routes: AvnuRoute[];
  gasless?: {
    active: boolean;
    gasTokenPrices?: Array<{
      tokenAddress: string;
      gasFeesInGasToken: string;
      gasFeesInUsd: number;
    }>;
  };
}

export interface AvnuBuildResult {
  calls: Array<{
    contractAddress: string;
    entrypoint: string;
    calldata: string[];
  }>;
}

// ============================================================================
// VALIDATION
// ============================================================================

const STARKNET_ADDRESS_RE = /^0x[0-9a-fA-F]{1,64}$/;

function isValidStarknetAddress(addr: string): boolean {
  return STARKNET_ADDRESS_RE.test(addr);
}

function validateQuoteInput(params: {
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  takerAddress: string;
}): void {
  if (!isValidStarknetAddress(params.sellToken)) {
    throw new Error(`Invalid sell token address: ${params.sellToken}`);
  }
  if (!isValidStarknetAddress(params.buyToken)) {
    throw new Error(`Invalid buy token address: ${params.buyToken}`);
  }
  if (!isValidStarknetAddress(params.takerAddress)) {
    throw new Error(`Invalid taker address: ${params.takerAddress}`);
  }
  if (params.sellToken.toLowerCase() === params.buyToken.toLowerCase()) {
    throw new Error("Sell and buy tokens must be different");
  }

  // Validate sellAmount is a valid positive uint256
  let amount: bigint;
  try {
    amount = BigInt(params.sellAmount);
  } catch {
    throw new Error(`Invalid sell amount: not a valid integer`);
  }
  if (amount < MIN_SWAP_AMOUNT) {
    throw new Error("Sell amount must be greater than zero");
  }
  if (amount > MAX_U256) {
    throw new Error("Sell amount exceeds maximum u256 value");
  }
}

function validateQuoteResponse(data: unknown): data is AvnuQuote[] {
  if (!Array.isArray(data)) return false;
  for (const item of data) {
    if (typeof item !== "object" || item === null) return false;
    const q = item as Record<string, unknown>;
    if (typeof q.quoteId !== "string" || !q.quoteId) return false;
    if (typeof q.sellTokenAddress !== "string") return false;
    if (typeof q.buyTokenAddress !== "string") return false;
    if (typeof q.sellAmount !== "string") return false;
    if (typeof q.buyAmount !== "string") return false;
    // buyAmount must be a valid positive integer (decimal or hex)
    try {
      const amt = BigInt(q.buyAmount as string);
      if (amt < 0n) return false;
    } catch {
      return false;
    }
    // priceImpact or estimatedSlippage — either is acceptable, both optional
    if (!Array.isArray(q.routes)) return false;
  }
  return true;
}

function validateBuildResponse(data: unknown): data is AvnuBuildResult {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.calls)) return false;
  for (const call of d.calls) {
    if (typeof call !== "object" || call === null) return false;
    const c = call as Record<string, unknown>;
    if (typeof c.contractAddress !== "string") return false;
    if (typeof c.entrypoint !== "string") return false;
    if (!Array.isArray(c.calldata)) return false;
  }
  return true;
}

// ============================================================================
// TOKEN LIST
// ============================================================================

export interface AvnuTokenOption {
  symbol: string;
  address: string;
  name: string;
  decimals: number;
}

export function getAvnuSupportedTokens(network: NetworkType): AvnuTokenOption[] {
  const externalTokens = EXTERNAL_TOKENS[network] || EXTERNAL_TOKENS.sepolia;
  const sageAddress = CONTRACTS[network]?.SAGE_TOKEN || "0x0";

  const tokens: AvnuTokenOption[] = [];

  // Add SAGE if deployed
  if (sageAddress !== "0x0") {
    tokens.push({
      symbol: "SAGE",
      address: sageAddress,
      name: TOKEN_METADATA.SAGE.name,
      decimals: TOKEN_METADATA.SAGE.decimals,
    });
  }

  // Add external tokens
  for (const [symbol, address] of Object.entries(externalTokens)) {
    if (address === "0x0") continue;
    const meta = TOKEN_METADATA[symbol as TokenSymbol];
    if (meta) {
      tokens.push({
        symbol,
        address,
        name: meta.name,
        decimals: meta.decimals,
      });
    }
  }

  return tokens;
}

// ============================================================================
// FETCH WITH RETRY + TIMEOUT
// ============================================================================

function getApiUrl(network: NetworkType): string {
  if (network === "mainnet") return AVNU_API_URLS.mainnet;
  return AVNU_API_URLS.sepolia;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit & { timeoutMs: number },
  retries = MAX_RETRIES,
): Promise<Response> {
  const { timeoutMs, signal: externalSignal, ...fetchInit } = init;
  let lastError: Error | null = null;

  // If caller already aborted, bail immediately
  if (externalSignal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);

    // Compose: abort on EITHER timeout OR external signal
    const onExternalAbort = () => timeoutController.abort();
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

    try {
      const response = await fetch(url, {
        ...fetchInit,
        signal: timeoutController.signal,
      });

      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onExternalAbort);

      // Retry on transient server errors
      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < retries) {
        const backoff = RETRY_BACKOFF_BASE_MS * 2 ** attempt;
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      return response;
    } catch (err) {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onExternalAbort);

      // Distinguish: was it the external signal or our timeout?
      if (externalSignal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      if (err instanceof DOMException && err.name === "AbortError") {
        lastError = new Error(`Request timed out after ${timeoutMs}ms`);
      } else {
        lastError = err instanceof Error ? err : new Error(String(err));
      }

      // Retry on network errors (but NOT on external abort)
      if (attempt < retries) {
        const backoff = RETRY_BACKOFF_BASE_MS * 2 ** attempt;
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
    }
  }

  throw lastError || new Error("Request failed after retries");
}

// ============================================================================
// AMOUNT CONVERSION (BigInt-safe, no floating-point)
// ============================================================================

/**
 * Convert a human-readable decimal string (e.g. "1.5") to a raw uint256 string
 * using purely integer arithmetic — no floating-point.
 */
export function parseAmountToRaw(humanAmount: string, decimals: number): string {
  const trimmed = humanAmount.trim();
  if (!trimmed || trimmed === ".") return "0";

  const parts = trimmed.split(".");
  if (parts.length > 2) throw new Error("Invalid amount: multiple decimal points");

  const intPart = parts[0] || "0";
  let fracPart = parts[1] || "";

  // Clamp fractional digits to token decimals
  if (fracPart.length > decimals) {
    fracPart = fracPart.slice(0, decimals);
  }

  // Pad fractional part to match decimals
  fracPart = fracPart.padEnd(decimals, "0");

  // Combine: intPart * 10^decimals + fracPart (pure BigInt — no Number overflow)
  const raw = BigInt(intPart) * 10n ** BigInt(decimals) + BigInt(fracPart);

  if (raw > MAX_U256) throw new Error("Amount exceeds maximum u256 value");

  return raw.toString();
}

/**
 * Format a raw uint256 string to a human-readable decimal string
 * using purely BigInt arithmetic — no Number precision loss.
 */
export function formatRawAmount(rawAmount: string, decimals: number, displayDecimals = 6): string {
  const raw = BigInt(rawAmount);
  const divisor = 10n ** BigInt(decimals);
  const intPart = raw / divisor;
  const fracPart = raw % divisor;

  const fracStr = fracPart.toString().padStart(decimals, "0").slice(0, displayDecimals);
  // Trim trailing zeros but keep at least 1 decimal
  const trimmed = fracStr.replace(/0+$/, "") || "0";

  return `${intPart}.${trimmed}`;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Fetch quotes from AVNU aggregator.
 * Returns up to `size` quotes sorted by best output amount.
 *
 * Pass an AbortSignal to cancel the request externally (e.g. on new input).
 */
export async function fetchAvnuQuote(params: {
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  takerAddress: string;
  network: NetworkType;
  size?: number;
  signal?: AbortSignal;
}): Promise<AvnuQuote[]> {
  const { sellToken, buyToken, sellAmount, takerAddress, network, size = 3, signal } = params;

  // Validate inputs before hitting the API
  validateQuoteInput({ sellToken, buyToken, sellAmount, takerAddress });

  const baseUrl = getApiUrl(network);
  // AVNU API requires sellAmount in hex format (e.g. "0xde0b6b3a7640000")
  const sellAmountHex = "0x" + BigInt(sellAmount).toString(16);
  const searchParams = new URLSearchParams({
    sellTokenAddress: sellToken,
    buyTokenAddress: buyToken,
    sellAmount: sellAmountHex,
    takerAddress,
    size: String(Math.min(size, 10)), // cap server-side cost
  });

  const response = await fetchWithRetry(
    `${baseUrl}/swap/v2/quotes?${searchParams}`,
    {
      headers: getAvnuHeaders(),
      timeoutMs: QUOTE_TIMEOUT_MS,
      signal,
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`AVNU quote failed (${response.status}): ${text || response.statusText}`);
  }

  const data: unknown = await response.json();

  if (!validateQuoteResponse(data)) {
    throw new Error("AVNU returned malformed quote response");
  }

  // Normalize: populate priceImpact from estimatedSlippage if missing
  for (const quote of data) {
    if (typeof quote.priceImpact !== "number") {
      quote.priceImpact = typeof quote.estimatedSlippage === "number" ? quote.estimatedSlippage : 0;
    }
  }

  return data;
}

/**
 * Build swap calldata from a selected quote.
 * Returns ERC20 approve + swap calls ready for account.execute().
 */
export async function buildAvnuSwap(params: {
  quoteId: string;
  takerAddress: string;
  slippage: number;
  network: NetworkType;
  signal?: AbortSignal;
}): Promise<AvnuBuildResult> {
  const { quoteId, takerAddress, slippage, network, signal } = params;

  if (!quoteId) throw new Error("Missing quoteId");
  if (!isValidStarknetAddress(takerAddress)) {
    throw new Error(`Invalid taker address: ${takerAddress}`);
  }
  if (slippage < 0 || slippage > 1) {
    throw new Error(`Invalid slippage: ${slippage}. Must be between 0 and 1.`);
  }

  const baseUrl = getApiUrl(network);

  const response = await fetchWithRetry(
    `${baseUrl}/swap/v2/build`,
    {
      method: "POST",
      headers: getAvnuHeaders(),
      body: JSON.stringify({ quoteId, takerAddress, slippage }),
      timeoutMs: BUILD_TIMEOUT_MS,
      signal,
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`AVNU build failed (${response.status}): ${text || response.statusText}`);
  }

  const data: unknown = await response.json();

  if (!validateBuildResponse(data)) {
    throw new Error("AVNU returned malformed build response");
  }

  // Additional validation: calls array must be non-empty
  if (data.calls.length === 0) {
    throw new Error("AVNU returned empty calls array");
  }

  return data;
}

// ============================================================================
// HELPERS
// ============================================================================

export function formatUsdValue(usd: number): string {
  if (!isFinite(usd) || usd <= 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  if (usd > 1e12) return ">$1T"; // guard against absurd values
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
