import moment from 'moment';
import { BigNumber, Contract, ContractFactory } from 'ethers';
import { ethers } from 'hardhat';
import { constants, erc20, evm, wallet } from '@test-utils';
import { contract } from '@test-utils/bdd';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import { TokenContract } from '@test-utils/erc20';
import { readArgFromEventOrFail } from '@test-utils/event-utils';
import {
  DCAGlobalParameters,
  DCAGlobalParameters__factory,
  DCAHub,
  DCAHub__factory,
  DCATokenDescriptor,
  DCATokenDescriptor__factory,
  TimeWeightedOracleMock,
  TimeWeightedOracleMock__factory,
} from '@typechained';
import isSvg from 'is-svg';
import { expect } from 'chai';

contract('DCATokenDescriptor', () => {
  let governor: SignerWithAddress;
  let feeRecipient: SignerWithAddress;
  let tokenA: TokenContract, tokenB: TokenContract;
  let DCAHubContract: DCAHub__factory;
  let DCAHub: DCAHub;
  let DCAGlobalParametersContract: DCAGlobalParameters__factory;
  let DCAGlobalParameters: DCAGlobalParameters;
  let DCATokenDescriptorContract: DCATokenDescriptor__factory;
  let DCATokenDescriptor: DCATokenDescriptor;
  let TimeWeightedOracleFactory: TimeWeightedOracleMock__factory;
  let TimeWeightedOracle: TimeWeightedOracleMock;
  const swapInterval = moment.duration(10, 'minutes').as('seconds');

  before('Setup accounts and contracts', async () => {
    [governor, feeRecipient] = await ethers.getSigners();
    DCAGlobalParametersContract = await ethers.getContractFactory('contracts/DCAGlobalParameters/DCAGlobalParameters.sol:DCAGlobalParameters');
    DCAHubContract = await ethers.getContractFactory('contracts/DCAHub/DCAHub.sol:DCAHub');
    DCATokenDescriptorContract = await ethers.getContractFactory('contracts/DCATokenDescriptor/DCATokenDescriptor.sol:DCATokenDescriptor');
    TimeWeightedOracleFactory = await ethers.getContractFactory('contracts/mocks/DCAHub/TimeWeightedOracleMock.sol:TimeWeightedOracleMock');
  });

  beforeEach('Deploy and configure', async () => {
    await evm.reset();
    tokenA = await erc20.deploy({
      name: 'tokenA',
      symbol: 'TKNA',
    });
    tokenB = await erc20.deploy({
      name: 'tokenB',
      symbol: 'TKNB',
    });
    TimeWeightedOracle = await TimeWeightedOracleFactory.deploy(tokenA.asUnits(1), tokenA.amountOfDecimals); // Rate is 1 token A = 1 token B
    DCATokenDescriptor = await DCATokenDescriptorContract.deploy();
    DCAGlobalParameters = await DCAGlobalParametersContract.deploy(
      governor.address,
      constants.NOT_ZERO_ADDRESS,
      feeRecipient.address,
      DCATokenDescriptor.address,
      TimeWeightedOracle.address
    );
    DCAHub = await DCAHubContract.deploy(DCAGlobalParameters.address, tokenA.address, tokenB.address);
    await DCAGlobalParameters.addSwapIntervalsToAllowedList([swapInterval], ['Daily']);

    await tokenA.mint(governor.address, tokenA.asUnits(1000));
    await tokenA.approveInternal(governor.address, DCAHub.address, tokenA.asUnits(1000));
    await tokenB.mint(governor.address, tokenB.asUnits(1000));
  });

  it('Validate tokenURI result', async () => {
    // Deposit
    const response = await DCAHub.deposit(governor.address, tokenA.address, tokenA.asUnits(10), 2, swapInterval);
    const tokenId = await readArgFromEventOrFail<BigNumber>(response, 'Deposited', 'dcaId');

    // Execute one swap
    await tokenB.transfer(DCAHub.address, tokenB.asUnits(20));
    await DCAHub['swap()']();

    // Get token uri
    const result1 = await DCAHub.tokenURI(tokenId);
    const { name: name1, description: description1, image: image1 } = extractJSONFromURI(result1);

    expect(name1).to.equal('Mean Finance DCA - Daily - TKNA/TKNB');
    expect(description1).to.equal(
      `This NFT represents a position in a Mean Finance DCA TKNA-TKNB pair. The owner of this NFT can modify or redeem the position.\n\nPair Address: ${DCAHub.address.toLowerCase()}\nTKNA Address: ${tokenA.address.toLowerCase()}\nTKNB Address: ${tokenB.address.toLowerCase()}\nSwap interval: Daily\nToken ID: 1\n\n⚠️ DISCLAIMER: Due diligence is imperative when assessing this NFT. Make sure token addresses match the expected tokens, as token symbols may be imitated.`
    );
    expect(isValidSvgImage(image1)).to.be.true;

    // Execute the last swap and withdraw
    await evm.advanceTimeAndBlock(swapInterval);
    await tokenB.transfer(DCAHub.address, tokenB.asUnits(20));
    await DCAHub['swap()']();
    await DCAHub.withdrawSwapped(tokenId, wallet.generateRandomAddress());

    // Get token uri
    const result2 = await DCAHub.tokenURI(tokenId);
    const { name: name2, description: description2, image: image2 } = extractJSONFromURI(result2);

    expect(name2).to.equal(name1);
    expect(description2).to.equal(description1);
    expect(isValidSvgImage(image2)).to.be.true;
  });

  function isValidSvgImage(base64: string) {
    const encodedImage = base64.substr('data:image/svg+xml;base64,'.length);
    const decodedImage = Buffer.from(encodedImage, 'base64').toString('utf8');
    return isSvg(decodedImage);
  }

  function extractJSONFromURI(uri: string): { name: string; description: string; image: string } {
    const encodedJSON = uri.substr('data:application/json;base64,'.length);
    const decodedJSON = Buffer.from(encodedJSON, 'base64').toString('utf8');
    return JSON.parse(decodedJSON);
  }
});
