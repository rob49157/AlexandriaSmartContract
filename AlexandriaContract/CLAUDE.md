# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context: Alexandria Smart Contracts

This repository contains the **smart contract layer** for Alexandria, a decentralized, censorship-resistant Web3 library designed to preserve human knowledge permanently on Arweave.

### Alexandria System Architecture (Full Stack)
While this repo only contains smart contracts, understanding the full system helps with design decisions:
- **Frontend:** React + Vite (user dashboard, in-browser PDF decryption)
- **Backend Gateway:** Node.js + Express (upload orchestration, Lit Protocol encryption, Arweave indexing)
- **AI Validation:** Python + FastAPI (PDF validation, SimHash duplicate detection, malware scanning)
- **Blockchain (THIS REPO):** Base Testnet / Solidity (handles $ALEX token, archivist staking, time-bound rental permissions)
- **Storage:** Arweave via Irys (permanent encrypted file storage) + MongoDB (off-chain search indexing)

### Smart Contract Responsibilities
The contracts in this repo handle:
- **Token Economics:** $ALEX token for payments and staking
- **Upload Staking & Validation:** 14-day staking period with librarian review
- **Rental System:** Time-bound access permissions to encrypted PDFs (the "rental permission slip")
- **Payment Distribution:** Rewards for valid uploads and rental revenue sharing

**Critical:** Smart contracts NEVER handle PDF files directly. They only manage permissions, staking, and payments. The frontend fetches encrypted files from Arweave and decrypts them locally using Lit Protocol.

## Upload & Staking Mechanism

### The 14-Day Validation Period

When an archivist uploads a book to Alexandria, they must stake $ALEX tokens as a quality assurance bond:

```
Upload Flow:
1. Archivist uploads PDF → Backend runs initial checks (SHA-256, ClamAV, SimHash)
2. File encrypted with Lit Protocol → Stored on Arweave
3. Archivist stakes $ALEX tokens → Smart contract locks stake for 14 days
4. Librarians review if AI/automated checks raise red flags
5. After 14 days:
   ✅ Valid upload → Archivist gets stake back + upload reward
   ❌ Invalid/malicious → Stake slashed, file delisted
```

### Key Contract Requirements

**Stake Contract (`stake.sol`):**
- `stakeForUpload(arweaveHash, amount)` - Lock tokens when upload occurs
- `getStakeStatus(arweaveHash)` - Check stake state (active/challenged/released)
- `releaseStake(arweaveHash)` - After 14 days, return stake + reward if valid
- `slashStake(arweaveHash)` - Penalize invalid uploads, redistribute slashed tokens

**Validation States:**
1. **Pending** (Days 0-14): Stake locked, librarians can review
2. **Challenged** (If flagged): Librarian review required before day 14
3. **Approved**: Stake released + reward paid to archivist
4. **Rejected**: Stake slashed, tokens burned or redistributed to librarians

**Time Constraints:**
- Minimum stake period: 14 days (enforced via `block.timestamp`)
- Challenge window: Days 1-14 (librarians can flag suspicious uploads)
- Auto-approval: If no challenges by day 14, upload automatically approved

### Payment Distribution (RESOLVED)

**For Valid Uploads:**
- Archivist receives: Staked tokens (100 ALEX) + upload reward (50 ALEX fixed, from treasury)
- Reward is for contributing valid content, regardless of rental count

**For Rental Revenue:**
- Each rental payment gets split:
  - 70% to archivist who uploaded the book
  - 20% to protocol treasury
  - 10% to librarian reward pool

**For Rejected Uploads:**
- Slashed stake gets redistributed:
  - 70% to librarian who flagged the invalid upload
  - 30% burned (deflationary — no treasury cut on slashes)

### Librarian Role

Librarians are incentivized validators who:
- Review uploads flagged by automated checks
- Can challenge suspicious uploads during the 14-day window
- Earn rewards from:
  - Slashed stakes (when they correctly identify bad uploads)
  - Share of rental revenue pool
  - Potentially their own staking rewards for active participation

**Key Functions Needed:**
- `challengeUpload(arweaveHash, reason)` - Librarian flags suspicious content
- `resolveChallenge(arweaveHash, approved)` - Admin/DAO resolves disputed uploads
- `claimLibrarianRewards()` - Librarians withdraw accumulated rewards

