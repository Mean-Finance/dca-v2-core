// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.6;

import '../../DCAFactory/DCAFactoryPairsHandler.sol';

contract DCAFactoryPairsHandlerMock is DCAFactoryPairsHandler {
  constructor(IDCAGlobalParameters _globalParameters) DCAFactoryPairsHandler(_globalParameters) {}
}
