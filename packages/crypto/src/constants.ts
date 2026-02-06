// Stark curve parameters for ElGamal encryption
// Based on the Stark curve used by Starknet

// Prime field order (P)
export const STARK_PRIME = BigInt(
  "0x800000000000011000000000000000000000000000000000000000000000001"
);

// Curve order (N) - number of points on the curve
export const CURVE_ORDER = BigInt(
  "0x800000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d2f"
);

// Generator point G for the Stark curve
export const GENERATOR_X = BigInt(
  "0x1ef15c18599971b7beced415a40f0c7deacfd9b0d1819e03d723d8bc943cfca"
);
export const GENERATOR_Y = BigInt(
  "0x5668060aa49730b7be4801df46ec62de53ecd11abe43a32873000c36e8dc1f"
);

// Common denominators for privacy pool amounts
export const PRIVACY_DENOMINATORS = [
  BigInt("100000000000000000000"), // 100 SAGE
  BigInt("1000000000000000000000"), // 1000 SAGE
  BigInt("10000000000000000000000"), // 10000 SAGE
];

// Domain separators for different cryptographic operations
export const DOMAIN_SEPARATORS = {
  ELGAMAL_ENCRYPTION: BigInt("0x454c47414d414c5f454e43525950545f"), // "ELGAMAL_ENCRYPT_"
  PEDERSEN_COMMIT: BigInt("0x5045444552534e5f434f4d4d49545f5f"), // "PEDERS_COMMIT__"
  NULLIFIER: BigInt("0x4e554c4c494649455f5f5f5f5f5f5f5f"), // "NULLIFIE________"
  STEALTH_ADDRESS: BigInt("0x535445414c54485f414444525f5f5f5f"), // "STEALTH_ADDR____"
};

// SAGE token decimals
export const SAGE_DECIMALS = 18;
