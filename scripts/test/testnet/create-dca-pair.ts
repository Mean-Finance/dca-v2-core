import { BigNumber } from '@ethersproject/bignumber';
import { TransactionResponse } from '@ethersproject/abstract-provider';
import { ethers } from 'hardhat';
import moment from 'moment';
import { abi as FACTORY_ABI } from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json';
import erc20 from '../../../test/utils/erc20';
import { Contract, utils } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import constants from '../../../test/utils/constants';

enum FeeAmount {
  LOW = 500,
  MEDIUM = 3000,
  HIGH = 10000,
}

const AMOUNT_OF_PAIRS = 1;
const SEBI_TEST_ACCOUNT = '0xD04Fc1C35cd00F799d6831E33978F302FE861789';

const randomNumber = (min: number, max: number): number => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const randomFloat = (min: number, max: number): number => {
  return Math.random() * (max - min + 1) + min;
};

const fiveMinutes = moment.duration('5', 'minutes').as('seconds');
const daily = moment.duration('1', 'days').as('seconds');

let randomUser: SignerWithAddress;

async function main() {
  const uniswapFactory = await ethers.getContractAt(FACTORY_ABI, '0x1f98431c8ad98523631ae4a59f267346ea31f984');
  const dcaFactory = await ethers.getContract('Factory');
  const [deployer, governor] = await ethers.getSigners();
  [, , , randomUser] = await ethers.getSigners();
  console.log('deployer', deployer.address);
  console.log('governor', governor.address);
  console.log('random user', randomUser.address);

  const token0 = await ethers.getContractAt('ERC20Mock', '0xa612918c2218024344c94667DEEec4e051554E42');
  const token1 = await ethers.getContractAt('ERC20Mock', '0x41474b9A1Ec76329300193992e9cF37B1C655217');

  const pairAddress = await dcaFactory.callStatic.createPair(token0.address, token1.address, { gasLimit: 10000000 });
  await dcaFactory.createPair(token0.address, token1.address, { gasLimit: 10000000 });
  console.log('Created DCAPair', pairAddress);

  const pair = await ethers.getContractAt('contracts/DCAPair/DCAPair.sol:DCAPair', pairAddress);

  console.log('Got pair contract');

  const dailyPositionId = await generatePosition(pair, randomNumber(1, 2) == 1 ? token0 : token1, daily);
  const dailyPositionId2 = await generatePosition(pair, randomNumber(1, 2) == 1 ? token0 : token1, daily);
  const dailyPositionId3 = await generatePosition(pair, randomNumber(1, 2) == 1 ? token0 : token1, daily);
  console.log('Daily position generated');

  const fiveMinutesPositionId = await generatePosition(pair, randomNumber(1, 2) == 1 ? token0 : token1, fiveMinutes);
  const fiveMinutesPositionId2 = await generatePosition(pair, randomNumber(1, 2) == 1 ? token0 : token1, fiveMinutes);
  const fiveMinutesPositionId3 = await generatePosition(pair, randomNumber(1, 2) == 1 ? token0 : token1, fiveMinutes);
  console.log('Ten minutes position generated');

  // logging
  console.log(`T0`, token0.address);
  console.log(`T1`, token1.address);
  console.log(`DCA Pair (T0 <-> T1)`, pairAddress);

  console.log('Daily position ID', dailyPositionId);
  console.log('Daily position ID 2', dailyPositionId2);
  console.log('Daily position ID 3', dailyPositionId3);
  console.log('Five minutes position ID', fiveMinutesPositionId);
  console.log('Five minutes position ID 2', fiveMinutesPositionId2);
  console.log('Five minutes position ID 3', fiveMinutesPositionId3);
}

const generatePosition = async (pair: Contract, from: Contract, interval: number): Promise<BigNumber> => {
  const rate = utils.parseEther(`${randomFloat(0, 2).toFixed(5)}`);
  const amountOfSwaps = BigNumber.from(`${randomNumber(20, 1000)}`);
  await from.connect(randomUser).approve(pair.address, constants.MAX_UINT_256, { gasLimit: 1500000 });
  // const id = await pair.connect(randomUser).callStatic.deposit(from.address, rate, amountOfSwaps, interval, { gasLimit: 2500000 });
  await pair.connect(randomUser).deposit(from.address, rate, amountOfSwaps, interval, { gasLimit: 2500000 });
  // return id;
  return BigNumber.from('0');
};

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
