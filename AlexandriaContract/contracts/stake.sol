// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./library.sol";
import "./token.sol";
interface IAlexandriaPayment {
    function notifyStakeChange(address librarian) external;
    function distributeUploadReward(string memory arweaveHash) external;
}

/// @title AlexandriaStake - Manages staking of ALEX tokens for upload validation and dispute resolution in the Alexandria ecosystem.
contract AlexandriaStake is Ownable, Pausable, ReentrancyGuard {
    AlexandriaLibrary public libraryContract;
    AlexandriaToken public tokenContract;
    IAlexandriaPayment public paymentContract;

    uint256 public totalLibrarianStake;

    // Staking parameters
    uint256 public constant MIN_STAKE = 100 * 10 ** 18; // Minimum stake of 100 ALEX
    uint256 public constant CHALLENGE_PERIOD = 14 days; // Time window for challenges after an upload is registered
    uint256 public constant MIN_LIBRARIAN_STAKE = 50 * 10 ** 18; // Minimum stake of 50 ALEX to become librarian
    uint256 public constant LIBRARIAN_COOLDOWN = 30 days; // Cooldown period before librarian can unstake

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

    // Librarian staking
    struct LibrarianInfo {
        uint256 amount;
        uint256 timestamp; // When they staked
        bool active;
    }
    mapping(address => LibrarianInfo) public librarians;


    // Events
    event Staked(string indexed arweaveHash, address indexed staker, uint256 amount);
    event Unstaked(string indexed arweaveHash, address indexed staker, uint256 amount);
    event ChallengeResolved(string indexed arweaveHash, bool approved);
    event slashed(string indexed arweaveHash, address indexed staker, uint256 amount);
    event challengeInitiated(string indexed arweaveHash, address indexed challenger);
    event LibrarianStaked(address indexed librarian, uint256 amount);
    event LibrarianUnstaked(address indexed librarian, uint256 amount);
    event LibrarianSlashed(address indexed librarian, uint256 amount, address indexed archivist);

    constructor(address _libraryAddress, address _tokenAddress) Ownable(msg.sender) {
        libraryContract = AlexandriaLibrary(_libraryAddress);
        tokenContract = AlexandriaToken(_tokenAddress);
    }

    function setPaymentContract(address _paymentContract) external onlyOwner {
        require(_paymentContract != address(0), "Zero address");
        paymentContract = IAlexandriaPayment(_paymentContract);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function getLibrarianStake(address librarian) external view returns (uint256) {
        return librarians[librarian].amount;
    }

    function stake(string memory arweaveHash, uint256 amount) external whenNotPaused nonReentrant {
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

    function unstake(string memory arweaveHash) external whenNotPaused nonReentrant {
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

        if (address(paymentContract) != address(0)) {
            paymentContract.distributeUploadReward(arweaveHash);
        }

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
    function stakeAsLibrarian(uint256 amount) external whenNotPaused nonReentrant {
        require(amount >= MIN_LIBRARIAN_STAKE, "Librarian stake too low");
        require(!librarians[msg.sender].active, "Already staked as librarian");

        tokenContract.transferFrom(msg.sender, address(this), amount);

        // Snapshot earnings at current rate before stake changes
        if (address(paymentContract) != address(0)) {
            paymentContract.notifyStakeChange(msg.sender);
        }

        librarians[msg.sender] = LibrarianInfo({
            amount: amount,
            timestamp: block.timestamp,
            active: true
        });

        totalLibrarianStake += amount;

        emit LibrarianStaked(msg.sender, amount);
    }

    function unstakeAsLibrarian() external whenNotPaused nonReentrant {
        LibrarianInfo storage info = librarians[msg.sender];
        require(info.active, "Not an active librarian");
        require(block.timestamp >= info.timestamp + LIBRARIAN_COOLDOWN, "Cooldown period not over");

        // Snapshot earnings at current rate before stake changes
        if (address(paymentContract) != address(0)) {
            paymentContract.notifyStakeChange(msg.sender);
        }

        info.active = false;
        uint256 amount = info.amount;
        info.amount = 0;

        totalLibrarianStake -= amount;

        tokenContract.transfer(msg.sender, amount);

        emit LibrarianUnstaked(msg.sender, amount);
    }

    function challengeUpload(string memory arweaveHash, string memory reason) external whenNotPaused {
        require(librarians[msg.sender].active, "Not an active librarian");
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
    function resolveChallenge(string memory arweaveHash, bool approved) external onlyOwner whenNotPaused nonReentrant {
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

            // Slash librarian 50% for wrong challenge, give to archivist
            LibrarianInfo storage libInfo = librarians[challenge.challenger];
            uint256 slashAmount = libInfo.amount / 2;

            // Snapshot earnings before stake is reduced
            if (address(paymentContract) != address(0)) {
                paymentContract.notifyStakeChange(challenge.challenger);
            }

            libInfo.amount -= slashAmount;
            totalLibrarianStake -= slashAmount;
            tokenContract.transfer(stakeInfo.staker, slashAmount);
            emit LibrarianSlashed(challenge.challenger, slashAmount, stakeInfo.staker);
        } else {
            // Upload is invalid — slash the stake and also blacklist the user from uploading
            //need to write logic for blacklisting in library.sol and call it here as well
            slashStake(arweaveHash);
        }

        emit ChallengeResolved(arweaveHash, approved);
    }
}