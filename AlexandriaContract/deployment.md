# Alexandria Smart Contract Deployment Guide

Target network: **Base Sepolia Testnet** (chain ID 84532)

---

## Contract Dependency Order

```
AlexandriaToken   (no deps)
AlexandriaLibrary (no deps)
      ↓
AlexandriaStake   ← library + token
AlexandriaRent    ← library + token
AlexandriaPayment ← library + token + treasury address
```

All five can be deployed in one Hardhat Ignition module. Ignition handles ordering automatically.

---

## Pre-Deployment Checklist

### 1. Environment setup

Install `dotenv` if not already present:

```bash
npm install dotenv
```

Create a `.env` file in the project root (never commit this):

```
PRIVATE_KEY=0xYOUR_DEPLOYER_PRIVATE_KEY
TREASURY_ADDRESS=0xYOUR_TREASURY_WALLET_ADDRESS
```

Confirm `.env` is in `.gitignore`:

```
.env
```

### 2. Update `hardhat.config.js`

Add the dotenv import and Base Sepolia network at the top and inside `networks`:

```javascript
require("dotenv").config();

module.exports = {
  solidity: "0.8.28",
  networks: {
    baseTestnet: {
      url: "https://sepolia.base.org",
      accounts: [process.env.PRIVATE_KEY],
      chainId: 84532,
    },
  },
};
```

### 3. Fund the deployer wallet

Get Base Sepolia ETH from the official faucet:
- https://www.coinbase.com/faucets/base-ethereum-goerli-faucet
- https://faucet.quicknode.com/base/sepolia

You need ETH for gas on every deployment and post-deploy transaction.

### 4. Run all tests

Confirm everything passes before deploying:

```bash
npx hardhat test
```

Expected: Token (17), Library (30), Stake (57) = 104 tests passing.

### 5. Compile

```bash
npx hardhat compile
```

---

## Step 1: Write the Ignition Module

Create `ignition/modules/Alexandria.js`:

```javascript
const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("AlexandriaModule", (m) => {
  const treasury = m.getParameter("treasury");

  // Tier 1 — no dependencies
  const token   = m.contract("AlexandriaToken",   []);
  const library = m.contract("AlexandriaLibrary", []);

  // Tier 2 — depend on token + library
  const stake   = m.contract("AlexandriaStake",   [library, token]);
  const rent    = m.contract("AlexandriaRent",    [library, token]);
  const payment = m.contract("AlexandriaPayment", [library, token, treasury]);

  return { token, library, stake, rent, payment };
});
```

The `treasury` parameter is passed at deploy time (see below).

---

## Step 2: Deploy

### Local (test first)

```bash
npx hardhat ignition deploy ./ignition/modules/Alexandria.js \
  --parameters '{"AlexandriaModule": {"treasury": "0xYOUR_TREASURY_ADDRESS"}}'
```

### Base Sepolia Testnet

```bash
npx hardhat ignition deploy ./ignition/modules/Alexandria.js \
  --network baseTestnet \
  --parameters '{"AlexandriaModule": {"treasury": "0xYOUR_TREASURY_ADDRESS"}}'
```

Ignition saves all deployed addresses to `ignition/deployments/`. Record the five contract addresses — you need them for wiring.

---

## Step 3: Post-Deployment Wiring

Contracts need to be authorized to call each other. These are admin transactions from the deployer wallet.

You can run these via Hardhat console or write a one-off script.

### Open Hardhat console (testnet)

```bash
npx hardhat console --network baseTestnet
```

Then paste each call below.

---

### 3a. Authorize `AlexandriaStake` to update the library registry

`stake.sol` calls `library.updateUploadStatus()` — it must be an authorized caller.

```javascript
const library = await ethers.getContractAt("AlexandriaLibrary", "<LIBRARY_ADDRESS>");
await library.setAuthorizedCaller("<STAKE_ADDRESS>", true);
```

### 3b. Authorize your backend to register uploads

The backend calls `library.registerUpload()` after Arweave storage.

```javascript
await library.setAuthorizedCaller("<BACKEND_WALLET_ADDRESS>", true);
```

### 3c. Wire `AlexandriaPayment` into `AlexandriaStake`

`stake.sol` calls `payment.notifyStakeChange()` before any librarian stake change.

```javascript
const stake = await ethers.getContractAt("AlexandriaStake", "<STAKE_ADDRESS>");
await stake.setPaymentContract("<PAYMENT_ADDRESS>");
```

