/**
 * Debug script: Verify token balance queries on Starknet Sepolia
 *
 * Tests balance_of for ETH, STRK, USDC, wBTC and Pragma Oracle price queries.
 * Run with: node scripts/debug-token-balances.mjs
 */

import { RpcProvider, Contract, CairoCustomEnum, CallData } from 'starknet';

const RPC_URL = 'https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/demo';
const USER = '0x01f9ebd4b60101259df3ac877a27a1a017e7961995fa913be1a6f189af664660';

const provider = new RpcProvider({ nodeUrl: RPC_URL });

const ERC20_BALANCE_ABI = [
  {
    name: 'balance_of',
    type: 'function',
    inputs: [{ name: 'account', type: 'core::starknet::contract_address::ContractAddress' }],
    outputs: [{ name: 'balance', type: 'core::integer::u256' }],
    state_mutability: 'view',
  },
];

const TOKENS = {
  ETH:  { address: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7', decimals: 18 },
  STRK: { address: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d', decimals: 18 },
  USDC: { address: '0x053b40A647CEDfca6cA84f542A0fe36736031905A9639a7f19A3C1e66bFd5080', decimals: 6 },
  wBTC: { address: '0x00452bd5c0512a61df7c7be8cfea5e4f893cb40e126bdc40aee6054db955129e', decimals: 8 },
};

console.log('=== Token Balance Debug Script ===');
console.log(`User: ${USER}`);
console.log(`RPC:  ${RPC_URL}\n`);

// Test 1: Direct RPC balance queries
console.log('--- Test 1: Direct balance_of via Contract.call ---');
for (const [name, token] of Object.entries(TOKENS)) {
  try {
    const contract = new Contract(ERC20_BALANCE_ABI, token.address, provider);
    const result = await contract.call('balance_of', [USER], { parseResponse: true });

    // Extract balance from struct return
    let balance;
    if (typeof result === 'bigint') {
      balance = result;
    } else if (typeof result === 'object' && result !== null && 'balance' in result) {
      balance = result.balance;
    } else {
      balance = 0n;
    }

    const human = Number(balance) / Math.pow(10, token.decimals);
    console.log(`  ${name.padEnd(5)}: ${human.toFixed(6)} (raw: ${balance}, type: ${typeof result}${typeof result === 'object' ? ` keys: [${Object.keys(result)}]` : ''})`);
  } catch (e) {
    console.log(`  ${name.padEnd(5)}: ERROR - ${e.message.slice(0, 100)}`);
  }
}

// Test 2: Pragma Oracle price queries
console.log('\n--- Test 2: Pragma Oracle Prices ---');

// Import OracleWrapper ABI
const { default: OracleABI } = await import('../src/lib/contracts/abis/OracleWrapper.json', { assert: { type: 'json' } });

const ORACLE = '0x4d86bb472cb462a45d68a705a798b5e419359a5758d84b24af4bbe5441b6e5a';
const oracleContract = new Contract(OracleABI, ORACLE, provider);

const PAIRS = {
  SAGE_USD: new CairoCustomEnum({ SAGE_USD: {}, USDC_USD: undefined, ETH_USD: undefined, STRK_USD: undefined, BTC_USD: undefined }),
  ETH_USD:  new CairoCustomEnum({ SAGE_USD: undefined, USDC_USD: undefined, ETH_USD: {}, STRK_USD: undefined, BTC_USD: undefined }),
  STRK_USD: new CairoCustomEnum({ SAGE_USD: undefined, USDC_USD: undefined, ETH_USD: undefined, STRK_USD: {}, BTC_USD: undefined }),
  BTC_USD:  new CairoCustomEnum({ SAGE_USD: undefined, USDC_USD: undefined, ETH_USD: undefined, STRK_USD: undefined, BTC_USD: {} }),
};

for (const [pair, enumVal] of Object.entries(PAIRS)) {
  try {
    const result = await oracleContract.get_price(enumVal);
    const price = Number(result.price) / Math.pow(10, Number(result.decimals));
    console.log(`  ${pair.padEnd(10)}: $${price.toFixed(4)} (raw: ${result.price}, dec: ${result.decimals})`);
  } catch (e) {
    console.log(`  ${pair.padEnd(10)}: ERROR - ${e.message.slice(0, 100)}`);
  }
}

// Test 3: Verify enum serialization
console.log('\n--- Test 3: CairoCustomEnum vs Plain Object Serialization ---');

const plainObj = { variant: { ETH_USD: {} } };
const cairoEnum = new CairoCustomEnum({ SAGE_USD: undefined, USDC_USD: undefined, ETH_USD: {}, STRK_USD: undefined, BTC_USD: undefined });

console.log(`  Plain { variant: { ETH_USD: {} } }:`);
try {
  const compiled = CallData.compile({ pair: plainObj });
  console.log(`    CallData.compile => [${compiled}] (length: ${compiled.length})`);
} catch (e) {
  console.log(`    CallData.compile => ERROR: ${e.message.slice(0, 100)}`);
}

console.log(`  CairoCustomEnum({ ETH_USD: {} }):`);
try {
  const compiled = CallData.compile({ pair: cairoEnum });
  console.log(`    CallData.compile => [${compiled}] (length: ${compiled.length})`);
} catch (e) {
  console.log(`    CallData.compile => ERROR: ${e.message.slice(0, 100)}`);
}

console.log('\n--- Test 4: Address Normalization ---');
const usdc_mixed = '0x053b40A647CEDfca6cA84f542A0fe36736031905A9639a7f19A3C1e66bFd5080';
const usdc_lower = '0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080';
console.log(`  USDC mixed case: ${usdc_mixed}`);
console.log(`  USDC lowercase:  ${usdc_lower}`);
console.log(`  Numeric equal:   ${BigInt(usdc_mixed) === BigInt(usdc_lower)}`);
console.log(`  String equal:    ${usdc_mixed === usdc_lower}`);

console.log('\n=== Summary ===');
console.log('Root cause: Two bugs in the Pragma Oracle integration:');
console.log('  1. PRICE_PAIR_VARIANTS used plain objects instead of CairoCustomEnum');
console.log('     -> CallData.compile produced empty calldata -> RPC call failed silently');
console.log('     -> pragmaPrices.*.isLoading stayed true forever');
console.log('     -> ETH/STRK/wBTC isLoading = balanceLoading || priceLoading (always true)');
console.log('  2. usePragmaOracle.ts checked Array.isArray(data) but starknet.js returns struct');
console.log('     -> Price data parsed as null even when successfully fetched');
console.log('  3. formatBalance in wallet page could not extract bigint from { balance: bigint }');
console.log('     -> USDC showed "0.00" because BigInt(String({balance: 0n})) threw');