## Environment & Tooling

- **Global Installs Blocked:** Always use `npx` for CLI tools (e.g., `npx hardhat test`)
- **Node Environment:** Managed via `nvm`. Use Node v18+ for Web3 library compatibility
- **Solidity Version:** `^0.8.28` (defined in hardhat.config.js)
- **Testing Framework:** Hardhat with ethers.js, Mocha, and Chai
- **Deployment:** Hardhat Ignition (not traditional deployment scripts)

## Development Commands

### Core Workflow
```bash
# Compile contracts
npx hardhat compile

# Run all tests
npx hardhat test

# Run tests with gas reporting
REPORT_GAS=true npx hardhat test

# Run specific test file
npx hardhat test test/Lock.js

# Start local Hardhat node
npx hardhat node

# Deploy using Hardhat Ignition (local)
npx hardhat ignition deploy ./ignition/modules/Lock.js

# Deploy to specific network
npx hardhat ignition deploy ./ignition/modules/Lock.js --network <network-name>

# Clean build artifacts
npx hardhat clean

# View all available tasks
npx hardhat help
```

## Project Structure

```
contracts/              # Solidity smart contracts
├── token.sol          # AlexandriaToken - $ALEX ERC20 (COMPLETE)
├── library.sol        # AlexandriaLibrary - Upload registry (COMPLETE)
├── stake.sol          # Upload staking & validation (TODO)
├── Rent.sol           # Rental permissions for Lit Protocol (TODO)
└── payment.sol        # Payment splits & reward claims (TODO)

test/                  # JavaScript test files (Mocha/Chai)
├── Token.test.js      # 17 tests passing
├── Library.test.js    # 30 tests passing
ignition/modules/      # Hardhat Ignition deployment modules
hardhat.config.js      # Hardhat configuration
checklist.md           # Full project checklist with resolved design decisions
```

### Contract Responsibilities Breakdown

**token.sol** - `AlexandriaToken` (COMPLETE)
- ERC20 + ERC20Burnable + Ownable + Pausable
- 1 billion ALEX fixed supply, all minted to deployer at deploy
- No minting — fixed cap. Burnable for slash deflationary mechanic
- Owner can pause/unpause all transfers in emergencies
- Ownership transferable (for future multisig migration)

**library.sol** - `AlexandriaLibrary` (COMPLETE)
- Central registry mapping Arweave hashes to Upload structs (uploader, timestamp, status, metadata)
- UploadStatus enum: Pending, Challenged, Approved, Rejected
- `registerUpload()` called by authorized backend after Arweave storage
- `updateUploadStatus()` called by stake contract during challenge/resolution
- Authorized caller system (owner + whitelisted contracts)
- Ownable + Pausable
- Emits events for MongoDB indexer: UploadRegistered, UploadStatusChanged

**stake.sol** - Upload validation staking (NOT YET BUILT)
- Locks archivist stakes (min 100 ALEX) for 14 days per upload
- Manages challenge submissions from whitelisted librarians
- Handles stake release (success) or slashing (rejection)
- Slashed stakes: 70% to challenger, 30% burned
- One challenger per upload, hard 14-day cutoff
- Archivist cannot challenge own uploads
- Anyone can call releaseStake after 14 days (permissionless auto-approval)
- Time-based state transitions (pending → approved/rejected)

**Rent.sol** - Rental access control (NOT YET BUILT)
- Records time-bound rental permissions (arweaveHash → renter → expirationTime)
- Archivist-set pricing in ALEX, three fixed durations: 24h, 7d, 30d
- No rental extensions — must create new rental after expiry
- Validates active rentals for Lit Protocol integration via `isRentalActive()`
- Blacklist support for addresses caught leaking
- Delisting prevents new rentals but honors existing ones until expiry

**payment.sol** - Revenue distribution (NOT YET BUILT)
- Rental revenue split: 70% archivist / 20% treasury / 10% librarian pool
- Upload reward: 50 ALEX fixed per valid upload (from treasury)
- Slash distribution: 70% challenger / 30% burned
- Pull pattern for reward claims (not push)
- Treasury management for protocol fees

## Testing Patterns

Tests use the **loadFixture pattern** for efficient state management:

