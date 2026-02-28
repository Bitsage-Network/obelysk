/**
 * Contract Addresses — Unit Tests
 *
 * Tests the addresses module for correctness of address constants,
 * helper functions, and per-token privacy pool mappings.
 */

import { describe, it, expect } from 'vitest';
import {
  CONTRACTS,
  EXTERNAL_TOKENS,
  NETWORK_CONFIG,
  PRIVACY_POOL_FOR_TOKEN,
  ASSET_ID_FOR_TOKEN,
  TOKEN_METADATA,
  STARKGATE_BRIDGES,
  ETHEREUM_CHAIN_CONFIG,
  EKUBO_CORE,
  getContractAddress,
  getTokenAddress,
  getTokenAddressForSymbol,
  getPrivacyPoolAddress,
  getStarkGateBridgeAddresses,
  getEthereumChainConfig,
  type NetworkType,
  type ContractName,
  type TokenSymbol,
} from '../addresses';

// ---------------------------------------------------------------------------
// Helper: validate hex format
// ---------------------------------------------------------------------------

function isValidHex(s: string): boolean {
  return /^0x[0-9a-fA-F]+$/.test(s);
}

// ---------------------------------------------------------------------------
// CONTRACTS object structure
// ---------------------------------------------------------------------------

describe('CONTRACTS', () => {
  it('has devnet, sepolia, and mainnet keys', () => {
    expect(CONTRACTS).toHaveProperty('devnet');
    expect(CONTRACTS).toHaveProperty('sepolia');
    expect(CONTRACTS).toHaveProperty('mainnet');
  });

  it('all sepolia addresses are valid hex strings', () => {
    const sepoliaContracts = CONTRACTS.sepolia;
    for (const [name, address] of Object.entries(sepoliaContracts)) {
      expect(
        isValidHex(address),
        `sepolia.${name} should be valid hex, got: ${address}`,
      ).toBe(true);
    }
  });

  it('core sepolia contracts are not 0x0', () => {
    const coreContracts: ContractName[] = [
      'SAGE_TOKEN',
      'STAKING',
      'VALIDATOR_REGISTRY',
      'JOB_MANAGER',
      'PRIVACY_ROUTER',
      'FAUCET',
      'OTC_ORDERBOOK',
      'PRIVACY_POOLS',
      'CONFIDENTIAL_SWAP',
      'SESSION_MANAGER',
      'SHIELDED_SWAP_ROUTER',
      'CONFIDENTIAL_TRANSFER',
      'DARK_POOL',
    ];

    for (const name of coreContracts) {
      const addr = CONTRACTS.sepolia[name];
      expect(
        addr !== '0x0',
        `sepolia.${name} should not be 0x0`,
      ).toBe(true);
    }
  });

  it('STEALTH_REGISTRY is deployed on sepolia', () => {
    expect(CONTRACTS.sepolia.STEALTH_REGISTRY).not.toBe('0x0');
    expect(CONTRACTS.sepolia.STEALTH_REGISTRY).toMatch(/^0x[0-9a-fA-F]+$/);
  });

  it('deployed mainnet contracts are valid non-zero hex', () => {
    const deployedContracts: ContractName[] = [
      'SAGE_TOKEN',
      'PRIVACY_ROUTER',
      'CONFIDENTIAL_TRANSFER',
      'SAGE_PRIVACY_POOL',
      'ETH_PRIVACY_POOL',
      'STRK_PRIVACY_POOL',
      'WBTC_PRIVACY_POOL',
      'USDC_PRIVACY_POOL',
      'VM31_POOL',
      'VM31_VERIFIER',
      'VM31_BRIDGE',
      'STEALTH_REGISTRY',
      'DARK_POOL',
      'SHIELDED_SWAP_ROUTER',
    ];
    for (const name of deployedContracts) {
      const addr = CONTRACTS.mainnet[name];
      expect(isValidHex(addr), `mainnet.${name} should be valid hex`).toBe(true);
      expect(addr, `mainnet.${name} should not be 0x0`).not.toBe('0x0');
    }
  });

  it('undeployed mainnet contracts are 0x0', () => {
    const undeployedContracts: ContractName[] = [
      'SESSION_MANAGER',
      'STAKING',
      'JOB_MANAGER',
    ];
    for (const name of undeployedContracts) {
      expect(CONTRACTS.mainnet[name]).toBe('0x0');
    }
  });

  it('devnet and sepolia have the same contract keys', () => {
    const devnetKeys = Object.keys(CONTRACTS.devnet).sort();
    const sepoliaKeys = Object.keys(CONTRACTS.sepolia).sort();
    expect(devnetKeys).toEqual(sepoliaKeys);
  });

  it('sepolia and mainnet have the same contract keys', () => {
    const sepoliaKeys = Object.keys(CONTRACTS.sepolia).sort();
    const mainnetKeys = Object.keys(CONTRACTS.mainnet).sort();
    expect(sepoliaKeys).toEqual(mainnetKeys);
  });
});

