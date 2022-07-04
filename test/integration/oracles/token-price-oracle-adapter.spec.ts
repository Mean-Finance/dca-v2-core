import { utils } from 'ethers';
import { deployments, ethers, getNamedAccounts } from 'hardhat';
import { ChainlinkOracle, DCAHub, TokenPriceOracleAdapter, TokenPriceOracleAdapter__factory } from '@typechained';
import { JsonRpcSigner } from '@ethersproject/providers';
import { evm, wallet } from '@test-utils';
import { contract, given, then, when } from '@test-utils/bdd';
import { expect } from 'chai';
import { convertPriceToBigNumberWithDecimals, getPrice } from '@test-utils/defillama';
import { DeterministicFactory, DeterministicFactory__factory } from '@mean-finance/deterministic-factory/typechained';

let oracle: TokenPriceOracleAdapter;
let hub: DCAHub;

const DETERMINISTIC_FACTORY_ADMIN = '0x1a00e1e311009e56e3b0b9ed6f86f5ce128a1c01';

const WETH = { address: '0x4200000000000000000000000000000000000006', decimals: 18, symbol: 'WETH' };
const USDC = { address: '0x7f5c764cbc14f9669b88837ca1490cca17c31607', decimals: 6, symbol: 'USDC' };
const USDT = { address: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', decimals: 6, symbol: 'USDT' };
const WBTC = { address: '0x68f180fcce6836688e9084f035309e29bf0a2095', decimals: 8, symbol: 'WBTC' };
const DAI = { address: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', decimals: 18, symbol: 'DAI' };
const LINK = { address: '0x350a791bfc2c21f9ed5d10980dad2e2638ffa7f6', decimals: 18, symbol: 'LINK' };
const UNI = { address: '0x6fd9d7ad17242c41f7131d257212c54a0e816691', decimals: 18, symbol: 'UNI' };
const OP = { address: '0x4200000000000000000000000000000000000042', decimals: 18, symbol: 'OP' };
const ENS = { address: '0x65559aa14915a70190438ef90104769e5e890a00', decimals: 18, symbol: 'ENS' };
const SNX = { address: '0x8700daec35af8ff88c16bdf0418774cb3d7599b4', decimals: 18, symbol: 'LINK' };

// WETH/ENS,
// OP/USDT,
// OP/DAI,
// WBTC/UNI,
// WBTC/USDT,
// WBTC/DAI,
// USDC/USDT,
// SNX/DAI,
const INTEGRATION_SWAP_PAIRS: { tokenIn: Token; tokenOut: Token }[] = [
  { tokenIn: WETH, tokenOut: ENS },
  { tokenIn: OP, tokenOut: USDT },
  { tokenIn: OP, tokenOut: DAI },
  { tokenIn: WBTC, tokenOut: UNI },
  { tokenIn: WBTC, tokenOut: USDT },
  { tokenIn: WBTC, tokenOut: DAI },
  { tokenIn: USDC, tokenOut: USDT },
  { tokenIn: SNX, tokenOut: DAI },
];

const PLANS: { tokenIn: Token; tokenOut: Token }[] = [
  { tokenIn: WETH, tokenOut: WBTC },
  { tokenIn: USDC, tokenOut: WBTC },
  { tokenIn: WETH, tokenOut: USDT },
  { tokenIn: DAI, tokenOut: WBTC },
  { tokenIn: LINK, tokenOut: DAI },
  { tokenIn: WETH, tokenOut: LINK },
];

const TRESHOLD_PERCENTAGE = 2.5;

contract.only('TokenPriceOracleAdapter', () => {
  describe('migrating hub oracle', () => {
    let timelock: JsonRpcSigner;
    given(async () => {
      // Prev.: https://optimistic.etherscan.io/tx/0xd5ffd365694e3ab3030565b6e2b604f3a6434a6747170f4972a150c9883b1544
      await fork({
        blockNumber: 13494238,
        keepDeployment: true,
      });
      hub = await ethers.getContract('DCAHub');
      const timelockAddress = (await deployments.get('Timelock')).address;
      timelock = await wallet.impersonate(timelockAddress);
      await ethers.provider.send('hardhat_setBalance', [timelockAddress, '0xffffffffffffffff']);
      await hub.connect(timelock).setOracle(oracle.address);
      const msig = await wallet.impersonate('0x308810881807189cAe91950888b2cB73A1CC5920');
      await ethers.provider.send('hardhat_setBalance', [msig._address, '0xffffffffffffffff']);
      // oracle = await ethers.getContractAt(TokenPriceOracleAdapter__factory.abi, '0xFD8aD08F7e35FA949c6dEB9B58623345Faa5D3EF')
      await oracle.connect(msig).addSupportForPairIfNeeded(WETH.address, ENS.address);
      // for (let i = 0; i < INTEGRATION_SWAP_PAIRS.length; i++) {
      //   console.log('adding support-o');
      console.log('adding support-o-o');
      // }
      // Add support for all tokens
    });
    when('there are swaps available', () => {
      then.only(`executes pending swaps`, async () => {
        await timelock.sendTransaction({ gasLimit: 8_000_000, to: '0xbf5c27cc7c1c91e924fa7b4df7928371e8f713a6', data: '' });
      });
    });
  });

  describe('quoting', () => {
    before(async () => {
      await fork({ keepDeployment: false });
    });
    for (const { tokenIn, tokenOut } of PLANS) {
      describe(`(${tokenIn.symbol}, ${tokenOut.symbol})`, () => {
        given(async () => {
          await oracle.addSupportForPairIfNeeded(tokenIn.address, tokenOut.address);
        });
        then(`returns correct quote`, async () => {
          const quote = await oracle.quote(tokenIn.address, utils.parseUnits('1', tokenIn.decimals), tokenOut.address);

          const coingeckoPrice = await getPriceBetweenTokens(tokenIn, tokenOut);
          const expected = convertPriceToBigNumberWithDecimals(coingeckoPrice, tokenOut.decimals);
          const threshold = expected.mul(TRESHOLD_PERCENTAGE * 10).div(100 * 10);
          const [upperThreshold, lowerThreshold] = [expected.add(threshold), expected.sub(threshold)];
          const diff = quote.sub(expected);
          const sign = diff.isNegative() ? '-' : '+';
          const diffPercentage = diff.abs().mul(10000).div(expected).toNumber() / 100;

          expect(
            quote.lte(upperThreshold) && quote.gte(lowerThreshold),
            `Expected ${quote.toString()} to be within [${lowerThreshold.toString()},${upperThreshold.toString()}]. Diff was ${sign}${diffPercentage}%`
          ).to.be.true;
        });
      });
    }
  });
  async function fork({ blockNumber, keepDeployment }: { blockNumber?: number; keepDeployment: boolean }): Promise<void> {
    await evm.reset({
      network: 'optimism',
      blockNumber,
      skipHardhatDeployFork: false,
    });

    const namedAccounts = await getNamedAccounts();
    const deterministicFactoryAdmin = await wallet.impersonate(DETERMINISTIC_FACTORY_ADMIN);
    await ethers.provider.send('hardhat_setBalance', [DETERMINISTIC_FACTORY_ADMIN, '0xffffffffffffffff']);

    const deterministicFactory = await ethers.getContractAt<DeterministicFactory>(
      DeterministicFactory__factory.abi,
      '0xbb681d77506df5CA21D2214ab3923b4C056aa3e2'
    );
    await deterministicFactory.connect(deterministicFactoryAdmin).grantRole(await deterministicFactory.DEPLOYER_ROLE(), namedAccounts.deployer);

    process.env.HARDHAT_DEPLOY_LOG = 'true';
    await deployments.run(['TokenPriceOracleAdapter'], {
      resetMemory: !keepDeployment,
    });
    oracle = await ethers.getContract('TokenPriceOracleAdapter');
    console.log('code:', await ethers.provider.getCode(oracle.address));
  }
});

async function getPriceBetweenTokens(tokenA: Token, tokenB: Token) {
  const tokenAPrice = await fetchPrice(tokenA.address);
  const tokenBPrice = await fetchPrice(tokenB.address);
  return tokenAPrice / tokenBPrice;
}

let priceCache: Map<string, number> = new Map();
async function fetchPrice(address: string): Promise<number> {
  if (!priceCache.has(address)) {
    const price = await getPrice('optimism', address);
    priceCache.set(address, price);
  }
  return priceCache.get(address)!;
}

type Token = { address: string; decimals: number; symbol: string };
