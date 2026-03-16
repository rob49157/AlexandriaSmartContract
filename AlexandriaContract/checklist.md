# Alexandria Smart Contract Checklist

Everything needed to get the contracts fully functional, in order.

---

## Phase 1: Prerequisites & Setup

- [x] Install OpenZeppelin contracts (`npm install @openzeppelin/contracts`)
- [ ] Add Base Testnet network config to `hardhat.config.js` (RPC URL, chain ID 84532)
- [ ] Create `.env` file with required variables:
  - [ ] `BASE_TESTNET_RPC_URL`
  - [ ] `DEPLOYER_PRIVATE_KEY`
  - [ ] `BASESCAN_API_KEY` (for contract verification)
- [ ] Install dotenv (`npm install dotenv`)
- [ ] Update `hardhat.config.js` to load `.env` and configure networks
- [ ] Remove default `test/Lock.js` and `ignition/modules/Lock.js` sample files

---

## Phase 2: Design Decisions (Must Resolve Before Coding)

### Tokenomics
- [x] **Total supply: 1,000,000,000 (1 billion) ALEX — fixed cap, all minted at deploy**
- [x] **Mintable: No. Burnable: Yes** — slashed tokens get burned, creating deflationary pressure
- [x] **Initial distribution:**
  - 50% Protocol Treasury (upload rewards, ecosystem incentives)
  - 20% Team (vested, not implemented in contract for PoC)
  - 15% Librarian Reward Pool (pre-funded)
  - 15% Public / Future Use (held in deployer wallet for PoC)
- [x] **Minimum stake per upload: 100 ALEX**
- [x] **Upload reward: 50 ALEX (fixed)** — paid from treasury on successful validation

### Payment Splits
- [x] **Rental revenue split:**
  - Archivist share: **70%**
  - Protocol treasury: **20%**
  - Librarian pool: **10%**
- [x] **Slash distribution:**
  - Challenger (librarian who flagged): **70%**
  - Burned: **30%** (deflationary — no treasury cut on slashes)

### Rental Pricing
- [x] **Pricing model: Archivist-set** — uploader sets price in ALEX when registering the upload
- [x] **Supported durations: 24h, 7d, 30d** — three fixed tiers, no custom durations
- [x] **No rental extensions** — user must create a new rental after expiry (simpler logic, cleaner audit trail)

### Access Control
- [x] **Admin model: Single EOA (deployer) for PoC** — migrate to multisig (e.g., Gnosis Safe) before mainnet. Single point of failure is not acceptable long-term.
- [x] **Librarian authorization: Whitelist** — admin manually adds/removes librarian addresses
- [x] **No — archivist cannot be a librarian on their own uploads** (prevents self-approval conflicts)
- [x] **No — only one challenger per upload** (first librarian to challenge gets priority; simpler slash logic)

### Storage Format
- [x] **`string` format for Arweave hashes** — readability and debuggability over gas savings for PoC. Arweave hashes are 43-char Base64URL, don't fit cleanly in bytes32 anyway.

### Edge Cases
- [x] **Yes — archivist gets upload reward regardless of rental count.** The reward is for contributing valid content, not for popularity.
- [x] **Hard cutoff — challenges must be submitted before day 14.** Challenge on day 14 exactly is rejected. Keeps the system predictable.
- [x] **Yes — auto-release after 14 days with no challenge.** Anyone can call `releaseStake()` after the window expires (archivist, bot, anyone). No admin action needed.
- [x] **Honor existing rentals until expiry.** Delisting prevents new rentals but doesn't revoke active ones. Renters paid for access and should keep it.

### Architecture
- [x] **Immutable contracts (no proxy pattern)** — simpler, more trustworthy for PoC. Redeploy if bugs found during testnet phase.
- [x] **Yes — include Pausable** (OpenZeppelin Pausable). Admin can freeze all contracts in an emergency. Essential safety net for testnet.
- [x] **Setter functions post-deploy** — each contract has `setContractAddress()` functions called after all contracts are deployed. More flexible than constructor args for PoC iteration.

---

## Phase 3: Token Contract (`token.sol`) — COMPLETE

### Implementation
- [x] Inherit OpenZeppelin ERC20 and ERC20Burnable
- [x] Implement constructor with name ("Alexandria"), symbol ("ALEX"), 1B supply
- [x] No minting function (fixed supply)
- [x] Burning via ERC20Burnable (burn + burnFrom)
- [x] Ownable (transferable ownership for future multisig)
- [x] Pausable (owner can freeze all transfers)
- [ ] Custom approval helpers for staking integration (deferred — standard approve works)

