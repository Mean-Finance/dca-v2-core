import chai, { expect } from 'chai';
import { ethers } from 'hardhat';
import { contract, given, then, when } from '@test-utils/bdd';
import { TokenPriceOracleAdapter__factory, TokenPriceOracleAdapter } from '@typechained';
import { ITokenPriceOracle } from '@mean-finance/mean-oracles/typechained';
import evm, { snapshot } from '@test-utils/evm';
import { FakeContract, smock } from '@defi-wonderland/smock';
import { BigNumber } from '@ethersproject/bignumber';
import { utils } from 'ethers';

chai.use(smock.matchers);

contract('TokenPriceOracleAdapter', () => {
  const TOKEN_A = '0x0000000000000000000000000000000000000001';
  const TOKEN_B = '0x0000000000000000000000000000000000000002';
  const AMOUNT_IN = utils.parseEther('69.6969');

  let snapshotId: string;
  let tokenPriceOracleAdapterFactory: TokenPriceOracleAdapter__factory;
  let tokenPriceOracleAdapter: TokenPriceOracleAdapter;
  let tokenPriceOracle: FakeContract<ITokenPriceOracle>;

  before('Setup accounts and contracts', async () => {
    // await evm.reset();
    tokenPriceOracle = await smock.fake('ITokenPriceOracle');
    tokenPriceOracleAdapterFactory = await ethers.getContractFactory('contracts/oracles/TokenPriceOracleAdapter.sol:TokenPriceOracleAdapter');
    tokenPriceOracleAdapter = await tokenPriceOracleAdapterFactory.deploy(tokenPriceOracle.address);
    snapshotId = await snapshot.take();
  });

  beforeEach(async () => {
    await snapshot.revert(snapshotId);
    tokenPriceOracle['quote(address,uint256,address)'].reset();
  });

  describe('constructor', () => {
    when('all arguments are valid', () => {
      then('token price oracle is set correctly', async () => {
        const tokenPriceOracleAddress = await tokenPriceOracleAdapter.tokenPriceOracle();
        expect(tokenPriceOracleAddress).to.equal(tokenPriceOracle.address);
      });
    });
  });

  describe('canSupportPair', () => {
    const SUPPORTS_PAIR = false;
    when('function is called', () => {
      let canSupport: boolean;
      given(async () => {
        tokenPriceOracle.canSupportPair.returns(SUPPORTS_PAIR);
        canSupport = await tokenPriceOracleAdapter.canSupportPair(TOKEN_A, TOKEN_B);
      });
      then('token price oracle canSupportPair function is called', () => {
        expect(tokenPriceOracle.canSupportPair).to.have.be.calledOnceWith(TOKEN_A, TOKEN_B);
      });
      then('returns token price oracle canSupportPair return value', () => {
        expect(canSupport).to.be.equal(SUPPORTS_PAIR);
      });
    });
  });

  describe('quote', () => {
    const QUOTE = utils.parseEther('420.69');
    when('function is called', () => {
      let quote: BigNumber;
      given(async () => {
        tokenPriceOracle['quote(address,uint256,address)'].returns(QUOTE);
        quote = await tokenPriceOracleAdapter.quote(TOKEN_A, AMOUNT_IN, TOKEN_B);
      });
      then('token price oracle quote function is called', async () => {
        expect(tokenPriceOracle['quote(address,uint256,address)']).to.have.been.calledOnceWith(TOKEN_A, AMOUNT_IN, TOKEN_B);
      });
      then('returns token price oracle quote return value', () => {
        expect(quote).to.be.equal(QUOTE);
      });
    });
  });

  describe('reconfigureSupportForPair', () => {
    when('function is called', () => {
      given(async () => {
        await tokenPriceOracleAdapter.reconfigureSupportForPair(TOKEN_A, TOKEN_B);
      });
      then('token price oracle addOrModifySupportForPair function is called', () => {
        expect(tokenPriceOracle['addOrModifySupportForPair(address,address)']).to.have.been.calledOnceWith(TOKEN_A, TOKEN_B);
      });
    });
  });

  describe('addSupportForPairIfNeeded', () => {
    when('function is called', () => {
      given(async () => {
        await tokenPriceOracleAdapter.addSupportForPairIfNeeded(TOKEN_A, TOKEN_B);
      });
      then('token price oracle addSupportForPairIfNeeded function is called', () => {
        expect(tokenPriceOracle['addSupportForPairIfNeeded(address,address)']).to.have.been.calledOnceWith(TOKEN_A, TOKEN_B);
      });
    });
  });
});
