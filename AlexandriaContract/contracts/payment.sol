// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./library.sol";
import "./token.sol";
import "./stake.sol";

// This contract handles all revenue distribution for the Alexandria protocol.
// It is the only contract that splits and disburses ALEX tokens to archivists, librarians, and the treasury.
// Rent.sol and Stake.sol forward payments here — neither pays out directly.

// Payment splits:
// - Rental revenue:  70% archivist / 20% treasury / 10% librarian pool
// - Upload reward:   50 ALEX fixed per valid upload (paid from treasury)
// - Slash (archivist stake rejected): 70% challenger / 30% burned
// - Wrong challenge (librarian slashed): 50% to archivist / 50% stays with librarian

// Design: pull pattern — rewards accumulate in mappings, recipients claim when ready (not pushed automatically)

contract AlexandriaPayment is Ownable, Pausable, ReentrancyGuard {

    AlexandriaLibrary public libraryContract;
    AlexandriaToken public tokenContract;
    AlexandriaStake public stakeContract;

    // Authorized contracts that can trigger payment distribution (Rent.sol, Stake.sol)
    mapping(address => bool) public authorizedCallers;

    // Revenue split constants
    uint256 public constant ARCHIVIST_SHARE = 70;
    uint256 public constant TREASURY_SHARE = 20;
    uint256 public constant LIBRARIAN_POOL_SHARE = 10;
    uint256 public constant UPLOAD_REWARD = 50 * 10 ** 18; // 50 ALEX fixed per valid upload

    // Treasury address (receives protocol fees)
    address public treasury;

    // Archivist pending rewards (pull pattern)
    mapping(address => uint256) public pendingArchivistRewards;

    // Tracks whether the upload reward has been paid out for a given arweaveHash
    mapping(string => bool) public uploadRewardClaimed;

    // Librarian reward accounting — rewards-per-token-staked pattern (Synthetix-style)
    // rewardPerTokenStored grows each time rental revenue is distributed.
    // Each librarian's share = their stake × (rewardPerTokenStored − their last snapshot rate).
    uint256 public rewardPerTokenStored;                        // scaled by 1e18 for precision
    mapping(address => uint256) public userRewardPerTokenPaid;  // rate at last snapshot per librarian
    mapping(address => uint256) public librarianEarned;         // accumulated unclaimed rewards

    // Events
    event RentalPaymentProcessed(string indexed arweaveHash, address indexed renter, uint256 amount);
    event UploadRewardDistributed(string indexed arweaveHash, address indexed archivist, uint256 amount);
    event RewardClaimed(address indexed recipient, uint256 amount);
    event AuthorizedCallerSet(address indexed caller, bool authorized);

    constructor(address _libraryAddress, address _tokenAddress, address _treasury) Ownable(msg.sender) {
        libraryContract = AlexandriaLibrary(_libraryAddress);
        tokenContract = AlexandriaToken(_tokenAddress);
        treasury = _treasury;
    }

    // --- Access Control ---

    modifier onlyAuthorized() {
        require(authorizedCallers[msg.sender], "Not authorized");
        _;
    }

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        require(caller != address(0), "Zero address");
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerSet(caller, authorized);
    }

    // --- Librarian Reward Accounting ---

    // Grows the global reward rate when new rental revenue arrives.
    // If no librarians are staked, the librarian share falls back to treasury.
    function _updateRewardRate(uint256 newRewards) internal {
        if (address(stakeContract) == address(0)) {
            tokenContract.transfer(treasury, newRewards);
            return;
        }
        uint256 totalStake = stakeContract.totalLibrarianStake();
        if (totalStake == 0) {
            tokenContract.transfer(treasury, newRewards);
            return;
        }
        rewardPerTokenStored += (newRewards * 1e18) / totalStake;
    }

    // Returns how much a librarian has earned since their last snapshot.
    function earned(address librarian) public view returns (uint256) {
        if (address(stakeContract) == address(0)) return librarianEarned[librarian];
        uint256 stake = stakeContract.getLibrarianStake(librarian);
        return (stake * (rewardPerTokenStored - userRewardPerTokenPaid[librarian])) / 1e18
               + librarianEarned[librarian];
    }

    function _snapshotRewards(address librarian) private {
        librarianEarned[librarian] = earned(librarian);
        userRewardPerTokenPaid[librarian] = rewardPerTokenStored;
    }

    // Snapshots latest earned rewards before claiming — ensures no rewards are missed
    // between the last stake change and the claim.
    modifier updateReward(address librarian) {
        if (address(stakeContract) != address(0)) {
            _snapshotRewards(librarian);
        }
        _;
    }

    // Called by stake.sol before any librarian stake change (stake / unstake / slash).
    // Locks in the librarian's earnings at the current rate before their share of
    // totalLibrarianStake changes and would distort future calculations.
    function notifyStakeChange(address librarian) external {
        require(msg.sender == address(stakeContract), "Not stake contract");
        _snapshotRewards(librarian);
    }

    // --- Core Distribution Functions ---

    // Called by Rent.sol when a user rents a book.
    // Renter must have approved this contract to spend `amount` tokens before Rent.sol calls this.
    function processRentalPayment(string memory arweaveHash, address renter, uint256 amount)
        external onlyAuthorized whenNotPaused
    {
        require(amount > 0, "Zero amount");

        address archivist = libraryContract.getUploader(arweaveHash);

        uint256 archivistAmount = (amount * ARCHIVIST_SHARE) / 100;
        uint256 librarianAmount = (amount * LIBRARIAN_POOL_SHARE) / 100;
        // Remainder absorbs rounding dust — goes to treasury
        uint256 treasuryAmount = amount - archivistAmount - librarianAmount;

        tokenContract.transferFrom(renter, address(this), amount);

        pendingArchivistRewards[archivist] += archivistAmount;
        _updateRewardRate(librarianAmount);
        tokenContract.transfer(treasury, treasuryAmount);

        emit RentalPaymentProcessed(arweaveHash, renter, amount);
    }

    // Called by Stake.sol when unstake() succeeds (valid upload approved after 14 days).
    // Treasury must have approved this contract to spend UPLOAD_REWARD on its behalf.
    function distributeUploadReward(string memory arweaveHash)
        external onlyAuthorized whenNotPaused
    {
        require(!uploadRewardClaimed[arweaveHash], "Reward already claimed");

        address archivist = libraryContract.getUploader(arweaveHash);

        uploadRewardClaimed[arweaveHash] = true;
        tokenContract.transferFrom(treasury, archivist, UPLOAD_REWARD);

        emit UploadRewardDistributed(arweaveHash, archivist, UPLOAD_REWARD);
    }

    // Slash distribution is handled directly in stake.sol (slashStake / resolveChallenge).
    // No distributeSlashReward needed here.

    // --- Claim Functions (Pull Pattern) ---

    function claimArchivistRewards() external nonReentrant whenNotPaused {
        uint256 amount = pendingArchivistRewards[msg.sender];
        require(amount > 0, "Nothing to claim");

        pendingArchivistRewards[msg.sender] = 0;
        tokenContract.transfer(msg.sender, amount);

        emit RewardClaimed(msg.sender, amount);
    }

    function claimLibrarianRewards() external nonReentrant whenNotPaused updateReward(msg.sender) {
        uint256 amount = librarianEarned[msg.sender];
        require(amount > 0, "Nothing to claim");

        librarianEarned[msg.sender] = 0;
        tokenContract.transfer(msg.sender, amount);

        emit RewardClaimed(msg.sender, amount);
    }

    // --- Admin Functions ---

    function setStakeContract(address _stakeContract) external onlyOwner {
        require(_stakeContract != address(0), "Zero address");
        stakeContract = AlexandriaStake(_stakeContract);
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Zero address");
        treasury = _treasury;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