### Tests (`test/Token.test.js`) — 17 passing
- [x] Deploys with correct name, symbol, and total supply
- [x] Initial supply minted to deployer
- [x] Transfers work correctly
- [x] Transfer fails with insufficient balance
- [x] Approve and transferFrom work correctly
- [x] TransferFrom fails without approval
- [x] Burning works correctly (burn + burnFrom)
- [x] Burn fails with insufficient balance
- [x] Pause/unpause blocks and resumes transfers
- [x] Only owner can pause/unpause
- [x] Ownership transfer works
- [x] Non-owner cannot transfer ownership

---

## Phase 4: Library Contract (`library.sol`) — COMPLETE

### Implementation
- [x] Define `Upload` struct (arweaveHash, uploader, timestamp, status, metadata)
- [x] Define `UploadStatus` enum (Pending, Challenged, Approved, Rejected)
- [x] Implement `registerUpload(arweaveHash, uploader, metadata)` — backend calls after Arweave upload
- [x] Implement `getUpload(arweaveHash)` — returns full upload details
- [x] Implement `getUploadStatus(arweaveHash)` — returns status only
- [x] Implement `getUploader(arweaveHash)` — returns uploader address
- [x] Implement `uploadExists(arweaveHash)` — quick existence check
- [x] Implement `updateUploadStatus(arweaveHash, newStatus)` — called by stake contract
- [x] Add mapping from arweaveHash to Upload struct
- [x] Add mapping from uploader address to their upload hashes
- [x] Emit events: `UploadRegistered`, `UploadStatusChanged`, `AuthorizedCallerSet`
- [x] Access control: onlyAuthorized modifier (authorized callers + owner)
- [x] Prevent duplicate registrations for same arweaveHash
- [x] Ownable (transferable ownership)
- [x] Pausable (owner can freeze register/update)

### Tests (`test/Library.test.js`) — 30 passing
- [x] Register upload stores correct metadata
- [x] Duplicate arweaveHash registration reverts
- [x] Only authorized address can register uploads
- [x] Owner can register directly
- [x] Empty hash and zero address revert
- [x] Status transitions work correctly (Pending → Challenged → Rejected, Pending → Approved)
- [x] Unchanged status reverts
- [x] Events emitted on registration, status change, and authorization
- [x] getUpload, getUploadStatus, getUploader return correct data
- [x] uploadExists returns true/false correctly
- [x] Uploader's upload list tracks correctly
- [x] Pause blocks writes, allows reads
- [x] Authorization grant/revoke works, non-owner cannot set

---

## Phase 5: Stake Contract (`stake.sol`)

### Implementation
- [ ] Import and interact with token.sol (ERC20 transferFrom for staking)
- [ ] Import and interact with library.sol (read/update upload status)
- [ ] Define `Stake` struct (arweaveHash, staker, amount, stakeTime, status, challenger)
- [ ] Implement `stakeForUpload(arweaveHash, amount)` — lock tokens for 14 days
- [ ] Implement `getStakeStatus(arweaveHash)` — return stake state
- [ ] Implement `releaseStake(arweaveHash)` — return stake + reward after 14 days if valid
- [ ] Implement `slashStake(arweaveHash)` — penalize invalid uploads
- [ ] Implement `challengeUpload(arweaveHash, reason)` — librarian flags upload
- [ ] Implement `resolveChallenge(arweaveHash, approved)` — admin resolves dispute
- [ ] Enforce 14-day minimum lock via `block.timestamp`
- [ ] Enforce minimum stake amount
- [ ] Add reentrancy guards (OpenZeppelin ReentrancyGuard)
- [ ] Emit events: `StakeDeposited`, `StakeReleased`, `StakeSlashed`, `UploadChallenged`, `ChallengeResolved`
- [ ] Librarian authorization checks on challengeUpload
- [ ] Admin authorization checks on resolveChallenge
- [ ] Prevent slashing after 14-day window (time-bound admin actions)
- [ ] Prevent double-challenge on same upload (or handle multi-challenge)

### Tests (`test/Stake.test.js`)
- [ ] Staking locks correct token amount
- [ ] Staking fails with insufficient balance or allowance
- [ ] Staking fails below minimum stake amount
- [ ] Cannot release stake before 14 days
- [ ] Release after 14 days returns stake + reward
- [ ] Challenge by authorized librarian works
- [ ] Challenge by unauthorized address reverts
- [ ] Challenge after 14 days reverts
- [ ] resolveChallenge(approved=true) releases stake
- [ ] resolveChallenge(approved=false) slashes stake
- [ ] Slashed tokens distributed correctly (challenger + treasury)
- [ ] Cannot slash after 14-day window expires
- [ ] Reentrancy attack on release/slash fails
- [ ] All events emitted correctly
- [ ] Auto-approval flow (no challenge, 14 days pass, release works)

---

## Phase 6: Rent Contract (`Rent.sol`)

