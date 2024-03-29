import { expect } from 'chai';
import { BigNumber, Contract, utils } from 'ethers';
import { ethers } from 'hardhat';
import { TransactionResponse } from '@ethersproject/abstract-provider';
import {
  DCAHub,
  DCAHub__factory,
  ReentrantDCAHubSwapCalleeMock,
  ReentrantDCAHubSwapCalleeMock__factory,
  DCAPermissionsManager,
  DCAPermissionsManager__factory,
  ITokenPriceOracle,
} from '@typechained';
import { constants, erc20, wallet } from '@test-utils';
import { given, then, when, contract } from '@test-utils/bdd';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { TokenContract } from '@test-utils/erc20';
import { readArgFromEventOrFail } from '@test-utils/event-utils';
import { snapshot } from '@test-utils/evm';
import { SwapInterval } from 'js-lib/interval-utils';
import { FakeContract, smock } from '@defi-wonderland/smock';

contract('DCAHub', () => {
  describe('Reentrancy Guard', () => {
    const BYTES = ethers.utils.hexlify(ethers.utils.randomBytes(5));
    let governor: SignerWithAddress;
    let dude: SignerWithAddress;
    let tokenA: TokenContract, tokenB: TokenContract;
    let DCAHubFactory: DCAHub__factory;
    let DCAHub: DCAHub;
    let reentrantDCAHubSwapCalleeFactory: ReentrantDCAHubSwapCalleeMock__factory;
    let priceOracle: FakeContract<ITokenPriceOracle>;
    let DCAPermissionsManagerFactory: DCAPermissionsManager__factory, DCAPermissionsManager: DCAPermissionsManager;
    let snapshotId: string;

    before('Setup accounts and contracts', async () => {
      [governor, dude] = await ethers.getSigners();
      DCAHubFactory = await ethers.getContractFactory('contracts/DCAHub/DCAHub.sol:DCAHub');
      reentrantDCAHubSwapCalleeFactory = await ethers.getContractFactory('contracts/mocks/DCAHubSwapCallee.sol:ReentrantDCAHubSwapCalleeMock');
      DCAPermissionsManagerFactory = await ethers.getContractFactory(
        'contracts/DCAPermissionsManager/DCAPermissionsManager.sol:DCAPermissionsManager'
      );

      const deploy = () => erc20.deploy({ name: 'A name', symbol: 'SYMB' });
      const tokens = [await deploy(), await deploy()];
      [tokenA, tokenB] = tokens.sort((a, b) => a.address.localeCompare(b.address));
      priceOracle = await smock.fake('ITokenPriceOracle');
      DCAPermissionsManager = await DCAPermissionsManagerFactory.deploy(constants.NOT_ZERO_ADDRESS, constants.NOT_ZERO_ADDRESS);
      DCAHub = await DCAHubFactory.deploy(governor.address, constants.NOT_ZERO_ADDRESS, priceOracle.address, DCAPermissionsManager.address);
      await DCAPermissionsManager.setHub(DCAHub.address);
      await DCAHub.setAllowedTokens([tokenA.address, tokenB.address], [true, true]);
      await DCAHub.addSwapIntervalsToAllowedList([SwapInterval.FIFTEEN_MINUTES.seconds]);
      snapshotId = await snapshot.take();
    });

    beforeEach('Deploy and configure', async () => {
      await snapshot.revert(snapshotId);
    });

    describe('flash swap', () => {
      const rateTokenA = 50;
      const swapsTokenA = 13;
      let reentrantDCAHubSwapCallee: ReentrantDCAHubSwapCalleeMock;
      given(async () => {
        priceOracle.quote.returns(({ amountIn }: { amountIn: BigNumber }) => amountIn.mul(tokenA.asUnits(1).div(tokenB.magnitude)));
        await deposit({
          from: () => tokenA,
          to: () => tokenB,
          depositor: dude,
          rate: rateTokenA,
          swaps: swapsTokenA,
        });
        reentrantDCAHubSwapCallee = await reentrantDCAHubSwapCalleeFactory.deploy();
      });

      testReentrantForFunction({
        funcAndSignature: 'swap',
        args: () => [
          [tokenA.address, tokenB.address],
          [{ indexTokenA: 0, indexTokenB: 1 }],
          reentrantDCAHubSwapCallee.address,
          reentrantDCAHubSwapCallee.address,
          [0, 0],
          utils.formatBytes32String(''),
          utils.formatBytes32String(''),
        ],
        attackerContract: () => reentrantDCAHubSwapCallee,
      });
    });

    async function testReentrantAttack({
      title,
      funcAndSignature,
      args,
      attackerContract,
      attack,
    }: {
      title: string;
      funcAndSignature: string;
      args: () => any[];
      attackerContract: () => Contract;
      attack: () => Promise<string>;
    }) {
      when(title, () => {
        let reentrantTx: Promise<TransactionResponse>;
        given(async () => {
          await attackerContract().setAttack(await attack());
          reentrantTx = (DCAHub as any)[funcAndSignature](...args());
        });
        then('tx is reverted', async () => {
          await expect(reentrantTx).to.be.revertedWith('ReentrancyGuard: reentrant call');
        });
      });
    }

    async function testReentrantForFunction({
      funcAndSignature,
      args,
      attackerContract,
    }: {
      funcAndSignature: string;
      args: () => any[];
      attackerContract: () => Contract;
    }) {
      testReentrantAttack({
        title: 'trying to do a reentrancy attack through a deposit',
        funcAndSignature,
        args,
        attackerContract,
        attack: async () => {
          const tx = await DCAHub.populateTransaction['deposit(address,address,uint256,uint32,uint32,address,(address,uint8[])[])'](
            constants.NOT_ZERO_ADDRESS,
            constants.NOT_ZERO_ADDRESS,
            0,
            0,
            0,
            wallet.generateRandomAddress(),
            []
          );
          return tx.data!;
        },
      });
      testReentrantAttack({
        title: 'trying to do a reentrancy attack through withdrawing swapped',
        funcAndSignature,
        args,
        attackerContract,
        attack: async () => (await DCAHub.populateTransaction.withdrawSwapped(0, wallet.generateRandomAddress())).data!,
      });

      testReentrantAttack({
        title: 'trying to do a reentrancy attack through withdrawing swapped many',
        funcAndSignature,
        args,
        attackerContract,
        attack: async () => (await DCAHub.populateTransaction.withdrawSwappedMany([], wallet.generateRandomAddress())).data!,
      });

      testReentrantAttack({
        title: 'trying to do a reentrancy attack through terminate',
        funcAndSignature,
        args,
        attackerContract,
        attack: async () =>
          (await DCAHub.populateTransaction.terminate(0, wallet.generateRandomAddress(), wallet.generateRandomAddress())).data!,
      });

      testReentrantAttack({
        title: 'trying to do a reentrancy attack through increasePosition',
        funcAndSignature,
        args,
        attackerContract,
        attack: async () => (await DCAHub.populateTransaction.increasePosition(0, 0, 0)).data!,
      });

      testReentrantAttack({
        title: 'trying to do a reentrancy attack through reducePosition',
        funcAndSignature,
        args,
        attackerContract,
        attack: async () => (await DCAHub.populateTransaction.reducePosition(0, 0, 0, wallet.generateRandomAddress())).data!,
      });

      testReentrantAttack({
        title: 'trying to do a reentrancy attack through withdraw from platform balance',
        funcAndSignature,
        args,
        attackerContract,
        attack: async () => (await DCAHub.populateTransaction.withdrawFromPlatformBalance([], wallet.generateRandomAddress())).data!,
      });

      testReentrantAttack({
        title: 'trying to do a reentrancy attack through a flash swap',
        funcAndSignature,
        args,
        attackerContract,
        attack: async () => {
          const result = await DCAHub.populateTransaction.swap([], [], constants.NOT_ZERO_ADDRESS, constants.NOT_ZERO_ADDRESS, [], BYTES, BYTES);
          return result.data!;
        },
      });
    }

    async function deposit({
      from,
      to,
      depositor,
      rate,
      swaps,
    }: {
      from: () => TokenContract;
      to: () => TokenContract;
      depositor: SignerWithAddress;
      rate: number;
      swaps: number;
    }) {
      await from().mint(depositor.address, from().asUnits(rate).mul(swaps));
      await from().connect(depositor).approve(DCAHub.address, from().asUnits(rate).mul(swaps));
      const response: TransactionResponse = await DCAHub.connect(depositor)[
        'deposit(address,address,uint256,uint32,uint32,address,(address,uint8[])[])'
      ](from().address, to().address, from().asUnits(rate).mul(swaps), swaps, SwapInterval.FIFTEEN_MINUTES.seconds, depositor.address, []);
      const positionId = await readArgFromEventOrFail<BigNumber>(response, 'Deposited', 'positionId');
      return { response, positionId };
    }
  });
});