```javascript
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");

describe("ContractName", function () {
  async function deployFixture() {
    const [owner, user1, user2] = await ethers.getSigners();
    const Contract = await ethers.getContractFactory("ContractName");
    const contract = await Contract.deploy();
    return { contract, owner, user1, user2 };
  }

  it("should perform expected behavior", async function () {
    const { contract, owner } = await loadFixture(deployFixture);
    expect(await contract.someFunction()).to.equal(expectedValue);
  });
});
```

Available helpers:
- `time.increaseTo(timestamp)` - Fast-forward blockchain time
- `time.latest()` - Get current block timestamp
- `expect(...).to.be.revertedWith("Error message")` - Test for reverts
- `expect(...).to.emit(contract, "EventName")` - Test event emissions
- `expect(...).to.changeEtherBalances([addr1, addr2], [amount1, amount2])` - Test balance changes

## Solidity Conventions

- **Pragma:** Use `pragma solidity ^0.8.28`
- **Error Handling:** Use descriptive error messages in `require()` statements for the PoC (gas savings over custom errors for now)
- **Development Approach:** Contract-Driven Development - finalize contract interfaces before frontend integration
- **Debugging:** Import `hardhat/console.sol` and use `console.log()` for debugging (comment out before production)

## Deployment with Hardhat Ignition

Create deployment modules in `ignition/modules/`:

```javascript
const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("ModuleName", (m) => {
  // Define parameters with defaults
  const param = m.getParameter("paramName", defaultValue);

  // Deploy contract
  const contract = m.contract("ContractName", [constructorArgs], {
    value: ethValue, // optional
  });

  return { contract };
});
```

## Critical Design Constraints

### Separation of Concerns
- **Smart contracts handle:** Access permissions, payments, staking, token economics
- **Smart contracts DO NOT handle:** PDF files, encryption, storage, duplicate detection
- **Off-chain systems handle:** File storage (Arweave), encryption (Lit Protocol), validation (AI agents), indexing (MongoDB)

### Complete Workflow: Upload to Rental

**Phase 1: Upload & Staking (Day 0)**
1. Archivist uploads PDF to backend
2. Backend runs automated checks (SHA-256, ClamAV, SimHash)
3. Backend encrypts with Lit Protocol → stores on Arweave
4. Backend calls `stakeForUpload(arweaveHash, stakeAmount)`
5. Smart contract locks $ALEX tokens for 14 days
6. Backend calls `registerUpload(arweaveHash, metadata)`
7. Upload enters "Pending" state

**Phase 2: Validation Period (Days 1-14)**
8. Librarians monitor new uploads
9. If red flags exist, librarian calls `challengeUpload(arweaveHash, reason)`
10. Upload enters "Challenged" state, requires admin/DAO resolution
11. If no challenge by day 14, upload auto-approved

**Phase 3: Resolution (Day 14+)**
- **Success Path:** `releaseStake(arweaveHash)` → archivist gets stake + reward
- **Rejection Path:** `slashStake(arweaveHash)` → tokens redistributed to challenger/treasury

**Phase 4: Rental (After Approval)**
12. User discovers book via frontend/MongoDB index
13. User calls `rentBook(arweaveHash, duration)` + payment
14. `Rent.sol` records permission: `rentals[arweaveHash][userAddress] = expirationTime`
15. `payment.sol` splits rental fee (archivist/protocol/librarian pool)
16. Frontend requests decryption key from Lit Protocol
17. Lit Protocol checks `isRentalActive(arweaveHash, userAddress)` on-chain
18. If valid, Lit releases key → frontend decrypts PDF locally

### Rental Permission Model
The rental system creates a "permission slip" validated on-chain:
- Smart contract maintains mapping: `arweaveHash → renterAddress → expirationTimestamp`
- Lit Protocol reads this mapping before releasing decryption keys
- No PDF data ever touches the blockchain
- Time-bound access automatically expires (Lit checks timestamp)

## Encryption & Key Management Architecture

### The Symmetric Key Model

**Critical Decision:** Each book has **one symmetric encryption key** shared across all rentals. This is the standard approach for decentralized content distribution (similar to how Netflix/Spotify work).

### Upload-Time Encryption Flow

