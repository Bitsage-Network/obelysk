/**
 * Signature and payload validation for relay requests
 */

export interface OutsideExecution {
  caller: string;
  nonce: string;
  executeAfter: number;
  executeBefore: number;
  calls: RelayCall[];
}

export interface RelayCall {
  contractAddress: string;
  entrypoint: string;
  calldata: string[];
}

export interface RelayPayload {
  outsideExecution: OutsideExecution;
  signature: string[];
  ownerAddress: string;
}

/**
 * Validate the relay payload structure
 */
export function validatePayload(body: unknown): { valid: boolean; error?: string; payload?: RelayPayload } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Missing request body" };
  }

  const b = body as Record<string, unknown>;

  if (!b.outsideExecution || typeof b.outsideExecution !== "object") {
    return { valid: false, error: "Missing outsideExecution" };
  }

  const oe = b.outsideExecution as Record<string, unknown>;
  if (typeof oe.nonce !== "string" || !oe.nonce) {
    return { valid: false, error: "Missing or invalid nonce" };
  }
  if (typeof oe.executeAfter !== "number") {
    return { valid: false, error: "Missing or invalid executeAfter" };
  }
  if (typeof oe.executeBefore !== "number") {
    return { valid: false, error: "Missing or invalid executeBefore" };
  }

  // Validate time window
  const now = Math.floor(Date.now() / 1000);
  if (oe.executeBefore < now) {
    return { valid: false, error: "OutsideExecution has expired" };
  }

  if (!Array.isArray(oe.calls) || oe.calls.length === 0) {
    return { valid: false, error: "Missing or empty calls" };
  }

  // Validate each call
  for (const call of oe.calls) {
    if (!call.contractAddress || !call.entrypoint) {
      return { valid: false, error: "Invalid call: missing contractAddress or entrypoint" };
    }
  }

  if (!Array.isArray(b.signature) || b.signature.length < 3) {
    return { valid: false, error: "Missing or invalid signature (need at least 3 elements)" };
  }

  if (typeof b.ownerAddress !== "string" || !b.ownerAddress) {
    return { valid: false, error: "Missing ownerAddress" };
  }

  return {
    valid: true,
    payload: {
      outsideExecution: {
        caller: (oe.caller as string) || "0x0",
        nonce: oe.nonce as string,
        executeAfter: oe.executeAfter as number,
        executeBefore: oe.executeBefore as number,
        calls: oe.calls as RelayCall[],
      },
      signature: b.signature as string[],
      ownerAddress: b.ownerAddress as string,
    },
  };
}
