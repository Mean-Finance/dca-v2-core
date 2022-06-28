import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from '@0xged/hardhat-deploy/types';
import moment from 'moment';
import { networkBeingForked } from '@test-utils/evm';
import { UniswapV3Oracle__factory } from '../typechained';
import { deployThroughDeterministicFactory } from '@mean-finance/deterministic-factory/utils/deployment';

const deployFunction: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer, governor } = await hre.getNamedAccounts();

  const UNISWAP_V3_FACTORY_ADDRESS = '0x1F98431c8aD98523631AE4a59f267346ea31F984';

  let cardinalityPerMinute: number;
  let period: number;
  let minimumPeriod: number;
  let maximumPeriod: number;

  const network = hre.network.name !== 'hardhat' ? hre.network.name : networkBeingForked ?? hre.network.name;
  switch (network) {
    case 'mainnet':
    case 'hardhat':
      cardinalityPerMinute = 4;
      period = moment.duration('5', 'minutes').as('seconds');
      minimumPeriod = moment.duration('5', 'minutes').as('seconds');
      maximumPeriod = moment.duration('20', 'minutes').as('seconds');
      break;
    case 'kovan':
      cardinalityPerMinute = 6;
      period = moment.duration('5', 'minutes').as('seconds');
      minimumPeriod = moment.duration('5', 'minutes').as('seconds');
      maximumPeriod = moment.duration('20', 'minutes').as('seconds');
      break;
    case 'arbitrum':
      cardinalityPerMinute = 30;
      period = moment.duration('10', 'minutes').as('seconds');
      minimumPeriod = moment.duration('5', 'minutes').as('seconds');
      maximumPeriod = moment.duration('45', 'minutes').as('seconds');
      break;
    case 'optimism':
      cardinalityPerMinute = 30;
      period = moment.duration('10', 'minutes').as('seconds');
      minimumPeriod = moment.duration('5', 'minutes').as('seconds');
      maximumPeriod = moment.duration('45', 'minutes').as('seconds');
      break;
    case 'optimism-kovan':
      cardinalityPerMinute = 60;
      period = moment.duration('10', 'minutes').as('seconds');
      minimumPeriod = moment.duration('5', 'minutes').as('seconds');
      maximumPeriod = moment.duration('45', 'minutes').as('seconds');
      break;
    case 'mumbai':
      cardinalityPerMinute = 30; // blocks every 2 seconds
      period = moment.duration('5', 'minutes').as('seconds');
      minimumPeriod = moment.duration('5', 'minutes').as('seconds');
      maximumPeriod = moment.duration('45', 'minutes').as('seconds');
      break;
    case 'polygon':
      cardinalityPerMinute = 30; // blocks every 2 seconds
      period = moment.duration('5', 'minutes').as('seconds');
      minimumPeriod = moment.duration('5', 'minutes').as('seconds');
      maximumPeriod = moment.duration('45', 'minutes').as('seconds');
      break;
    case 'candle':
      cardinalityPerMinute = 30; // blocks every 2 seconds
      period = moment.duration('5', 'minutes').as('seconds');
      minimumPeriod = moment.duration('5', 'minutes').as('seconds');
      maximumPeriod = moment.duration('45', 'minutes').as('seconds');
      break;
    default:
      throw new Error(`Unsupported chain '${hre.network.name}`);
  }

  await deployThroughDeterministicFactory({
    deployer,
    name: 'UniswapOracle',
    salt: 'MF-DCAV2-UniswapOracle',
    contract: 'contracts/oracles/UniswapV3Oracle.sol:UniswapV3Oracle',
    bytecode: UniswapV3Oracle__factory.bytecode,
    constructorArgs: {
      types: ['address', 'address', 'uint8', 'uint16', 'uint16', 'uint16'],
      values: [governor, UNISWAP_V3_FACTORY_ADDRESS, cardinalityPerMinute, period, minimumPeriod, maximumPeriod],
    },
    log: !process.env.TEST,
    overrides: {
      gasLimit: 3_000_000,
    },
  });
};

deployFunction.tags = ['UniswapOracle'];
deployFunction.dependencies = ['ChainlinkOracle'];
export default deployFunction;
