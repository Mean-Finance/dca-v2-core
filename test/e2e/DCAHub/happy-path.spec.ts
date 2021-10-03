import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { ethers } from 'hardhat';
import {
  DCAHub,
  DCAHub__factory,
  DCAHubSwapCalleeMock,
  DCAHubSwapCalleeMock__factory,
  DCAHubLoanCalleeMock,
  DCAHubLoanCalleeMock__factory,
  DCAPermissionsManager,
  DCAPermissionsManager__factory,
  ITimeWeightedOracle,
} from '@typechained';
import { TransactionResponse } from '@ethersproject/abstract-provider';
import { constants, erc20, evm } from '@test-utils';
import { contract } from '@test-utils/bdd';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import { TokenContract } from '@test-utils/erc20';
import { readArgFromEventOrFail } from '@test-utils/event-utils';
import { buildGetNextSwapInfoInput, buildSwapInput } from 'js-lib/swap-utils';
import { SwapInterval } from 'js-lib/interval-utils';
import { FakeContract, smock } from '@defi-wonderland/smock';

contract('DCAHub', () => {
  describe('Full e2e test', () => {
    let governor: SignerWithAddress, john: SignerWithAddress;
    let lucy: SignerWithAddress, sarah: SignerWithAddress;
    let tokenA: TokenContract, tokenB: TokenContract;
    let DCAHubFactory: DCAHub__factory, DCAHub: DCAHub;
    let timeWeightedOracle: FakeContract<ITimeWeightedOracle>;
    let DCAHubSwapCalleeFactory: DCAHubSwapCalleeMock__factory, DCAHubSwapCallee: DCAHubSwapCalleeMock;
    let DCAHubLoanCalleeFactory: DCAHubLoanCalleeMock__factory, DCAHubLoanCallee: DCAHubLoanCalleeMock;
    let DCAPermissionsManagerFactory: DCAPermissionsManager__factory, DCAPermissionsManager: DCAPermissionsManager;

    // Global variables
    const swapFee1: number = 0.3;
    const swapRatio1: SwapRatio = { tokenA: 2, tokenB: 1 };

    before('Setup accounts and contracts', async () => {
      [governor, john, lucy, sarah] = await ethers.getSigners();
      DCAHubFactory = await ethers.getContractFactory('contracts/DCAHub/DCAHub.sol:DCAHub');
      DCAHubSwapCalleeFactory = await ethers.getContractFactory('contracts/mocks/DCAHubSwapCallee.sol:DCAHubSwapCalleeMock');
      DCAHubLoanCalleeFactory = await ethers.getContractFactory('contracts/mocks/DCAHubLoanCallee.sol:DCAHubLoanCalleeMock');
      DCAPermissionsManagerFactory = await ethers.getContractFactory(
        'contracts/DCAPermissionsManager/DCAPermissionsManager.sol:DCAPermissionsManager'
      );
    });

    beforeEach('Deploy and configure', async () => {
      await evm.reset();
      tokenA = await erc20.deploy({
        name: 'tokenA',
        symbol: 'TKNA',
        decimals: 12,
      });
      tokenB = await erc20.deploy({
        name: 'tokenB',
        symbol: 'TKNB',
        decimals: 16,
      });

      timeWeightedOracle = await smock.fake('ITimeWeightedOracle');
      DCAPermissionsManager = await DCAPermissionsManagerFactory.deploy(constants.NOT_ZERO_ADDRESS, constants.NOT_ZERO_ADDRESS);
      setSwapRatio(swapRatio1);
      DCAHub = await DCAHubFactory.deploy(governor.address, governor.address, timeWeightedOracle.address, DCAPermissionsManager.address);
      await DCAPermissionsManager.setHub(DCAHub.address);
      await DCAHub.addSwapIntervalsToAllowedList([SwapInterval.FIFTEEN_MINUTES.seconds, SwapInterval.ONE_HOUR.seconds]);
      DCAHubSwapCallee = await DCAHubSwapCalleeFactory.deploy();
      await DCAHubSwapCallee.setInitialBalances([tokenA.address, tokenB.address], [tokenA.asUnits(2500), tokenB.asUnits(2500)]);

      DCAHubLoanCallee = await DCAHubLoanCalleeFactory.deploy();
      await DCAHubLoanCallee.setInitialBalances([tokenA.address, tokenB.address], [tokenA.asUnits(20), tokenB.asUnits(20)]);

      await setInitialBalance(DCAHubSwapCallee, { tokenA: 2500, tokenB: 2500 });
      await setInitialBalance(DCAHubLoanCallee, { tokenA: 20, tokenB: 20 });
      await setSwapFee(swapFee1);
    });

    it('Execute happy path', async () => {
      await assertNoSwapsCanBeExecutedNow();

      const johnsPosition = await deposit({
        depositor: john,
        token: tokenA,
        swapInterval: SwapInterval.FIFTEEN_MINUTES,
        rate: 100,
        swaps: 10,
      });

      await assertPositionIsConsistent(johnsPosition);
      await assertIntervalsToSwapNowAre(SwapInterval.FIFTEEN_MINUTES);
      await assertHubBalanceDifferencesAre({ tokenA: +1000 });
      await assertAmountsToSwapAre({ tokenA: 100, tokenB: 0 });

      await flashSwap({ callee: DCAHubSwapCallee });

      await assertPositionIsConsistent(johnsPosition, { expectedSwapped: swapped({ rate: 100, ratio: swapRatio1, fee: swapFee1 }) });
      await assertNoSwapsCanBeExecutedNow();
      await assertHubBalanceDifferencesAre({ tokenA: -100, tokenB: +49.85 });
      await assertBalanceDifferencesAre(DCAHubSwapCallee, { tokenA: +100, tokenB: -49.85 });
      await assertPlatformBalanceIncreasedBy({ tokenA: 0, tokenB: 0 });

      const lucysPosition = await deposit({
        depositor: lucy,
        token: tokenB,
        swapInterval: SwapInterval.ONE_HOUR,
        rate: 200,
        swaps: 2,
      });

      await assertPositionIsConsistent(lucysPosition);
      await assertNoSwapsCanBeExecutedNow(); // Even though the 1h interval could be swapped, it will wait for the 15m interval
      await assertHubBalanceDifferencesAre({ tokenB: +400 });

      await evm.advanceTimeAndBlock(SwapInterval.FIFTEEN_MINUTES.seconds);

      await assertIntervalsToSwapNowAre(SwapInterval.FIFTEEN_MINUTES, SwapInterval.ONE_HOUR);
      await assertAmountsToSwapAre({ tokenA: 100, tokenB: 200 });

      const swapRatio2: SwapRatio = { tokenA: 1, tokenB: 1 };
      setSwapRatio(swapRatio2);
      await flashSwap({ callee: DCAHubSwapCallee });

      await assertNoSwapsCanBeExecutedNow();
      await assertPositionIsConsistent(johnsPosition, {
        expectedSwapped: swapped({ rate: 100, ratio: swapRatio1, fee: swapFee1 }, { rate: 100, ratio: swapRatio2, fee: swapFee1 }),
      });
      await assertPositionIsConsistent(lucysPosition, { expectedSwapped: swapped({ rate: 200, ratio: swapRatio2, fee: swapFee1 }) });
      await assertHubBalanceDifferencesAre({ tokenA: +99.7, tokenB: -100 });
      await assertBalanceDifferencesAre(DCAHubSwapCallee, { tokenA: -99.7, tokenB: +100 });
      await assertPlatformBalanceIncreasedBy({ tokenA: +0.3, tokenB: +0.3 });

      const sarahsPosition1 = await deposit({
        depositor: sarah,
        token: tokenA,
        swapInterval: SwapInterval.FIFTEEN_MINUTES,
        rate: 500,
        swaps: 3,
      });
      const sarahsPosition2 = await deposit({
        depositor: sarah,
        token: tokenB,
        swapInterval: SwapInterval.FIFTEEN_MINUTES,
        rate: 100,
        swaps: 4,
      });

      await assertPositionIsConsistent(sarahsPosition1);
      await assertPositionIsConsistent(sarahsPosition2);
      await assertHubBalanceDifferencesAre({ tokenA: +1500, tokenB: +400 });

      await reducePosition(johnsPosition, { amount: 400, newSwaps: 8 });
      await assertPositionIsConsistent(johnsPosition, {
        expectedSwapped: swapped({ rate: 100, ratio: swapRatio1, fee: swapFee1 }, { rate: 100, ratio: swapRatio2, fee: swapFee1 }),
      });
      await assertHubBalanceDifferencesAre({ tokenA: -400 });
      await assertBalanceDifferencesAre(john, { tokenA: +400 });

      await evm.advanceTimeAndBlock(SwapInterval.ONE_HOUR.seconds);

      await assertIntervalsToSwapNowAre(SwapInterval.FIFTEEN_MINUTES, SwapInterval.ONE_HOUR);
      await assertAmountsToSwapAre({ tokenA: 550, tokenB: 300 });

      await flashSwap({ callee: DCAHubSwapCallee });

      await assertNoSwapsCanBeExecutedNow();
      await assertPositionIsConsistent(johnsPosition, {
        expectedSwapped: swapped(
          { rate: 100, ratio: swapRatio1, fee: swapFee1 },
          { rate: 100, ratio: swapRatio2, fee: swapFee1 },
          { rate: 50, ratio: swapRatio2, fee: swapFee1 }
        ),
      });
      await assertPositionIsConsistent(lucysPosition, {
        expectedSwapped: swapped({ rate: 200, ratio: swapRatio2, fee: swapFee1 }, { rate: 200, ratio: swapRatio2, fee: swapFee1 }),
      });
      await assertPositionIsConsistent(sarahsPosition1, { expectedSwapped: swapped({ rate: 500, ratio: swapRatio2, fee: swapFee1 }) });
      await assertPositionIsConsistent(sarahsPosition2, { expectedSwapped: swapped({ rate: 100, ratio: swapRatio2, fee: swapFee1 }) });
      await assertHubBalanceDifferencesAre({ tokenA: -250, tokenB: +249.25 });
      await assertBalanceDifferencesAre(DCAHubSwapCallee, { tokenA: +250, tokenB: -249.25 });
      await assertPlatformBalanceIncreasedBy({ tokenA: +0.9, tokenB: +0.9 });

      const availableForWithdraw = calculateSwapped(
        johnsPosition,
        { rate: 100, ratio: swapRatio1, fee: swapFee1 },
        { rate: 100, ratio: swapRatio2, fee: swapFee1 },
        { rate: 50, ratio: swapRatio2, fee: swapFee1 }
      );
      await withdraw(johnsPosition, john.address);

      await assertPositionIsConsistentWithNothingToWithdraw(johnsPosition);
      await assertHubBalanceDifferencesAre({ tokenB: availableForWithdraw.mul(-1) });
      await assertBalanceDifferencesAre(john, { tokenB: availableForWithdraw });

      await loan({ callee: DCAHubLoanCallee, tokenA: 1849.7, tokenB: 799.7 });

      await assertHubBalanceDifferencesAre({ tokenA: +1.8497, tokenB: +0.7997 });
      await assertPlatformBalanceIncreasedBy({ tokenA: +1.8497, tokenB: +0.7997 });
      await assertBalanceDifferencesAre(DCAHubLoanCallee, { tokenA: -1.8497, tokenB: -0.7997 });

      await increasePosition(johnsPosition, { newSwaps: 10, amount: 100 });

      await assertPositionIsConsistentWithNothingToWithdraw(johnsPosition);
      await assertHubBalanceDifferencesAre({ tokenA: +100 });
      await assertBalanceDifferencesAre(john, { tokenA: -100 });

      const swapFee2 = 0.2;
      const swapRatio3: SwapRatio = { tokenA: 1, tokenB: 2 };
      await setSwapFee(swapFee2);
      setSwapRatio(swapRatio3);
      await evm.advanceTimeAndBlock(SwapInterval.ONE_HOUR.seconds);

      await assertIntervalsToSwapNowAre(SwapInterval.FIFTEEN_MINUTES, SwapInterval.ONE_HOUR);
      await assertAmountsToSwapAre({ tokenA: 545, tokenB: 100 });

      await flashSwap({ callee: DCAHubSwapCallee });

      await assertNoSwapsCanBeExecutedNow();
      await assertPositionIsConsistent(johnsPosition, {
        expectedSwapped: swapped({ rate: 45, ratio: swapRatio3, fee: swapFee2 }),
      });
      await assertPositionIsConsistent(lucysPosition, {
        expectedSwapped: swapped({ rate: 200, ratio: swapRatio2, fee: swapFee1 }, { rate: 200, ratio: swapRatio2, fee: swapFee1 }),
      });
      await assertPositionIsConsistent(sarahsPosition1, {
        expectedSwapped: swapped({ rate: 500, ratio: swapRatio2, fee: swapFee1 }, { rate: 500, ratio: swapRatio3, fee: swapFee2 }),
      });
      await assertPositionIsConsistent(sarahsPosition2, {
        expectedSwapped: swapped({ rate: 100, ratio: swapRatio2, fee: swapFee1 }, { rate: 100, ratio: swapRatio3, fee: swapFee2 }),
      });
      await assertHubBalanceDifferencesAre({ tokenA: -495, tokenB: +988.02 });
      await assertBalanceDifferencesAre(DCAHubSwapCallee, { tokenA: +495, tokenB: -988.02 });
      await assertPlatformBalanceIncreasedBy({ tokenA: +0.1, tokenB: +0.2 });

      await evm.advanceTimeAndBlock(SwapInterval.ONE_HOUR.seconds);
      await assertIntervalsToSwapNowAre(SwapInterval.FIFTEEN_MINUTES); // Even after waiting an hour, the 1 hour interval is not available. This is because it was marked as inactive on the last swap, since there were no more swaps on it

      await assertAmountsToSwapAre({ tokenA: 545, tokenB: 100 });

      await terminate(johnsPosition);

      await assertHubBalanceDifferencesAre({ tokenA: -405, tokenB: -89.82 });
      await assertBalanceDifferencesAre(john, { tokenA: +405, tokenB: +89.82 });
      await assertAmountsToSwapAre({ tokenA: 500, tokenB: 100 });

      await withdrawMany(sarahsPosition1, sarahsPosition2);

      await assertHubBalanceDifferencesAre({ tokenA: -149.6, tokenB: -1496.5 });
      await assertBalanceDifferencesAre(sarah, { tokenA: +149.6, tokenB: +1496.5 });

      await flashSwap({ callee: DCAHubSwapCallee });

      await assertNoSwapsCanBeExecutedNow();
      await assertPositionIsConsistent(lucysPosition, {
        expectedSwapped: swapped({ rate: 200, ratio: swapRatio2, fee: swapFee1 }, { rate: 200, ratio: swapRatio2, fee: swapFee1 }),
      });
      await assertPositionIsConsistent(sarahsPosition1, {
        expectedSwapped: swapped({ rate: 500, ratio: swapRatio3, fee: swapFee2 }),
      });
      await assertPositionIsConsistent(sarahsPosition2, {
        expectedSwapped: swapped({ rate: 100, ratio: swapRatio3, fee: swapFee2 }),
      });
      await assertHubBalanceDifferencesAre({ tokenA: -450, tokenB: +898.2 });
      await assertBalanceDifferencesAre(DCAHubSwapCallee, { tokenA: +450, tokenB: -898.2 });
      await assertPlatformBalanceIncreasedBy({ tokenA: +0.1, tokenB: +0.2 });

      await evm.advanceTimeAndBlock(SwapInterval.FIFTEEN_MINUTES.seconds);
      await assertAmountsToSwapAre({ tokenA: 0, tokenB: 100 });
    });

    async function withdrawMany(position1: UserPositionDefinition, ...otherPositions: UserPositionDefinition[]) {
      const positionMap: Map<string, Set<BigNumber>> = new Map();
      for (const position of [position1, ...otherPositions]) {
        if (!positionMap.has(position.to.address)) positionMap.set(position.to.address, new Set([position.id]));
        else positionMap.get(position.to.address)!.add(position.id);
      }
      const input = Array.from(positionMap.entries()).map(([token, positionIds]) => ({ token, positionIds: Array.from(positionIds.values()) }));
      await DCAHub.connect(position1.owner).withdrawSwappedMany(input, position1.owner.address);

      // Since the position is "resetted" with a withdraw, we need to reduce the amount of swaps
      for (const position of [position1].concat(otherPositions)) {
        const { swapsLeft } = await getPosition(position);
        position.amountOfSwaps = BigNumber.from(swapsLeft);
      }
    }

    async function terminate(position: UserPositionDefinition) {
      await DCAHub.connect(position.owner).terminate(position.id, position.owner.address, position.owner.address);
    }

    async function setSwapFee(fee: number) {
      await DCAHub.setSwapFee(fee * 10000);
    }

    async function increasePosition(position: UserPositionDefinition, args: { newSwaps: number; amount: number }) {
      const token = position.from.address === tokenA.address ? tokenA : tokenB;
      await token.connect(position.owner).approve(DCAHub.address, token.asUnits(args.amount).mul(args.newSwaps));
      const response = await DCAHub.connect(position.owner).increasePosition(position.id, token.asUnits(args.amount), args.newSwaps);
      position.amountOfSwaps = BigNumber.from(args.newSwaps);
      position.rate = await readArgFromEventOrFail<BigNumber>(response, 'Modified', 'rate');
    }

    function setSwapRatio(ratio: SwapRatio) {
      timeWeightedOracle.quote.returns(({ _amountIn }: { _amountIn: BigNumber }) =>
        _amountIn.mul(tokenA.asUnits(ratio.tokenA / ratio.tokenB)).div(tokenB.magnitude)
      );
    }

    async function withdraw(position: UserPositionDefinition, recipient: string): Promise<void> {
      await DCAHub.connect(position.owner).withdrawSwapped(position.id, recipient);

      // Since the position is "resetted" with a withdraw, we need to reduce the amount of swaps
      const { swapsLeft } = await getPosition(position);
      position.amountOfSwaps = BigNumber.from(swapsLeft);
    }

    async function flashSwap({ callee }: { callee: HasAddress }) {
      const { tokens, pairIndexes, borrow } = buildSwapInput([{ tokenA: tokenA.address, tokenB: tokenB.address }], []);
      await DCAHub.swap(tokens, pairIndexes, borrow, callee.address, ethers.utils.randomBytes(5));
    }

    async function loan({ callee, tokenA: amountTokenA, tokenB: amountTokenB }: { callee: HasAddress; tokenA: number; tokenB: number }) {
      await DCAHub.loan(
        [
          { token: tokenA.address, amount: tokenA.asUnits(amountTokenA) },
          { token: tokenB.address, amount: tokenB.asUnits(amountTokenB) },
        ],
        callee.address,
        ethers.utils.randomBytes(5)
      );
    }

    function getPosition(position: UserPositionDefinition): Promise<OngoingUserPosition> {
      return DCAHub.userPosition(position.id);
    }

    async function getNextSwapInfo() {
      const { tokens, pairIndexes } = buildGetNextSwapInfoInput([{ tokenA: tokenA.address, tokenB: tokenB.address }], []);
      return DCAHub.getNextSwapInfo(tokens, pairIndexes);
    }

    async function reducePosition(position: UserPositionDefinition, args: { newSwaps: number; amount: number }) {
      const token = position.from.address === tokenA.address ? tokenA : tokenB;
      await token.connect(position.owner).approve(DCAHub.address, token.asUnits(args.amount).mul(args.newSwaps));
      const response = await DCAHub.connect(position.owner).reducePosition(
        position.id,
        token.asUnits(args.amount),
        args.newSwaps,
        position.owner.address
      );
      position.amountOfSwaps = BigNumber.from(args.newSwaps);
      position.rate = await readArgFromEventOrFail<BigNumber>(response, 'Modified', 'rate');
    }

    async function deposit({
      token,
      depositor,
      rate,
      swapInterval,
      swaps,
    }: {
      token: TokenContract;
      depositor: SignerWithAddress;
      rate: number;
      swapInterval: SwapInterval;
      swaps: number;
    }): Promise<UserPositionDefinition> {
      const toToken = token.address === tokenA.address ? tokenB : tokenA;
      await token.mint(depositor.address, token.asUnits(rate).mul(swaps));
      await token.connect(depositor).approve(DCAHub.address, token.asUnits(rate).mul(swaps));
      const response: TransactionResponse = await DCAHub.connect(depositor).deposit(
        token.address,
        toToken.address,
        token.asUnits(rate).mul(swaps),
        swaps,
        swapInterval.seconds,
        depositor.address,
        []
      );
      const positionId = await readArgFromEventOrFail<BigNumber>(response, 'Deposited', 'positionId');
      return {
        id: positionId,
        owner: depositor,
        from: token,
        to: toToken,
        swapInterval,
        rate: token.asUnits(rate),
        amountOfSwaps: BigNumber.from(swaps),
      };
    }

    function calculateSwapped({ from, to }: UserPositionDefinition, ...swaps: { rate: number; ratio: SwapRatio; fee: number }[]) {
      return swaps
        .map(({ rate, ratio, fee }) => {
          const rateBN = from.asUnits(rate);
          const tempRatio = to.address === tokenB.address ? ratio.tokenB / ratio.tokenA : ratio.tokenA / ratio.tokenB;
          const swapped = tempRatio < 1 ? rateBN.div(1 / tempRatio) : rateBN.mul(tempRatio);
          const withCorrectDecimals = swapped.mul(to.magnitude).div(from.magnitude);
          return substractFee(fee, withCorrectDecimals);
        })
        .reduce(sumBN);
    }

    function swapped(...swaps: { rate: number; ratio: SwapRatio; fee: number }[]) {
      return (position: UserPositionDefinition) => calculateSwapped(position, ...swaps);
    }

    function assertNoSwapsCanBeExecutedNow() {
      return assertIntervalsToSwapNowAre();
    }

    async function assertAmountsToSwapAre({ tokenA: expectedTokenA, tokenB: expectedTokenB }: { tokenA: number; tokenB: number }) {
      const nextSwapInfo = await getNextSwapInfo();
      const { intervalsInSwap } = nextSwapInfo.pairs[0];
      let totalTokenA = constants.ZERO;
      let totalTokenB = constants.ZERO;

      const intervals = SwapInterval.intervalsfromByte(intervalsInSwap);
      for (const interval of intervals) {
        const { nextAmountToSwapAToB, nextAmountToSwapBToA } = await DCAHub.swapData(tokenA.address, tokenB.address, interval.mask);
        totalTokenA = totalTokenA.add(nextAmountToSwapAToB);
        totalTokenB = totalTokenB.add(nextAmountToSwapBToA);
      }

      expect(totalTokenA).to.equal(tokenA.asUnits(expectedTokenA));
      expect(totalTokenB).to.equal(tokenB.asUnits(expectedTokenB));
    }

    async function assertIntervalsToSwapNowAre(...swapIntervals: SwapInterval[]): Promise<void> {
      const nextSwapInfo = await getNextSwapInfo();
      const intervals = nextSwapInfo.pairs
        .map(({ intervalsInSwap }) => intervalsInSwap)
        .reduce((a, b) => '0x' + (parseInt(a) | parseInt(b)).toString(16).padStart(2, '0'), '0x00');
      expect(intervals).to.eql(SwapInterval.intervalsToByte(...swapIntervals));
    }

    function assertPositionIsConsistentWithNothingToWithdraw(position: UserPositionDefinition) {
      return assertPositionIsConsistent(position);
    }

    async function assertPositionIsConsistent(
      position: UserPositionDefinition,
      options?: { expectedSwapped: (position: UserPositionDefinition) => BigNumber }
    ) {
      const { from, to, swapInterval, rate, swapsExecuted, swapsLeft, remaining, swapped } = await getPosition(position);
      expect(from).to.equal(position.from.address);
      expect(to).to.equal(position.to.address);
      expect(swapInterval).to.equal(position.swapInterval.seconds);
      expect(rate).to.equal(position.rate);
      expect(swapsExecuted + swapsLeft).to.equal(position.amountOfSwaps);
      expect(remaining).to.equal(rate.mul(swapsLeft));
      if (options) {
        const expectedSwapped = options.expectedSwapped(position);
        expect(swapped).to.equal(expectedSwapped);
      } else {
        expect(swapped).to.equal(constants.ZERO);
      }
    }

    async function assertHubBalanceDifferencesAre(
      args: { tokenA: number | BigNumber; tokenB?: number | BigNumber } | { tokenA?: number | BigNumber; tokenB: number | BigNumber }
    ) {
      await assertBalanceDifferencesAre(DCAHub, args);
    }

    let lastBalanceTokenA: Map<string, BigNumber> = new Map();
    let lastBalanceTokenB: Map<string, BigNumber> = new Map();
    async function assertBalanceDifferencesAre(
      hasAddress: HasAddress,
      {
        tokenA: diffTokenA,
        tokenB: diffTokenB,
      }: { tokenA: number | BigNumber; tokenB?: number | BigNumber } | { tokenA?: number | BigNumber; tokenB: number | BigNumber }
    ) {
      const diffA = !diffTokenA ? 0 : BigNumber.isBigNumber(diffTokenA) ? diffTokenA : tokenA.asUnits(diffTokenA);
      const diffB = !diffTokenB ? 0 : BigNumber.isBigNumber(diffTokenB) ? diffTokenB : tokenB.asUnits(diffTokenB);
      const expectedBalanceTokenA = (lastBalanceTokenA.get(hasAddress.address) ?? constants.ZERO).add(diffA);
      const expectedBalanceTokenB = (lastBalanceTokenB.get(hasAddress.address) ?? constants.ZERO).add(diffB);
      expect(await tokenA.balanceOf(hasAddress.address), 'Unexpected diff in token A').to.equal(expectedBalanceTokenA);
      expect(await tokenB.balanceOf(hasAddress.address), 'Unexpected diff in token B').to.equal(expectedBalanceTokenB);
      lastBalanceTokenA.set(hasAddress.address, expectedBalanceTokenA);
      lastBalanceTokenB.set(hasAddress.address, expectedBalanceTokenB);
    }

    async function assertPlatformBalanceIncreasedBy({
      tokenA: increasedTokenA,
      tokenB: increasedTokenB,
    }: { tokenA: number | BigNumber; tokenB?: number | BigNumber } | { tokenA?: number | BigNumber; tokenB: number | BigNumber }) {
      const diffA = !increasedTokenA ? 0 : BigNumber.isBigNumber(increasedTokenA) ? increasedTokenA : tokenA.asUnits(increasedTokenA);
      const diffB = !increasedTokenB ? 0 : BigNumber.isBigNumber(increasedTokenB) ? increasedTokenB : tokenB.asUnits(increasedTokenB);
      const expectedBalanceTokenA = (lastBalanceTokenA.get('platform') ?? constants.ZERO).add(diffA);
      const expectedBalanceTokenB = (lastBalanceTokenB.get('platform') ?? constants.ZERO).add(diffB);

      expect(await DCAHub.platformBalance(tokenA.address)).to.equal(expectedBalanceTokenA);
      expect(await DCAHub.platformBalance(tokenB.address)).to.equal(expectedBalanceTokenB);
      lastBalanceTokenA.set('platform', expectedBalanceTokenA);
      lastBalanceTokenB.set('platform', expectedBalanceTokenB);
      return { expectedBalanceTokenA, expectedBalanceTokenB };
    }

    function substractFee(fee: number, number: BigNumber) {
      const percent = 100;
      return number.mul(percent * percent - fee * percent).div(percent * percent);
    }

    async function setInitialBalance(
      hasAddress: HasAddress,
      { tokenA: amountTokenA, tokenB: amountTokenB }: { tokenA: number; tokenB: number }
    ) {
      await tokenA.mint(hasAddress.address, tokenA.asUnits(amountTokenA));
      await tokenB.mint(hasAddress.address, tokenB.asUnits(amountTokenB));
      lastBalanceTokenA.set(hasAddress.address, tokenA.asUnits(amountTokenA));
      lastBalanceTokenB.set(hasAddress.address, tokenB.asUnits(amountTokenB));
    }

    const sumBN = (accum: BigNumber, newValue: BigNumber) => accum.add(newValue);

    type SwapRatio = { tokenA: 1; tokenB: number } | { tokenA: number; tokenB: 1 };

    type UserPositionDefinition = {
      id: BigNumber;
      owner: SignerWithAddress;
      from: TokenContract;
      to: TokenContract;
      swapInterval: SwapInterval;
      rate: BigNumber;
      amountOfSwaps: BigNumber;
    };

    type OngoingUserPosition = [string, string, number, number, BigNumber, number, BigNumber, BigNumber] & {
      from: string;
      to: string;
      swapInterval: number;
      swapsExecuted: number;
      swapped: BigNumber;
      swapsLeft: number;
      remaining: BigNumber;
      rate: BigNumber;
    };

    type HasAddress = {
      readonly address: string;
    };
  });
});