### 3d. Wire `AlexandriaStake` into `AlexandriaPayment`

`payment.sol` reads `stake.totalLibrarianStake()` and `stake.getLibrarianStake()` for reward accounting.

```javascript
const payment = await ethers.getContractAt("AlexandriaPayment", "<PAYMENT_ADDRESS>");
await payment.setStakeContract("<STAKE_ADDRESS>");
```

### 3e. Authorize `AlexandriaRent` to trigger payment distribution

`payment.processRentalPayment()` is restricted to authorized callers.

```javascript
await payment.setAuthorizedCaller("<RENT_ADDRESS>", true);
```

### 3f. Authorize `AlexandriaStake` to trigger upload rewards

`payment.distributeUploadReward()` is restricted to authorized callers.

```javascript
await payment.setAuthorizedCaller("<STAKE_ADDRESS>", true);
```

### 3g. Wire payment contract into `AlexandriaRent`

`rentBook()` requires `paymentContract` to be set before any rental can happen.

```javascript
const rent = await ethers.getContractAt("AlexandriaRent", "<RENT_ADDRESS>");
await rent.setPaymentContract("<PAYMENT_ADDRESS>");
```

---

## Step 4: Treasury Token Setup

All 1B ALEX is minted to the deployer on `AlexandriaToken` deployment. You must distribute tokens before the protocol can operate.

### 4a. Send initial supply to treasury

Decide how much to allocate to the treasury wallet for upload rewards and operations. Example for testnet:

```javascript
const token = await ethers.getContractAt("AlexandriaToken", "<TOKEN_ADDRESS>");
const amount = ethers.parseUnits("1000000", 18); // 1M ALEX
await token.transfer("<TREASURY_ADDRESS>", amount);
```

### 4b. Treasury approves the payment contract to spend upload rewards

`payment.distributeUploadReward()` calls `token.transferFrom(treasury, archivist, 50 ALEX)`. The treasury must pre-approve this.

Do this **from the treasury wallet**:

```javascript
const token = await ethers.getContractAt("AlexandriaToken", "<TOKEN_ADDRESS>");
// Approve enough for expected upload volume (e.g. 10,000 uploads × 50 ALEX = 500,000 ALEX)
const approvalAmount = ethers.parseUnits("500000", 18);
await token.approve("<PAYMENT_ADDRESS>", approvalAmount);
```

---

## Step 5: Verify Contracts on Basescan (Optional but Recommended)

Verified source code lets users and auditors inspect the contracts on https://sepolia.basescan.org.

```bash
# No constructor args
npx hardhat verify --network baseTestnet <TOKEN_ADDRESS>
npx hardhat verify --network baseTestnet <LIBRARY_ADDRESS>

# With constructor args
npx hardhat verify --network baseTestnet <STAKE_ADDRESS> "<LIBRARY_ADDRESS>" "<TOKEN_ADDRESS>"
npx hardhat verify --network baseTestnet <RENT_ADDRESS> "<LIBRARY_ADDRESS>" "<TOKEN_ADDRESS>"
npx hardhat verify --network baseTestnet <PAYMENT_ADDRESS> "<LIBRARY_ADDRESS>" "<TOKEN_ADDRESS>" "<TREASURY_ADDRESS>"
```

---

## Deployed Contract Addresses (fill in after deployment)

| Contract           | Address |
|--------------------|---------|
| AlexandriaToken    |         |
| AlexandriaLibrary  |         |
| AlexandriaStake    |         |
| AlexandriaRent     |         |
| AlexandriaPayment  |         |
| Treasury Wallet    |         |

---

## Quick Reference: Key Contract Roles

| Who calls what | Function | Auth mechanism |
|---|---|---|
| Backend | `library.registerUpload()` | `setAuthorizedCaller` |
| Stake.sol | `library.updateUploadStatus()` | `setAuthorizedCaller` |
| Stake.sol | `payment.notifyStakeChange()` | address check (`msg.sender == stakeContract`) |
| Stake.sol | `payment.distributeUploadReward()` | `setAuthorizedCaller` |
| Rent.sol | `payment.processRentalPayment()` | `setAuthorizedCaller` |
| Payment.sol | `token.transferFrom(treasury, ...)` | ERC20 allowance from treasury |
| Admin (owner) | `stake.resolveChallenge()` | `onlyOwner` |