### Implementation
- [ ] Define `Rental` struct (arweaveHash, renter, startTime, expiryTime)
- [ ] Implement `rentBook(arweaveHash, duration)` — create rental + trigger payment
- [ ] Implement `isRentalActive(arweaveHash, renter) → bool` — Lit Protocol reads this
- [ ] Implement `getRental(arweaveHash, renter)` — return rental details
- [ ] Add nested mapping: `arweaveHash → renter → Rental`
- [ ] Validate upload is Approved before allowing rental (check library.sol)
- [ ] Validate rental duration is within allowed range
- [ ] Handle rental extension logic (if decided to support)
- [ ] Add blacklist mapping and check in `isRentalActive`
- [ ] Add blacklist management functions (add/remove, admin only)
- [ ] Emit events: `BookRented`, `RentalExpired`, `AddressBlacklisted`
- [ ] Integrate with payment.sol for fee splitting

### Tests (`test/Rent.test.js`)
- [ ] Renting approved book creates correct rental record
- [ ] Renting unapproved/pending book reverts
- [ ] isRentalActive returns true during rental period
- [ ] isRentalActive returns false after expiry
- [ ] isRentalActive returns false for blacklisted address
- [ ] Rental payment collected correctly
- [ ] Duplicate rental behavior (extend vs reject)
- [ ] Events emitted on rental creation
- [ ] Blacklist add/remove restricted to admin
- [ ] Duration validation (min/max) works

---

## Phase 7: Payment Contract (`payment.sol`)

### Implementation
- [ ] Implement `processRentalPayment(arweaveHash, renter, amount)` — split rental fee
- [ ] Implement `distributeUploadReward(arweaveHash)` — pay archivist for valid upload
- [ ] Implement `distributeSlashReward(arweaveHash, challenger)` — pay challenger from slashed stake
- [ ] Implement `claimLibrarianRewards()` — librarians withdraw accumulated rewards
- [ ] Implement `claimArchivistRewards()` — archivists withdraw accumulated rewards
- [ ] Track pending rewards per address (pull pattern, not push)
- [ ] Revenue split logic with correct percentages
- [ ] Treasury balance tracking
- [ ] Reentrancy guards on all claim/withdraw functions
- [ ] Validate percentage splits sum to 100%
- [ ] Handle rounding errors in splits (remainder goes to treasury)
- [ ] Emit events: `RentalPaymentProcessed`, `RewardClaimed`, `UploadRewardDistributed`
- [ ] Access control: only Rent.sol and Stake.sol can call distribution functions

### Tests (`test/Payment.test.js`)
- [ ] Rental payment splits correctly to archivist, treasury, librarian pool
- [ ] Upload reward distributes correct amount to archivist
- [ ] Slash reward distributes correctly to challenger + treasury
- [ ] claimLibrarianRewards sends correct accumulated amount
- [ ] claimArchivistRewards sends correct accumulated amount
- [ ] Claiming with zero balance reverts
- [ ] Double-claim prevented (balance zeroed after claim)
- [ ] Rounding errors handled (no tokens lost)
- [ ] Reentrancy attack on claim fails
- [ ] Only authorized contracts can call distribution functions
- [ ] Events emitted correctly

---

## Phase 8: Integration Testing

- [ ] Full upload flow: register upload → stake → wait 14 days → release stake → reward paid
- [ ] Full rejection flow: register → stake → challenge → resolve(rejected) → slash → challenger rewarded
- [ ] Full rental flow: approved upload → rent book → payment split → isRentalActive returns true
- [ ] Rental expiry: rent → time passes → isRentalActive returns false
- [ ] Cross-contract access control: only authorized contracts can call each other
- [ ] End-to-end token flow: mint → approve → stake → release → claim rewards → transfer

---

## Phase 9: Deployment

### Ignition Modules
- [ ] Create `ignition/modules/AlexandriaToken.js`
- [ ] Create `ignition/modules/AlexandriaLibrary.js`
- [ ] Create `ignition/modules/AlexandriaStake.js`
- [ ] Create `ignition/modules/AlexandriaRent.js`
- [ ] Create `ignition/modules/AlexandriaPayment.js`
- [ ] Create master module that deploys all contracts in order and wires addresses

### Deploy & Verify
- [ ] Deploy to Hardhat local node and test
- [ ] Deploy to Base Testnet (Sepolia)
- [ ] Verify all contracts on Basescan
- [ ] Document deployed contract addresses

---

## Phase 10: Post-Deployment

- [ ] Wire contract addresses together (set references between contracts)
- [ ] Transfer ownership/admin roles to intended address (multisig if applicable)
- [ ] Authorize librarian addresses
- [ ] Fund treasury with initial $ALEX for upload rewards
- [ ] Test isRentalActive from external call (simulate Lit Protocol check)
- [ ] Update CLAUDE.md with final deployed addresses and resolved design decisions
- [ ] Share ABIs with frontend and backend teams for integration
