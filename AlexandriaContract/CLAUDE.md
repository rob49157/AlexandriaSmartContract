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

**Stake Contract (`stake.sol`) — IMPLEMENTED:**
- `stake(arweaveHash, amount)` - Lock tokens when upload occurs (min 100 ALEX)
- `unstake(arweaveHash)` - After 14 days, return stake if valid, sets upload to Approved
- `slashStake(arweaveHash)` - Internal, 70% to challenger, 30% burned
- `stakeAsLibrarian(amount)` - Stake min 50 ALEX to become a librarian
- `unstakeAsLibrarian()` - Withdraw librarian stake after 30-day cooldown
- `challengeUpload(arweaveHash, reason)` - Active librarian flags suspicious content
- `resolveChallenge(arweaveHash, approved, shouldBlacklist)` - Admin resolves: approved returns stake + slashes librarian 50%, rejected slashes archivist stake (optional blacklist)

**Validation States:**
1. **Pending** (Days 0-14): Stake locked, librarians can review
2. **Challenged** (If flagged): Librarian review required before day 14
3. **Approved**: Stake released + reward paid to archivist
4. **Rejected**: Stake slashed, tokens burned or redistributed to librarians

**Time Constraints:**
- Minimum stake period: 14 days (enforced via `block.timestamp`)
- Challenge window: Days 1-14 (librarians can flag suspicious uploads)
- Auto-approval: If no challenges by day 14, upload automatically approved

### Payment Distribution (IMPLEMENTED)

**For Valid Uploads:**
- Archivist receives: Staked tokens (100 ALEX) + upload reward (50 ALEX fixed, from treasury)
- Reward is for contributing valid content, regardless of rental count

**For Rental Revenue:**
- Each rental payment gets split:
  - 70% to archivist who uploaded the book
  - 20% to protocol treasury
  - 10% to librarian reward pool

**For Rejected Uploads (correct challenge):**
- Archivist's slashed stake gets redistributed:
  - 70% to librarian who flagged the invalid upload
  - 30% burned (deflationary — no treasury cut on slashes)
- Librarian's stake: untouched
- **Optional Blacklist:** Admin can ban uploader permanently via `resolveChallenge`

**For Approved Uploads After Challenge (wrong challenge):**
- Archivist's stake: returned in full
- Librarian's stake: 50% sent to archivist as compensation, 50% remains with librarian

### Librarian Role

Librarians are stake-based validators. Anyone can become a librarian by staking ALEX tokens — no admin approval needed.

**Becoming a Librarian:**
- Stake minimum 50 ALEX via `stakeAsLibrarian(amount)` to become active
- 30-day cooldown before unstaking via `unstakeAsLibrarian()`
- Stake acts as skin-in-the-game to prevent frivolous challenges

**Librarian Incentives (3 layers):**
1. **Correct challenge reward:** 70% of slashed archivist stake (direct reward for catching bad uploads)
2. **Rental revenue share:** 10% of all rental fees go to librarian pool
3. **Protocol fee share:** Proportional to stake or activity

**Librarian Penalties:**
- **Wrong challenge (upload approved by admin):** 50% of librarian's stake sent to archivist as compensation
- Discourages frivolous challenges while allowing honest mistakes (not full slash)

**Key Functions (IMPLEMENTED in stake.sol):**
- `stakeAsLibrarian(amount)` - Stake ALEX to become an active librarian
- `unstakeAsLibrarian()` - Withdraw stake after 30-day cooldown
- `challengeUpload(arweaveHash, reason)` - Flag suspicious content (active librarians only)
- `resolveChallenge(arweaveHash, approved, shouldBlacklist)` - Admin resolves disputed uploads

**Key Functions (IMPLEMENTED in payment.sol):**
- `claimLibrarianRewards()` - Librarians withdraw accumulated rewards

**Mainnet Upgrade: Decentralized Challenge Resolution**
Current PoC uses single admin (onlyOwner) to resolve challenges. For mainnet, replace with:
1. Backend runs automated checks (ClamAV, SimHash, AI validation) → if fails → backend calls `challengeUpload()`
2. 3 random librarians selected from pool (Chainlink VRF for on-chain randomness)
3. Anonymous voting via commit-reveal scheme (hidden votes, then reveal phase)
4. 2/3 or 3/3 approve → upload passes, minority voter(s) slashed
5. 1/3 or 0/3 approve → upload rejected, minority voter(s) slashed
6. Requires: enumerable librarian pool, timeout/replacement for non-voters, two-phase voting window

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
├── stake.sol          # Upload staking, librarian staking & validation (COMPLETE - 58 tests)
├── Rent.sol           # Rental permissions for Lit Protocol (COMPLETE)
└── payment.sol        # Payment splits & reward claims (COMPLETE - 41 tests)

test/                  # JavaScript test files (Mocha/Chai)
├── Token.test.js      # 17 tests passing
├── Library.test.js    # 36 tests passing
├── Stake.test.js      # 58 tests passing
├── Payment.test.js    # 41 tests passing
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

**stake.sol** - `AlexandriaStake` (COMPLETE — 57 tests passing)
- Ownable (admin resolves challenges)
- Locks archivist stakes (min 100 ALEX) for 14 days per upload
- Stake-based librarian system: anyone stakes min 50 ALEX to become librarian (30-day cooldown to unstake)
- Manages challenge submissions from staked librarians
- Handles stake release (success) or slashing (rejection)
- Correct challenge: archivist slashed 70% to challenger, 30% burned
- Wrong challenge: librarian slashed 50% to archivist as compensation
- One challenger per upload, hard 14-day cutoff
- Archivist cannot challenge own uploads
- `unstake()` after 14 days sets upload to Approved via library.updateUploadStatus()
- Emits events: Staked, Unstaked, slashed, challengeInitiated, ChallengeResolved, LibrarianStaked, LibrarianUnstaked, LibrarianSlashed

**Rent.sol** - Rental access control (COMPLETE)
- Records time-bound rental permissions (arweaveHash → renter → expirationTime)
- Archivist-set pricing in ALEX, three fixed durations: 24h, 7d, 30d
- No rental extensions — must create new rental after expiry
- Validates active rentals for Lit Protocol integration via `isRentalActive()`
- Blacklist support for addresses caught leaking
- Delisting prevents new rentals but honors existing ones until expiry

**payment.sol** - Revenue distribution (COMPLETE)
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
- Challenge system prevents spam via librarian staking (min 50 ALEX, 50% slashed on wrong challenge)

**Payment Distribution:**
- Token transfers must follow checks-effects-interactions pattern
- Prevent reentrancy in reward claims
- Validate all percentage splits sum to 100%
- Protect against rounding errors in revenue distribution

**Access Control:**
- Only staked librarians can challenge uploads (stake-based authorization)
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
- **Access:** Single EOA admin for PoC (migrate to multisig before mainnet), stake-based librarians (50 ALEX min, 30-day cooldown)
- **Architecture:** Immutable contracts, Pausable, setter functions for wiring, string format for Arweave hashes