//SPDX-License-Identifier: Unlicense
pragma solidity 0.7.0;

import './DCAPairParameters.sol';
import './DCAPairPositionHandler.sol';
import './DCAPairSwapHandler.sol';

interface IDCAPair is IDCAPairParameters, IDCAPairSwapHandler, IDCAPairPositionHandler {}

contract DCAPair is DCAPairParameters, DCAPairSwapHandler, DCAPairPositionHandler, IDCAPair {
  constructor(
    IERC20Decimals _tokenA,
    IERC20Decimals _tokenB,
    IUniswapV2Router02 _uniswap,
    uint256 _swapInterval
  ) DCAPairParameters(_tokenA, _tokenB, _uniswap) DCAPairSwapHandler(IDCAFactory(msg.sender), _swapInterval) {}

  // PositionHandler
  function deposit(
    address _token,
    uint256 _rate,
    uint256 _amountOfSwaps
  ) external override {
    _deposit(_token, _rate, _amountOfSwaps);
  }

  function withdrawSwapped(uint256 _dcaId) external override returns (uint256 _swapped) {
    /* */
  }

  function modifyRate(uint256 _dcaId, uint256 _newRate) external override {
    /* */
  }

  function modifySwaps(uint256 _dcaId, uint256 _newSwaps) external override {
    /* */
  }

  function modifyRateAndSwaps(
    uint256 _dcaId,
    uint256 _newRate,
    uint256 _newSwaps
  ) external override {
    /* */
  }

  function terminate(uint256 _dcaId) external override {
    /* */
  }

  // Swap Handler
  function setSwapInterval(uint256 _swapInterval) public override {
    _setSwapInterval(_swapInterval);
  }

  function swap() public override {
    _swap();
  }
}
