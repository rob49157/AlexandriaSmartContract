const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

// Master deployment module — deploys all Alexandria contracts in order and wires them together.
//
// Post-deploy manual steps (NOT automated here):
//   1. Treasury wallet must call: token.approve(payment.address, large_amount)
//      Required so payment.distributeUploadReward() can pull rewards from treasury.
//   2. Distribute initial token allocations from deployer to treasury, team, etc.
//   3. Transfer ownership to multisig before mainnet.
//
// Deploy to Base Testnet:
//   npx hardhat ignition deploy ignition/modules/Alexandria.js --network baseTestnet
//
// Verify contracts after deploy:
//   npx hardhat verify --network baseTestnet <address>

module.exports = buildModule("Alexandria", (m) => {
  const deployer = m.getAccount(0);

  // 1. Token — no dependencies
  const token = m.contract("AlexandriaToken", []);

  // 2. Library — no dependencies
  const library = m.contract("AlexandriaLibrary", []);

  // 3. Stake — depends on library + token
  const stake = m.contract("AlexandriaStake", [library, token]);

  // 4. Payment — depends on library + token; treasury = deployer wallet for PoC
  const payment = m.contract("AlexandriaPayment", [library, token, deployer]);

  // 5. Rent — depends on library + token
  const rent = m.contract("AlexandriaRent", [library, token]);

  // Wire: Library authorizes Stake to call updateUploadStatus
  m.call(library, "setAuthorizedCaller", [stake, true], { id: "authStakeInLibrary" });

  // Wire: Payment knows about Stake (for librarian reward accounting)
  m.call(payment, "setStakeContract", [stake], { id: "paymentSetStake" });

  // Wire: Stake knows about Payment (to trigger upload rewards + notify stake changes)
  m.call(stake, "setPaymentContract", [payment], { id: "stakeSetPayment" });

  // Wire: Payment authorizes Rent + Stake as callers (they trigger distributions)
  m.call(payment, "setAuthorizedCaller", [rent, true], { id: "authRentInPayment" });
  m.call(payment, "setAuthorizedCaller", [stake, true], { id: "authStakeInPayment" });

  // Wire: Rent knows about Payment (to forward rental fees)
  m.call(rent, "setPaymentContract", [payment], { id: "rentSetPayment" });

  return { token, library, stake, payment, rent };
});
