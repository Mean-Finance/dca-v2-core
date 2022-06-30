import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from '@0xged/hardhat-deploy/types';
import { TokenPriceOracleAdapter__factory } from '../typechained';
import { deployThroughDeterministicFactory } from '@mean-finance/deterministic-factory/utils/deployment';

// Ref.: https://github.com/Mean-Finance/mean-oracles
const MEAN_ORACLE_AGGREGATOR = '0xFD8aD08F7e35FA949c6dEB9B58623345Faa5D3EF';

const deployFunction: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  await deployThroughDeterministicFactory({
    deployer,
    name: 'TokenPriceOracleAdapter',
    salt: 'MF-DCAV2-TPOA-V1', // Token Price Oracle Adapter (TPOA)
    contract: 'contracts/oracles/TokenPriceOracleAdapter.sol:TokenPriceOracleAdapter',
    bytecode: TokenPriceOracleAdapter__factory.bytecode,
    constructorArgs: {
      types: ['address'],
      values: [MEAN_ORACLE_AGGREGATOR],
    },
    log: !process.env.TEST,
    overrides: {
      gasLimit: 8_000_000,
    },
  });
};
deployFunction.tags = ['TokenPriceOracleAdapter'];
export default deployFunction;
