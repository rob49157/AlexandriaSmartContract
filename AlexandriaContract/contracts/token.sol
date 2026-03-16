// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
/// @title AlexandriaToken - A standard ERC20 token with burnable and pausable features, owned by the deployer.
contract AlexandriaToken is ERC20, ERC20Burnable, Ownable, Pausable {

    // 1 billion tokens with 18 decimals
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 10 ** 18;

    // mint the total supply to the deployer (owner) at contract creation
    constructor() ERC20("Alexandria", "ALEX") Ownable(msg.sender) {
        _mint(msg.sender, TOTAL_SUPPLY);
    }


    // Owner can pause all token transfers in case of emergency, basescan.
    function pause() external onlyOwner {
        _pause();
    }
    // Owner can unpause token transfers when the emergency is resolved.
    function unpause() external onlyOwner {
        _unpause();
    }

    // Override to enforce pause on all transfers
    function _update(address from, address to, uint256 value) internal override whenNotPaused {
        super._update(from, to, value);
    }
}
