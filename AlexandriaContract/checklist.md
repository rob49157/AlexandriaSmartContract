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
- [x] **Slash distribution (archivist stake on rejected upload):**
  - Challenger (librarian who flagged): **70%**
  - Burned: **30%** (deflationary — no treasury cut on slashes)
- [x] **Librarian penalty (wrong challenge — upload approved):**
  - 50% of librarian's stake sent to archivist as compensation
  - 50% remains with librarian

### Rental Pricing
- [x] **Pricing model: Archivist-set** — uploader sets price in ALEX when registering the upload
- [x] **Supported durations: 24h, 7d, 30d** — three fixed tiers, no custom durations
- [x] **No rental extensions** — user must create a new rental after expiry (simpler logic, cleaner audit trail)

### Access Control
- [x] **Admin model: Single EOA (deployer) for PoC** — migrate to multisig (e.g., Gnosis Safe) before mainnet. Single point of failure is not acceptable long-term.
- [x] **Librarian authorization: Stake-based** — anyone can become a librarian by staking minimum 50 ALEX. 30-day cooldown to unstake.
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
- [x] Import and interact with token.sol (ERC20 transferFrom for staking)
- [x] Import and interact with library.sol (read/update upload status)
- [x] Define `StakeInfo` struct (staker, amount, timestamp, active) + `Challenger` struct (challenger, timestamp, resolved)
- [x] Implement `stake(arweaveHash, amount)` — lock tokens, validate upload exists, enforce min stake
- [ ] Implement `getStakeStatus(arweaveHash)` — return stake state
- [x] Implement `unstake(arweaveHash)` — return stake after 14 days if valid, sets status to Approved
- [x] Implement `slashStake(arweaveHash)` — internal, 70% to challenger, 30% burned
- [x] Implement `challengeUpload(arweaveHash, reason)` — librarian flags upload, sets status to Challenged
- [x] Implement `resolveChallenge(arweaveHash, approved)` — admin resolves: approved returns stake, rejected slashes
- [x] Enforce 14-day minimum lock via `block.timestamp`
- [x] Enforce minimum stake amount (100 ALEX)
- [ ] Add reentrancy guards (OpenZeppelin ReentrancyGuard)
- [x] Emit events: `Staked`, `Unstaked`, `slashed`, `challengeInitiated`, `ChallengeResolved`, `LibrarianStaked`, `LibrarianUnstaked`, `LibrarianSlashed`
- [x] Librarian stake-based authorization (stakeAsLibrarian/unstakeAsLibrarian replaces admin whitelist)
- [x] Admin authorization checks on resolveChallenge (onlyOwner)
- [x] Define `LibrarianInfo` struct (amount, timestamp, active)
- [x] Implement `stakeAsLibrarian(amount)` — lock min 50 ALEX to become librarian
- [x] Implement `unstakeAsLibrarian()` — return stake after 30-day cooldown
- [x] Wrong challenge slashes librarian 50%, sends to archivist as compensation
- [x] Prevent challenge after 14-day window (hard cutoff)
- [x] Prevent double-challenge on same upload (one challenger per upload)
- [x] Prevent unstaking if upload is Challenged or Rejected
- [x] Archivist cannot challenge own upload

### Tests (`test/Stake.test.js`) — 57 passing
- [x] Staking locks correct token amount
- [x] Staking records correct stake info
- [x] Staking emits Staked event
- [x] Staking fails with insufficient balance or allowance
- [x] Staking fails below minimum stake amount (100 ALEX)
- [x] Staking fails if upload does not exist
- [x] Staking fails if already staked on same upload
- [x] Cannot unstake before 14 days
- [x] Unstake after 14 days returns stake to archivist
- [x] Unstake marks stake inactive and sets upload to Approved
- [x] Unstake reverts if upload is Challenged or Rejected
- [x] Unstake reverts if caller is not staker
- [x] Librarian staking locks tokens and activates librarian
- [x] Librarian staking fails below min (50 ALEX), double stake, no balance, no approval
- [x] Librarian unstake returns stake after 30-day cooldown
- [x] Librarian unstake deactivates librarian, prevents further challenges
- [x] Librarian unstake reverts before cooldown or if not active
- [x] Challenge by active librarian works, updates status to Challenged
- [x] Challenge by non-librarian reverts
- [x] Archivist cannot challenge own upload
- [x] Challenge after 14 days reverts
- [x] Double challenge reverts
- [x] resolveChallenge(approved=true) returns stake + slashes librarian 50% to archivist
- [x] resolveChallenge(approved=false) slashes archivist stake (70% challenger, 30% burned)
- [x] Correct challenge does not slash librarian stake
- [x] resolveChallenge reverts if no challenge, already resolved, or non-owner
- [x] All events emitted correctly (Staked, Unstaked, slashed, challengeInitiated, ChallengeResolved, LibrarianStaked, LibrarianUnstaked, LibrarianSlashed)
- [x] Full happy path: stake → 14 days → unstake → Approved
- [x] Full rejection path: stake → challenge → reject → slash
- [x] Full wrong challenge path: stake → challenge → approve → librarian slashed

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
- [ ] Verify librarian staking works (librarians self-authorize by staking)
- [ ] Fund treasury with initial $ALEX for upload rewards
- [ ] Test isRentalActive from external call (simulate Lit Protocol check)
- [ ] Update CLAUDE.md with final deployed addresses and resolved design decisions
- [ ] Share ABIs with frontend and backend teams for integration

---

## Phase 11: Mainnet Upgrades (Post-PoC)

### Decentralized Challenge Resolution
Currently `resolveChallenge()` uses single admin (onlyOwner). Replace with librarian jury system:
- [ ] Backend calls `challengeUpload()` when automated checks fail (ClamAV, SimHash, AI validation)
- [ ] 3 random librarians selected from active pool (Chainlink VRF for on-chain randomness)
- [ ] Anonymous voting via commit-reveal scheme (Phase 1: submit hash of vote+secret, Phase 2: reveal vote)
- [ ] Voting threshold: 2/3 or 3/3 approve → upload passes; 1/3 or 0/3 → upload rejected
- [ ] Minority voters slashed (voted wrong side)
- [ ] Requires: enumerable librarian pool (array + mapping), timeout for non-voters, replacement selection
- [ ] Voting window: e.g., 48h to commit, 24h to reveal

### Other Mainnet Items
- [ ] Migrate admin from single EOA to multisig (Gnosis Safe)
- [ ] Audit all contracts
- [ ] Gas optimization pass