```
Backend Node.js:
┌─────────────────────────────────────────────────────┐
│ 1. Generate random symmetric key (AES-256)          │
│    symmetric_key = randomBytes(32)                  │
│    e.g., "a3f5k9j2d8h4..." (256 bits)              │
└─────────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────┐
│ 2. Encrypt PDF with symmetric key                   │
│    encrypted_pdf = AES.encrypt(pdf, symmetric_key)  │
└─────────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────┐
│ 3. Upload encrypted PDF to Arweave via Irys         │
│    → Returns: arweaveHash (e.g., "xJ4k2...")       │
│    → PDF is now public but encrypted (useless)      │
└─────────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────┐
│ 4. Encrypt symmetric_key with Lit Protocol          │
│    Lit.encrypt(symmetric_key, {                     │
│      accessConditions: [{                           │
│        contractAddress: "AlexandriaRent.sol",       │
│        method: "isRentalActive",                    │
│        params: [arweaveHash, ":userAddress"],       │
│        returnValue: true                            │
│      }]                                             │
│    })                                               │
│    → Lit stores: encrypted_symmetric_key + rules    │
└─────────────────────────────────────────────────────┘
```

**Key Points:**
- Backend generates the symmetric key (Node.js controls this)
- Same symmetric key used for all rentals of this book
- Lit Protocol encrypts the symmetric key with on-chain access conditions
- Arweave stores encrypted PDF (permanent, public, but unreadable without key)

### Rental-Time Decryption Flow

```
Frontend (Browser):
┌─────────────────────────────────────────────────────┐
│ 1. User pays for rental                             │
│    → Smart contract records:                        │
│    rentals[arweaveHash][userAddress] = expiryTime   │
└─────────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────┐
│ 2. Download encrypted_pdf from Arweave              │
│    (Anyone can download, but it's encrypted)        │
└─────────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────┐
│ 3. Request decryption key from Lit Protocol         │
│    Lit.decrypt({                                    │
│      encryptedSymmetricKey,                         │
│      accessConditions,                              │
│      userAddress                                    │
│    })                                               │
└─────────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────┐
│ 4. Lit Protocol checks smart contract on-chain      │
│    → Calls: isRentalActive(arweaveHash, userAddr)   │
│    → If true: Rental exists and hasn't expired      │
│    → If false: No permission or rental expired      │
└─────────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────┐
│ 5. If valid: Lit releases symmetric_key              │
│    (THE SAME KEY used during upload encryption)     │
│    → Key delivered to browser (ephemeral)           │
└─────────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────┐
│ 6. Frontend decrypts PDF in browser memory          │
│    pdf = AES.decrypt(encrypted_pdf, symmetric_key)  │
│    → Never saved to disk unencrypted                │
└─────────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────┐
│ 7. WATERMARK PDF before display (CRITICAL)          │
│    watermarked_pdf = addWatermark(pdf, {            │
│      renterAddress: userWalletAddress,              │
│      rentalDate: timestamp,                         │
│      expiryDate: rentalExpiry                       │
│    })                                               │
│    → Display watermarked version in PDF viewer      │
└─────────────────────────────────────────────────────┘
```

### Security: One Key Per Book Trade-offs

**Why One Key Per Book:**
- ✅ Cost-effective: One Arweave upload per book (not per rental)
- ✅ Simple: No need to re-encrypt for each renter
- ✅ Efficient: Fast decryption flow
- ✅ Standard: Same approach as Netflix, Spotify, etc.

**Risks:**
- ⚠️ If symmetric key leaks, that book is compromised forever
- ⚠️ Cannot revoke access to someone who already obtained the key
- ⚠️ Cannot identify leaker by key alone (all renters have same key)

**Mitigations (MUST IMPLEMENT):**

**1. Dynamic Watermarking (Primary Defense)**
```javascript
// Frontend: After decryption, before display
const watermarkedPDF = injectWatermark(decryptedPDF, {
  walletAddress: user.address,        // Visible on each page
  rentalTimestamp: Date.now(),        // Rental start time
  expiryTimestamp: rental.expiry,     // Rental end time
  transactionHash: rental.txHash      // On-chain proof
});

// Watermark appears on every page:
// "Licensed to: 0x1234...5678 | Rental: 2024-01-15 | Expires: 2024-01-22"
```

**Benefits:**
- Leaked PDFs can be traced to specific wallet address
- Social/legal consequences for leakers
- Economic disincentive (lose stake, get blacklisted)

