/**
 * Send Stealth Payment Hook
 *
 * Wraps the StealthRegistry.send_stealth_payment contract call.
 * Flow:
 *   1. Look up recipient's stealth meta-address on-chain
 *   2. Generate ephemeral_secret + encryption_randomness
 *   3. Approve SAGE token spend on the registry
 *   4. Call send_stealth_payment via multicall (approve + send)
 *
 * The registry contract does transfer_from(sender, registry, amount),
 * so the sender must approve the registry first.
 */

import { useState, useCallback } from "react";
import { useAccount, useSendTransaction } from "@starknet-react/core";
import { RpcProvider } from "starknet";
import { CONTRACTS, NETWORK_CONFIG } from "../contracts/addresses";
import { useNetwork } from "../contexts/NetworkContext";
import { randomScalar } from "../crypto";

export type SendStealthStatus =
  | "idle"
  | "looking_up"
  | "not_registered"
  | "ready"
  | "approving"
  | "sending"
  | "confirmed"
  | "error";

export interface SendStealthResult {
  txHash: string;
}

export function useSendStealthPayment() {
  const { network } = useNetwork();
  const { account, address } = useAccount();
  const { sendAsync } = useSendTransaction({});

  const [status, setStatus] = useState<SendStealthStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [recipientRegistered, setRecipientRegistered] = useState<boolean | null>(null);

  const contracts = CONTRACTS[network];
  const SEPOLIA_STEALTH_REGISTRY =
    "0x02ab118a1527e3e00882d4bf75a479deccd7f16e2bc89417d54cb97cb9e2dc59";
  const registryAddress = contracts?.STEALTH_REGISTRY || SEPOLIA_STEALTH_REGISTRY;

  const rpcUrl = NETWORK_CONFIG[network]?.rpcUrl || "";

  const lookupRecipient = useCallback(
    async (recipientAddress: string): Promise<boolean> => {
      setError(null);
      setStatus("looking_up");
      setRecipientRegistered(null);

      if (!recipientAddress || !/^0x[a-fA-F0-9]{1,64}$/.test(recipientAddress)) {
        setError("Invalid recipient address format");
        setStatus("error");
        setRecipientRegistered(false);
        return false;
      }

      try {
        const provider = new RpcProvider({ nodeUrl: rpcUrl });
        const result = await provider.callContract({
          contractAddress: registryAddress,
          entrypoint: "get_meta_address",
          calldata: [recipientAddress],
        });

        const data: string[] = Array.isArray(result) ? result : [];

        if (data.length >= 4 && BigInt(data[0] || "0") !== 0n) {
          setRecipientRegistered(true);
          setStatus("ready");
          return true;
        }

        setRecipientRegistered(false);
        setStatus("not_registered");
        return false;
      } catch {
        setRecipientRegistered(false);
        setStatus("not_registered");
        return false;
      }
    },
    [rpcUrl, registryAddress],
  );

  const sendStealthPayment = useCallback(
    async (
      recipientAddress: string,
      amount: string,
      tokenAddress: string,
      decimals: number
    ): Promise<string | null> => {
      setError(null);
      setTxHash(null);

      if (!account || !address) {
        setError("Wallet not connected");
        setStatus("error");
        return null;
      }

      if (!recipientAddress || !/^0x[a-fA-F0-9]{1,64}$/.test(recipientAddress)) {
        setError("Invalid recipient address");
        setStatus("error");
        return null;
      }

      if (!tokenAddress || tokenAddress === "0x0") {
        setError("Invalid token address");
        setStatus("error");
        return null;
      }

      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        setError("Invalid amount");
        setStatus("error");
        return null;
      }

      try {
        // Convert to u256 using the token's decimals
        const [whole = "0", frac = ""] = amount.split(".");
        const paddedFrac = frac.padEnd(decimals, "0").slice(0, decimals);
        const amountWei = BigInt(whole) * BigInt(10 ** decimals) + BigInt(paddedFrac);
        const amountLow = amountWei & ((1n << 128n) - 1n);
        const amountHigh = amountWei >> 128n;

        // Generate cryptographic randomness
        const ephemeralSecret = randomScalar();
        const encryptionRandomness = randomScalar();

        setStatus("sending");

        // Multicall: approve + send_stealth_payment
        const tx = await sendAsync([
          // Call 1: token.approve(registry, amount)
          {
            contractAddress: tokenAddress,
            entrypoint: "approve",
            calldata: [
              registryAddress,
              "0x" + amountLow.toString(16),
              "0x" + amountHigh.toString(16),
            ],
          },
          // Call 2: registry.send_stealth_payment(worker, amount, ephemeral_secret, encryption_randomness, job_id, token)
          {
            contractAddress: registryAddress,
            entrypoint: "send_stealth_payment",
            calldata: [
              // worker: ContractAddress (recipient)
              recipientAddress,
              // amount: u256 (low, high)
              "0x" + amountLow.toString(16),
              "0x" + amountHigh.toString(16),
              // ephemeral_secret: felt252
              "0x" + ephemeralSecret.toString(16),
              // encryption_randomness: felt252
              "0x" + encryptionRandomness.toString(16),
              // job_id: u256 (low=0, high=0)
              "0x0",
              "0x0",
              // token: ContractAddress
              tokenAddress,
            ],
          },
        ]);

        const hash = tx.transaction_hash;
        setTxHash(hash);
        setStatus("confirmed");
        return hash;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStatus("error");
        return null;
      }
    },
    [account, address, sendAsync, registryAddress],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setTxHash(null);
    setRecipientRegistered(null);
  }, []);

  return {
    status,
    error,
    txHash,
    recipientRegistered,
    lookupRecipient,
    sendStealthPayment,
    reset,
  };
}
