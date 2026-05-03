// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./library.sol";
import "./token.sol";

// This contract is the on-chain permission registry for Alexandria rentals.
// It does NOT handle PDF files or encryption — those are managed off-chain via Arweave and Lit Protocol.
// Lit Protocol calls isRentalActive() on this contract before releasing a book's decryption key to a renter.

// The contract will need to:
// - Allow users (not archivists) to rent a book for a fixed duration: 24h, 7d, or 30d (no extensions)
// - Accept payment in ALEX tokens at a per-book price set by the archivist
// - Record rental permissions: arweaveHash → renter address → expiry timestamp
// - Expose isRentalActive(arweaveHash, renter) → bool for Lit Protocol to query
// - Only allow rentals on Approved uploads (checked via AlexandriaLibrary)
// - Support blacklisting addresses caught leaking decrypted content
// - Support delisting: block new rentals on a hash while honouring existing ones until expiry
// - Forward rental payments to payment.sol for revenue splitting (70% archivist / 20% treasury / 10% librarian pool)

// This contract will need references to: AlexandriaToken, AlexandriaLibrary, and eventually payment.sol

contract AlexandriaRent is Ownable, Pausable {

    AlexandriaLibrary public libraryContract;
    AlexandriaToken public tokenContract;

    // Valid rental durations
    uint256 public constant DURATION_1DAY = 1 days;
    uint256 public constant DURATION_7DAY = 7 days;
    uint256 public constant DURATION_30DAY = 30 days;

    // arweaveHash → renter address → expiry timestamp
    // Supports multiple renters per book simultaneously
    mapping(string => mapping(address => uint256)) public rentals;

    // Archivist-set price per book in ALEX tokens
    mapping(string => uint256) public bookPrices;

    // Addresses banned from renting (caught leaking)
    mapping(address => bool) public blacklisted;

    // Books blocked from new rentals (existing rentals still honoured)
    mapping(string => bool) public delisted;

    // Events
    event BookRented(string indexed arweaveHash, address indexed renter, uint256 expiry, uint256 duration);
    event BookPriceSet(string indexed arweaveHash, uint256 price);
    event AddressBlacklisted(address indexed renter);
    event BookDelisted(string indexed arweaveHash);

    constructor(address _libraryAddress, address _tokenAddress) Ownable(msg.sender) {
        libraryContract = AlexandriaLibrary(_libraryAddress);
        tokenContract = AlexandriaToken(_tokenAddress);
    }

    function isRentalActive(string memory arweaveHash, address renter) public view whenNotPaused returns (bool) {
         return rentals[arweaveHash][renter] > block.timestamp && !blacklisted[renter];
    }

    function setBookPrice(string memory arweaveHash, uint256 price) external whenNotPaused {
        require(libraryContract.getUploader(arweaveHash) == msg.sender, "Not the Archivist");
        require(libraryContract.getUploadStatus(arweaveHash) == AlexandriaLibrary.UploadStatus.Approved, "Book is not approved");
        require(price > 0, "Price must be greater than 0");


        bookPrices[arweaveHash] = price;

        emit BookPriceSet(arweaveHash, price);
    }

    function rentBook(string memory arweaveHash, uint256 duration) external whenNotPaused {
        require(!blacklisted[msg.sender], "Address is blacklisted");
        require(libraryContract.getUploader(arweaveHash) != msg.sender, "Archivist cannot rent own book");
        require(!delisted[arweaveHash], "Book delisted");
        require(libraryContract.getUploadStatus(arweaveHash) == AlexandriaLibrary.UploadStatus.Approved, "Book not approved");
        require(bookPrices[arweaveHash] > 0, "Book has no price set");
        require(duration == DURATION_1DAY || duration == DURATION_7DAY || duration == DURATION_30DAY, "Invalid rental duration");
        require(rentals[arweaveHash][msg.sender] <= block.timestamp, "Active rental already exists");

        // Daily rate: bookPrices stores price per day, multiply by number of days
        uint256 daysCount = duration / 1 days;
        uint256 totalPrice = bookPrices[arweaveHash] * daysCount;

        // Collect payment — held by contract until payment.sol handles splitting
        tokenContract.transferFrom(msg.sender, address(this), totalPrice);

        uint256 expiry = block.timestamp + duration;
        rentals[arweaveHash][msg.sender] = expiry;

        emit BookRented(arweaveHash, msg.sender, expiry, duration);
    }

    function blacklistAddress(address renter) external onlyOwner {
        require(renter != address(0), "Invalid address");
        require(!blacklisted[renter], "Already blacklisted");

        blacklisted[renter] = true;

        emit AddressBlacklisted(renter);
    }

    function delistBook(string memory arweaveHash) external onlyOwner {
        require(libraryContract.uploadExists(arweaveHash), "Book not found");
        require(!delisted[arweaveHash], "Already delisted");

        delisted[arweaveHash] = true;

        emit BookDelisted(arweaveHash);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}

