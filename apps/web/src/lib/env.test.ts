/**
 * Environment Variable Validation — Unit Tests
 *
 * Tests validateEnv(), getEnvConfig(), and getEnvConfigSafe()
 * by manipulating process.env to simulate various network configurations.
 *
 * Because env.ts reads from process.env at module level via a static
 * ENV_VALUES object, we need to reset the module between tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Store original env
const originalEnv = { ...process.env };

// We need to re-import the module after each env change because
// ENV_VALUES is captured at module load time. We use vi.resetModules().
beforeEach(() => {
  vi.resetModules();
  // Start with clean env
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = { ...originalEnv };
});

// Helper to import env.ts fresh
async function importEnv() {
  return await import('./env');
}

// ---------------------------------------------------------------------------
// validateEnv() — required vars
// ---------------------------------------------------------------------------

describe('validateEnv()', () => {
  it('returns valid when all required vars are present (sepolia)', async () => {
    process.env.NEXT_PUBLIC_STARKNET_NETWORK = 'sepolia';
    process.env.NEXT_PUBLIC_RPC_URL = 'https://starknet-sepolia.g.alchemy.com/demo';
    // Contract addresses for sepolia
    process.env.NEXT_PUBLIC_SAGE_TOKEN_ADDRESS = '0x072349097c8a802e7f66dc96b95aca84e4d78ddad22014904076c76293a99850';
    process.env.NEXT_PUBLIC_OTC_ORDERBOOK_ADDRESS = '0x7b2b59d93764ccf1ea85edca2720c37bba7742d05a2791175982eaa59cedef0';
    process.env.NEXT_PUBLIC_PRIVACY_POOLS_ADDRESS = '0xd85ad03dcd91a075bef0f4226149cb7e43da795d2c1d33e3227c68bfbb78a7';
    process.env.NEXT_PUBLIC_CONFIDENTIAL_SWAP_ADDRESS = '0x29516b3abfbc56fdf0c1f136c971602325cbabf07ad8f984da582e2106ad2af';
    process.env.NEXT_PUBLIC_FAUCET_ADDRESS = '0x62d3231450645503345e2e022b60a96aceff73898d26668f3389547a61471d3';

    const { validateEnv } = await importEnv();
    const result = validateEnv();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns errors when NEXT_PUBLIC_STARKNET_NETWORK is missing', async () => {
    delete process.env.NEXT_PUBLIC_STARKNET_NETWORK;
    process.env.NEXT_PUBLIC_RPC_URL = 'https://example.com';

    const { validateEnv } = await importEnv();
    const result = validateEnv();
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('NEXT_PUBLIC_STARKNET_NETWORK'))).toBe(true);
  });

  it('returns errors when NEXT_PUBLIC_RPC_URL is missing', async () => {
    process.env.NEXT_PUBLIC_STARKNET_NETWORK = 'devnet';
    delete process.env.NEXT_PUBLIC_RPC_URL;

    const { validateEnv } = await importEnv();
    const result = validateEnv();
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('NEXT_PUBLIC_RPC_URL'))).toBe(true);
  });

  it('devnet does not require contract addresses', async () => {
    process.env.NEXT_PUBLIC_STARKNET_NETWORK = 'devnet';
    process.env.NEXT_PUBLIC_RPC_URL = 'http://localhost:5050';

    const { validateEnv } = await importEnv();
    const result = validateEnv();
    expect(result.valid).toBe(true);
  });

  it('sepolia requires contract addresses', async () => {
    process.env.NEXT_PUBLIC_STARKNET_NETWORK = 'sepolia';
    process.env.NEXT_PUBLIC_RPC_URL = 'https://example.com';
    // Contract addresses not set — should fail

    const { validateEnv } = await importEnv();
    const result = validateEnv();
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('NEXT_PUBLIC_SAGE_TOKEN_ADDRESS'))).toBe(true);
  });

  it('sepolia rejects contract address = 0x0', async () => {
    process.env.NEXT_PUBLIC_STARKNET_NETWORK = 'sepolia';
    process.env.NEXT_PUBLIC_RPC_URL = 'https://example.com';
    process.env.NEXT_PUBLIC_SAGE_TOKEN_ADDRESS = '0x0';
    process.env.NEXT_PUBLIC_OTC_ORDERBOOK_ADDRESS = '0x0';
    process.env.NEXT_PUBLIC_PRIVACY_POOLS_ADDRESS = '0x0';
    process.env.NEXT_PUBLIC_CONFIDENTIAL_SWAP_ADDRESS = '0x0';
    process.env.NEXT_PUBLIC_FAUCET_ADDRESS = '0x0';

    const { validateEnv } = await importEnv();
    const result = validateEnv();
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// Mainnet-specific validations
// ---------------------------------------------------------------------------

describe('validateEnv() — mainnet', () => {
  it('rejects public RPC endpoints on mainnet', async () => {
    process.env.NEXT_PUBLIC_STARKNET_NETWORK = 'mainnet';
    process.env.NEXT_PUBLIC_RPC_URL = 'https://starknet-mainnet.public.blastapi.io';
    process.env.NEXT_PUBLIC_MAINNET_RPC_URL = 'https://starknet-mainnet.public.blastapi.io';
    process.env.NEXT_PUBLIC_RELAY_URL = 'https://relay.example.com';
    // Set all contract addresses
    process.env.NEXT_PUBLIC_SAGE_TOKEN_ADDRESS = '0xabc';
    process.env.NEXT_PUBLIC_OTC_ORDERBOOK_ADDRESS = '0xabc';
    process.env.NEXT_PUBLIC_PRIVACY_POOLS_ADDRESS = '0xabc';
    process.env.NEXT_PUBLIC_CONFIDENTIAL_SWAP_ADDRESS = '0xabc';
    process.env.NEXT_PUBLIC_FAUCET_ADDRESS = '0xabc';

    const { validateEnv } = await importEnv();
    const result = validateEnv();
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('dedicated provider'))).toBe(true);
  });

  it('rejects publicnode.com RPC on mainnet', async () => {
    process.env.NEXT_PUBLIC_STARKNET_NETWORK = 'mainnet';
    process.env.NEXT_PUBLIC_MAINNET_RPC_URL = 'https://starknet-mainnet.publicnode.com';
    process.env.NEXT_PUBLIC_RELAY_URL = 'https://relay.example.com';
    process.env.NEXT_PUBLIC_RPC_URL = 'https://starknet-mainnet.publicnode.com';
    process.env.NEXT_PUBLIC_SAGE_TOKEN_ADDRESS = '0xabc';
    process.env.NEXT_PUBLIC_OTC_ORDERBOOK_ADDRESS = '0xabc';
    process.env.NEXT_PUBLIC_PRIVACY_POOLS_ADDRESS = '0xabc';
    process.env.NEXT_PUBLIC_CONFIDENTIAL_SWAP_ADDRESS = '0xabc';
    process.env.NEXT_PUBLIC_FAUCET_ADDRESS = '0xabc';

    const { validateEnv } = await importEnv();
    const result = validateEnv();
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('dedicated provider'))).toBe(true);
  });

  it('rejects http:// relay URL on mainnet', async () => {
    process.env.NEXT_PUBLIC_STARKNET_NETWORK = 'mainnet';
    process.env.NEXT_PUBLIC_MAINNET_RPC_URL = 'https://starknet-mainnet.infura.io/v3/KEY';
    process.env.NEXT_PUBLIC_RPC_URL = 'https://starknet-mainnet.infura.io/v3/KEY';
    process.env.NEXT_PUBLIC_RELAY_URL = 'http://relay.example.com';
    process.env.NEXT_PUBLIC_SAGE_TOKEN_ADDRESS = '0xabc';
    process.env.NEXT_PUBLIC_OTC_ORDERBOOK_ADDRESS = '0xabc';
    process.env.NEXT_PUBLIC_PRIVACY_POOLS_ADDRESS = '0xabc';
    process.env.NEXT_PUBLIC_CONFIDENTIAL_SWAP_ADDRESS = '0xabc';
    process.env.NEXT_PUBLIC_FAUCET_ADDRESS = '0xabc';

    const { validateEnv } = await importEnv();
    const result = validateEnv();
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('HTTPS'))).toBe(true);
  });

  it('accepts valid mainnet configuration', async () => {
    process.env.NEXT_PUBLIC_STARKNET_NETWORK = 'mainnet';
    process.env.NEXT_PUBLIC_RPC_URL = 'https://starknet-mainnet.infura.io/v3/KEY';
    process.env.NEXT_PUBLIC_MAINNET_RPC_URL = 'https://starknet-mainnet.infura.io/v3/KEY';
    process.env.NEXT_PUBLIC_RELAY_URL = 'https://relay.bitsage.network';
    process.env.NEXT_PUBLIC_SAGE_TOKEN_ADDRESS = '0xabc';
    process.env.NEXT_PUBLIC_OTC_ORDERBOOK_ADDRESS = '0xabc';
    process.env.NEXT_PUBLIC_PRIVACY_POOLS_ADDRESS = '0xabc';
    process.env.NEXT_PUBLIC_CONFIDENTIAL_SWAP_ADDRESS = '0xabc';
    process.env.NEXT_PUBLIC_FAUCET_ADDRESS = '0xabc';

    const { validateEnv } = await importEnv();
    const result = validateEnv();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('requires RELAY_URL for mainnet', async () => {
    process.env.NEXT_PUBLIC_STARKNET_NETWORK = 'mainnet';
    process.env.NEXT_PUBLIC_RPC_URL = 'https://starknet-mainnet.infura.io/v3/KEY';
    process.env.NEXT_PUBLIC_MAINNET_RPC_URL = 'https://starknet-mainnet.infura.io/v3/KEY';
    // No RELAY_URL
    process.env.NEXT_PUBLIC_SAGE_TOKEN_ADDRESS = '0xabc';
    process.env.NEXT_PUBLIC_OTC_ORDERBOOK_ADDRESS = '0xabc';
    process.env.NEXT_PUBLIC_PRIVACY_POOLS_ADDRESS = '0xabc';
    process.env.NEXT_PUBLIC_CONFIDENTIAL_SWAP_ADDRESS = '0xabc';
    process.env.NEXT_PUBLIC_FAUCET_ADDRESS = '0xabc';

    const { validateEnv } = await importEnv();
    const result = validateEnv();
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('NEXT_PUBLIC_RELAY_URL'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getEnvConfig()
// ---------------------------------------------------------------------------

describe('getEnvConfig()', () => {
  it('returns correct config for devnet', async () => {
    process.env.NEXT_PUBLIC_STARKNET_NETWORK = 'devnet';
    process.env.NEXT_PUBLIC_RPC_URL = 'http://localhost:5050';
    process.env.NODE_ENV = 'development';

    const { getEnvConfig } = await importEnv();
    const config = getEnvConfig();

    expect(config.network).toBe('devnet');
    expect(config.isDevnet).toBe(true);
    expect(config.isMainnet).toBe(false);
    expect(config.rpcUrl).toBe('http://localhost:5050');
  });

  it('returns correct config for sepolia', async () => {
    process.env.NEXT_PUBLIC_STARKNET_NETWORK = 'sepolia';
    process.env.NEXT_PUBLIC_RPC_URL = 'https://alchemy.example.com/starknet';
    process.env.NODE_ENV = 'development';

    const { getEnvConfig } = await importEnv();
    const config = getEnvConfig();

    expect(config.network).toBe('sepolia');
    expect(config.isDevnet).toBe(false);
    expect(config.isMainnet).toBe(false);
    expect(config.rpcUrl).toBe('https://alchemy.example.com/starknet');
  });

  it('defaults network to sepolia when unset', async () => {
    delete process.env.NEXT_PUBLIC_STARKNET_NETWORK;
    process.env.NEXT_PUBLIC_RPC_URL = 'https://example.com';
    process.env.NODE_ENV = 'development';

    const { getEnvConfig } = await importEnv();
    const config = getEnvConfig();

    expect(config.network).toBe('sepolia');
  });

  it('defaults apiUrl when not set', async () => {
    process.env.NEXT_PUBLIC_STARKNET_NETWORK = 'devnet';
    process.env.NEXT_PUBLIC_RPC_URL = 'http://localhost:5050';
    process.env.NODE_ENV = 'development';

    const { getEnvConfig } = await importEnv();
    const config = getEnvConfig();

    expect(config.apiUrl).toBe('http://localhost:3030');
  });

  it('defaults wsUrl when not set', async () => {
    process.env.NEXT_PUBLIC_STARKNET_NETWORK = 'devnet';
    process.env.NEXT_PUBLIC_RPC_URL = 'http://localhost:5050';
    process.env.NODE_ENV = 'development';

    const { getEnvConfig } = await importEnv();
    const config = getEnvConfig();

    expect(config.wsUrl).toBe('ws://localhost:3030/ws/prover');
  });

  it('uses devnet contract addresses when network is devnet', async () => {
    process.env.NEXT_PUBLIC_STARKNET_NETWORK = 'devnet';
    process.env.NEXT_PUBLIC_RPC_URL = 'http://localhost:5050';
    process.env.NEXT_PUBLIC_DEVNET_SAGE_TOKEN = '0xDEVNET_SAGE';
    process.env.NODE_ENV = 'development';

    const { getEnvConfig } = await importEnv();
    const config = getEnvConfig();

    expect(config.contracts.sageToken).toBe('0xDEVNET_SAGE');
  });

  it('uses production contract addresses when network is sepolia', async () => {
    process.env.NEXT_PUBLIC_STARKNET_NETWORK = 'sepolia';
    process.env.NEXT_PUBLIC_RPC_URL = 'https://example.com';
    process.env.NEXT_PUBLIC_SAGE_TOKEN_ADDRESS = '0xSEPOLIA_SAGE';
    process.env.NODE_ENV = 'development';

    const { getEnvConfig } = await importEnv();
    const config = getEnvConfig();

    expect(config.contracts.sageToken).toBe('0xSEPOLIA_SAGE');
  });

  it('mainnet prefers NEXT_PUBLIC_MAINNET_RPC_URL', async () => {
    process.env.NEXT_PUBLIC_STARKNET_NETWORK = 'mainnet';
    process.env.NEXT_PUBLIC_RPC_URL = 'https://fallback.com';
    process.env.NEXT_PUBLIC_MAINNET_RPC_URL = 'https://mainnet-primary.com';
    process.env.NEXT_PUBLIC_RELAY_URL = 'https://relay.example.com';
    process.env.NODE_ENV = 'development';

    const { getEnvConfig } = await importEnv();
    const config = getEnvConfig();

    expect(config.rpcUrl).toBe('https://mainnet-primary.com');
    expect(config.isMainnet).toBe(true);
  });

  it('throws in production mode when required vars are missing', async () => {
    delete process.env.NEXT_PUBLIC_STARKNET_NETWORK;
    delete process.env.NEXT_PUBLIC_RPC_URL;
    process.env.NODE_ENV = 'production';

    const { getEnvConfig } = await importEnv();
    expect(() => getEnvConfig()).toThrow();
  });
});

// ---------------------------------------------------------------------------
// getEnvConfigSafe()
// ---------------------------------------------------------------------------

describe('getEnvConfigSafe()', () => {
  it('returns null when getEnvConfig throws', async () => {
    delete process.env.NEXT_PUBLIC_STARKNET_NETWORK;
    delete process.env.NEXT_PUBLIC_RPC_URL;
    process.env.NODE_ENV = 'production';

    const { getEnvConfigSafe } = await importEnv();
    const result = getEnvConfigSafe();
    expect(result).toBeNull();
  });

  it('returns config when valid', async () => {
    process.env.NEXT_PUBLIC_STARKNET_NETWORK = 'devnet';
    process.env.NEXT_PUBLIC_RPC_URL = 'http://localhost:5050';
    process.env.NODE_ENV = 'development';

    const { getEnvConfigSafe } = await importEnv();
    const result = getEnvConfigSafe();
    expect(result).not.toBeNull();
    expect(result!.network).toBe('devnet');
  });
});

// ---------------------------------------------------------------------------
// isEnvValid()
// ---------------------------------------------------------------------------

describe('isEnvValid()', () => {
  it('returns true when env is valid', async () => {
    process.env.NEXT_PUBLIC_STARKNET_NETWORK = 'devnet';
    process.env.NEXT_PUBLIC_RPC_URL = 'http://localhost:5050';

    const { isEnvValid } = await importEnv();
    expect(isEnvValid()).toBe(true);
  });

  it('returns false when required vars are missing', async () => {
    delete process.env.NEXT_PUBLIC_STARKNET_NETWORK;
    delete process.env.NEXT_PUBLIC_RPC_URL;

    const { isEnvValid } = await importEnv();
    expect(isEnvValid()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getEnvVar()
// ---------------------------------------------------------------------------

describe('getEnvVar()', () => {
  it('returns the value of an existing env var', async () => {
    process.env.NEXT_PUBLIC_STARKNET_NETWORK = 'sepolia';
    process.env.NEXT_PUBLIC_RPC_URL = 'https://example.com';

    const { getEnvVar } = await importEnv();
    expect(getEnvVar('NEXT_PUBLIC_STARKNET_NETWORK')).toBe('sepolia');
  });

  it('returns default when env var is not set', async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    process.env.NEXT_PUBLIC_STARKNET_NETWORK = 'devnet';
    process.env.NEXT_PUBLIC_RPC_URL = 'http://localhost:5050';

    const { getEnvVar } = await importEnv();
    expect(getEnvVar('NEXT_PUBLIC_API_URL', 'http://fallback')).toBe('http://fallback');
  });
});