**2. Monitoring & Detection**
- Track unusual rental patterns (same book rented 1000x in 1 hour)
- Flag new wallets that rent once and never read
- Monitor for leaked PDFs appearing online (watermark search)

**3. Smart Contract Access Controls**
```solidity
// Rent.sol must implement
function isRentalActive(string memory arweaveHash, address renter)
    public view returns (bool) {
    Rental memory rental = rentals[arweaveHash][renter];
    return (
        rental.expiryTime > block.timestamp &&
        !blacklistedAddresses[renter]
    );
}
```

**4. Time-Limited Rentals**
- Short rental periods (24h, 7d, 30d) reduce leak exposure window
- Expired rentals = Lit won't release key anymore
- Forces re-rental (re-payment) for continued access

### Alternative Considered: Unique Keys Per Rental

**Rejected Approach:**
```
For each rental:
- Generate new symmetric key
- Re-encrypt PDF with new key
- Upload to Arweave (new hash per renter)
- Store unique key in Lit
```

**Why Rejected:**
- ❌ 1000 rentals = 1000 Arweave uploads (massive cost)
- ❌ Storage duplication (wasteful)
- ❌ Backend complexity (re-encryption per rental)
- ❌ Slower rental flow
- ✅ Only benefit: Key leaks don't affect other renters

**Conclusion:** Not worth the cost/complexity. Watermarking solves the leak-tracking problem more elegantly.

### Implementation Requirements

**Backend (Node.js) Must:**
- Generate cryptographically secure random symmetric keys (`crypto.randomBytes(32)`)
- Encrypt PDFs using AES-256-GCM (authenticated encryption)
- Store symmetric key → arweaveHash mapping temporarily (until Lit confirms)
- Integrate Lit SDK to encrypt symmetric keys with access conditions
- Never store unencrypted PDFs or raw symmetric keys long-term

**Frontend Must:**
- Integrate Lit Protocol SDK for key retrieval
- Decrypt PDFs in browser memory only (never write to localStorage/disk)
- Implement watermarking before PDF display (every page)
- Clear decrypted content from memory on page close/rental expiry
- Display rental expiry countdown to user

**Smart Contracts Must:**
- Implement `isRentalActive(arweaveHash, renter) → bool` (Lit reads this)
- Track rental expiry timestamps accurately
- Support blacklisting (optional: ban addresses caught leaking)
- Emit events for rental start/end (frontend can listen)

### Security Considerations

**Staking & Validation:**
- All stake deposits/withdrawals must be non-reentrant
- 14-day lock period must be strictly enforced via `block.timestamp` checks
- Prevent early stake withdrawal even if upload appears valid
- Prevent stake slashing after 14-day window expires (time-bound admin actions)
- Challenge system must prevent spam challenges (require librarian stake/reputation?)

**Payment Distribution:**
- Token transfers must follow checks-effects-interactions pattern
- Prevent reentrancy in reward claims
- Validate all percentage splits sum to 100%
- Protect against rounding errors in revenue distribution

**Access Control:**
- Only authorized librarians can challenge uploads
- Only admin/DAO can resolve challenges (prevent self-serving decisions)
- Time-bound rental permissions must be strictly enforced
- Prevent front-running on rental purchases

**Edge Cases (RESOLVED):**
- Uploads with zero rentals: archivist still gets 50 ALEX upload reward (reward is for valid content, not popularity)
- Challenge on day 14: hard cutoff, challenge rejected (keeps system predictable)
- Minimum stake: 100 ALEX per upload (prevents spam)
- Abandoned stakes: auto-release after 14 days, anyone can call `releaseStake()` (permissionless)
- Delisted uploads with active rentals: honor existing rentals until expiry, block new ones

## Resolved Design Decisions

All design decisions are tracked in `checklist.md` Phase 2. Key decisions:
- **Tokenomics:** 1B fixed supply, burnable (no minting), 100 ALEX min stake, 50 ALEX upload reward
- **Splits:** Rental 70/20/10 (archivist/treasury/librarian), Slash 70/30 (challenger/burned)
- **Pricing:** Archivist-set, 24h/7d/30d fixed durations, no extensions
- **Access:** Single EOA admin for PoC (migrate to multisig before mainnet), whitelisted librarians
- **Architecture:** Immutable contracts, Pausable, setter functions for wiring, string format for Arweave hashes