// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.8.7 <0.9.0;

import '@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol';
import '@chainlink/contracts/src/v0.8/Denominations.sol';
import '../interfaces/oracles/ITokenPriceOracleAdapter.sol';
import '../libraries/TokenSorting.sol';
import '../utils/Governable.sol';

contract TokenPriceOracleAdapter is ITokenPriceOracleAdapter {
  /// @inheritdoc ITokenPriceOracleAdapter
  ITokenPriceOracle public immutable tokenPriceOracle;

  constructor(ITokenPriceOracle _tokenPriceOracle) {
    tokenPriceOracle = _tokenPriceOracle;
  }

  /// @inheritdoc IPriceOracle
  function canSupportPair(address _tokenA, address _tokenB) external view returns (bool) {
    return ITokenPriceOracle(tokenPriceOracle).canSupportPair(_tokenA, _tokenB);
  }

  /// @inheritdoc IPriceOracle
  function quote(
    address _tokenIn,
    uint128 _amountIn,
    address _tokenOut
  ) external view returns (uint256 _amountOut) {
    return ITokenPriceOracle(tokenPriceOracle).quote(_tokenIn, _amountIn, _tokenOut);
  }

  /// @inheritdoc IPriceOracle
  function reconfigureSupportForPair(address _tokenA, address _tokenB) external {
    ITokenPriceOracle(tokenPriceOracle).addOrModifySupportForPair(_tokenA, _tokenB);
  }

  /// @inheritdoc IPriceOracle
  function addSupportForPairIfNeeded(address _tokenA, address _tokenB) external {
    ITokenPriceOracle(tokenPriceOracle).addSupportForPairIfNeeded(_tokenA, _tokenB);
  }
}
