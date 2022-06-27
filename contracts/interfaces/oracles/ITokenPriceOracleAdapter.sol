// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

import '@mean-finance/mean-oracles/solidity/interfaces/ITokenPriceOracle.sol';
import './IPriceOracle.sol';

/// @title Adapts old interface to new token price oracle interface.
/// @notice This adapter will be transitional from IPriceOracle to ITokenPriceOracel
interface ITokenPriceOracleAdapter is IPriceOracle {
  function tokenPriceOracle() external view returns (ITokenPriceOracle);
}
