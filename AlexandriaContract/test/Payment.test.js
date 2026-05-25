const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");

describe("AlexandriaPayment", function () {

  async function deployFixture() {
    const [owner, archivist, librarian1, librarian2, renter, treasury] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("AlexandriaToken");
    const token = await Token.deploy();

    const Library = await ethers.getContractFactory("AlexandriaLibrary");
    const library = await Library.deploy();

    const Stake = await ethers.getContractFactory("AlexandriaStake");
    const stake = await Stake.deploy(await library.getAddress(), await token.getAddress());

    const Payment = await ethers.getContractFactory("AlexandriaPayment");
    const payment = await Payment.deploy(
      await library.getAddress(),
      await token.getAddress(),
      treasury.address
    );

    // Wire up library
    await library.setAuthorizedCaller(owner.address, true);
    await library.setAuthorizedCaller(await stake.getAddress(), true);

    // Wire up payment ↔ stake
    await payment.setStakeContract(await stake.getAddress());
    await payment.setAuthorizedCaller(owner.address, true); // owner simulates Rent.sol / Stake.sol calls
    await stake.setPaymentContract(await payment.getAddress());

    // Fund accounts
    await token.transfer(archivist.address, ethers.parseEther("1000"));
    await token.transfer(librarian1.address, ethers.parseEther("1000"));
    await token.transfer(librarian2.address, ethers.parseEther("1000"));
    await token.transfer(renter.address, ethers.parseEther("1000"));
    await token.transfer(treasury.address, ethers.parseEther("10000"));

    // Approvals
    await token.connect(treasury).approve(await payment.getAddress(), ethers.parseEther("10000"));
    await token.connect(renter).approve(await payment.getAddress(), ethers.parseEther("1000"));
    await token.connect(librarian1).approve(await stake.getAddress(), ethers.parseEther("1000"));
    await token.connect(librarian2).approve(await stake.getAddress(), ethers.parseEther("1000"));
    await token.connect(archivist).approve(await stake.getAddress(), ethers.parseEther("1000"));

    // Register a book
    await library.connect(owner).registerUpload(HASH_1, archivist.address, "Test Book");

    const rentalPrice = ethers.parseEther("100");

    return { token, library, stake, payment, owner, archivist, librarian1, librarian2, renter, treasury, rentalPrice };
  }

  const HASH_1 = "xJ4k2mN8pQrS9tV3wY5zA1bC6dE7fG0hI";
  const UPLOAD_REWARD = ethers.parseEther("50");
  const THIRTY_DAYS = 30 * 24 * 60 * 60;

  // --- Deployment ---

  describe("Deployment", function () {
    it("should set correct contract addresses", async function () {
      const { payment, library, token, treasury, stake } = await loadFixture(deployFixture);
      expect(await payment.libraryContract()).to.equal(await library.getAddress());
      expect(await payment.tokenContract()).to.equal(await token.getAddress());
      expect(await payment.treasury()).to.equal(treasury.address);
      expect(await payment.stakeContract()).to.equal(await stake.getAddress());
    });

    it("should set deployer as owner", async function () {
      const { payment, owner } = await loadFixture(deployFixture);
      expect(await payment.owner()).to.equal(owner.address);
    });
  });

  // --- Access Control ---

  describe("Access Control", function () {
    it("should set authorized caller", async function () {
      const { payment, archivist } = await loadFixture(deployFixture);
      await payment.setAuthorizedCaller(archivist.address, true);
      expect(await payment.authorizedCallers(archivist.address)).to.be.true;
    });

    it("should emit AuthorizedCallerSet event", async function () {
      const { payment, archivist } = await loadFixture(deployFixture);
      await expect(payment.setAuthorizedCaller(archivist.address, true))
        .to.emit(payment, "AuthorizedCallerSet")
        .withArgs(archivist.address, true);
    });

    it("should revert setAuthorizedCaller for zero address", async function () {
      const { payment } = await loadFixture(deployFixture);
      await expect(
        payment.setAuthorizedCaller(ethers.ZeroAddress, true)
      ).to.be.revertedWith("Zero address");
    });

    it("should revert setAuthorizedCaller for non-owner", async function () {
      const { payment, archivist } = await loadFixture(deployFixture);
      await expect(
        payment.connect(archivist).setAuthorizedCaller(archivist.address, true)
      ).to.be.revertedWithCustomError(payment, "OwnableUnauthorizedAccount");
    });

    it("should revert processRentalPayment if not authorized", async function () {
      const { payment, renter, rentalPrice } = await loadFixture(deployFixture);
      await expect(
        payment.connect(renter).processRentalPayment(HASH_1, renter.address, rentalPrice)
      ).to.be.revertedWith("Not authorized");
    });

    it("should revert distributeUploadReward if not authorized", async function () {
      const { payment, renter } = await loadFixture(deployFixture);
      await expect(
        payment.connect(renter).distributeUploadReward(HASH_1)
      ).to.be.revertedWith("Not authorized");
    });
  });

  // --- processRentalPayment ---

  describe("processRentalPayment", function () {
    it("should accumulate archivist share in pendingArchivistRewards", async function () {
      const { payment, owner, renter, archivist, rentalPrice } = await loadFixture(deployFixture);

      await payment.connect(owner).processRentalPayment(HASH_1, renter.address, rentalPrice);

      const expected = (rentalPrice * 70n) / 100n; // 70 ALEX
      expect(await payment.pendingArchivistRewards(archivist.address)).to.equal(expected);
    });

    it("should transfer treasury share immediately when no librarians staked", async function () {
      const { token, payment, owner, renter, treasury, rentalPrice } = await loadFixture(deployFixture);

      const before = await token.balanceOf(treasury.address);
      await payment.connect(owner).processRentalPayment(HASH_1, renter.address, rentalPrice);
      const after = await token.balanceOf(treasury.address);

      // No librarians: treasury gets 20% direct + 10% librarian fallback = 30 ALEX
      expect(after - before).to.equal(ethers.parseEther("30"));
    });

    it("should only send 20 ALEX to treasury when librarians are staked", async function () {
      const { token, payment, stake, owner, renter, treasury, librarian1, rentalPrice } = await loadFixture(deployFixture);

      await stake.connect(librarian1).stakeAsLibrarian(ethers.parseEther("300"));

      const before = await token.balanceOf(treasury.address);
      await payment.connect(owner).processRentalPayment(HASH_1, renter.address, rentalPrice);
      const after = await token.balanceOf(treasury.address);

      expect(after - before).to.equal(ethers.parseEther("20"));
    });

    it("should increase rewardPerTokenStored when librarians are staked", async function () {
      const { payment, stake, owner, renter, librarian1, rentalPrice } = await loadFixture(deployFixture);

      await stake.connect(librarian1).stakeAsLibrarian(ethers.parseEther("300"));

      const before = await payment.rewardPerTokenStored();
      await payment.connect(owner).processRentalPayment(HASH_1, renter.address, rentalPrice);
      const after = await payment.rewardPerTokenStored();

      expect(after).to.be.gt(before);
    });

    it("should emit RentalPaymentProcessed event", async function () {
      const { payment, owner, renter, rentalPrice } = await loadFixture(deployFixture);

      await expect(payment.connect(owner).processRentalPayment(HASH_1, renter.address, rentalPrice))
        .to.emit(payment, "RentalPaymentProcessed")
        .withArgs(HASH_1, renter.address, rentalPrice);
    });

    it("should revert with zero amount", async function () {
      const { payment, owner, renter } = await loadFixture(deployFixture);
      await expect(
        payment.connect(owner).processRentalPayment(HASH_1, renter.address, 0)
      ).to.be.revertedWith("Zero amount");
    });

    it("should revert when paused", async function () {
      const { payment, owner, renter, rentalPrice } = await loadFixture(deployFixture);
      await payment.pause();
      await expect(
        payment.connect(owner).processRentalPayment(HASH_1, renter.address, rentalPrice)
      ).to.be.revertedWithCustomError(payment, "EnforcedPause");
    });
  });

  // --- distributeUploadReward ---

  describe("distributeUploadReward", function () {
    it("should transfer 50 ALEX from treasury to archivist", async function () {
      const { token, payment, owner, archivist } = await loadFixture(deployFixture);

      const before = await token.balanceOf(archivist.address);
      await payment.connect(owner).distributeUploadReward(HASH_1);
      const after = await token.balanceOf(archivist.address);

      expect(after - before).to.equal(UPLOAD_REWARD);
    });

    it("should mark uploadRewardClaimed as true", async function () {
      const { payment, owner } = await loadFixture(deployFixture);
      await payment.connect(owner).distributeUploadReward(HASH_1);
      expect(await payment.uploadRewardClaimed(HASH_1)).to.be.true;
    });

    it("should emit UploadRewardDistributed event", async function () {
      const { payment, owner, archivist } = await loadFixture(deployFixture);
      await expect(payment.connect(owner).distributeUploadReward(HASH_1))
        .to.emit(payment, "UploadRewardDistributed")
        .withArgs(HASH_1, archivist.address, UPLOAD_REWARD);
    });

    it("should revert on double claim for same arweaveHash", async function () {
      const { payment, owner } = await loadFixture(deployFixture);
      await payment.connect(owner).distributeUploadReward(HASH_1);
      await expect(
        payment.connect(owner).distributeUploadReward(HASH_1)
      ).to.be.revertedWith("Reward already claimed");
    });

    it("should revert when paused", async function () {
      const { payment, owner } = await loadFixture(deployFixture);
      await payment.pause();
      await expect(
        payment.connect(owner).distributeUploadReward(HASH_1)
      ).to.be.revertedWithCustomError(payment, "EnforcedPause");
    });
  });

  // --- claimArchivistRewards ---

  describe("claimArchivistRewards", function () {
    it("should transfer pending rewards to archivist", async function () {
      const { token, payment, owner, archivist, renter, rentalPrice } = await loadFixture(deployFixture);
      await payment.connect(owner).processRentalPayment(HASH_1, renter.address, rentalPrice);

      const archivistShare = (rentalPrice * 70n) / 100n;
      const before = await token.balanceOf(archivist.address);
      await payment.connect(archivist).claimArchivistRewards();
      const after = await token.balanceOf(archivist.address);

      expect(after - before).to.equal(archivistShare);
    });

    it("should zero out pendingArchivistRewards after claim", async function () {
      const { payment, owner, archivist, renter, rentalPrice } = await loadFixture(deployFixture);
      await payment.connect(owner).processRentalPayment(HASH_1, renter.address, rentalPrice);
      await payment.connect(archivist).claimArchivistRewards();
      expect(await payment.pendingArchivistRewards(archivist.address)).to.equal(0);
    });

    it("should emit RewardClaimed event", async function () {
      const { payment, owner, archivist, renter, rentalPrice } = await loadFixture(deployFixture);
      await payment.connect(owner).processRentalPayment(HASH_1, renter.address, rentalPrice);
      const archivistShare = (rentalPrice * 70n) / 100n;

      await expect(payment.connect(archivist).claimArchivistRewards())
        .to.emit(payment, "RewardClaimed")
        .withArgs(archivist.address, archivistShare);
    });

    it("should accumulate across multiple rentals before claiming", async function () {
      const { token, payment, owner, archivist, renter, rentalPrice } = await loadFixture(deployFixture);
      await payment.connect(owner).processRentalPayment(HASH_1, renter.address, rentalPrice);
      await payment.connect(owner).processRentalPayment(HASH_1, renter.address, rentalPrice);

      const expected = ((rentalPrice * 70n) / 100n) * 2n; // 140 ALEX
      const before = await token.balanceOf(archivist.address);
      await payment.connect(archivist).claimArchivistRewards();
      const after = await token.balanceOf(archivist.address);

      expect(after - before).to.equal(expected);
    });

    it("should revert if nothing to claim", async function () {
      const { payment, archivist } = await loadFixture(deployFixture);
      await expect(
        payment.connect(archivist).claimArchivistRewards()
      ).to.be.revertedWith("Nothing to claim");
    });

    it("should revert when paused", async function () {
      const { payment, owner, archivist, renter, rentalPrice } = await loadFixture(deployFixture);
      await payment.connect(owner).processRentalPayment(HASH_1, renter.address, rentalPrice);
      await payment.pause();
      await expect(
        payment.connect(archivist).claimArchivistRewards()
      ).to.be.revertedWithCustomError(payment, "EnforcedPause");
    });
  });

  // --- Librarian Reward Accounting ---

  describe("Librarian Reward Accounting", function () {
    it("earned() returns 0 for a librarian before any rentals", async function () {
      const { payment, stake, librarian1 } = await loadFixture(deployFixture);
      await stake.connect(librarian1).stakeAsLibrarian(ethers.parseEther("300"));
      expect(await payment.earned(librarian1.address)).to.equal(0);
    });

    it("should calculate full librarian share for sole staker", async function () {
      const { payment, stake, owner, renter, librarian1, rentalPrice } = await loadFixture(deployFixture);

      await stake.connect(librarian1).stakeAsLibrarian(ethers.parseEther("100"));
      await payment.connect(owner).processRentalPayment(HASH_1, renter.address, rentalPrice);

      // Sole staker gets 100% of 10% of 100 ALEX = 10 ALEX
      expect(await payment.earned(librarian1.address)).to.equal(ethers.parseEther("10"));
    });

    it("should split proportionally between two librarians (75/25)", async function () {
      const { payment, stake, owner, renter, librarian1, librarian2, rentalPrice } = await loadFixture(deployFixture);

      // librarian1: 300 ALEX (75%), librarian2: 100 ALEX (25%), total: 400 ALEX
      await stake.connect(librarian1).stakeAsLibrarian(ethers.parseEther("300"));
      await stake.connect(librarian2).stakeAsLibrarian(ethers.parseEther("100"));

      await payment.connect(owner).processRentalPayment(HASH_1, renter.address, rentalPrice);

      // 10 ALEX total: librarian1 → 7.5 ALEX, librarian2 → 2.5 ALEX
      expect(await payment.earned(librarian1.address)).to.equal(ethers.parseEther("7.5"));
      expect(await payment.earned(librarian2.address)).to.equal(ethers.parseEther("2.5"));
    });

    it("should accumulate earned across multiple rentals", async function () {
      const { payment, stake, owner, renter, librarian1, rentalPrice } = await loadFixture(deployFixture);

      await stake.connect(librarian1).stakeAsLibrarian(ethers.parseEther("100"));
      await payment.connect(owner).processRentalPayment(HASH_1, renter.address, rentalPrice);
      await payment.connect(owner).processRentalPayment(HASH_1, renter.address, rentalPrice);

      // 10 ALEX per rental × 2 = 20 ALEX
      expect(await payment.earned(librarian1.address)).to.equal(ethers.parseEther("20"));
    });

    it("should preserve earned rewards after librarian unstakes", async function () {
      const { payment, stake, owner, renter, librarian1, rentalPrice } = await loadFixture(deployFixture);

      await stake.connect(librarian1).stakeAsLibrarian(ethers.parseEther("100"));
      await payment.connect(owner).processRentalPayment(HASH_1, renter.address, rentalPrice);

      // Unstaking calls notifyStakeChange which snapshots 10 ALEX into librarianEarned
      await time.increase(THIRTY_DAYS);
      await stake.connect(librarian1).unstakeAsLibrarian();

      // earned() should still return 10 ALEX even though stake is now 0
      expect(await payment.earned(librarian1.address)).to.equal(ethers.parseEther("10"));
    });

    it("claimLibrarianRewards should transfer correct amount", async function () {
      const { token, payment, stake, owner, renter, librarian1, rentalPrice } = await loadFixture(deployFixture);

      await stake.connect(librarian1).stakeAsLibrarian(ethers.parseEther("100"));
      await payment.connect(owner).processRentalPayment(HASH_1, renter.address, rentalPrice);

      const before = await token.balanceOf(librarian1.address);
      await payment.connect(librarian1).claimLibrarianRewards();
      const after = await token.balanceOf(librarian1.address);

      expect(after - before).to.equal(ethers.parseEther("10"));
    });

    it("claimLibrarianRewards should zero out earned balance", async function () {
      const { payment, stake, owner, renter, librarian1, rentalPrice } = await loadFixture(deployFixture);

      await stake.connect(librarian1).stakeAsLibrarian(ethers.parseEther("300"));
      await payment.connect(owner).processRentalPayment(HASH_1, renter.address, rentalPrice);

      await payment.connect(librarian1).claimLibrarianRewards();

      expect(await payment.earned(librarian1.address)).to.equal(0);
    });

    it("claimLibrarianRewards should emit RewardClaimed", async function () {
      const { payment, stake, owner, renter, librarian1, rentalPrice } = await loadFixture(deployFixture);

      await stake.connect(librarian1).stakeAsLibrarian(ethers.parseEther("100"));
      await payment.connect(owner).processRentalPayment(HASH_1, renter.address, rentalPrice);

      await expect(payment.connect(librarian1).claimLibrarianRewards())
        .to.emit(payment, "RewardClaimed")
        .withArgs(librarian1.address, ethers.parseEther("10"));
    });

    it("claimLibrarianRewards should revert if nothing to claim", async function () {
      const { payment, stake, librarian1 } = await loadFixture(deployFixture);
      await stake.connect(librarian1).stakeAsLibrarian(ethers.parseEther("300"));
      await expect(
        payment.connect(librarian1).claimLibrarianRewards()
      ).to.be.revertedWith("Nothing to claim");
    });

    it("claimLibrarianRewards should revert when paused", async function () {
      const { payment, stake, owner, renter, librarian1, rentalPrice } = await loadFixture(deployFixture);
      await stake.connect(librarian1).stakeAsLibrarian(ethers.parseEther("300"));
      await payment.connect(owner).processRentalPayment(HASH_1, renter.address, rentalPrice);
      await payment.pause();
      await expect(
        payment.connect(librarian1).claimLibrarianRewards()
      ).to.be.revertedWithCustomError(payment, "EnforcedPause");
    });

    it("notifyStakeChange should revert if not called by stake contract", async function () {
      const { payment, archivist } = await loadFixture(deployFixture);
      await expect(
        payment.connect(archivist).notifyStakeChange(archivist.address)
      ).to.be.revertedWith("Not stake contract");
    });
  });

  // --- Admin Functions ---

  describe("Admin Functions", function () {
    it("setTreasury should update treasury address", async function () {
      const { payment, archivist } = await loadFixture(deployFixture);
      await payment.setTreasury(archivist.address);
      expect(await payment.treasury()).to.equal(archivist.address);
    });

    it("setTreasury should revert for zero address", async function () {
      const { payment } = await loadFixture(deployFixture);
      await expect(
        payment.setTreasury(ethers.ZeroAddress)
      ).to.be.revertedWith("Zero address");
    });

    it("setTreasury should revert for non-owner", async function () {
      const { payment, archivist } = await loadFixture(deployFixture);
      await expect(
        payment.connect(archivist).setTreasury(archivist.address)
      ).to.be.revertedWithCustomError(payment, "OwnableUnauthorizedAccount");
    });

    it("setStakeContract should revert for zero address", async function () {
      const { payment } = await loadFixture(deployFixture);
      await expect(
        payment.setStakeContract(ethers.ZeroAddress)
      ).to.be.revertedWith("Zero address");
    });

    it("setStakeContract should revert for non-owner", async function () {
      const { payment, stake, archivist } = await loadFixture(deployFixture);
      await expect(
        payment.connect(archivist).setStakeContract(await stake.getAddress())
      ).to.be.revertedWithCustomError(payment, "OwnableUnauthorizedAccount");
    });

    it("should pause and unpause", async function () {
      const { payment } = await loadFixture(deployFixture);
      await payment.pause();
      expect(await payment.paused()).to.be.true;
      await payment.unpause();
      expect(await payment.paused()).to.be.false;
    });

    it("pause should revert for non-owner", async function () {
      const { payment, archivist } = await loadFixture(deployFixture);
      await expect(
        payment.connect(archivist).pause()
      ).to.be.revertedWithCustomError(payment, "OwnableUnauthorizedAccount");
    });
  });

  // --- Full Flows ---

  describe("Full Flows", function () {
    it("rental → archivist claims 70 ALEX", async function () {
      const { token, payment, owner, archivist, renter, rentalPrice } = await loadFixture(deployFixture);

      await payment.connect(owner).processRentalPayment(HASH_1, renter.address, rentalPrice);

      const before = await token.balanceOf(archivist.address);
      await payment.connect(archivist).claimArchivistRewards();
      const after = await token.balanceOf(archivist.address);

      expect(after - before).to.equal(ethers.parseEther("70"));
    });

    it("rental → two librarians earn and claim proportional shares", async function () {
      const { token, payment, stake, owner, renter, librarian1, librarian2, rentalPrice } = await loadFixture(deployFixture);

      await stake.connect(librarian1).stakeAsLibrarian(ethers.parseEther("300")); // 75%
      await stake.connect(librarian2).stakeAsLibrarian(ethers.parseEther("100")); // 25%

      await payment.connect(owner).processRentalPayment(HASH_1, renter.address, rentalPrice);

      const lib1Before = await token.balanceOf(librarian1.address);
      const lib2Before = await token.balanceOf(librarian2.address);

      await payment.connect(librarian1).claimLibrarianRewards();
      await payment.connect(librarian2).claimLibrarianRewards();

      expect(await token.balanceOf(librarian1.address) - lib1Before).to.equal(ethers.parseEther("7.5"));
      expect(await token.balanceOf(librarian2.address) - lib2Before).to.equal(ethers.parseEther("2.5"));
    });

    it("valid upload → archivist receives 50 ALEX upload reward from treasury", async function () {
      const { token, payment, owner, archivist } = await loadFixture(deployFixture);

      const before = await token.balanceOf(archivist.address);
      await payment.connect(owner).distributeUploadReward(HASH_1);
      const after = await token.balanceOf(archivist.address);

      expect(after - before).to.equal(UPLOAD_REWARD);
    });

    it("librarian earns, unstakes, then claims preserved rewards", async function () {
      const { token, payment, stake, owner, renter, librarian1, rentalPrice } = await loadFixture(deployFixture);

      await stake.connect(librarian1).stakeAsLibrarian(ethers.parseEther("100"));
      await payment.connect(owner).processRentalPayment(HASH_1, renter.address, rentalPrice);

      // Unstake — notifyStakeChange snapshots 10 ALEX into librarianEarned
      await time.increase(THIRTY_DAYS);
      await stake.connect(librarian1).unstakeAsLibrarian();

      // Still able to claim even after unstaking
      const before = await token.balanceOf(librarian1.address);
      await payment.connect(librarian1).claimLibrarianRewards();
      const after = await token.balanceOf(librarian1.address);

      expect(after - before).to.equal(ethers.parseEther("10"));
    });
  });
});
