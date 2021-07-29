import { expect } from 'chai';
import { Contract, ContractFactory, Wallet } from 'ethers';
import { TransactionResponse } from '@ethersproject/abstract-provider';
import { ethers } from 'hardhat';
import { behaviours, constants, wallet } from '../../utils';
import { given, then, when } from '../../utils/bdd';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import { smockit, MockContract } from '@eth-optimism/smock';
import { abi as KEEP3R_ABI } from '../../../artifacts/contracts/interfaces/IKeep3rV1.sol/IKeep3rV1.json';

describe('DCAKeep3rJob', () => {
  const ADDRESS_1 = '0x0000000000000000000000000000000000000001';
  const ADDRESS_2 = '0x0000000000000000000000000000000000000002';

  let owner: SignerWithAddress, swapperCaller: SignerWithAddress;
  let DCAKeep3rJobContract: ContractFactory, DCAFactoryContract: ContractFactory;
  let DCASwapperContract: ContractFactory;
  let DCAKeep3rJob: Contract, DCAFactory: Contract;
  let DCASwapper: Contract;
  let keep3r: MockContract;

  before('Setup accounts and contracts', async () => {
    [owner, swapperCaller] = await ethers.getSigners();
    DCAKeep3rJobContract = await ethers.getContractFactory('contracts/mocks/DCAKeep3rJob/DCAKeep3rJob.sol:DCAKeep3rJobMock');
    DCASwapperContract = await ethers.getContractFactory('contracts/mocks/DCAKeep3rJob/DCASwapperMock.sol:DCASwapperMock');
    DCAFactoryContract = await ethers.getContractFactory('contracts/mocks/DCAKeep3rJob/DCAFactoryMock.sol:DCAFactoryMock');
    keep3r = await smockit(KEEP3R_ABI);
  });

  beforeEach('Deploy and configure', async () => {
    DCAFactory = await DCAFactoryContract.deploy();
    DCASwapper = await DCASwapperContract.deploy();
    DCAKeep3rJob = await DCAKeep3rJobContract.deploy(owner.address, DCAFactory.address, keep3r.address, DCASwapper.address);
  });

  describe('constructor', () => {
    when('factory is zero address', () => {
      then('tx is reverted with reason error', async () => {
        await behaviours.deployShouldRevertWithMessage({
          contract: DCAKeep3rJobContract,
          args: [owner.address, constants.ZERO_ADDRESS, keep3r.address, DCASwapper.address],
          message: 'ZeroAddress',
        });
      });
    });
    when('keep3r is zero address', () => {
      then('tx is reverted with reason error', async () => {
        await behaviours.deployShouldRevertWithMessage({
          contract: DCAKeep3rJobContract,
          args: [owner.address, DCAFactory.address, constants.ZERO_ADDRESS, DCASwapper.address],
          message: 'ZeroAddress',
        });
      });
    });
    when('swapper is zero address', () => {
      then('tx is reverted with reason error', async () => {
        await behaviours.deployShouldRevertWithMessage({
          contract: DCAKeep3rJobContract,
          args: [owner.address, DCAFactory.address, keep3r.address, constants.ZERO_ADDRESS],
          message: 'ZeroAddress',
        });
      });
    });
    when('all arguments are valid', () => {
      then('factory is set correctly', async () => {
        const factory = await DCAKeep3rJob.factory();
        expect(factory).to.equal(DCAFactory.address);
      });
      then('swapper is set correctly', async () => {
        const swapper = await DCAKeep3rJob.swapper();
        expect(swapper).to.equal(DCASwapper.address);
      });
    });
  });

  describe('setKeep3rV1', () => {
    when('keep3r address is zero', () => {
      then('tx is reverted with reason error', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: DCAKeep3rJob,
          func: 'setKeep3rV1',
          args: [constants.ZERO_ADDRESS],
          message: 'ZeroAddress',
        });
      });
    });
    when('keep3r is not zero address', () => {
      let keep3rSetTx: TransactionResponse;
      const newKeep3r = wallet.generateRandomAddress();
      given(async () => {
        keep3rSetTx = await DCAKeep3rJob.setKeep3rV1(newKeep3r);
      });
      then('keep3r is set', async () => {
        expect(await DCAKeep3rJob.keep3rV1()).to.be.equal(newKeep3r);
      });
      then('event is emitted', async () => {
        expect(keep3rSetTx).to.emit(DCAKeep3rJob, 'Keep3rSet').withArgs(newKeep3r);
      });
    });
    behaviours.shouldBeExecutableOnlyByGovernor({
      contract: () => DCAKeep3rJob,
      funcAndSignature: 'setKeep3rV1(address)',
      params: [ADDRESS_1],
      governor: () => owner,
    });
  });

  describe('setSwapper', () => {
    when('swapper address is zero', () => {
      then('tx is reverted with reason error', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: DCAKeep3rJob,
          func: 'setSwapper',
          args: [constants.ZERO_ADDRESS],
          message: 'ZeroAddress',
        });
      });
    });
    when('swapper is not zero address', () => {
      let swapperSetTx: TransactionResponse;
      const newSwapper = wallet.generateRandomAddress();
      given(async () => {
        swapperSetTx = await DCAKeep3rJob.setSwapper(newSwapper);
      });
      then('swapper is set', async () => {
        expect(await DCAKeep3rJob.swapper()).to.be.equal(newSwapper);
      });
      then('event is emitted', async () => {
        expect(swapperSetTx).to.emit(DCAKeep3rJob, 'SwapperSet').withArgs(newSwapper);
      });
    });
    behaviours.shouldBeExecutableOnlyByGovernor({
      contract: () => DCAKeep3rJob,
      funcAndSignature: 'setSwapper(address)',
      params: [ADDRESS_1],
      governor: () => owner,
    });
  });

  describe('startSubsidizingPairs', () => {
    when('one of the pairs is not a DCA pair', () => {
      given(async () => {
        await DCAFactory.setAsPair(ADDRESS_1);
      });
      then('tx is reverted with reason', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: DCAKeep3rJob,
          func: 'startSubsidizingPairs',
          args: [[ADDRESS_1, ADDRESS_2]],
          message: 'InvalidPairAddress',
        });
        await behaviours.txShouldRevertWithMessage({
          contract: DCAKeep3rJob,
          func: 'startSubsidizingPairs',
          args: [[ADDRESS_2, ADDRESS_1]],
          message: 'InvalidPairAddress',
        });
      });
    });
    when('addresses are valid pairs', () => {
      let tx: TransactionResponse;

      given(async () => {
        await DCAFactory.setAsPair(ADDRESS_1);
        await DCAFactory.setAsPair(ADDRESS_2);
        tx = await DCAKeep3rJob.startSubsidizingPairs([ADDRESS_1, ADDRESS_2]);
      });

      then('pairs are added', async () => {
        expect(await DCAKeep3rJob.subsidizedPairs()).to.eql([ADDRESS_1, ADDRESS_2]);
      });

      then('event is emmitted', async () => {
        await expect(tx).to.emit(DCAKeep3rJob, 'SubsidizingNewPairs').withArgs([ADDRESS_1, ADDRESS_2]);
      });
    });
    behaviours.shouldBeExecutableOnlyByGovernor({
      contract: () => DCAKeep3rJob,
      funcAndSignature: 'startSubsidizingPairs(address[])',
      params: [[ADDRESS_1]],
      governor: () => owner,
    });
  });
  describe('stopSubsidizingPairs', () => {
    given(async () => {
      await DCAFactory.setAsPair(ADDRESS_1);
      await DCAKeep3rJob.startSubsidizingPairs([ADDRESS_1]);
    });
    when('address being subsidized is removed', () => {
      let tx: TransactionResponse;

      given(async () => {
        tx = await DCAKeep3rJob.stopSubsidizingPairs([ADDRESS_1]);
      });

      then('event is emitted', async () => {
        await expect(tx).to.emit(DCAKeep3rJob, 'StoppedSubsidizingPairs').withArgs([ADDRESS_1]);
      });
      then('pair is no longer subsidized', async () => {
        expect(await DCAKeep3rJob.subsidizedPairs()).to.be.empty;
      });
    });
    behaviours.shouldBeExecutableOnlyByGovernor({
      contract: () => DCAKeep3rJob,
      funcAndSignature: 'stopSubsidizingPairs(address[])',
      params: [[ADDRESS_1]],
      governor: () => owner,
    });
  });

  describe('workable', () => {
    const ADDRESS_3 = '0x0000000000000000000000000000000000000003';

    given(async () => {
      await DCAFactory.setAsPair(ADDRESS_1);
      await DCAFactory.setAsPair(ADDRESS_2);
      await DCAFactory.setAsPair(ADDRESS_3);
    });

    when('there are no pairs being subsidized', () => {
      then('empty list is returned', async () => {
        const pairsToSwap = await DCAKeep3rJob.callStatic.workable();
        expect(pairsToSwap).to.be.empty;
      });
    });

    when('pairs being subsidized should not be swaped', () => {
      given(async () => {
        await DCAKeep3rJob.startSubsidizingPairs([ADDRESS_1, ADDRESS_2]);
        await DCASwapper.setPairsToSwap([], []);
      });

      then('empty list is returned', async () => {
        const pairsToSwap = await DCAKeep3rJob.callStatic.workable();
        expect(pairsToSwap).to.be.empty;
      });
    });

    when('some of the pairs being subsidized should be swapped', () => {
      given(async () => {
        await DCAKeep3rJob.startSubsidizingPairs([ADDRESS_1, ADDRESS_2, ADDRESS_3]);
        await DCASwapper.setPairsToSwap([ADDRESS_1, ADDRESS_3], [3000, 10000]);
      });

      then('then they are returned', async () => {
        const pairsToSwap: { pair: string; bestFeeTier: number }[] = await DCAKeep3rJob.callStatic.workable();
        expect(pairsToSwap.map(({ pair }) => pair)).to.eql([ADDRESS_3, ADDRESS_1]);
        expect(pairsToSwap.map(({ bestFeeTier }) => bestFeeTier)).to.eql([10000, 3000]);
      });
    });
  });

  describe('work', () => {
    given(async () => {
      await keep3r.smocked.isKeeper.will.return.with(true);
    });
    when('not being called from a keeper', () => {
      given(async () => {
        await keep3r.smocked.isKeeper.will.return.with(false);
      });
      then('tx is reverted with reason error', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: DCAKeep3rJob,
          func: 'work',
          args: [[[wallet.generateRandomAddress(), 1]]],
          message: 'NotAKeeper',
        });
      });
    });
    when('pair is not being subsidized', () => {
      then('calling work will revert', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: DCAKeep3rJob,
          func: 'work',
          args: [[[ADDRESS_1, 500]]],
          message: 'PairNotSubsidized',
        });
      });
    });
    when('pair is being subsidized', () => {
      let tx: TransactionResponse;
      let keeper: Wallet;
      given(async () => {
        keeper = await wallet.generateRandom();
        await DCAFactory.setAsPair(ADDRESS_1);
        await DCAFactory.setAsPair(ADDRESS_2);
        await DCAKeep3rJob.startSubsidizingPairs([ADDRESS_1, ADDRESS_2]);

        tx = await DCAKeep3rJob.connect(keeper).work(
          [
            [ADDRESS_1, 500],
            [ADDRESS_2, 3000],
          ],
          { gasPrice: 0 }
        );
      });

      then('job will call the swapper', async () => {
        const lastCalled = await DCASwapper.lastCalled();
        expect(lastCalled).to.eql([
          [ADDRESS_1, 500],
          [ADDRESS_2, 3000],
        ]);
      });

      then('keep3r protocol gets consulted if worker is a keeper', () => {
        expect(keep3r.smocked.isKeeper.calls[0]).to.eql([keeper.address]);
      });

      then('keep3r protocol gets notice of the work done by keeper', async () => {
        expect(keep3r.smocked.worked.calls[0]).to.eql([keeper.address]);
      });
    });
  });
});
