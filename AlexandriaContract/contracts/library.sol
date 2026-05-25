// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title AlexandriaLibrary - Central registry for all uploads to Alexandria
contract AlexandriaLibrary is Ownable, Pausable {

    // Upload validation states
    enum UploadStatus { Pending, Challenged, Approved, Rejected }

    // Metadata for each upload
    struct Upload {
        string arweaveHash;     // Arweave transaction ID (43-char Base64URL)
        address uploader;       // Archivist who uploaded the content
        uint256 timestamp;      // Block timestamp when registered
        UploadStatus status;    // Current validation state
        string metadata;        // Title, author, or other descriptive info
    }

    // arweaveHash => Upload details
    mapping(string => Upload) private uploads;

    // uploader address => list of their arweave hashes
    mapping(address => string[]) private uploaderHashes;

    // Authorized contract addresses that can register or update uploads
    mapping(address => bool) public authorizedCallers;

    // Events
    event UploadRegistered(string indexed arweaveHash, address indexed uploader, string metadata);
    event UploadStatusChanged(string indexed arweaveHash, UploadStatus oldStatus, UploadStatus newStatus);
    event AuthorizedCallerSet(address indexed caller, bool authorized);

    // Modifiers, only allow owner or authorized contracts to call certain functions
    modifier onlyAuthorized() {
        require(authorizedCallers[msg.sender] || msg.sender == owner(), "Not authorized");
        _;
    }

    constructor() Ownable(msg.sender) {}

    // --- Admin Functions ---

    // Owner adds/removes authorized callers (backend, stake contract, etc.)
    
    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerSet(caller, authorized);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // --- Core Functions ---

    // Register a new upload after it has been stored on Arweave. This contract is being called by the backend after successful upload to Arweave and initial validation.
    function registerUpload(string calldata arweaveHash, address uploader, string calldata metadata) external onlyAuthorized whenNotPaused {
        // check to make sure arweaveHash is not empty
        require(bytes(arweaveHash).length > 0, "Empty arweave hash");
        // check to make sure uploader is not zero address
        require(uploader != address(0), "Invalid uploader address");
        //check if upload already exists
        require(uploads[arweaveHash].timestamp == 0, "Upload already registered");
        // we pass the metadata in the struct
        uploads[arweaveHash] = Upload({
            arweaveHash: arweaveHash,
            uploader: uploader,
            timestamp: block.timestamp,
            status: UploadStatus.Pending,
            metadata: metadata
        });

        // we also keep track of all uploads by an uploader, so we can easily query them later. Might remove this since we are using MongoDB to index the uploads and we can just query by uploader there, but it doesn't hurt to have it on chain as well for easy retrieval without needing to query the database
        uploaderHashes[uploader].push(arweaveHash);
        // we emit the metadata in the event for easier indexing and retrieval by the frontend, since we won't be able to read the metadata from the contract directly without a lot of gas
        emit UploadRegistered(arweaveHash, uploader, metadata);
    }

    // Update upload status (called by stake contract during challenge/resolution)
    function updateUploadStatus(string calldata arweaveHash, UploadStatus newStatus) external onlyAuthorized whenNotPaused {
        // check if upload already exists
        require(uploads[arweaveHash].timestamp != 0, "Upload not found");

        UploadStatus oldStatus = uploads[arweaveHash].status;
        // require that the status is actually changing
        require(oldStatus != newStatus, "Status unchanged");

        uploads[arweaveHash].status = newStatus;
        // emit to the front end with the upload hash and the new status, so the front end can update the UI accordingly
        emit UploadStatusChanged(arweaveHash, oldStatus, newStatus);
    }

    // --- View Functions ---

    // Get full upload details
    function getUpload(string calldata arweaveHash) external view returns (Upload memory) {
        require(uploads[arweaveHash].timestamp != 0, "Upload not found");
        return uploads[arweaveHash];
    }

    // Get upload status only
    function getUploadStatus(string calldata arweaveHash) external view returns (UploadStatus) {
        require(uploads[arweaveHash].timestamp != 0, "Upload not found");
        return uploads[arweaveHash].status;
    }

    // Get the uploader address for an upload
    function getUploader(string calldata arweaveHash) external view returns (address) {
        require(uploads[arweaveHash].timestamp != 0, "Upload not found");
        return uploads[arweaveHash].uploader;
    }

    // Check if an upload exists
    function uploadExists(string calldata arweaveHash) external view returns (bool) {
        return uploads[arweaveHash].timestamp != 0;
    }

    // Get all arweave hashes uploaded by an address
    function getUploaderHashes(address uploader) external view returns (string[] memory) {
        return uploaderHashes[uploader];
    }
}
