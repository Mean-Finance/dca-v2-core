// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.6;

import '../../DCAHub/DCAHubSwapHandler.sol';
import './DCAHubConfigHandler.sol';

contract DCAHubSwapHandlerMock is DCAHubSwapHandler, DCAHubConfigHandlerMock {
  struct RegisterSwapCall {
    uint256 ratioAToB;
    uint256 ratioBToA;
    uint32 timestamp;
  }

  struct TotalAmountsToSwap {
    uint256 amountTokenA;
    uint256 amountTokenB;
    uint32[] intervalsInSwap;
  }

  mapping(address => mapping(address => mapping(uint32 => RegisterSwapCall))) public registerSwapCalls; // token A => token B => swap interval => call

  mapping(address => mapping(address => mapping(uint32 => uint256[2]))) private _amountToSwap;
  mapping(address => mapping(address => uint128)) private _ratios; // from => to => ratio(from -> to)
  mapping(address => mapping(address => TotalAmountsToSwap)) private _totalAmountsToSwap; // tokenA => tokenB => total amounts

  SwapInfo private _swapInformation;
  uint32 private _customTimestamp;

  constructor(
    IERC20Metadata _tokenA,
    IERC20Metadata _tokenB,
    address _immediateGovernor,
    address _timeLockedGovernor,
    IDCATokenDescriptor _nftDescriptor,
    ITimeWeightedOracle _oracle
  ) DCAHubConfigHandlerMock(_tokenA, _tokenB, _immediateGovernor, _timeLockedGovernor, _nftDescriptor, _oracle) DCAHubSwapHandler() {
    /* */
  }

  // SwapHandler

  function registerSwap(
    address _tokenA,
    address _tokenB,
    uint32 _swapInterval,
    uint256 _ratioAToB,
    uint256 _ratioBToA,
    uint32 _timestamp
  ) external {
    _registerSwap(_tokenA, _tokenB, _swapInterval, _ratioAToB, _ratioBToA, _timestamp);
  }

  function getAmountToSwap(
    address _from,
    address _to,
    uint32 _swapInterval
  ) external view returns (uint256, uint256) {
    return _getAmountToSwap(_from, _to, _swapInterval);
  }

  function setBlockTimestamp(uint32 _blockTimestamp) external {
    _customTimestamp = _blockTimestamp;
  }

  function _getTimestamp() internal view override returns (uint32 _blockTimestamp) {
    _blockTimestamp = (_customTimestamp > 0) ? _customTimestamp : super._getTimestamp();
  }

  function _getAmountToSwap(
    address _tokenA,
    address _tokenB,
    uint32 _swapInterval
  ) internal view override returns (uint256, uint256) {
    uint256[2] memory _amounts = _amountToSwap[_tokenA][_tokenB][_swapInterval];
    if (_amounts[0] == 0 && _amounts[1] == 0) {
      return super._getAmountToSwap(_tokenA, _tokenB, _swapInterval);
    } else {
      return (_amounts[0], _amounts[1]);
    }
  }

  function getTotalAmountsToSwap(address _tokenA, address _tokenB)
    external
    view
    returns (
      uint256,
      uint256,
      uint32[] memory
    )
  {
    return _getTotalAmountsToSwap(_tokenA, _tokenB);
  }

  function _getTotalAmountsToSwap(address _tokenA, address _tokenB)
    internal
    view
    override
    returns (
      uint256 _totalAmountTokenA,
      uint256 _totalAmountTokenB,
      uint32[] memory _affectedIntervals
    )
  {
    TotalAmountsToSwap memory _amounts = _totalAmountsToSwap[_tokenA][_tokenB];
    if (_amounts.amountTokenA == 0 && _amounts.amountTokenB == 0) {
      return super._getTotalAmountsToSwap(_tokenA, _tokenB);
    }
    _totalAmountTokenA = _amounts.amountTokenA;
    _totalAmountTokenB = _amounts.amountTokenB;
    _affectedIntervals = _amounts.intervalsInSwap;
  }

  function internalGetNextSwapInfo(address[] calldata _tokens, PairIndexes[] calldata _pairs) external view returns (SwapInfo memory) {
    return _getNextSwapInfo(_tokens, _pairs);
  }

  function _getNextSwapInfo(address[] calldata _tokens, PairIndexes[] calldata _pairs) internal view override returns (SwapInfo memory) {
    if (_swapInformation.tokens.length > 0) {
      return _swapInformation;
    } else {
      return super._getNextSwapInfo(_tokens, _pairs);
    }
  }

  function calculateRatio(
    address _tokenA,
    address _tokenB,
    uint256 _magnitudeA,
    uint256 _magnitudeB,
    ITimeWeightedOracle _oracle
  ) external view returns (uint128, uint128) {
    return _calculateRatio(_tokenA, _tokenB, _magnitudeA, _magnitudeB, _oracle);
  }

  function _calculateRatio(
    address _tokenA,
    address _tokenB,
    uint256 _magnitudeA,
    uint256 _magnitudeB,
    ITimeWeightedOracle _oracle
  ) internal view override returns (uint128 _ratioAToB, uint128 _ratioBToA) {
    _ratioBToA = _ratios[_tokenB][_tokenA];
    if (_ratioBToA == 0) {
      return super._calculateRatio(_tokenA, _tokenB, _magnitudeA, _magnitudeB, _oracle);
    }
    _ratioAToB = uint128((_magnitudeA * _magnitudeB) / _ratioBToA);
  }

  // Used to register calls
  function _registerSwap(
    address _tokenA,
    address _tokenB,
    uint32 _swapInterval,
    uint256 _ratioAToB,
    uint256 _ratioBToA,
    uint32 _timestamp
  ) internal override {
    registerSwapCalls[_tokenA][_tokenB][_swapInterval] = RegisterSwapCall({ratioAToB: _ratioAToB, ratioBToA: _ratioBToA, timestamp: _timestamp});
    super._registerSwap(_tokenA, _tokenB, _swapInterval, _ratioAToB, _ratioBToA, _timestamp);
  }

  // Mocks setters

  function setRatio(
    address _tokenA,
    address _tokenB,
    uint128 _ratioBToA
  ) external {
    _ratios[_tokenB][_tokenA] = _ratioBToA;
  }

  function setTotalAmountsToSwap(
    address _tokenA,
    address _tokenB,
    uint256 _totalAmountTokenA,
    uint256 _totalAmountTokenB,
    uint32[] memory _intervalsInSwap
  ) external {
    _totalAmountsToSwap[_tokenA][_tokenB].amountTokenA = _totalAmountTokenA;
    _totalAmountsToSwap[_tokenA][_tokenB].amountTokenB = _totalAmountTokenB;

    for (uint256 i = 0; i < _intervalsInSwap.length; i++) {
      _totalAmountsToSwap[_tokenA][_tokenB].intervalsInSwap.push(_intervalsInSwap[i]);
    }
  }

  function setAmountToSwap(
    address _tokenA,
    address _tokenB,
    uint32 _swapInterval,
    uint256 _amountTokenA,
    uint256 _amountTokenB
  ) external {
    _amountToSwap[_tokenA][_tokenB][_swapInterval] = [_amountTokenA, _amountTokenB];
  }

  function setInternalGetNextSwapInfo(SwapInfo memory __swapInformation) external {
    for (uint256 i; i < __swapInformation.tokens.length; i++) {
      _swapInformation.tokens.push(__swapInformation.tokens[i]);
    }

    for (uint256 i; i < __swapInformation.pairs.length; i++) {
      _swapInformation.pairs.push(__swapInformation.pairs[i]);
    }
  }

  function setNextSwapAvailable(uint32 _swapInterval, uint32 _nextSwapAvailable) external {
    // TODO: stop using tokenA & tokenB and receive as parameters
    if (address(tokenA) < address(tokenB)) {
      nextSwapAvailable[address(tokenA)][address(tokenB)][_swapInterval] = _nextSwapAvailable;
    } else {
      nextSwapAvailable[address(tokenB)][address(tokenA)][_swapInterval] = _nextSwapAvailable;
    }
  }
}
