import moment from 'moment';
import { expect } from 'chai';
import { BigNumber, Contract, utils } from 'ethers';
import { ethers } from 'hardhat';
import { TransactionResponse } from '@ethersproject/abstract-provider';
import {
  DCAHub,
  DCAHub__factory,
  TimeWeightedOracleMock,
  TimeWeightedOracleMock__factory,
  ReentrantDCAHubSwapCalleeMock,
  ReentrantDCAHubSwapCalleeMock__factory,
  ReentrantDCAHubLoanCalleeMock,
  ReentrantDCAHubLoanCalleeMock__factory,
  DCAPermissionsManager,
  DCAPermissionsManager__factory,
} from '@typechained';
import { constants, erc20, wallet } from '@test-utils';
import { given, then, when, contract } from '@test-utils/bdd';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import { TokenContract } from '@test-utils/erc20';
import { readArgFromEventOrFail } from '@test-utils/event-utils';
import { snapshot } from '@test-utils/evm';

contract('DCAHub', () => {
  describe('Reentrancy Guard', () => {
    let governor: SignerWithAddress;
    let dude: SignerWithAddress;
    let tokenA: TokenContract, tokenB: TokenContract;
    let DCAHubFactory: DCAHub__factory;
    let DCAHub: DCAHub;
    let reentrantDCAHubSwapCalleeFactory: ReentrantDCAHubSwapCalleeMock__factory;
    let reentrantDCAHubLoanCalleeFactory: ReentrantDCAHubLoanCalleeMock__factory;
    let TimeWeightedOracleFactory: TimeWeightedOracleMock__factory;
    let TimeWeightedOracle: TimeWeightedOracleMock;
    let DCAPermissionsManagerFactory: DCAPermissionsManager__factory, DCAPermissionsManager: DCAPermissionsManager;
    let snapshotId: string;

    const swapInterval = moment.duration(10, 'minutes').as('seconds');

    before('Setup accounts and contracts', async () => {
      [governor, dude] = await ethers.getSigners();
      DCAHubFactory = await ethers.getContractFactory('contracts/DCAHub/DCAHub.sol:DCAHub');
      reentrantDCAHubLoanCalleeFactory = await ethers.getContractFactory('contracts/mocks/DCAHubLoanCallee.sol:ReentrantDCAHubLoanCalleeMock');
      reentrantDCAHubSwapCalleeFactory = await ethers.getContractFactory('contracts/mocks/DCAHubSwapCallee.sol:ReentrantDCAHubSwapCalleeMock');
      TimeWeightedOracleFactory = await ethers.getContractFactory('contracts/mocks/DCAHub/TimeWeightedOracleMock.sol:TimeWeightedOracleMock');
      DCAPermissionsManagerFactory = await ethers.getContractFactory(
        'contracts/DCAPermissionsManager/DCAPermissionsManager.sol:DCAPermissionsManager'
      );

      const deploy = () => erc20.deploy({ name: 'A name', symbol: 'SYMB' });
      const tokens = [await deploy(), await deploy()];
      [tokenA, tokenB] = tokens.sort((a, b) => a.address.localeCompare(b.address));
      TimeWeightedOracle = await TimeWeightedOracleFactory.deploy(0, 0);
      DCAPermissionsManager = await DCAPermissionsManagerFactory.deploy(constants.NOT_ZERO_ADDRESS, constants.NOT_ZERO_ADDRESS);
      DCAHub = await DCAHubFactory.deploy(
        governor.address,
        constants.NOT_ZERO_ADDRESS,
        TimeWeightedOracle.address,
        DCAPermissionsManager.address
      );
      await DCAPermissionsManager.setHub(DCAHub.address);
      await DCAHub.addSwapIntervalsToAllowedList([swapInterval], ['NULL']);
      snapshotId = await snapshot.take();
    });

    beforeEach('Deploy and configure', async () => {
      await snapshot.revert(snapshotId);
    });

    describe('loan', () => {
      const rateTokenA = 50;
      const swapsTokenA = 13;
      let reentrantDCAHubLoanCallee: ReentrantDCAHubLoanCalleeMock;
      given(async () => {
        await deposit({
          from: () => tokenA,
          to: () => tokenB,
          depositor: dude,
          rate: rateTokenA,
          swaps: swapsTokenA,
        });
        reentrantDCAHubLoanCallee = await reentrantDCAHubLoanCalleeFactory.deploy();
      });

      testReentrantForFunction({
        funcAndSignature: 'loan',
        args: () => [[], reentrantDCAHubLoanCallee.address, '0x'],
        attackerContract: () => reentrantDCAHubLoanCallee,
      });
    });

    describe('flash swap', () => {
      const rateTokenA = 50;
      const swapsTokenA = 13;
      let reentrantDCAHubSwapCallee: ReentrantDCAHubSwapCalleeMock;
      given(async () => {
        await TimeWeightedOracle.setRate(tokenA.asUnits('1'), 18);
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
        funcAndSignature: 'swap(address[],(uint8,uint8)[],uint256[],address,bytes)',
        args: () => [
          [tokenA.address, tokenB.address],
          [{ indexTokenA: 0, indexTokenB: 1 }],
          [0, 0],
          reentrantDCAHubSwapCallee.address,
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
        attack: async () =>
          (
            await DCAHub.populateTransaction.deposit(
              constants.NOT_ZERO_ADDRESS,
              constants.NOT_ZERO_ADDRESS,
              0,
              0,
              0,
              wallet.generateRandomAddress(),
              []
            )
          ).data!,
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
        attack: async () => (await DCAHub.populateTransaction.reducePosition(0, 0, 0)).data!,
      });

      testReentrantAttack({
        title: 'trying to do a reentrancy attack through a flash swap',
        funcAndSignature,
        args,
        attackerContract,
        attack: async () => {
          const result = await DCAHub.populateTransaction.swap([], [], [], constants.NOT_ZERO_ADDRESS, '0x');
          return result.data!;
        },
      });

      testReentrantAttack({
        title: 'trying to do a reentrancy attack through a flash loan',
        funcAndSignature,
        args,
        attackerContract,
        attack: async () => (await DCAHub.populateTransaction.loan([], constants.NOT_ZERO_ADDRESS, '0x')).data!,
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
      const response: TransactionResponse = await DCAHub.connect(depositor).deposit(
        from().address,
        to().address,
        from().asUnits(rate).mul(swaps),
        swaps,
        swapInterval,
        depositor.address,
        []
      );
      const dcaId = await readArgFromEventOrFail<BigNumber>(response, 'Deposited', 'dcaId');
      return { response, dcaId };
    }
  });
});
