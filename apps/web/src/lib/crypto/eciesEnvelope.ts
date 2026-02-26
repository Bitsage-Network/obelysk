/**
 * ECIES Envelope — Client-side encryption for relayer submissions.
 *
 * Closes privacy gap #1: The relayer operator can no longer read transaction
 * data in transit or at rest. Uses Web Crypto API (SubtleCrypto) exclusively
 * to avoid new dependencies.
 *
 * Protocol (version 1):
 *   1. Client fetches relayer's static X25519 public key from /public-key
 *   2. Client generates ephemeral X25519 keypair
 *   3. ECDH: sharedSecret = ECDH(ephemeralPrivate, relayerPublic)
 *   4. HKDF-SHA256(sharedSecret, info="obelysk-ecies-v1") → AES-256-GCM key
 *   5. AES-256-GCM encrypt(JSON payload, random 12-byte nonce)
 *   6. Send: { ephemeral_pubkey, ciphertext, nonce, version: 1 }
 *
 * The relayer decrypts using its static X25519 private key inside
 * spawn_blocking (proving scope). Plaintext never persists in memory.
 */

/** The encrypted submission envelope sent to POST /submit */
export interface EncryptedSubmitRequest {
  ephemeral_pubkey: string;  // 32 bytes, hex
  ciphertext: string;        // base64
  nonce: string;             // 12 bytes, hex
  version: number;           // always 1
}

/** Cached relayer public key */
let cachedRelayerPubkey: Uint8Array | null = null;
let cachedRelayerUrl: string | null = null;

/**
 * Fetch and cache the relayer's X25519 public key.
 */
export async function fetchRelayerPublicKey(relayerUrl: string): Promise<Uint8Array> {
  if (cachedRelayerPubkey && cachedRelayerUrl === relayerUrl) {
    return cachedRelayerPubkey;
  }

  const res = await fetch(`${relayerUrl}/public-key`);
  if (!res.ok) {
    throw new Error(`Failed to fetch relayer public key: ${res.status}`);
  }

  const data = await res.json();
  const pubkeyHex: string = data.public_key;

  if (!pubkeyHex || pubkeyHex.length !== 64) {
    throw new Error("Invalid relayer public key format");
  }

  cachedRelayerPubkey = hexToBytes(pubkeyHex);
  cachedRelayerUrl = relayerUrl;
  return cachedRelayerPubkey;
}

/**
 * Encrypt a JSON payload for the relayer using ECIES.
 *
 * Uses Web Crypto API (SubtleCrypto) for all operations:
 * - X25519 via ECDH (importKey + deriveBits)
 * - HKDF-SHA256 for key derivation
 * - AES-256-GCM for authenticated encryption
 */
export async function encryptForRelayer(
  payload: Record<string, unknown>,
  relayerPubkeyBytes: Uint8Array
): Promise<EncryptedSubmitRequest> {
  const subtle = crypto.subtle;

  // 1. Generate ephemeral X25519 keypair
  const ephemeralKeyPair = await subtle.generateKey(
    { name: "X25519" },
    true,  // extractable (we need the public key bytes)
    ["deriveBits"]
  ) as CryptoKeyPair;

  // 2. Import relayer's public key
  const relayerPubkey = await subtle.importKey(
    "raw",
    relayerPubkeyBytes,
    { name: "X25519" },
    false,
    []
  );

  // 3. ECDH: derive shared secret
  const sharedBits = await subtle.deriveBits(
    { name: "X25519", public: relayerPubkey },
    ephemeralKeyPair.privateKey,
    256  // 32 bytes
  );

  // 4. HKDF-SHA256 to derive AES-256-GCM key
  const sharedKey = await subtle.importKey(
    "raw",
    sharedBits,
    { name: "HKDF" },
    false,
    ["deriveKey"]
  );

  const aesKey = await subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: new TextEncoder().encode("obelysk-ecies-v1"),
    },
    sharedKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );

  // 5. Generate random 12-byte nonce
  const nonce = crypto.getRandomValues(new Uint8Array(12));

  // 6. AES-256-GCM encrypt the JSON payload
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    aesKey,
    plaintext
  );

  // 7. Export ephemeral public key
  const ephPubRaw = await subtle.exportKey("raw", ephemeralKeyPair.publicKey);

  return {
    ephemeral_pubkey: bytesToHex(new Uint8Array(ephPubRaw)),
    ciphertext: arrayBufferToBase64(ciphertext),
    nonce: bytesToHex(nonce),
    version: 1,
  };
}

// --- Utility functions ---

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
