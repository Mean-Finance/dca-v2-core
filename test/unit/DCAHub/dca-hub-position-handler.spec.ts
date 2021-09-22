import { BigNumber, Contract, Wallet } from 'ethers';
import { ethers } from 'hardhat';
import { DCAHubPositionHandlerMock__factory, DCAHubPositionHandlerMock, DCAPermissionsManager } from '@typechained';
import { erc20, behaviours, constants, wallet } from '@test-utils';
import chai, { expect } from 'chai';
import { TransactionResponse } from '@ethersproject/abstract-provider';
import { readArgFromEventOrFail } from '@test-utils/event-utils';
import { when, then, given, contract } from '@test-utils/bdd';
import { TokenContract } from '@test-utils/erc20';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import moment from 'moment';
import { snapshot } from '@test-utils/evm';
import { FakeContract, smock } from '@defi-wonderland/smock';
import { Permission } from 'js-lib/types';

chai.use(smock.matchers);

contract('DCAPositionHandler', () => {
  const PERFORMED_SWAPS_10 = 10;
  const POSITION_RATE_5 = 5;
  const POSITION_SWAPS_TO_PERFORM_10 = 10;
  const RATE_PER_UNIT_5 = 5;
  const SWAP_INTERVAL = moment.duration(1, 'days').as('seconds');
  const SWAP_INTERVAL_2 = moment.duration(5, 'minutes').as('seconds');

  const INITIAL_TOKEN_A_BALANCE_CONTRACT = 100;
  const INITIAL_TOKEN_A_BALANCE_USER = 100;
  const INITIAL_TOKEN_B_BALANCE_CONTRACT = 100;
  const INITIAL_TOKEN_B_BALANCE_USER = 100;

  let owner: SignerWithAddress;
  let tokenA: TokenContract, tokenB: TokenContract;
  let DCAPositionHandlerContract: DCAHubPositionHandlerMock__factory;
  let DCAPositionHandler: DCAHubPositionHandlerMock;
  let DCAPermissionManager: FakeContract<DCAPermissionsManager>;
  let snapshotId: string;

  before('Setup accounts and contracts', async () => {
    [owner] = await ethers.getSigners();
    DCAPositionHandlerContract = await ethers.getContractFactory('contracts/mocks/DCAHub/DCAHubPositionHandler.sol:DCAHubPositionHandlerMock');

    const deploy = (decimals: number) => erc20.deploy({ name: 'A name', symbol: 'SYMB', decimals });

    const tokens = await Promise.all([deploy(12), deploy(16)]);
    [tokenA, tokenB] = tokens.sort((a, b) => a.address.localeCompare(b.address));
    await tokenA.mint(owner.address, tokenA.asUnits(INITIAL_TOKEN_A_BALANCE_USER));
    await tokenB.mint(owner.address, tokenB.asUnits(INITIAL_TOKEN_B_BALANCE_USER));
    DCAPermissionManager = await smock.fake('DCAPermissionsManager');
    DCAPositionHandler = await DCAPositionHandlerContract.deploy(owner.address, DCAPermissionManager.address);
    await tokenA.approveInternal(owner.address, DCAPositionHandler.address, tokenA.asUnits(1000));
    await tokenB.approveInternal(owner.address, DCAPositionHandler.address, tokenB.asUnits(1000));
    await tokenA.mint(DCAPositionHandler.address, tokenA.asUnits(INITIAL_TOKEN_A_BALANCE_CONTRACT));
    await tokenB.mint(DCAPositionHandler.address, tokenB.asUnits(INITIAL_TOKEN_B_BALANCE_CONTRACT));
    await DCAPositionHandler.setInternalBalance(tokenA.address, tokenA.asUnits(INITIAL_TOKEN_A_BALANCE_CONTRACT));
    await DCAPositionHandler.setInternalBalance(tokenB.address, tokenB.asUnits(INITIAL_TOKEN_B_BALANCE_CONTRACT));
    await DCAPositionHandler.setPerformedSwaps(tokenA.address, tokenB.address, SWAP_INTERVAL, PERFORMED_SWAPS_10);
    await DCAPositionHandler.addSwapIntervalsToAllowedList([SWAP_INTERVAL, SWAP_INTERVAL_2]);
    snapshotId = await snapshot.take();
  });

  beforeEach('Deploy and configure', async () => {
    await snapshot.revert(snapshotId);
    DCAPermissionManager.hasPermission.returns(true);
  });

  describe('constructor', () => {
    when('permission manager is zero address', () => {
      then('deployment is reverted with reason', async () => {
        await behaviours.deployShouldRevertWithMessage({
          contract: DCAPositionHandlerContract,
          args: [constants.NOT_ZERO_ADDRESS, constants.ZERO_ADDRESS],
          message: 'ZeroAddress',
        });
      });
    });
    when('contract is initiated', () => {
      then('permission manager is set correctly', async () => {
        expect(await DCAPositionHandler.permissionManager()).to.equal(DCAPermissionManager.address);
      });
    });
  });

  describe('deposit', () => {
    const depositShouldRevert = ({
      owner,
      from,
      to,
      amount,
      interval,
      swaps,
      error,
    }: {
      owner: string;
      from: string;
      to: string;
      amount: number;
      swaps: number;
      interval: number;
      error: string;
    }) =>
      behaviours.txShouldRevertWithMessage({
        contract: DCAPositionHandler,
        func: 'deposit',
        args: [from, to, amount, swaps, interval, owner, []],
        message: error,
      });

    when('making a deposit to a zero address from', () => {
      then('tx is reverted with message', async () => {
        await depositShouldRevert({
          from: constants.ZERO_ADDRESS,
          to: tokenB.address,
          owner: constants.NOT_ZERO_ADDRESS,
          amount: 10,
          swaps: POSITION_SWAPS_TO_PERFORM_10,
          interval: SWAP_INTERVAL,
          error: 'ZeroAddress',
        });
      });
    });

    when('making a deposit to a zero address to', () => {
      then('tx is reverted with message', async () => {
        await depositShouldRevert({
          from: tokenA.address,
          to: constants.ZERO_ADDRESS,
          owner: constants.NOT_ZERO_ADDRESS,
          amount: 10,
          swaps: POSITION_SWAPS_TO_PERFORM_10,
          interval: SWAP_INTERVAL,
          error: 'ZeroAddress',
        });
      });
    });

    when('making a deposit to a zero address owner', () => {
      then('tx is reverted with message', async () => {
        await depositShouldRevert({
          from: tokenA.address,
          to: tokenB.address,
          owner: constants.ZERO_ADDRESS,
          amount: 10,
          swaps: POSITION_SWAPS_TO_PERFORM_10,
          interval: SWAP_INTERVAL,
          error: 'ZeroAddress',
        });
      });
    });

    when('making a deposit with non-allowed interval', async () => {
      then('tx is reverted with messasge', async () => {
        await depositShouldRevert({
          from: tokenA.address,
          to: tokenB.address,
          owner: constants.NOT_ZERO_ADDRESS,
          amount: 10,
          swaps: 10,
          interval: 0,
          error: 'InvalidInterval',
        });
      });
    });

    when('making a deposit with 0 amount', () => {
      then('tx is reverted with message', async () => {
        await depositShouldRevert({
          from: tokenA.address,
          to: tokenB.address,
          owner: constants.NOT_ZERO_ADDRESS,
          amount: 0,
          swaps: POSITION_SWAPS_TO_PERFORM_10,
          interval: SWAP_INTERVAL,
          error: 'ZeroAmount',
        });
      });
    });

    when('making a deposit with 0 swaps', () => {
      then('tx is reverted with message', async () => {
        await depositShouldRevert({
          from: tokenA.address,
          to: tokenB.address,
          owner: constants.NOT_ZERO_ADDRESS,
          amount: 10,
          swaps: 0,
          interval: SWAP_INTERVAL,
          error: 'ZeroSwaps',
        });
      });
    });

    when('making a deposit with 0 swaps', () => {
      then('tx is reverted with message', async () => {
        await depositShouldRevert({
          from: tokenA.address,
          to: tokenA.address,
          owner: constants.NOT_ZERO_ADDRESS,
          amount: 10,
          swaps: 20,
          interval: SWAP_INTERVAL,
          error: 'InvalidToken',
        });
      });
    });

    when('making a valid deposit', async () => {
      let dcaId: BigNumber;
      let tx: TransactionResponse;

      const nftOwner = wallet.generateRandomAddress();

      given(async () => {
        const depositTx = await deposit({ owner: nftOwner, token: tokenA, rate: POSITION_RATE_5, swaps: POSITION_SWAPS_TO_PERFORM_10 });
        tx = depositTx.response;
        dcaId = depositTx.dcaId;
      });

      then('event is emitted correctly', async () => {
        await expect(tx)
          .to.emit(DCAPositionHandler, 'Deposited')
          .withArgs(
            owner.address,
            nftOwner,
            1,
            tokenA.address,
            tokenB.address,
            tokenA.asUnits(POSITION_RATE_5),
            PERFORMED_SWAPS_10 + 1,
            SWAP_INTERVAL,
            PERFORMED_SWAPS_10 + POSITION_SWAPS_TO_PERFORM_10
          );
      });

      then('correct amount is transferred from sender', async () => {
        await expectBalanceToBe(tokenA, owner.address, INITIAL_TOKEN_A_BALANCE_USER - POSITION_RATE_5 * POSITION_SWAPS_TO_PERFORM_10);
        await expectBalanceToBe(
          tokenA,
          DCAPositionHandler.address,
          INITIAL_TOKEN_A_BALANCE_CONTRACT + POSITION_RATE_5 * POSITION_SWAPS_TO_PERFORM_10
        );
      });

      then('position is created', async () => {
        await expectPositionToBe(dcaId, {
          from: tokenA,
          rate: POSITION_RATE_5,
          swapsExecuted: 0,
          swapsLeft: POSITION_SWAPS_TO_PERFORM_10,
          swapped: 0,
          remaining: POSITION_RATE_5 * POSITION_SWAPS_TO_PERFORM_10,
        });
      });

      then('trade is recorded', async () => {
        const { swapDeltaAToB: deltaPerformedSwaps } = await DCAPositionHandler.swapAmountDelta(
          tokenA.address,
          tokenB.address,
          SWAP_INTERVAL,
          PERFORMED_SWAPS_10
        );
        const { nextAmountToSwapAToB } = await DCAPositionHandler.swapData(tokenA.address, tokenB.address, SWAP_INTERVAL);
        const { swapDeltaAToB: deltaLastDay } = await DCAPositionHandler.swapAmountDelta(
          tokenA.address,
          tokenB.address,
          SWAP_INTERVAL,
          PERFORMED_SWAPS_10 + POSITION_SWAPS_TO_PERFORM_10 + 1
        );

        expect(deltaPerformedSwaps).to.equal(0);
        expect(nextAmountToSwapAToB).to.equal(tokenA.asUnits(POSITION_RATE_5));
        expect(deltaLastDay).to.equal(tokenA.asUnits(POSITION_RATE_5).mul(-1));
      });

      then('other swap intervals remain unaffected', async () => {
        const { swapDeltaAToB: deltaPerformedSwaps } = await DCAPositionHandler.swapAmountDelta(
          tokenA.address,
          tokenB.address,
          SWAP_INTERVAL_2,
          PERFORMED_SWAPS_10
        );
        const { swapDeltaAToB: deltaFirstDay } = await DCAPositionHandler.swapAmountDelta(
          tokenA.address,
          tokenB.address,
          SWAP_INTERVAL_2,
          PERFORMED_SWAPS_10 + 1
        );
        const { swapDeltaAToB: deltaLastDay } = await DCAPositionHandler.swapAmountDelta(
          tokenA.address,
          tokenB.address,
          SWAP_INTERVAL_2,
          PERFORMED_SWAPS_10 + POSITION_SWAPS_TO_PERFORM_10
        );

        expect(deltaPerformedSwaps).to.equal(0);
        expect(deltaFirstDay).to.equal(0);
        expect(deltaLastDay).to.equal(0);
      });

      then('permission manager is called correctly', async () => {
        expect(DCAPermissionManager.mint).to.have.been.calledWith(dcaId, nftOwner, []);
      });

      then('interval is now active', async () => {
        expect(await DCAPositionHandler.isSwapIntervalActive(tokenA.address, tokenB.address, SWAP_INTERVAL)).to.be.true;
      });

      thenInternalBalancesAreTheSameAsTokenBalances();
    });
  });

  describe('withdrawSwapped', () => {
    const recipient: string = wallet.generateRandomAddress();

    when('withdrawing with zero address recipient', () => {
      then('tx is reverted with message', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: DCAPositionHandler,
          func: 'withdrawSwapped(uint256,address)',
          args: [0, constants.ZERO_ADDRESS],
          message: 'ZeroAddress',
        });
      });
    });

    when('withdrawing swapped with invalid id', () => {
      then('tx is reverted with message', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: DCAPositionHandler,
          func: 'withdrawSwapped(uint256,address)',
          args: [100, recipient],
          message: 'InvalidPosition',
        });
      });
    });

    permissionTest(Permission.WITHDRAW, ({ contract, dcaId }) => contract.withdrawSwapped(dcaId, recipient));

    when(`withdrawing swapped with position that didn't have swaps executed`, () => {
      let response: TransactionResponse;
      let dcaId: BigNumber;

      given(async () => {
        ({ dcaId } = await deposit({ owner: owner.address, token: tokenA, rate: POSITION_RATE_5, swaps: POSITION_SWAPS_TO_PERFORM_10 }));
        response = await withdrawSwapped(dcaId, owner.address);
      });

      then('event is emitted', async () => {
        await expect(response).to.emit(DCAPositionHandler, 'Withdrew').withArgs(owner.address, owner.address, dcaId, tokenB.address, 0);
      });

      then('no token transfer was made', async () => {
        await expectBalanceToBe(tokenA, owner.address, INITIAL_TOKEN_A_BALANCE_USER - POSITION_RATE_5 * POSITION_SWAPS_TO_PERFORM_10);
        await expectBalanceToBe(
          tokenA,
          DCAPositionHandler.address,
          INITIAL_TOKEN_A_BALANCE_CONTRACT + POSITION_RATE_5 * POSITION_SWAPS_TO_PERFORM_10
        );
      });

      then(`position wasn't modified`, async () => {
        await expectPositionToBe(dcaId, {
          from: tokenA,
          rate: POSITION_RATE_5,
          swapsExecuted: 0,
          swapsLeft: POSITION_SWAPS_TO_PERFORM_10,
          swapped: 0,
          remaining: POSITION_RATE_5 * POSITION_SWAPS_TO_PERFORM_10,
        });
      });

      thenInternalBalancesAreTheSameAsTokenBalances();
    });

    when(`withdrawing swapped with executed position`, () => {
      let response: TransactionResponse;
      let dcaId: BigNumber;

      given(async () => {
        ({ dcaId } = await deposit({ owner: owner.address, token: tokenA, rate: POSITION_RATE_5, swaps: POSITION_SWAPS_TO_PERFORM_10 }));
        await performTrade({
          swap: PERFORMED_SWAPS_10 + 1,
          ratioAToB: RATE_PER_UNIT_5,
          amountAToB: POSITION_RATE_5,
        });
      });

      when('withdrawing with recipient', () => {
        given(async () => {
          response = await withdrawSwapped(dcaId, recipient);
        });

        then('swapped tokens are sent to the user', async () => {
          const swapped = tokenB.asUnits(RATE_PER_UNIT_5 * POSITION_RATE_5);
          expect(await tokenB.balanceOf(recipient)).to.equal(swapped);
          await expectBalanceToBe(tokenB, DCAPositionHandler.address, INITIAL_TOKEN_B_BALANCE_CONTRACT);
        });

        then('position is updated', async () => {
          await expectPositionToBe(dcaId, {
            from: tokenA,
            rate: POSITION_RATE_5,
            swapsExecuted: 0,
            swapsLeft: POSITION_SWAPS_TO_PERFORM_10 - 1,
            swapped: 0,
            remaining: POSITION_RATE_5 * (POSITION_SWAPS_TO_PERFORM_10 - 1),
          });
        });

        then('event is emitted', async () => {
          const swapped = tokenB.asUnits(RATE_PER_UNIT_5 * POSITION_RATE_5);
          await expect(response).to.emit(DCAPositionHandler, 'Withdrew').withArgs(owner.address, recipient, dcaId, tokenB.address, swapped);
        });

        thenInternalBalancesAreTheSameAsTokenBalances();
      });
    });
  });

  describe('withdrawSwappedMany', () => {
    const recipient = wallet.generateRandomAddress();

    when('withdrawing with zero address recipient', () => {
      then('tx is reverted with message', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: DCAPositionHandler,
          func: 'withdrawSwappedMany',
          args: [[], constants.ZERO_ADDRESS],
          message: 'ZeroAddress',
        });
      });
    });

    when('withdrawing swapped with invalid id', () => {
      then('tx is reverted with message', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: DCAPositionHandler,
          func: 'withdrawSwappedMany',
          args: [[{ token: constants.NOT_ZERO_ADDRESS, positionIds: [100] }], recipient],
          message: 'InvalidPosition',
        });
      });
    });

    when('position is grouped under the wrong token', () => {
      let dcaId: BigNumber;
      given(async () => {
        ({ dcaId } = await deposit({
          owner: owner.address,
          token: tokenA,
          rate: POSITION_RATE_5,
          swaps: POSITION_SWAPS_TO_PERFORM_10,
        }));
      });
      then('tx is reverted with message', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: DCAPositionHandler,
          func: 'withdrawSwappedMany',
          args: [[{ token: constants.NOT_ZERO_ADDRESS, positionIds: [dcaId] }], recipient],
          message: 'PositionDoesNotMatchToken',
        });
      });
    });

    permissionTest(Permission.WITHDRAW, ({ contract, dcaId }) =>
      contract.withdrawSwappedMany([{ token: tokenB.address, positionIds: [dcaId] }], recipient)
    );

    when(`withdrawing swapped with positions that didn't have swaps executed`, () => {
      let response: TransactionResponse;
      let dcaId1: BigNumber, dcaId2: BigNumber;
      let input: PositionSet[];

      given(async () => {
        ({ dcaId: dcaId1 } = await deposit({
          owner: owner.address,
          token: tokenA,
          rate: POSITION_RATE_5,
          swaps: POSITION_SWAPS_TO_PERFORM_10,
        }));
        ({ dcaId: dcaId2 } = await deposit({
          owner: owner.address,
          token: tokenB,
          rate: POSITION_RATE_5,
          swaps: POSITION_SWAPS_TO_PERFORM_10,
        }));
        input = [
          { token: tokenA.address, positionIds: [dcaId2] },
          { token: tokenB.address, positionIds: [dcaId1] },
        ];
        response = await DCAPositionHandler.withdrawSwappedMany(input, recipient);
      });

      then('event is emitted', async () => {
        const withdrawer = await readArgFromEventOrFail(response, 'WithdrewMany', 'withdrawer');
        const withdrawRecipient = await readArgFromEventOrFail(response, 'WithdrewMany', 'recipient');
        const positions = await readArgFromEventOrFail<any>(response, 'WithdrewMany', 'positions');
        const withdrew = await readArgFromEventOrFail(response, 'WithdrewMany', 'withdrew');
        expect(withdrawer).to.equal(owner.address);
        expect(withdrawRecipient).to.equal(recipient);
        expect(withdrew).to.eql([constants.ZERO, constants.ZERO]);
        expect(positions.length).to.equal(2);
        expect(positions[0].token).to.equal(input[0].token);
        expect(positions[0].positionIds).to.eql(input[0].positionIds);
        expect(positions[1].token).to.equal(input[1].token);
        expect(positions[1].positionIds).to.eql(input[1].positionIds);
      });

      then('no token transfer was made', async () => {
        await expectBalanceToBe(tokenA, owner.address, INITIAL_TOKEN_A_BALANCE_USER - POSITION_RATE_5 * POSITION_SWAPS_TO_PERFORM_10);
        await expectBalanceToBe(
          tokenA,
          DCAPositionHandler.address,
          INITIAL_TOKEN_A_BALANCE_CONTRACT + POSITION_RATE_5 * POSITION_SWAPS_TO_PERFORM_10
        );
        await expectBalanceToBe(tokenB, owner.address, INITIAL_TOKEN_B_BALANCE_USER - POSITION_RATE_5 * POSITION_SWAPS_TO_PERFORM_10);
        await expectBalanceToBe(
          tokenB,
          DCAPositionHandler.address,
          INITIAL_TOKEN_B_BALANCE_CONTRACT + POSITION_RATE_5 * POSITION_SWAPS_TO_PERFORM_10
        );
      });

      then(`position wasn't modified`, async () => {
        await expectPositionToBe(dcaId1, {
          from: tokenA,
          rate: POSITION_RATE_5,
          swapsExecuted: 0,
          swapsLeft: POSITION_SWAPS_TO_PERFORM_10,
          swapped: 0,
          remaining: POSITION_RATE_5 * POSITION_SWAPS_TO_PERFORM_10,
        });
        await expectPositionToBe(dcaId2, {
          from: tokenB,
          rate: POSITION_RATE_5,
          swapsExecuted: 0,
          swapsLeft: POSITION_SWAPS_TO_PERFORM_10,
          swapped: 0,
          remaining: POSITION_RATE_5 * POSITION_SWAPS_TO_PERFORM_10,
        });
      });

      thenInternalBalancesAreTheSameAsTokenBalances();
    });

    when(`withdrawing swapped with executed positions`, () => {
      const POSITION_RATE_3 = 3;
      let response: TransactionResponse;
      let dcaId1: BigNumber, dcaId2: BigNumber;
      let input: PositionSet[];

      given(async () => {
        ({ dcaId: dcaId1 } = await deposit({
          owner: owner.address,
          token: tokenA,
          rate: POSITION_RATE_5,
          swaps: POSITION_SWAPS_TO_PERFORM_10,
        }));
        ({ dcaId: dcaId2 } = await deposit({
          owner: owner.address,
          token: tokenB,
          rate: POSITION_RATE_3,
          swaps: POSITION_SWAPS_TO_PERFORM_10,
        }));
        await performTrade({
          swap: PERFORMED_SWAPS_10 + 1,
          ratioAToB: RATE_PER_UNIT_5,
          amountAToB: POSITION_RATE_5,
          ratioBToA: RATE_PER_UNIT_5,
          amountBToA: POSITION_RATE_3,
        });

        input = [
          { token: tokenA.address, positionIds: [dcaId2] },
          { token: tokenB.address, positionIds: [dcaId1] },
        ];
        response = await DCAPositionHandler.withdrawSwappedMany(input, recipient);
      });

      then('swapped tokens are sent to the user', async () => {
        const tradedFromBToA = tokenA.asUnits(RATE_PER_UNIT_5 * POSITION_RATE_3);
        expect(await tokenA.balanceOf(recipient)).to.equal(tradedFromBToA);
        const tradedFromAToB = tokenB.asUnits(RATE_PER_UNIT_5 * POSITION_RATE_5);
        expect(await tokenB.balanceOf(recipient)).to.equal(tradedFromAToB);
      });

      then('position is updated', async () => {
        await expectPositionToBe(dcaId1, {
          from: tokenA,
          rate: POSITION_RATE_5,
          swapsExecuted: 0,
          swapsLeft: POSITION_SWAPS_TO_PERFORM_10 - 1,
          swapped: 0,
          remaining: POSITION_RATE_5 * (POSITION_SWAPS_TO_PERFORM_10 - 1),
        });
        await expectPositionToBe(dcaId2, {
          from: tokenB,
          rate: POSITION_RATE_3,
          swapsExecuted: 0,
          swapsLeft: POSITION_SWAPS_TO_PERFORM_10 - 1,
          swapped: 0,
          remaining: POSITION_RATE_3 * (POSITION_SWAPS_TO_PERFORM_10 - 1),
        });
      });

      then('event is emitted', async () => {
        const swappedA = tokenA.asUnits(RATE_PER_UNIT_5 * POSITION_RATE_3);
        const swappedB = tokenB.asUnits(RATE_PER_UNIT_5 * POSITION_RATE_5);
        const withdrawer = await readArgFromEventOrFail(response, 'WithdrewMany', 'withdrawer');
        const withdrawRecipient = await readArgFromEventOrFail(response, 'WithdrewMany', 'recipient');
        const positions = await readArgFromEventOrFail<any>(response, 'WithdrewMany', 'positions');
        const withdrew = await readArgFromEventOrFail(response, 'WithdrewMany', 'withdrew');
        expect(withdrawer).to.equal(owner.address);
        expect(withdrawRecipient).to.equal(recipient);
        expect(withdrew).to.eql([swappedA, swappedB]);
        expect(positions.length).to.equal(2);
        expect(positions[0].token).to.equal(input[0].token);
        expect(positions[0].positionIds).to.eql(input[0].positionIds);
        expect(positions[1].token).to.equal(input[1].token);
        expect(positions[1].positionIds).to.eql(input[1].positionIds);
      });

      thenInternalBalancesAreTheSameAsTokenBalances();
    });
    type PositionSet = { token: string; positionIds: BigNumber[] };
  });

  describe('terminate', () => {
    const recipientUnswapped = wallet.generateRandomAddress();
    const recipientSwapped = wallet.generateRandomAddress();

    when('withdrawing with zero address recipientUnswapped', () => {
      then('tx is reverted with message', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: DCAPositionHandler,
          func: 'terminate',
          args: [0, constants.ZERO_ADDRESS, recipientSwapped],
          message: 'ZeroAddress',
        });
      });
    });

    when('withdrawing with zero address recipientSwapped', () => {
      then('tx is reverted with message', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: DCAPositionHandler,
          func: 'terminate',
          args: [0, recipientUnswapped, constants.ZERO_ADDRESS],
          message: 'ZeroAddress',
        });
      });
    });

    when('terminating a position with invalid id', () => {
      then('tx is reverted with message', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: DCAPositionHandler,
          func: 'terminate',
          args: [100, recipientUnswapped, recipientSwapped],
          message: 'InvalidPosition',
        });
      });
    });

    permissionTest(Permission.TERMINATE, ({ contract, dcaId }) => contract.terminate(dcaId, recipientUnswapped, recipientSwapped));

    when(`terminating a valid position`, () => {
      const swappedWhenTerminated = RATE_PER_UNIT_5 * POSITION_RATE_5;
      const unswappedWhenTerminated = (POSITION_SWAPS_TO_PERFORM_10 - 1) * POSITION_RATE_5;

      let response: TransactionResponse;
      let dcaId: BigNumber;

      given(async () => {
        ({ dcaId } = await deposit({ owner: owner.address, token: tokenA, rate: POSITION_RATE_5, swaps: POSITION_SWAPS_TO_PERFORM_10 }));

        await performTrade({
          swap: PERFORMED_SWAPS_10 + 1,
          ratioAToB: RATE_PER_UNIT_5,
          amountAToB: POSITION_RATE_5,
        });

        response = await terminate(dcaId, recipientUnswapped, recipientSwapped);
      });

      then('event is emitted', async () => {
        await expect(response)
          .to.emit(DCAPositionHandler, 'Terminated')
          .withArgs(
            owner.address,
            recipientUnswapped,
            recipientSwapped,
            dcaId,
            tokenA.asUnits(unswappedWhenTerminated),
            tokenB.asUnits(swappedWhenTerminated)
          );
      });

      then('un-swapped balance is returned', async () => {
        await expectBalanceToBe(tokenA, recipientUnswapped, unswappedWhenTerminated);
      });

      then('swapped balance is returned', async () => {
        await expectBalanceToBe(tokenB, recipientSwapped, swappedWhenTerminated);
      });

      then(`position is removed`, async () => {
        await expectPositionToBe(dcaId, {
          from: constants.ZERO_ADDRESS,
          rate: 0,
          swapsExecuted: 0,
          swapsLeft: 0,
          swapped: 0,
          remaining: 0,
          swapInterval: 0,
        });
      });

      then('permission manager is called correctly', async () => {
        expect(DCAPermissionManager.burn).to.have.been.calledWith(dcaId);
      });

      thenInternalBalancesAreTheSameAsTokenBalances();
    });
  });

  describe('increasePosition', () => {
    const NEW_SWAPS_TO_PERFORM_5 = 5;
    const EXTRA_AMOUNT_TO_ADD_1 = 1;

    when('adding funds to a position with invalid id', () => {
      then('tx is reverted with message', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: DCAPositionHandler,
          func: 'increasePosition',
          args: [100, tokenA.asUnits(EXTRA_AMOUNT_TO_ADD_1), POSITION_SWAPS_TO_PERFORM_10],
          message: 'InvalidPosition',
        });
      });
    });

    when('adding funds but with 0 swaps', () => {
      then('tx is reverted with message', async () => {
        const { dcaId } = await deposit({ owner: owner.address, token: tokenA, rate: POSITION_RATE_5, swaps: POSITION_SWAPS_TO_PERFORM_10 });

        await behaviours.txShouldRevertWithMessage({
          contract: DCAPositionHandler,
          func: 'increasePosition',
          args: [dcaId, tokenA.asUnits(EXTRA_AMOUNT_TO_ADD_1), 0],
          message: 'ZeroSwaps',
        });
      });
    });

    permissionTest(Permission.INCREASE, ({ token, contract, dcaId }) => contract.increasePosition(dcaId, token.asUnits(1), 2));

    modifyPositionTest({
      title: `adding more funds to the position`,
      initialRate: POSITION_RATE_5,
      initialSwaps: POSITION_SWAPS_TO_PERFORM_10,
      newRate: ((POSITION_SWAPS_TO_PERFORM_10 - 1) * POSITION_RATE_5 + EXTRA_AMOUNT_TO_ADD_1) / NEW_SWAPS_TO_PERFORM_5, // We are subtracting one to the positions to perform, because there was one trade already
      newSwaps: NEW_SWAPS_TO_PERFORM_5,
      exec: ({ token, dcaId, newSwaps }) => increasePosition(token, dcaId, EXTRA_AMOUNT_TO_ADD_1, newSwaps),
    });

    modifyPositionTest({
      title: `using add funds to re-organize the unswapped balance`,
      initialRate: POSITION_RATE_5,
      initialSwaps: POSITION_SWAPS_TO_PERFORM_10,
      newRate: 9,
      newSwaps: 5,
      exec: ({ token, dcaId, newSwaps }) => increasePosition(token, dcaId, 0, newSwaps),
    });
  });

  describe('reducePosition', () => {
    const NEW_SWAPS_TO_PERFORM_5 = 5;
    const AMOUNT_TO_REMOVE_1 = 1;

    when('removing funds from a position with invalid id', () => {
      then('tx is reverted with message', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: DCAPositionHandler,
          func: 'reducePosition',
          args: [100, tokenA.asUnits(AMOUNT_TO_REMOVE_1), POSITION_SWAPS_TO_PERFORM_10],
          message: 'InvalidPosition',
        });
      });
    });

    when('trying to remove more funds than available from a position', () => {
      then('tx is reverted with message', async () => {
        const { dcaId } = await deposit({ owner: owner.address, token: tokenA, rate: POSITION_RATE_5, swaps: POSITION_SWAPS_TO_PERFORM_10 });

        await behaviours.txShouldRevertWithMessage({
          contract: DCAPositionHandler,
          func: 'reducePosition',
          args: [dcaId, tokenA.asUnits(POSITION_RATE_5 * POSITION_SWAPS_TO_PERFORM_10).add(1), 0],
          message:
            'VM Exception while processing transaction: reverted with panic code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)',
        });
      });
    });

    when('removing funds but with 0 swaps and amount to remove is not enough', () => {
      then('tx is reverted with message', async () => {
        const { dcaId } = await deposit({ owner: owner.address, token: tokenA, rate: POSITION_RATE_5, swaps: POSITION_SWAPS_TO_PERFORM_10 });

        await behaviours.txShouldRevertWithMessage({
          contract: DCAPositionHandler,
          func: 'reducePosition',
          args: [dcaId, tokenA.asUnits(AMOUNT_TO_REMOVE_1), 0],
          message: 'ZeroSwaps',
        });
      });
    });

    permissionTest(Permission.REDUCE, ({ token, contract, dcaId }) => contract.reducePosition(dcaId, token.asUnits(1), 2));

    modifyPositionTest({
      title: `using remove funds to re-organize the unswapped balance`,
      initialRate: POSITION_RATE_5,
      initialSwaps: POSITION_SWAPS_TO_PERFORM_10,
      newRate: 9,
      newSwaps: 5,
      exec: ({ token, dcaId, newSwaps }) => reducePosition(token, dcaId, 0, newSwaps),
    });

    modifyPositionTest({
      title: `removing all funds from a position and setting 0 swaps`,
      initialRate: POSITION_RATE_5,
      initialSwaps: POSITION_SWAPS_TO_PERFORM_10,
      newRate: 0,
      newSwaps: 0,
      exec: ({ token, dcaId, newSwaps }) => reducePosition(token, dcaId, (POSITION_SWAPS_TO_PERFORM_10 - 1) * POSITION_RATE_5, newSwaps),
    });

    modifyPositionTest({
      title: `removing all funds from a position and setting a positive number of swaps`,
      initialRate: POSITION_RATE_5,
      initialSwaps: POSITION_SWAPS_TO_PERFORM_10,
      newRate: 0,
      newSwaps: 0,
      exec: ({ token, dcaId }) => reducePosition(token, dcaId, (POSITION_SWAPS_TO_PERFORM_10 - 1) * POSITION_RATE_5, 10),
    });

    modifyPositionTest({
      title: `removing some funds from a position`,
      initialRate: POSITION_RATE_5,
      initialSwaps: POSITION_SWAPS_TO_PERFORM_10,
      newRate: ((POSITION_SWAPS_TO_PERFORM_10 - 1) * POSITION_RATE_5 - AMOUNT_TO_REMOVE_1) / NEW_SWAPS_TO_PERFORM_5, // We are subtracting one to the positions to perform, because there was one trade already
      newSwaps: NEW_SWAPS_TO_PERFORM_5,
      exec: ({ token, dcaId, newSwaps }) => reducePosition(token, dcaId, AMOUNT_TO_REMOVE_1, newSwaps),
    });
  });

  describe('_calculateSwapped', () => {
    when('last swap ended before calculation', () => {
      then('swapped is calculated correctly', async () => {
        const { dcaId } = await deposit({ owner: owner.address, token: tokenA, rate: 1, swaps: 1 });

        // Set a value in PERFORMED_SWAPS_10 + 1
        await setRatio({
          accumRate: 1000000,
          onSwap: PERFORMED_SWAPS_10 + 1,
        });

        // Set another value in PERFORMED_SWAPS_10 + 2
        await setRatio({
          accumRate: 1000001,
          onSwap: PERFORMED_SWAPS_10 + 2,
        });

        await DCAPositionHandler.setPerformedSwaps(tokenA.address, tokenB.address, SWAP_INTERVAL, PERFORMED_SWAPS_10 + 3);

        // It shouldn't revert, since the position ended before the overflow
        const swapped = await calculateSwapped(dcaId);
        expect(swapped).to.equal(tokenB.asUnits(1000000));
      });
    });

    when(`last update happens after the position's last swap`, () => {
      then('0 is returned', async () => {
        const { dcaId } = await deposit({ owner: owner.address, token: tokenA, rate: 1, swaps: 1 });

        // Set a value in PERFORMED_SWAPS_10 + 1
        await setRatio({
          accumRate: 1000000,
          onSwap: PERFORMED_SWAPS_10 + 1,
        });

        // Set another value in PERFORMED_SWAPS_10 + 2
        await setRatio({
          accumRate: 1000001,
          onSwap: PERFORMED_SWAPS_10 + 2,
        });

        await DCAPositionHandler.setLastUpdated(dcaId, PERFORMED_SWAPS_10 + 2);
        await DCAPositionHandler.setPerformedSwaps(tokenA.address, tokenB.address, SWAP_INTERVAL, PERFORMED_SWAPS_10 + 2);

        const swapped = await calculateSwapped(dcaId);
        expect(swapped).to.equal(0);
      });
    });

    describe('verify overflow errors', () => {
      when('accum is MAX(uint256) and position rate is more than 1', () => {
        then('there is an overflow', async () => {
          await expectCalculationToFailWithOverflow({
            accumRate: constants.MAX_UINT_256,
            positionRate: 2,
          });
        });
      });
    });

    describe('verify overflow limits', () => {
      when('accum is MAX(uint256) and position rate is 1', () => {
        then('swapped should be max uint', async () => {
          const swapped = await calculateSwappedWith({
            accumRate: constants.MAX_UINT_256,
            positionRate: 1,
          });
          // We are losing precision when accumRate is MAX(uint256), but we accept that
          expect(swapped.gte('0xfffffffffffffffffffffffffffffffffffffffffffffffffff1c2d3019e0000')).to.true;
        });
      });
    });

    async function calculateSwappedWith({ accumRate, positionRate }: { accumRate: number | BigNumber; positionRate?: number }) {
      const { dcaId } = await deposit({ owner: owner.address, token: tokenA, rate: positionRate ?? 1, swaps: 1 });
      await DCAPositionHandler.setPerformedSwaps(tokenA.address, tokenB.address, SWAP_INTERVAL, PERFORMED_SWAPS_10 + 1);
      await setRatio({
        accumRate,
        onSwap: PERFORMED_SWAPS_10 + 1,
      });

      return calculateSwapped(dcaId);
    }

    async function expectCalculationToFailWithOverflow({ accumRate, positionRate }: { accumRate: number | BigNumber; positionRate: number }) {
      const { dcaId } = await deposit({ owner: owner.address, token: tokenA, rate: positionRate ?? 1, swaps: 1 });
      await DCAPositionHandler.setPerformedSwaps(tokenA.address, tokenB.address, SWAP_INTERVAL, PERFORMED_SWAPS_10 + 1);
      await setRatio({
        accumRate,
        onSwap: PERFORMED_SWAPS_10 + 1,
      });
      const tx = DCAPositionHandler.userPosition(dcaId) as any as Promise<TransactionResponse>;

      return behaviours.checkTxRevertedWithMessage({
        tx,
        message: 'reverted with panic code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)',
      });
    }
  });

  async function setRatio({ accumRate, onSwap }: { accumRate: number | BigNumber; onSwap: number }) {
    await DCAPositionHandler.setAcummRatio(
      tokenA.address,
      tokenB.address,
      SWAP_INTERVAL,
      onSwap,
      BigNumber.isBigNumber(accumRate) ? accumRate : tokenB.asUnits(accumRate),
      0
    );
  }

  function permissionTest(
    permission: Permission,
    execute: (params: { token: TokenContract; contract: Contract; dcaId: BigNumber }) => Promise<TransactionResponse>
  ) {
    let operator: Wallet;

    given(async () => {
      operator = await wallet.generateRandom();
      await tokenA.mint(operator.address, tokenA.asUnits(1000));
      await tokenA.connect(operator).approve(DCAPositionHandler.address, tokenA.asUnits(1000));
    });

    when(`executing address has permission`, () => {
      let dcaId: BigNumber;

      given(async () => {
        ({ dcaId } = await deposit({ owner: owner.address, token: tokenA, rate: POSITION_RATE_5, swaps: POSITION_SWAPS_TO_PERFORM_10 }));
        DCAPermissionManager.hasPermission.returns(({ _permission }: { _permission: Permission }) => permission === _permission);
      });

      then('they can execute the operation', async () => {
        const result: Promise<TransactionResponse> = execute({ token: tokenA, contract: DCAPositionHandler.connect(operator), dcaId });
        await expect(result).to.not.be.reverted;
      });
    });

    when(`executing address doesn't have permission`, () => {
      let dcaId: BigNumber;

      given(async () => {
        ({ dcaId } = await deposit({ owner: owner.address, token: tokenA, rate: POSITION_RATE_5, swaps: POSITION_SWAPS_TO_PERFORM_10 }));
        DCAPermissionManager.hasPermission.returns(false);
      });

      then('operation is reverted', async () => {
        const result: Promise<TransactionResponse> = execute({ token: tokenA, contract: DCAPositionHandler.connect(operator), dcaId });
        await expect(result).to.be.revertedWith('UnauthorizedCaller');
      });
    });
  }

  function modifyPositionTest({
    title,
    initialRate,
    initialSwaps,
    newRate,
    newSwaps,
    exec,
  }: {
    title: string;
    initialRate: number;
    initialSwaps: number;
    newRate?: number;
    newSwaps?: number;
    exec: (params: { token: TokenContract; dcaId: BigNumber; newRate: number; newSwaps: number }) => Promise<TransactionResponse>;
  }) {
    newRate = newRate ?? initialRate;
    newSwaps = newSwaps ?? initialSwaps;

    const PERFORMED_SWAPS_11 = 11;

    when(title, () => {
      let response: TransactionResponse;
      let dcaId: BigNumber;

      given(async () => {
        ({ dcaId } = await deposit({ owner: owner.address, token: tokenA, rate: initialRate, swaps: initialSwaps }));

        await performTrade({
          swap: PERFORMED_SWAPS_10 + 1,
          ratioAToB: RATE_PER_UNIT_5,
          amountAToB: initialRate,
        });

        response = await exec({
          token: tokenA,
          dcaId,
          newRate: newRate!,
          newSwaps: newSwaps!,
        });
      });

      then('event is emitted', async () => {
        await expect(response)
          .to.emit(DCAPositionHandler, 'Modified')
          .withArgs(owner.address, dcaId, tokenA.asUnits(newRate!), PERFORMED_SWAPS_11 + 1, PERFORMED_SWAPS_10 + newSwaps! + 1);
      });

      then('final balances are as expected', async () => {
        await expectBalanceToBe(
          tokenA,
          owner.address,
          INITIAL_TOKEN_A_BALANCE_USER -
            initialRate * 1 - // Already executed trade
            newRate! * newSwaps! // New position
        );
        await expectBalanceToBe(tokenA, DCAPositionHandler.address, INITIAL_TOKEN_A_BALANCE_USER + newRate! * newSwaps!);
        await expectBalanceToBe(tokenB, owner.address, INITIAL_TOKEN_B_BALANCE_USER);
        const expectedRate = tokenB.asUnits(RATE_PER_UNIT_5 * initialRate);
        await expectBalanceToBe(tokenB, DCAPositionHandler.address, expectedRate.add(tokenB.asUnits(INITIAL_TOKEN_B_BALANCE_CONTRACT)));
      });

      then(`position is modified`, async () => {
        await expectPositionToBe(dcaId, {
          from: tokenA,
          rate: newRate!,
          swapsExecuted: 0,
          swapsLeft: newSwaps!,
          swapped: initialRate * RATE_PER_UNIT_5,
          remaining: newRate! * newSwaps!,
        });
      });

      then('previous trade is rolled back', async () => {
        // If it happens that this condition is true, then the new last swap will match the previous last swap, making the delta not 0
        if (PERFORMED_SWAPS_10 + initialSwaps + 1 !== PERFORMED_SWAPS_11 + newSwaps! + 1) {
          const { swapDeltaAToB: deltaLastSwap } = await DCAPositionHandler.swapAmountDelta(
            tokenA.address,
            tokenB.address,
            SWAP_INTERVAL,
            PERFORMED_SWAPS_10 + initialSwaps + 1
          );

          expect(deltaLastSwap).to.equal(0);
        }
      });

      then('new trade is recorded', async () => {
        const { nextAmountToSwapAToB } = await DCAPositionHandler.swapData(tokenA.address, tokenB.address, SWAP_INTERVAL);
        const { swapDeltaAToB: deltaLastSwap } = await DCAPositionHandler.swapAmountDelta(
          tokenA.address,
          tokenB.address,
          SWAP_INTERVAL,
          PERFORMED_SWAPS_11 + newSwaps! + 1
        );

        expect(nextAmountToSwapAToB).to.equal(tokenA.asUnits(newRate!));
        expect(deltaLastSwap).to.equal(tokenA.asUnits(newRate!).mul(-1));
      });

      thenInternalBalancesAreTheSameAsTokenBalances();
    });
  }

  async function performTrade({
    swap,
    ratioAToB,
    amountAToB,
    ratioBToA,
    amountBToA,
  }: {
    swap: number;
    ratioAToB?: number;
    amountAToB?: number;
    ratioBToA?: number;
    amountBToA?: number;
  }) {
    await DCAPositionHandler.setPerformedSwaps(tokenA.address, tokenB.address, SWAP_INTERVAL, swap);
    await DCAPositionHandler.setAcummRatio(
      tokenA.address,
      tokenB.address,
      SWAP_INTERVAL,
      swap,
      tokenB.asUnits(ratioAToB ?? 0),
      tokenA.asUnits(ratioBToA ?? 0)
    );
    if (amountAToB) {
      await tokenA.burn(DCAPositionHandler.address, tokenA.asUnits(amountAToB));
      await tokenB.mint(DCAPositionHandler.address, tokenB.asUnits(amountAToB * ratioAToB!));
    }
    if (amountBToA) {
      await tokenB.burn(DCAPositionHandler.address, tokenB.asUnits(amountBToA));
      await tokenA.mint(DCAPositionHandler.address, tokenA.asUnits(amountBToA * ratioBToA!));
    }
    await DCAPositionHandler.setInternalBalance(tokenA.address, await tokenA.balanceOf(DCAPositionHandler.address));
    await DCAPositionHandler.setInternalBalance(tokenB.address, await tokenB.balanceOf(DCAPositionHandler.address));
  }

  function increasePosition(token: TokenContract, dcaId: BigNumber, amount: number, swaps: number): Promise<TransactionResponse> {
    return DCAPositionHandler.increasePosition(dcaId, token.asUnits(amount), swaps);
  }

  function reducePosition(token: TokenContract, dcaId: BigNumber, amount: number, swaps: number): Promise<TransactionResponse> {
    return DCAPositionHandler.reducePosition(dcaId, token.asUnits(amount), swaps);
  }

  function withdrawSwapped(dcaId: BigNumber, recipient: string): Promise<TransactionResponse> {
    return DCAPositionHandler.withdrawSwapped(dcaId, recipient);
  }

  function terminate(dcaId: BigNumber, recipientUnswapped: string, recipientSwapped: string): Promise<TransactionResponse> {
    return DCAPositionHandler.terminate(dcaId, recipientUnswapped, recipientSwapped);
  }

  async function calculateSwapped(dcaId: BigNumber): Promise<BigNumber> {
    const { swapped } = await DCAPositionHandler.userPosition(dcaId);
    return swapped;
  }

  async function deposit({ owner, token, rate, swaps }: { owner: string; token: TokenContract; rate: number; swaps: number }) {
    const to = tokenA == token ? tokenB : tokenA;
    const response: TransactionResponse = await DCAPositionHandler.deposit(
      token.address,
      to.address,
      token.asUnits(rate).mul(swaps),
      swaps,
      SWAP_INTERVAL,
      owner,
      []
    );
    const dcaId = await readArgFromEventOrFail<BigNumber>(response, 'Deposited', 'dcaId');
    return { response, dcaId };
  }

  async function expectBalanceToBe(token: TokenContract, address: string, amount: BigNumber | number) {
    const balance = await token.balanceOf(address);
    expect(balance).to.be.equal(BigNumber.isBigNumber(amount) ? amount : token.asUnits(amount));
  }

  function thenInternalBalancesAreTheSameAsTokenBalances() {
    then('internal balance for token A is as expected', async () => {
      const balance = await tokenA.balanceOf(DCAPositionHandler.address);
      const internalBalance = await DCAPositionHandler.internalBalanceOf(tokenA.address);
      expect(internalBalance).to.equal(balance);
    });

    then('internal balance for token B is as expected', async () => {
      const balance = await tokenB.balanceOf(DCAPositionHandler.address);
      const internalBalance = await DCAPositionHandler.internalBalanceOf(tokenB.address);
      expect(internalBalance).to.equal(balance);
    });
  }

  async function expectPositionToBe(
    dcaId: BigNumber,
    {
      from,
      rate,
      swapped,
      swapsLeft,
      remaining,
      swapsExecuted,
      swapInterval,
    }: {
      from: Contract | string;
      rate: number;
      swapsLeft: number;
      swapped: number;
      swapsExecuted: number;
      remaining: number;
      swapInterval?: number;
    }
  ) {
    const {
      from: positionFrom,
      to: positionTo,
      swapInterval: positionSwapInterval,
      swapsExecuted: positionSwapsExecuted,
      swapped: positionSwapped,
      swapsLeft: positionSwapsLeft,
      remaining: positionRemaining,
      rate: positionRate,
    }: [string, string, number, number, BigNumber, number, BigNumber, BigNumber] & {
      from: string;
      to: string;
      swapInterval: number;
      swapsExecuted: number;
      swapped: BigNumber;
      swapsLeft: number;
      remaining: BigNumber;
      rate: BigNumber;
    } = await DCAPositionHandler.userPosition(dcaId);
    const fromAddress = typeof from === 'string' ? from : from.address;
    const fromToken = fromAddress === tokenA.address ? tokenA : tokenB;
    const toToken = fromAddress === tokenA.address ? tokenB : tokenA;

    expect(positionFrom, 'Wrong from address in position').to.equal(fromAddress);
    expect(positionTo, 'Wrong to address in position').to.equal(
      fromAddress === constants.ZERO_ADDRESS ? constants.ZERO_ADDRESS : toToken.address
    );
    expect(positionSwapInterval, 'Wrong swap interval in position').to.equal(swapInterval ?? SWAP_INTERVAL);
    expect(positionSwapsExecuted, 'Wrong swaps executed in position').to.equal(swapsExecuted);
    expect(positionSwapped, 'Wrong swapped amount in position').to.equal(toToken.asUnits(swapped));
    expect(positionSwapsLeft, 'Wrong swaps left in position').to.equal(swapsLeft);
    expect(positionRemaining, 'Wrong remaining amount in position').to.equal(fromToken.asUnits(remaining));
    expect(positionRate, 'Wrong rate in position').to.equal(fromAddress === tokenA.address ? tokenA.asUnits(rate) : tokenB.asUnits(rate));
  }
});
