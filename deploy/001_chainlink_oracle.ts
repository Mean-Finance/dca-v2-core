import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from '@0xged/hardhat-deploy/types';
import moment from 'moment';
import { BigNumber, BigNumberish } from 'ethers';
import { networkBeingForked } from '@test-utils/evm';
import { ChainlinkOracle__factory } from '../typechained';
import { deployThroughDeterministicFactory } from '@mean-finance/deterministic-factory/utils/deployment';

const deployFunction: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer, governor } = await hre.getNamedAccounts();

  let registry: string;
  let weth: string;
  let maxDelay: BigNumberish;

  const network = hre.network.name !== 'hardhat' ? hre.network.name : networkBeingForked ?? hre.network.name;
  switch (network) {
    case 'mainnet':
    case 'hardhat':
      registry = '0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf';
      weth = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
      maxDelay = moment.duration('1', 'day').asSeconds();
      break;
    case 'kovan':
      registry = '0xAa7F6f7f507457a1EE157fE97F6c7DB2BEec5cD0';
      weth = '0xd0a1e359811322d97991e03f863a0c30c2cf029c';
      maxDelay = BigNumber.from(2).pow(32).sub(1); // Max possible
      break;
    case 'optimism-kovan':
      registry = '0x2dfb2c5c013826a0728440d8036305b254ad9cce';
      weth = '0x4200000000000000000000000000000000000006';
      maxDelay = BigNumber.from(2).pow(32).sub(1); // Max possible
      break;
    case 'optimism':
      registry = '0x2dfb2c5c013826a0728440d8036305b254ad9cce';
      weth = '0x4200000000000000000000000000000000000006';
      maxDelay = moment.duration('1', 'day').asSeconds();
      break;
    case 'arbitrum':
      registry = '0x2dfb2c5c013826a0728440d8036305b254ad9cce';
      weth = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1';
      maxDelay = moment.duration('1', 'day').asSeconds();
      break;
    case 'mumbai':
      registry = '0x2dfb2c5c013826a0728440d8036305b254ad9cce';
      weth = '0xA6FA4fB5f76172d178d61B04b0ecd319C5d1C0aa';
      maxDelay = BigNumber.from(2).pow(32).sub(1); // Max possible
      break;
    case 'candle':
      registry = '0x2dfb2c5c013826a0728440d8036305b254ad9cce'; //need to change
      weth = '0xb750990F953B36F806d0327678eCFB4eEFd16979';
      maxDelay = BigNumber.from(2).pow(32).sub(1); // Max possible
      break;
    case 'polygon':
      registry = '0x2dfb2c5c013826a0728440d8036305b254ad9cce';
      weth = '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619';
      maxDelay = moment.duration('1', 'day').asSeconds();
      break;
    default:
      throw new Error(`Unsupported chain '${hre.network.name}`);
  }

  await deployThroughDeterministicFactory({
    deployer,
    name: 'ChainlinkOracle',
    salt: 'MF-DCAV2-ChainlinkOracle',
    contract: 'contracts/oracles/ChainlinkOracle.sol:ChainlinkOracle',
    bytecode: ChainlinkOracle__factory.bytecode,
    constructorArgs: {
      types: ['address', 'address', 'uint32', 'address'],
      values: [weth, registry, maxDelay, governor],
    },
    log: !process.env.TEST,
    overrides: {
      gasLimit: 3_000_000,
    },
  });
};

deployFunction.tags = ['ChainlinkOracle'];
export default deployFunction;
