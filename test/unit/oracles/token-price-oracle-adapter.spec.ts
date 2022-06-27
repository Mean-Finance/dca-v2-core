import { expect } from 'chai';
import { ethers } from 'hardhat';
import { behaviours, constants } from '@test-utils';
import { given, then, when } from '@test-utils/bdd';
import { TokenPriceOracleAdapter__factory, TokenPriceOracleAdapter } from '@typechained';
import { ITokenPriceOracle } from '@mean-finance/mean-oracles/typechained';
import { snapshot } from '@test-utils/evm';
import { FakeContract, smock } from '@defi-wonderland/smock';
import { BigNumber } from '@ethersproject/bignumber';
import { TransactionResponse } from '@ethersproject/abstract-provider';

describe.only('TokenPriceOracleAdapter', () => {
  const TOKEN_A = '0x0000000000000000000000000000000000000001';
  const TOKEN_B = '0x0000000000000000000000000000000000000002';

  let snapshotId: string;
  let tokenPriceOracleAdapterFactory: TokenPriceOracleAdapter__factory;
  let tokenPriceOracleAdapter: TokenPriceOracleAdapter;
  let tokenPriceOracle: FakeContract<ITokenPriceOracle>;

  before('Setup accounts and contracts', async () => {
    tokenPriceOracle = await smock.fake('ITokenPriceOracle');
    tokenPriceOracleAdapterFactory = await ethers.getContractFactory('contracts/oracles/TokenPriceOracleAdapter.sol:TokenPriceOracleAdapter');
    tokenPriceOracleAdapter = await tokenPriceOracleAdapterFactory.deploy(tokenPriceOracle.address);
    snapshotId = await snapshot.take();
  });

  beforeEach(async () => {
    await snapshot.revert(snapshotId);
  });

  describe('constructor', () => {
    when('all arguments are valid', () => {
      then('token price oracle is set correctly', async () => {
        const tokenPriceOracleAddress = await tokenPriceOracleAdapter.tokenPriceOracle();
        expect(tokenPriceOracleAddress).to.equal(tokenPriceOracle.address);
      });
    });
  });
});
