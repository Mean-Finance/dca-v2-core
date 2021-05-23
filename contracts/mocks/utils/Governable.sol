// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import '../../utils/Governable.sol';

contract GovernableMock is Governable {
  constructor(address _governor) Governable(_governor) {}

  function onlyGovernorAllowed() external onlyGovernor {}

  function onlyPendingGovernorAllowed() external onlyPendingGovernor {}

  function setPendingGovernorInternal(address _pendingGovernor) external {
    _setPendingGovernor(_pendingGovernor);
  }

  function acceptPendingGovernorInternal() external {
    _acceptPendingGovernor();
  }
}