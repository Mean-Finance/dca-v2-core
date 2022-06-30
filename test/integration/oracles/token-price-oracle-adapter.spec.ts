import { utils } from 'ethers';
import { deployments, ethers, getNamedAccounts } from 'hardhat';
import { ChainlinkOracle, TokenPriceOracleAdapter } from '@typechained';
import { getNodeUrl } from '@utils/network';
import { evm, wallet } from '@test-utils';
import { contract, given, then } from '@test-utils/bdd';
import { expect } from 'chai';
import { convertPriceToBigNumberWithDecimals, getPrice } from '@test-utils/defillama';
import { DeterministicFactory, DeterministicFactory__factory } from '@mean-finance/deterministic-factory/typechained';

let oracle: TokenPriceOracleAdapter;

const WETH = { address: '0x4200000000000000000000000000000000000006', decimals: 18, symbol: 'WETH' };
const USDC = { address: '0x7f5c764cbc14f9669b88837ca1490cca17c31607', decimals: 6, symbol: 'USDC' };
const USDT = { address: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', decimals: 6, symbol: 'USDT' };
const WBTC = { address: '0x68f180fcce6836688e9084f035309e29bf0a2095', decimals: 8, symbol: 'WBTC' };
const DAI = { address: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', decimals: 18, symbol: 'DAI' };
const LINK = { address: '0x350a791bfc2c21f9ed5d10980dad2e2638ffa7f6', decimals: 18, symbol: 'LINK' };

const PLANS: { tokenIn: Token; tokenOut: Token }[] = [
  { tokenIn: WETH, tokenOut: WBTC },
  { tokenIn: USDC, tokenOut: WBTC },
  { tokenIn: WETH, tokenOut: USDT },
  { tokenIn: DAI, tokenOut: WBTC },
  { tokenIn: LINK, tokenOut: DAI },
  { tokenIn: WETH, tokenOut: LINK },
];

const TRESHOLD_PERCENTAGE = 2.5;

contract('TokenPriceOracleAdapter', () => {
  before(async () => {
    await evm.reset({
      network: 'optimism',
      skipHardhatDeployFork: true,
    });

    const namedAccounts = await getNamedAccounts();
    const governorAddress = namedAccounts.governor;
    const governor = await wallet.impersonate(governorAddress);
    await ethers.provider.send('hardhat_setBalance', [governorAddress, '0xffffffffffffffff']);

    const deterministicFactory = await ethers.getContractAt<DeterministicFactory>(
      DeterministicFactory__factory.abi,
      '0xbb681d77506df5CA21D2214ab3923b4C056aa3e2'
    );
    await deterministicFactory.connect(governor).grantRole(await deterministicFactory.DEPLOYER_ROLE(), namedAccounts.deployer);

    await deployments.run('TokenPriceOracleAdapter', {
      resetMemory: true,
      deletePreviousDeployments: false,
      writeDeploymentsToFiles: false,
    });
    oracle = await ethers.getContract('TokenPriceOracleAdapter');
  });

  describe('quoting', () => {
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