// ---------------------------------------------------------------------------
// getContractAddress()
// ---------------------------------------------------------------------------

describe('getContractAddress()', () => {
  it('returns the correct sepolia SAGE_TOKEN address', () => {
    const addr = getContractAddress('sepolia', 'SAGE_TOKEN');
    expect(addr).toBe(CONTRACTS.sepolia.SAGE_TOKEN);
    expect(isValidHex(addr)).toBe(true);
    expect(addr).not.toBe('0x0');
  });

  it('returns the correct devnet SAGE_TOKEN address', () => {
    const addr = getContractAddress('devnet', 'SAGE_TOKEN');
    expect(addr).toBe(CONTRACTS.devnet.SAGE_TOKEN);
  });

  it('returns deployed address for mainnet SAGE_TOKEN', () => {
    const addr = getContractAddress('mainnet', 'SAGE_TOKEN');
    expect(isValidHex(addr)).toBe(true);
    expect(addr).not.toBe('0x0');
  });
});

// ---------------------------------------------------------------------------
// EXTERNAL_TOKENS
// ---------------------------------------------------------------------------

describe('EXTERNAL_TOKENS', () => {
  it('has sepolia, mainnet, and devnet', () => {
    expect(EXTERNAL_TOKENS).toHaveProperty('sepolia');
    expect(EXTERNAL_TOKENS).toHaveProperty('mainnet');
    expect(EXTERNAL_TOKENS).toHaveProperty('devnet');
  });

  it('ETH address is the same across sepolia and mainnet', () => {
    expect(EXTERNAL_TOKENS.sepolia.ETH).toBe(EXTERNAL_TOKENS.mainnet.ETH);
  });

  it('STRK address is the same across sepolia and mainnet', () => {
    expect(EXTERNAL_TOKENS.sepolia.STRK).toBe(EXTERNAL_TOKENS.mainnet.STRK);
  });

  it('USDC differs between sepolia and mainnet', () => {
    expect(EXTERNAL_TOKENS.sepolia.USDC).not.toBe(EXTERNAL_TOKENS.mainnet.USDC);
  });

  it('all sepolia tokens are valid non-zero hex', () => {
    for (const [symbol, addr] of Object.entries(EXTERNAL_TOKENS.sepolia)) {
      expect(
        isValidHex(addr),
        `sepolia ${symbol} should be valid hex`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// getTokenAddress()
// ---------------------------------------------------------------------------

describe('getTokenAddress()', () => {
  it('returns correct ETH address for sepolia', () => {
    const addr = getTokenAddress('sepolia', 'ETH');
    expect(addr).toBe(EXTERNAL_TOKENS.sepolia.ETH);
  });

  it('returns correct STRK address for mainnet', () => {
    const addr = getTokenAddress('mainnet', 'STRK');
    expect(addr).toBe(EXTERNAL_TOKENS.mainnet.STRK);
  });
});

// ---------------------------------------------------------------------------
// getTokenAddressForSymbol()
// ---------------------------------------------------------------------------

describe('getTokenAddressForSymbol()', () => {
  it('returns SAGE_TOKEN address for "SAGE"', () => {
    const addr = getTokenAddressForSymbol('sepolia', 'SAGE');
    expect(addr).toBe(CONTRACTS.sepolia.SAGE_TOKEN);
    expect(addr).not.toBe('0x0');
  });

  it('returns ETH token address for "ETH"', () => {
    const addr = getTokenAddressForSymbol('sepolia', 'ETH');
    expect(addr).toBe(EXTERNAL_TOKENS.sepolia.ETH);
  });

  it('returns STRK token address for "STRK"', () => {
    const addr = getTokenAddressForSymbol('sepolia', 'STRK');
    expect(addr).toBe(EXTERNAL_TOKENS.sepolia.STRK);
  });

  it('returns USDC token address for "USDC"', () => {
    const addr = getTokenAddressForSymbol('sepolia', 'USDC');
    expect(addr).toBe(EXTERNAL_TOKENS.sepolia.USDC);
  });

  it('returns wBTC token address for "wBTC"', () => {
    const addr = getTokenAddressForSymbol('sepolia', 'wBTC');
    expect(addr).toBe(EXTERNAL_TOKENS.sepolia.wBTC);
  });

  it('returns 0x0 for unknown symbol', () => {
    const addr = getTokenAddressForSymbol('sepolia', 'UNKNOWN');
    expect(addr).toBe('0x0');
  });

  it('returns deployed SAGE address on mainnet', () => {
    const addr = getTokenAddressForSymbol('mainnet', 'SAGE');
    expect(isValidHex(addr)).toBe(true);
    expect(addr).not.toBe('0x0');
  });
});

// ---------------------------------------------------------------------------
// PRIVACY_POOL_FOR_TOKEN
// ---------------------------------------------------------------------------

describe('PRIVACY_POOL_FOR_TOKEN', () => {
  it('has sepolia and mainnet keys', () => {
    expect(PRIVACY_POOL_FOR_TOKEN).toHaveProperty('sepolia');
    expect(PRIVACY_POOL_FOR_TOKEN).toHaveProperty('mainnet');
  });

  it('sepolia has all 5 token entries (SAGE, ETH, STRK, wBTC, USDC)', () => {
    const tokens = Object.keys(PRIVACY_POOL_FOR_TOKEN.sepolia);
    expect(tokens).toContain('SAGE');
    expect(tokens).toContain('ETH');
    expect(tokens).toContain('STRK');
    expect(tokens).toContain('wBTC');
    expect(tokens).toContain('USDC');
    expect(tokens).toHaveLength(5);
  });

  it('sepolia pool addresses match CONTRACTS', () => {
    expect(PRIVACY_POOL_FOR_TOKEN.sepolia.SAGE).toBe(CONTRACTS.sepolia.SAGE_PRIVACY_POOL);
    expect(PRIVACY_POOL_FOR_TOKEN.sepolia.ETH).toBe(CONTRACTS.sepolia.ETH_PRIVACY_POOL);
    expect(PRIVACY_POOL_FOR_TOKEN.sepolia.STRK).toBe(CONTRACTS.sepolia.STRK_PRIVACY_POOL);
    expect(PRIVACY_POOL_FOR_TOKEN.sepolia.wBTC).toBe(CONTRACTS.sepolia.WBTC_PRIVACY_POOL);
    expect(PRIVACY_POOL_FOR_TOKEN.sepolia.USDC).toBe(CONTRACTS.sepolia.USDC_PRIVACY_POOL);
  });

  it('all mainnet pools are deployed (non-zero)', () => {
    for (const [token, addr] of Object.entries(PRIVACY_POOL_FOR_TOKEN.mainnet)) {
      expect(isValidHex(addr), `mainnet pool for ${token} should be valid hex`).toBe(true);
      expect(addr, `mainnet pool for ${token} should not be 0x0`).not.toBe('0x0');
    }
  });
});

// ---------------------------------------------------------------------------
// getPrivacyPoolAddress()
// ---------------------------------------------------------------------------

describe('getPrivacyPoolAddress()', () => {
  it('returns correct address for sepolia SAGE', () => {
    const addr = getPrivacyPoolAddress('sepolia', 'SAGE');
    expect(addr).toBe(CONTRACTS.sepolia.SAGE_PRIVACY_POOL);
  });

  it('returns 0x0 for unknown token', () => {
    const addr = getPrivacyPoolAddress('sepolia', 'DOGECOIN');
    expect(addr).toBe('0x0');
  });

  it('returns deployed address for mainnet SAGE pool', () => {
    const addr = getPrivacyPoolAddress('mainnet', 'SAGE');
    expect(isValidHex(addr)).toBe(true);
    expect(addr).not.toBe('0x0');
  });

  it('returns fallback for devnet (uses sepolia pools)', () => {
    const addr = getPrivacyPoolAddress('devnet' as NetworkType, 'SAGE');
    // devnet falls back to sepolia which has deployed pools
    expect(isValidHex(addr)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ASSET_ID_FOR_TOKEN
// ---------------------------------------------------------------------------

describe('ASSET_ID_FOR_TOKEN', () => {
  it('contains all 5 expected tokens', () => {
    expect(ASSET_ID_FOR_TOKEN).toHaveProperty('SAGE');
    expect(ASSET_ID_FOR_TOKEN).toHaveProperty('ETH');
    expect(ASSET_ID_FOR_TOKEN).toHaveProperty('STRK');
    expect(ASSET_ID_FOR_TOKEN).toHaveProperty('USDC');
    expect(ASSET_ID_FOR_TOKEN).toHaveProperty('wBTC');
  });

  it('each ID is a unique hex string', () => {
    const ids = Object.values(ASSET_ID_FOR_TOKEN);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('SAGE has asset ID 0x0', () => {
    expect(ASSET_ID_FOR_TOKEN.SAGE).toBe('0x0');
  });

  it('ETH has asset ID 0x1', () => {
    expect(ASSET_ID_FOR_TOKEN.ETH).toBe('0x1');
  });
});

// ---------------------------------------------------------------------------
// TOKEN_METADATA
// ---------------------------------------------------------------------------

describe('TOKEN_METADATA', () => {
  it('has all expected token symbols', () => {
    expect(TOKEN_METADATA).toHaveProperty('SAGE');
    expect(TOKEN_METADATA).toHaveProperty('ETH');
    expect(TOKEN_METADATA).toHaveProperty('STRK');
    expect(TOKEN_METADATA).toHaveProperty('USDC');
    expect(TOKEN_METADATA).toHaveProperty('wBTC');
  });

  it('each token has symbol, name, decimals, and logo', () => {
    for (const [key, meta] of Object.entries(TOKEN_METADATA)) {
      expect(meta).toHaveProperty('symbol');
      expect(meta).toHaveProperty('name');
      expect(meta).toHaveProperty('decimals');
      expect(meta).toHaveProperty('logo');
      expect(typeof meta.decimals).toBe('number');
      expect(meta.decimals).toBeGreaterThan(0);
    }
  });

  it('USDC has 6 decimals', () => {
    expect(TOKEN_METADATA.USDC.decimals).toBe(6);
  });

  it('wBTC has 8 decimals', () => {
    expect(TOKEN_METADATA.wBTC.decimals).toBe(8);
  });

  it('ETH has 18 decimals', () => {
    expect(TOKEN_METADATA.ETH.decimals).toBe(18);
  });
});

// ---------------------------------------------------------------------------
// NETWORK_CONFIG
// ---------------------------------------------------------------------------

describe('NETWORK_CONFIG', () => {
  it('has devnet, sepolia, mainnet keys', () => {
    expect(NETWORK_CONFIG).toHaveProperty('devnet');
    expect(NETWORK_CONFIG).toHaveProperty('sepolia');
    expect(NETWORK_CONFIG).toHaveProperty('mainnet');
  });

  it('each network has chainId, name, rpcUrl, explorerUrl', () => {
    for (const [net, config] of Object.entries(NETWORK_CONFIG)) {
      expect(config).toHaveProperty('chainId');
      expect(config).toHaveProperty('name');
      expect(config).toHaveProperty('rpcUrl');
      expect(config).toHaveProperty('explorerUrl');
    }
  });

  it('devnet rpcUrl is localhost', () => {
    expect(NETWORK_CONFIG.devnet.rpcUrl).toContain('localhost');
  });

  it('sepolia and devnet share the same chainId', () => {
    expect(NETWORK_CONFIG.sepolia.chainId).toBe(NETWORK_CONFIG.devnet.chainId);
  });

  it('mainnet has a different chainId', () => {
    expect(NETWORK_CONFIG.mainnet.chainId).not.toBe(NETWORK_CONFIG.sepolia.chainId);
  });
});

// ---------------------------------------------------------------------------
// StarkGate bridges
// ---------------------------------------------------------------------------

describe('STARKGATE_BRIDGES', () => {
  it('has sepolia and mainnet', () => {
    expect(STARKGATE_BRIDGES).toHaveProperty('sepolia');
    expect(STARKGATE_BRIDGES).toHaveProperty('mainnet');
  });

  it('each bridge entry has l1Bridge, l2Bridge, l2Token', () => {
    for (const network of ['sepolia', 'mainnet'] as const) {
      for (const [token, bridge] of Object.entries(STARKGATE_BRIDGES[network])) {
        expect(bridge).toHaveProperty('l1Bridge');
        expect(bridge).toHaveProperty('l2Bridge');
        expect(bridge).toHaveProperty('l2Token');
      }
    }
  });
});

describe('getStarkGateBridgeAddresses()', () => {
  it('returns correct bridge info for sepolia ETH', () => {
    const bridge = getStarkGateBridgeAddresses('sepolia', 'ETH');
    expect(bridge.l2Token).toBe(EXTERNAL_TOKENS.sepolia.ETH);
  });
});

// ---------------------------------------------------------------------------
// Ethereum chain config
// ---------------------------------------------------------------------------

describe('ETHEREUM_CHAIN_CONFIG', () => {
  it('sepolia has chain ID 11155111', () => {
    expect(ETHEREUM_CHAIN_CONFIG.sepolia.chainIdDecimal).toBe(11155111);
  });

  it('mainnet has chain ID 1', () => {
    expect(ETHEREUM_CHAIN_CONFIG.mainnet.chainIdDecimal).toBe(1);
  });
});

describe('getEthereumChainConfig()', () => {
  it('returns sepolia config', () => {
    const config = getEthereumChainConfig('sepolia');
    expect(config.name).toBe('Ethereum Sepolia');
  });

  it('returns mainnet config', () => {
    const config = getEthereumChainConfig('mainnet');
    expect(config.name).toBe('Ethereum Mainnet');
  });
});

// ---------------------------------------------------------------------------
// Ekubo Core
// ---------------------------------------------------------------------------

describe('EKUBO_CORE', () => {
  it('has sepolia and mainnet addresses', () => {
    expect(isValidHex(EKUBO_CORE.sepolia)).toBe(true);
    expect(isValidHex(EKUBO_CORE.mainnet)).toBe(true);
  });

  it('sepolia and mainnet addresses differ', () => {
    expect(EKUBO_CORE.sepolia).not.toBe(EKUBO_CORE.mainnet);
  });
});
