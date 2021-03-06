import { expect } from 'chai';
import { TransactionResponse } from '@ethersproject/abstract-provider';
import { ethers } from 'hardhat';
import { behaviours, constants } from '@test-utils';
import { given, then, when } from '@test-utils/bdd';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { UniswapV3OracleMock, UniswapV3OracleMock__factory, IUniswapV3Pool, IUniswapV3Factory } from '@typechained';
import { snapshot } from '@test-utils/evm';
import { FakeContract, smock } from '@defi-wonderland/smock';
import moment from 'moment';

describe('UniswapV3Oracle', () => {
  const TOKEN_A = '0x0000000000000000000000000000000000000001';
  const TOKEN_B = '0x0000000000000000000000000000000000000002';
  const INITIAL_FEE_TIERS = [500, 3000, 10000];
  const FEE = INITIAL_FEE_TIERS[0];
  const FEE_2 = INITIAL_FEE_TIERS[1];
  const CARDINALITY_PER_MINUTE = 60;
  const PERIOD = moment.duration('5', 'minute').as('seconds');
  const MINIMUM_PERIOD = moment.duration('1', 'minute').as('seconds');
  const MAXIMUM_PERIOD = moment.duration('20', 'minutes').as('seconds');
  let owner: SignerWithAddress;
  let UniswapV3OracleContract: UniswapV3OracleMock__factory;
  let UniswapV3Oracle: UniswapV3OracleMock;
  let snapshotId: string;
  let uniswapV3Pool: FakeContract<IUniswapV3Pool>, uniswapV3Pool2: FakeContract<IUniswapV3Pool>;
  let uniswapV3Factory: FakeContract<IUniswapV3Factory>;
  let supportedPools: Map<string, string>;
  let supportedFeeTiers: Set<number>;

  before('Setup accounts and contracts', async () => {
    [owner] = await ethers.getSigners();
    UniswapV3OracleContract = await ethers.getContractFactory('contracts/mocks/oracles/UniswapV3Oracle.sol:UniswapV3OracleMock');
    uniswapV3Factory = await smock.fake('IUniswapV3Factory');
    UniswapV3Oracle = await UniswapV3OracleContract.deploy(
      owner.address,
      uniswapV3Factory.address,
      CARDINALITY_PER_MINUTE,
      PERIOD,
      MINIMUM_PERIOD,
      MAXIMUM_PERIOD
    );
    uniswapV3Pool = await smock.fake('IUniswapV3Pool');
    uniswapV3Pool2 = await smock.fake('IUniswapV3Pool');
    snapshotId = await snapshot.take();
    uniswapV3Factory.getPool.returns(({ tokenA, tokenB, fee }: { tokenA: string; tokenB: string; fee: number }) => {
      const key = `${tokenA}-${tokenB}-${fee}`;
      return supportedPools.get(key) ?? constants.ZERO_ADDRESS;
    });
    uniswapV3Factory.feeAmountTickSpacing.returns(({ fee }: { fee: number }) =>
      INITIAL_FEE_TIERS.includes(fee) || supportedFeeTiers.has(fee) ? 1 : 0
    );
  });

  beforeEach('Deploy and configure', async () => {
    await snapshot.revert(snapshotId);
    uniswapV3Pool.liquidity.returns(0);
    uniswapV3Pool2.liquidity.returns(0);
    supportedPools = new Map();
    supportedFeeTiers = new Set();
  });

  describe('constructor', () => {
    when('factory is zero address', () => {
      then('tx is reverted with reason error', async () => {
        await behaviours.deployShouldRevertWithMessage({
          contract: UniswapV3OracleContract,
          args: [owner.address, constants.ZERO_ADDRESS, CARDINALITY_PER_MINUTE, PERIOD, MINIMUM_PERIOD, MAXIMUM_PERIOD],
          message: 'ZeroAddress',
        });
      });
    });
    when('cardinality per minute is zero', () => {
      then('tx is reverted with reason', async () => {
        await behaviours.deployShouldRevertWithMessage({
          contract: UniswapV3OracleContract,
          args: [owner.address, uniswapV3Factory.address, constants.ZERO, PERIOD, MINIMUM_PERIOD, MAXIMUM_PERIOD],
          message: 'ZeroCPM',
        });
      });
    });
    when('period is zero, lower than minimum or higher than maximum period', () => {
      then('tx is reverted with reason', async () => {
        await behaviours.deployShouldRevertWithMessage({
          contract: UniswapV3OracleContract,
          args: [owner.address, uniswapV3Factory.address, CARDINALITY_PER_MINUTE, constants.ZERO, MINIMUM_PERIOD, MAXIMUM_PERIOD],
          message: 'PeriodOutOfRange',
        });
        await behaviours.deployShouldRevertWithMessage({
          contract: UniswapV3OracleContract,
          args: [owner.address, uniswapV3Factory.address, CARDINALITY_PER_MINUTE, MINIMUM_PERIOD - 1, MINIMUM_PERIOD, MAXIMUM_PERIOD],
          message: 'PeriodOutOfRange',
        });
        await behaviours.deployShouldRevertWithMessage({
          contract: UniswapV3OracleContract,
          args: [owner.address, uniswapV3Factory.address, CARDINALITY_PER_MINUTE, MAXIMUM_PERIOD + 1, MINIMUM_PERIOD, MAXIMUM_PERIOD],
          message: 'PeriodOutOfRange',
        });
      });
    });
    when('minimum period is zero, or higher than the maximum period', () => {
      then('tx is reverted with reason', async () => {
        await behaviours.deployShouldRevertWithMessage({
          contract: UniswapV3OracleContract,
          args: [owner.address, uniswapV3Factory.address, CARDINALITY_PER_MINUTE, PERIOD, constants.ZERO, MAXIMUM_PERIOD],
          message: 'InvalidPeriodThreshold',
        });
        await behaviours.deployShouldRevertWithMessage({
          contract: UniswapV3OracleContract,
          args: [owner.address, uniswapV3Factory.address, CARDINALITY_PER_MINUTE, PERIOD, MAXIMUM_PERIOD + 1, MAXIMUM_PERIOD],
          message: 'InvalidPeriodThreshold',
        });
      });
    });
    when('maximum period is zero, or less than minimum period', () => {
      then('tx is reverted with reason', async () => {
        await behaviours.deployShouldRevertWithMessage({
          contract: UniswapV3OracleContract,
          args: [owner.address, uniswapV3Factory.address, CARDINALITY_PER_MINUTE, PERIOD, MINIMUM_PERIOD, constants.ZERO],
          message: 'InvalidPeriodThreshold',
        });
        await behaviours.deployShouldRevertWithMessage({
          contract: UniswapV3OracleContract,
          args: [owner.address, uniswapV3Factory.address, CARDINALITY_PER_MINUTE, PERIOD, MINIMUM_PERIOD, MINIMUM_PERIOD - 1],
          message: 'InvalidPeriodThreshold',
        });
      });
    });
    when('all arguments are valid', () => {
      then('factory is set correctly', async () => {
        const factory = await UniswapV3Oracle.factory();
        expect(factory).to.equal(uniswapV3Factory.address);
      });
      then('cardinality per minute is 60', async () => {
        const cardinalityPerMinute = await UniswapV3Oracle.cardinalityPerMinute();
        expect(cardinalityPerMinute).to.equal(60);
      });
      then('starting period is 5 minutes', async () => {
        const period = await UniswapV3Oracle.period();
        expect(period).to.equal(5 * 60);
      });
      then('min period is 1 minute', async () => {
        const minPeriod = await UniswapV3Oracle.minimumPeriod();
        expect(minPeriod).to.equal(60);
      });
      then('max period is 20 minutes', async () => {
        const maxPeriod = await UniswapV3Oracle.maximumPeriod();
        expect(maxPeriod).to.equal(20 * 60);
      });
      then('starting fee tiers are correct', async () => {
        const feeTiers = await UniswapV3Oracle.supportedFeeTiers();
        expect(feeTiers).to.eql(INITIAL_FEE_TIERS);
      });
    });
  });

  describe('addFeeTier', () => {
    when('fee tier is invalid', () => {
      then('tx is reverted with reason', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: UniswapV3Oracle,
          func: 'addFeeTier',
          args: [20],
          message: 'InvalidFeeTier',
        });
      });
    });
    when('addresses are valid pairs', () => {
      const NEW_FEE_TIER = 10;
      let tx: TransactionResponse;

      given(async () => {
        supportedFeeTiers.add(NEW_FEE_TIER);
        tx = await UniswapV3Oracle.addFeeTier(NEW_FEE_TIER);
      });

      then('fee tier is added', async () => {
        expect(await UniswapV3Oracle.supportedFeeTiers()).to.eql([...INITIAL_FEE_TIERS, NEW_FEE_TIER]);
      });

      then('event is emitted', async () => {
        await expect(tx).to.emit(UniswapV3Oracle, 'AddedFeeTier').withArgs(NEW_FEE_TIER);
      });
    });
    when('fee tier is already added', () => {
      then('tx is reverted with reason', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: UniswapV3Oracle,
          func: 'addFeeTier',
          args: [FEE],
          message: 'FeeTierAlreadyPresent',
        });
      });
    });
    behaviours.shouldBeExecutableOnlyByGovernor({
      contract: () => UniswapV3Oracle,
      funcAndSignature: 'addFeeTier(uint24)',
      params: [20],
      governor: () => owner,
    });
  });

  describe('canSupportPair', () => {
    when('no pool exists for pair', () => {
      then('pair is not supported', async () => {
        expect(await UniswapV3Oracle.canSupportPair(TOKEN_A, TOKEN_B)).to.be.false;
      });
    });

    when('pool exists for pair on unsupported fie tier', () => {
      given(() => {
        addPoolToFactory(TOKEN_A, TOKEN_B, FEE, uniswapV3Pool);
      });
      then('pair is not supported', async () => {
        expect(await UniswapV3Oracle.canSupportPair(TOKEN_A, TOKEN_B)).to.be.false;
      });
    });

    when('pool exists for pair on supported fie tier', () => {
      given(() => {
        makePoolValidForSupport(TOKEN_A, TOKEN_B, FEE, uniswapV3Pool);
      });
      then('pair is marked as supported', async () => {
        expect(await UniswapV3Oracle.canSupportPair(TOKEN_A, TOKEN_B)).to.be.true;
      });
    });
    when('pool exists for pair on supported fie tier, but liquidity is not enough', () => {
      given(() => {
        addPoolToFactory(TOKEN_A, TOKEN_B, FEE, uniswapV3Pool);
      });
      then('pair is not supported', async () => {
        expect(await UniswapV3Oracle.canSupportPair(TOKEN_A, TOKEN_B)).to.be.false;
      });
    });
    when(`pools exists for pair on supported fie tier, but one of them doesn't have enough liquidity`, () => {
      given(() => {
        addPoolToFactory(TOKEN_A, TOKEN_B, FEE, uniswapV3Pool);
        makePoolValidForSupport(TOKEN_A, TOKEN_B, FEE_2, uniswapV3Pool2);
      });
      then('pair is supported', async () => {
        expect(await UniswapV3Oracle.canSupportPair(TOKEN_A, TOKEN_B)).to.be.true;
      });
    });
  });

  describe('setPeriod', () => {
    when('period is higher than max period', () => {
      then('tx is reverted with reason', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: UniswapV3Oracle,
          func: 'setPeriod',
          args: [20 * 60 + 1],
          message: 'GreaterThanMaximumPeriod',
        });
      });
    });
    when('period is lower than min period', () => {
      then('tx is reverted with reason', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: UniswapV3Oracle,
          func: 'setPeriod',
          args: [60 - 1],
          message: 'LessThanMinimumPeriod',
        });
      });
    });
    when('new period is valid', () => {
      const PERIOD = 6 * 60;

      let tx: TransactionResponse;

      given(async () => {
        tx = await UniswapV3Oracle.setPeriod(PERIOD);
      });

      then('period is set', async () => {
        expect(await UniswapV3Oracle.period()).to.eql(PERIOD);
      });

      then('event is emitted', async () => {
        await expect(tx).to.emit(UniswapV3Oracle, 'PeriodChanged').withArgs(PERIOD);
      });
    });
    behaviours.shouldBeExecutableOnlyByGovernor({
      contract: () => UniswapV3Oracle,
      funcAndSignature: 'setPeriod(uint16)',
      params: [10 * 60],
      governor: () => owner,
    });
  });

  describe('setCardinalityPerMinute', () => {
    when('period is zero', () => {
      then('tx is reverted with reason', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: UniswapV3Oracle,
          func: 'setCardinalityPerMinute',
          args: [constants.ZERO],
          message: 'ZeroCPM',
        });
      });
    });
    when('new cardinality per minute is valid', () => {
      const NEW_CARDINALITY_PER_MINUTE = CARDINALITY_PER_MINUTE - 10;

      let tx: TransactionResponse;

      given(async () => {
        tx = await UniswapV3Oracle.setCardinalityPerMinute(NEW_CARDINALITY_PER_MINUTE);
      });

      then('cardinality per minute is set', async () => {
        expect(await UniswapV3Oracle.cardinalityPerMinute()).to.eql(NEW_CARDINALITY_PER_MINUTE);
      });

      then('event is emitted', async () => {
        await expect(tx).to.emit(UniswapV3Oracle, 'CardinalityPerMinuteChanged').withArgs(NEW_CARDINALITY_PER_MINUTE);
      });
    });
    behaviours.shouldBeExecutableOnlyByGovernor({
      contract: () => UniswapV3Oracle,
      funcAndSignature: 'setCardinalityPerMinute(uint8)',
      params: [CARDINALITY_PER_MINUTE],
      governor: () => owner,
    });
  });

  describe('reconfigureSupportForPair', () => {
    when(`pair's addreses are inverted`, () => {
      given(async () => {
        makePoolValidForSupport(TOKEN_A, TOKEN_B, FEE, uniswapV3Pool);
        await UniswapV3Oracle.reconfigureSupportForPair(TOKEN_B, TOKEN_A);
      });

      then(`correct order is sent to internal add support`, async () => {
        expect(await UniswapV3Oracle.addSupportForPairCalled(TOKEN_A, TOKEN_B)).to.be.true;
      });
    });

    when('a new pool is deployed for already supported pair', () => {
      let tx: TransactionResponse;
      given(async () => {
        // Support FEE
        makePoolValidForSupport(TOKEN_A, TOKEN_B, FEE, uniswapV3Pool);
        await UniswapV3Oracle.internalAddSupportForPair(TOKEN_A, TOKEN_B);

        // Support FEE_2
        makePoolValidForSupport(TOKEN_A, TOKEN_B, FEE_2, uniswapV3Pool2);
        tx = await UniswapV3Oracle.reconfigureSupportForPair(TOKEN_A, TOKEN_B);
      });

      then(`it is added to list of pair's list of pools`, async () => {
        expect(await UniswapV3Oracle.poolsUsedForPair(TOKEN_A, TOKEN_B)).to.eql([uniswapV3Pool.address, uniswapV3Pool2.address]);
      });

      then('event is emitted', async () => {
        await expect(tx).to.emit(UniswapV3Oracle, 'AddedSupportForPairInUniswapOracle').withArgs(TOKEN_A, TOKEN_B);
      });

      then(`pool's cardinality is increased correctly`, async () => {
        expect(uniswapV3Pool2.increaseObservationCardinalityNext).has.been.calledWith(5 * CARDINALITY_PER_MINUTE + 10);
      });
    });
  });

  describe('addSupportForPairIfNeeded', () => {
    when(`pair's addreses are inverted`, () => {
      given(async () => {
        makePoolValidForSupport(TOKEN_A, TOKEN_B, FEE, uniswapV3Pool);
        await UniswapV3Oracle.addSupportForPairIfNeeded(TOKEN_B, TOKEN_A);
      });

      then(`correct order is sent to internal add support`, async () => {
        expect(await UniswapV3Oracle.addSupportForPairCalled(TOKEN_A, TOKEN_B)).to.be.true;
      });
    });

    when('pair does not have supported pools yet', () => {
      given(async () => {
        makePoolValidForSupport(TOKEN_A, TOKEN_B, FEE, uniswapV3Pool);
        await UniswapV3Oracle.addSupportForPairIfNeeded(TOKEN_A, TOKEN_B);
      });
      then('internal add support is called', async () => {
        expect(await UniswapV3Oracle.addSupportForPairCalled(TOKEN_A, TOKEN_B)).to.be.true;
      });
    });

    when('pair already has supported pools', () => {
      given(async () => {
        makePoolValidForSupport(TOKEN_A, TOKEN_B, FEE, uniswapV3Pool);
        await UniswapV3Oracle.internalAddSupportForPair(TOKEN_A, TOKEN_B);
        await UniswapV3Oracle.reset(TOKEN_A, TOKEN_B);

        await UniswapV3Oracle.addSupportForPairIfNeeded(TOKEN_A, TOKEN_B);
      });

      then('internal add support is not called', async () => {
        expect(await UniswapV3Oracle.addSupportForPairCalled(TOKEN_A, TOKEN_B)).to.be.false;
      });
    });
  });

  describe('internalAddSupportForPair', () => {
    when('there are no fee tiers supported', () => {
      then('tx is reverted with reason', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: UniswapV3Oracle,
          func: 'internalAddSupportForPair',
          args: [TOKEN_A, TOKEN_B],
          message: 'PairNotSupported',
        });
      });
    });
    when('there are no pools for the pair', () => {
      then('tx is reverted with reason', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: UniswapV3Oracle,
          func: 'internalAddSupportForPair',
          args: [TOKEN_A, TOKEN_B],
          message: 'PairNotSupported',
        });
      });
    });
    when('only pool for the pair does not have liquidity', () => {
      given(async () => {
        addPoolToFactory(TOKEN_A, TOKEN_B, FEE, uniswapV3Pool);
      });
      then('tx is reverted with reason', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: UniswapV3Oracle,
          func: 'internalAddSupportForPair',
          args: [TOKEN_A, TOKEN_B],
          message: 'PairNotSupported',
        });
      });
    });
    when('there is a pool for the pair', () => {
      let tx: TransactionResponse;

      given(async () => {
        makePoolValidForSupport(TOKEN_A, TOKEN_B, FEE, uniswapV3Pool);
        tx = await UniswapV3Oracle.internalAddSupportForPair(TOKEN_A, TOKEN_B);
      });

      then(`it is added to list of pair's list of pools`, async () => {
        expect(await UniswapV3Oracle.poolsUsedForPair(TOKEN_A, TOKEN_B)).to.eql([uniswapV3Pool.address]);
      });

      then('event is emitted', async () => {
        await expect(tx).to.emit(UniswapV3Oracle, 'AddedSupportForPairInUniswapOracle').withArgs(TOKEN_A, TOKEN_B);
      });

      then(`pool's cardinality is increased correctly`, async () => {
        expect(uniswapV3Pool.increaseObservationCardinalityNext).has.been.calledWith(5 * CARDINALITY_PER_MINUTE + 10);
      });
    });
  });
  describe('poolsUsedForPair', () => {
    when('there are no pools registered', () => {
      then('an empty list is returned', async () => {
        expect(await UniswapV3Oracle.poolsUsedForPair(TOKEN_A, TOKEN_B)).to.be.empty;
      });
    });
    when('there is a pool for the pair', () => {
      given(async () => {
        makePoolValidForSupport(TOKEN_A, TOKEN_B, FEE, uniswapV3Pool);
        await UniswapV3Oracle.addSupportForPairIfNeeded(TOKEN_A, TOKEN_B);
      });
      then('it is marked as used', async () => {
        expect(await UniswapV3Oracle.poolsUsedForPair(TOKEN_A, TOKEN_B)).to.eql([uniswapV3Pool.address]);
      });
      then('it is marked as used even when token addresses are reverted', async () => {
        expect(await UniswapV3Oracle.poolsUsedForPair(TOKEN_B, TOKEN_A)).to.eql([uniswapV3Pool.address]);
      });
    });
  });

  function makePoolValidForSupport(tokenA: string, tokenB: string, fee: number, pool: FakeContract<IUniswapV3Pool>) {
    addPoolToFactory(tokenA, tokenB, fee, pool);
    addLiquidityToPool(pool);
  }

  function addPoolToFactory(tokenA: string, tokenB: string, fee: number, pool: FakeContract<IUniswapV3Pool>) {
    const key = `${tokenA}-${tokenB}-${fee}`;
    supportedPools.set(key, pool.address);
  }

  function addLiquidityToPool(pool: FakeContract<IUniswapV3Pool>) {
    pool.liquidity.returns(1);
  }
});
