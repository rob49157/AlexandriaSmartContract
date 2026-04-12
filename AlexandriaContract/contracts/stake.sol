// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./library.sol";
import "./token.sol";
/// @title AlexandriaStake - Manages staking of ALEX tokens for upload validation and dispute resolution in the Alexandria ecosystem.
contract AlexandriaStake is Ownable {
    AlexandriaLibrary public libraryContract;
    AlexandriaToken public tokenContract;

    // Staking parameters
    uint256 public constant MIN_STAKE = 100 * 10 ** 18; // Minimum stake of 100 ALEX
    uint256 public constant CHALLENGE_PERIOD = 14 days; // Time window for challenges after an upload is registered

    // Mapping of arweaveHash to staker's address and amount
    struct StakeInfo {
        address staker;
        uint256 amount;
        uint256 timestamp; // When the stake was made
        bool active; // Whether the stake is currently active
    }
    mapping(string => StakeInfo) public stakes;

    struct Challenger {
        address challenger;
        uint256 timestamp; // When the challenge was initiated
        bool resolved; // Whether the challenge has been resolved
    }
    mapping (string => Challenger) public challenges;

    // Whitelisted librarians who can challenge uploads
    mapping(address => bool) public authorizedLibrarians;


    // Events
    event Staked(string indexed arweaveHash, address indexed staker, uint256 amount);
    event Unstaked(string indexed arweaveHash, address indexed staker, uint256 amount);
    event ChallengeResolved(string indexed arweaveHash, bool approved);
    event slashed(string indexed arweaveHash, address indexed staker, uint256 amount);
    event challengeInitiated(string indexed arweaveHash, address indexed challenger);

    constructor(address _libraryAddress, address _tokenAddress) Ownable(msg.sender) {
        libraryContract = AlexandriaLibrary(_libraryAddress);
        tokenContract = AlexandriaToken(_tokenAddress);
    }

    function stake(string memory arweaveHash, uint256 amount) external {
        require(amount >= MIN_STAKE, "Stake amount too low");
        require(libraryContract.uploadExists(arweaveHash), "Upload not found");
        require(stakes[arweaveHash].active == false, "Already staked");

        // Transfer tokens from staker to this contract
        tokenContract.transferFrom(msg.sender, address(this), amount);

        // Record the stake
        stakes[arweaveHash] = StakeInfo({
            staker: msg.sender,
            amount: amount,
            timestamp: block.timestamp,
            active: true
        });

        emit Staked(arweaveHash, msg.sender, amount);
    }

    function unstake( string memory arweaveHash)external{
        StakeInfo storage stakeInfo = stakes[arweaveHash];
        require(stakeInfo.active, "No active stake");
        require(stakeInfo.staker == _msgSender(), "Not staker");
        require(block.timestamp >= stakeInfo.timestamp + CHALLENGE_PERIOD, "Challenge period not over");
        require(libraryContract.getUploadStatus(arweaveHash) != AlexandriaLibrary.UploadStatus.Challenged, "Upload is challenged");
        require(libraryContract.getUploadStatus(arweaveHash) != AlexandriaLibrary.UploadStatus.Rejected, "Upload was rejected");
        

        // Mark stake as inactive before transferring to prevent reentrancy
        stakeInfo.active = false;

        // Mark upload as Approved in library
        libraryContract.updateUploadStatus(arweaveHash, AlexandriaLibrary.UploadStatus.Approved);

        // Transfer tokens back to staker
        tokenContract.transfer(stakeInfo.staker, stakeInfo.amount);

        emit Unstaked(arweaveHash, stakeInfo.staker, stakeInfo.amount);
    }
    function slashStake(string memory arweaveHash) internal {
        StakeInfo storage stakeInfo = stakes[arweaveHash];
        Challenger storage challenge = challenges[arweaveHash];

        // Mark stake as inactive before transfers
        stakeInfo.active = false;

        // Calculate split: 70% to challenger, 30% burned
        uint256 challengerReward = (stakeInfo.amount * 70) / 100;
        uint256 burnAmount = stakeInfo.amount - challengerReward;

        // Update library status to Rejected
        libraryContract.updateUploadStatus(arweaveHash, AlexandriaLibrary.UploadStatus.Rejected);

        // Pay challenger
        tokenContract.transfer(challenge.challenger, challengerReward);

        // Burn the rest
        tokenContract.burn(burnAmount);

        emit slashed(arweaveHash, stakeInfo.staker, stakeInfo.amount);
    }
    function setAuthorizedLibrarian(address librarian, bool authorized) external onlyOwner {
        authorizedLibrarians[librarian] = authorized;
    }

    function challengeUpload(string memory arweaveHash, string memory reason) external {
        require(authorizedLibrarians[msg.sender], "Not an authorized librarian");
        require(stakes[arweaveHash].active, "No active stake");
        require(stakes[arweaveHash].staker != msg.sender, "Cannot challenge own upload");
        require(block.timestamp < stakes[arweaveHash].timestamp + CHALLENGE_PERIOD, "Challenge period expired");
        require(libraryContract.getUploadStatus(arweaveHash) == AlexandriaLibrary.UploadStatus.Pending, "Upload not in pending status");
        require(challenges[arweaveHash].challenger == address(0), "Already challenged");

        challenges[arweaveHash] = Challenger({
            challenger: msg.sender,
            timestamp: block.timestamp,
            resolved: false
        });

        // Update library status to Challenged
        libraryContract.updateUploadStatus(arweaveHash, AlexandriaLibrary.UploadStatus.Challenged);

        emit challengeInitiated(arweaveHash, msg.sender);
    }
    function resolveChallenge(string memory arweaveHash, bool approved) external onlyOwner {
        Challenger storage challenge = challenges[arweaveHash];
        StakeInfo storage stakeInfo = stakes[arweaveHash];

        require(challenge.challenger != address(0), "No challenge exists");
        require(!challenge.resolved, "Challenge already resolved");
        require(stakeInfo.active, "No active stake");

        challenge.resolved = true;

        if (approved) {
            // Upload is valid — return stake to archivist
            stakeInfo.active = false;
            libraryContract.updateUploadStatus(arweaveHash, AlexandriaLibrary.UploadStatus.Approved);
            tokenContract.transfer(stakeInfo.staker, stakeInfo.amount);
            emit Unstaked(arweaveHash, stakeInfo.staker, stakeInfo.amount);
        } else {
            // Upload is invalid — slash the stake
            slashStake(arweaveHash);
        }

        emit ChallengeResolved(arweaveHash, approved);
    }
}