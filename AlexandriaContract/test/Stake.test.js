const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");

describe("AlexandriaStake", function () {
  async function deployFixture() {
    const [owner, archivist, librarian, user1, user2] = await ethers.getSigners();

    // Deploy token
    const Token = await ethers.getContractFactory("AlexandriaToken");
    const token = await Token.deploy();

    // Deploy library
    const Library = await ethers.getContractFactory("AlexandriaLibrary");
    const library = await Library.deploy();

    // Deploy stake
    const Stake = await ethers.getContractFactory("AlexandriaStake");
    const stake = await Stake.deploy(await library.getAddress(), await token.getAddress());

    // Wire up: authorize stake contract on library, and owner as backend
    await library.setAuthorizedCaller(await stake.getAddress(), true);
    await library.setAuthorizedCaller(owner.address, true);

    // Fund archivist and librarian with tokens and approve stake contract
    const stakeAmount = ethers.parseEther("100");
    const librarianStakeAmount = ethers.parseEther("50");
    await token.transfer(archivist.address, ethers.parseEther("1000"));
    await token.transfer(librarian.address, ethers.parseEther("1000"));
    await token.connect(archivist).approve(await stake.getAddress(), ethers.parseEther("1000"));
    await token.connect(librarian).approve(await stake.getAddress(), ethers.parseEther("1000"));

    // Librarian stakes to become authorized
    await stake.connect(librarian).stakeAsLibrarian(librarianStakeAmount);

    return { token, library, stake, owner, archivist, librarian, user1, user2, stakeAmount, librarianStakeAmount };
  }

  // Helper: register upload and stake in one go
  async function registerAndStake(library, stake, owner, archivist, hash, stakeAmount) {
    await library.connect(owner).registerUpload(hash, archivist.address, "Test Book");
    await stake.connect(archivist).stake(hash, stakeAmount);
  }

  const HASH_1 = "xJ4k2mN8pQrS9tV3wY5zA1bC6dE7fG0hI";
  const HASH_2 = "aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV";
  const FOURTEEN_DAYS = 14 * 24 * 60 * 60;
  const THIRTY_DAYS = 30 * 24 * 60 * 60;

  describe("Deployment", function () {
    it("should set correct library and token addresses", async function () {
      const { stake, library, token } = await loadFixture(deployFixture);
      expect(await stake.libraryContract()).to.equal(await library.getAddress());
      expect(await stake.tokenContract()).to.equal(await token.getAddress());
    });

    it("should set deployer as owner", async function () {
      const { stake, owner } = await loadFixture(deployFixture);
      expect(await stake.owner()).to.equal(owner.address);
    });
  });

  describe("Staking", function () {
    it("should lock correct token amount", async function () {
      const { token, library, stake, owner, archivist, stakeAmount } = await loadFixture(deployFixture);
      await library.connect(owner).registerUpload(HASH_1, archivist.address, "Test Book");

      const balanceBefore = await token.balanceOf(archivist.address);
      await stake.connect(archivist).stake(HASH_1, stakeAmount);
      const balanceAfter = await token.balanceOf(archivist.address);

      expect(balanceBefore - balanceAfter).to.equal(stakeAmount);
    });

    it("should record correct stake info", async function () {
      const { library, stake, owner, archivist, stakeAmount } = await loadFixture(deployFixture);
      await library.connect(owner).registerUpload(HASH_1, archivist.address, "Test Book");
      await stake.connect(archivist).stake(HASH_1, stakeAmount);

      const info = await stake.stakes(HASH_1);
      expect(info.staker).to.equal(archivist.address);
      expect(info.amount).to.equal(stakeAmount);
      expect(info.active).to.be.true;
    });

    it("should emit Staked event", async function () {
      const { library, stake, owner, archivist, stakeAmount } = await loadFixture(deployFixture);
      await library.connect(owner).registerUpload(HASH_1, archivist.address, "Test Book");

      await expect(stake.connect(archivist).stake(HASH_1, stakeAmount))
        .to.emit(stake, "Staked")
        .withArgs(HASH_1, archivist.address, stakeAmount);
    });

    it("should revert below minimum stake amount", async function () {
      const { library, stake, owner, archivist } = await loadFixture(deployFixture);
      await library.connect(owner).registerUpload(HASH_1, archivist.address, "Test Book");

      await expect(
        stake.connect(archivist).stake(HASH_1, ethers.parseEther("50"))
      ).to.be.revertedWith("Stake amount too low");
    });

    it("should revert if upload does not exist", async function () {
      const { stake, archivist, stakeAmount } = await loadFixture(deployFixture);

      await expect(
        stake.connect(archivist).stake(HASH_1, stakeAmount)
      ).to.be.revertedWith("Upload not found");
    });

    it("should revert if already staked on same upload", async function () {
      const { library, stake, owner, archivist, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);

      await expect(
        stake.connect(archivist).stake(HASH_1, stakeAmount)
      ).to.be.revertedWith("Already staked");
    });

    it("should revert with insufficient balance", async function () {
      const { token, library, stake, owner, user1, stakeAmount } = await loadFixture(deployFixture);
      await library.connect(owner).registerUpload(HASH_1, user1.address, "Test Book");
      await token.connect(user1).approve(await stake.getAddress(), stakeAmount);

      await expect(
        stake.connect(user1).stake(HASH_1, stakeAmount)
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });

    it("should revert without token approval", async function () {
      const { token, library, stake, owner, user1 } = await loadFixture(deployFixture);
      await library.connect(owner).registerUpload(HASH_1, user1.address, "Test Book");
      await token.transfer(user1.address, ethers.parseEther("200"));

      await expect(
        stake.connect(user1).stake(HASH_1, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });
  });

  describe("Unstaking", function () {
    it("should return stake after 14 days", async function () {
      const { token, library, stake, owner, archivist, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);

      const balanceBefore = await token.balanceOf(archivist.address);
      await time.increase(FOURTEEN_DAYS);
      await stake.connect(archivist).unstake(HASH_1);
      const balanceAfter = await token.balanceOf(archivist.address);

      expect(balanceAfter - balanceBefore).to.equal(stakeAmount);
    });

    it("should mark stake as inactive after unstaking", async function () {
      const { library, stake, owner, archivist, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);

      await time.increase(FOURTEEN_DAYS);
      await stake.connect(archivist).unstake(HASH_1);

      const info = await stake.stakes(HASH_1);
      expect(info.active).to.be.false;
    });

    it("should set upload status to Approved", async function () {
      const { library, stake, owner, archivist, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);

      await time.increase(FOURTEEN_DAYS);
      await stake.connect(archivist).unstake(HASH_1);

      expect(await library.getUploadStatus(HASH_1)).to.equal(2); // Approved
    });

    it("should emit Unstaked event", async function () {
      const { library, stake, owner, archivist, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);

      await time.increase(FOURTEEN_DAYS);
      await expect(stake.connect(archivist).unstake(HASH_1))
        .to.emit(stake, "Unstaked")
        .withArgs(HASH_1, archivist.address, stakeAmount);
    });

    it("should revert before 14 days", async function () {
      const { library, stake, owner, archivist, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);

      await time.increase(FOURTEEN_DAYS - 100);
      await expect(
        stake.connect(archivist).unstake(HASH_1)
      ).to.be.revertedWith("Challenge period not over");
    });

    it("should revert if no active stake", async function () {
      const { stake, archivist } = await loadFixture(deployFixture);

      await expect(
        stake.connect(archivist).unstake(HASH_1)
      ).to.be.revertedWith("No active stake");
    });

    it("should revert if caller is not staker", async function () {
      const { library, stake, owner, archivist, user1, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);

      await time.increase(FOURTEEN_DAYS);
      await expect(
        stake.connect(user1).unstake(HASH_1)
      ).to.be.revertedWith("Not staker");
    });

    it("should revert if upload is Challenged", async function () {
      const { library, stake, owner, archivist, librarian, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);

      await stake.connect(librarian).challengeUpload(HASH_1, "Suspicious content");
      await time.increase(FOURTEEN_DAYS);

      await expect(
        stake.connect(archivist).unstake(HASH_1)
      ).to.be.revertedWith("Upload is challenged");
    });

    it("should revert if upload is Rejected", async function () {
      const { library, stake, owner, archivist, librarian, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);

      await stake.connect(librarian).challengeUpload(HASH_1, "Bad content");
      await stake.connect(owner).resolveChallenge(HASH_1, false);

      await time.increase(FOURTEEN_DAYS);
      await expect(
        stake.connect(archivist).unstake(HASH_1)
      ).to.be.revertedWith("No active stake");
    });
  });

  describe("Librarian Staking", function () {
    it("should lock tokens and activate librarian", async function () {
      const { token, stake, user1 } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("50");
      await token.transfer(user1.address, ethers.parseEther("100"));
      await token.connect(user1).approve(await stake.getAddress(), amount);

      await stake.connect(user1).stakeAsLibrarian(amount);

      const info = await stake.librarians(user1.address);
      expect(info.amount).to.equal(amount);
      expect(info.active).to.be.true;
    });

    it("should emit LibrarianStaked event", async function () {
      const { token, stake, user1 } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("50");
      await token.transfer(user1.address, ethers.parseEther("100"));
      await token.connect(user1).approve(await stake.getAddress(), amount);

      await expect(stake.connect(user1).stakeAsLibrarian(amount))
        .to.emit(stake, "LibrarianStaked")
        .withArgs(user1.address, amount);
    });

    it("should revert below minimum librarian stake", async function () {
      const { token, stake, user1 } = await loadFixture(deployFixture);
      await token.transfer(user1.address, ethers.parseEther("100"));
      await token.connect(user1).approve(await stake.getAddress(), ethers.parseEther("100"));

      await expect(
        stake.connect(user1).stakeAsLibrarian(ethers.parseEther("25"))
      ).to.be.revertedWith("Librarian stake too low");
    });

    it("should revert if already staked as librarian", async function () {
      const { stake, librarian } = await loadFixture(deployFixture);
      // librarian already staked in fixture
      await expect(
        stake.connect(librarian).stakeAsLibrarian(ethers.parseEther("50"))
      ).to.be.revertedWith("Already staked as librarian");
    });

    it("should revert with insufficient balance", async function () {
      const { token, stake, user1 } = await loadFixture(deployFixture);
      // user1 has no tokens
      await token.connect(user1).approve(await stake.getAddress(), ethers.parseEther("50"));

      await expect(
        stake.connect(user1).stakeAsLibrarian(ethers.parseEther("50"))
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });

    it("should revert without token approval", async function () {
      const { token, stake, user1 } = await loadFixture(deployFixture);
      await token.transfer(user1.address, ethers.parseEther("100"));

      await expect(
        stake.connect(user1).stakeAsLibrarian(ethers.parseEther("50"))
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });
  });

  describe("Librarian Unstaking", function () {
    it("should return stake after 30-day cooldown", async function () {
      const { token, stake, librarian, librarianStakeAmount } = await loadFixture(deployFixture);

      const balanceBefore = await token.balanceOf(librarian.address);
      await time.increase(THIRTY_DAYS);
      await stake.connect(librarian).unstakeAsLibrarian();
      const balanceAfter = await token.balanceOf(librarian.address);

      expect(balanceAfter - balanceBefore).to.equal(librarianStakeAmount);
    });

    it("should deactivate librarian after unstaking", async function () {
      const { stake, librarian } = await loadFixture(deployFixture);

      await time.increase(THIRTY_DAYS);
      await stake.connect(librarian).unstakeAsLibrarian();

      const info = await stake.librarians(librarian.address);
      expect(info.active).to.be.false;
      expect(info.amount).to.equal(0);
    });

    it("should emit LibrarianUnstaked event", async function () {
      const { stake, librarian, librarianStakeAmount } = await loadFixture(deployFixture);

      await time.increase(THIRTY_DAYS);
      await expect(stake.connect(librarian).unstakeAsLibrarian())
        .to.emit(stake, "LibrarianUnstaked")
        .withArgs(librarian.address, librarianStakeAmount);
    });

    it("should revert before 30-day cooldown", async function () {
      const { stake, librarian } = await loadFixture(deployFixture);

      await time.increase(THIRTY_DAYS - 100);
      await expect(
        stake.connect(librarian).unstakeAsLibrarian()
      ).to.be.revertedWith("Cooldown period not over");
    });

    it("should revert if not an active librarian", async function () {
      const { stake, user1 } = await loadFixture(deployFixture);

      await expect(
        stake.connect(user1).unstakeAsLibrarian()
      ).to.be.revertedWith("Not an active librarian");
    });

    it("should prevent challenging after unstaking", async function () {
      const { library, stake, owner, archivist, librarian, stakeAmount } = await loadFixture(deployFixture);

      // Unstake as librarian
      await time.increase(THIRTY_DAYS);
      await stake.connect(librarian).unstakeAsLibrarian();

      // Register and stake an upload
      await library.connect(owner).registerUpload(HASH_1, archivist.address, "Test Book");
      await stake.connect(archivist).stake(HASH_1, stakeAmount);

      await expect(
        stake.connect(librarian).challengeUpload(HASH_1, "Should fail")
      ).to.be.revertedWith("Not an active librarian");
    });
  });

  describe("Challenge Upload", function () {
    it("should allow active librarian to challenge", async function () {
      const { library, stake, owner, archivist, librarian, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);

      await stake.connect(librarian).challengeUpload(HASH_1, "Duplicate content");

      const challenge = await stake.challenges(HASH_1);
      expect(challenge.challenger).to.equal(librarian.address);
      expect(challenge.resolved).to.be.false;
    });

    it("should update upload status to Challenged", async function () {
      const { library, stake, owner, archivist, librarian, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);

      await stake.connect(librarian).challengeUpload(HASH_1, "Duplicate content");

      expect(await library.getUploadStatus(HASH_1)).to.equal(1); // Challenged
    });

    it("should emit challengeInitiated event", async function () {
      const { library, stake, owner, archivist, librarian, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);

      await expect(stake.connect(librarian).challengeUpload(HASH_1, "Duplicate"))
        .to.emit(stake, "challengeInitiated")
        .withArgs(HASH_1, librarian.address, "Duplicate");
    });

    it("should revert if not an active librarian", async function () {
      const { library, stake, owner, archivist, user1, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);

      await expect(
        stake.connect(user1).challengeUpload(HASH_1, "Bad content")
      ).to.be.revertedWith("Not an active librarian");
    });

    it("should revert if archivist challenges own upload", async function () {
      const { token, library, stake, owner, archivist, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);
      // Make archivist also a librarian by staking
      await token.connect(archivist).approve(await stake.getAddress(), ethers.parseEther("50"));
      await stake.connect(archivist).stakeAsLibrarian(ethers.parseEther("50"));

      await expect(
        stake.connect(archivist).challengeUpload(HASH_1, "Self challenge")
      ).to.be.revertedWith("Cannot challenge own upload");
    });

    it("should revert after 14-day window expires", async function () {
      const { library, stake, owner, archivist, librarian, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);

      await time.increase(FOURTEEN_DAYS);
      await expect(
        stake.connect(librarian).challengeUpload(HASH_1, "Too late")
      ).to.be.revertedWith("Challenge period expired");
    });

    it("should revert if no active stake", async function () {
      const { library, stake, owner, archivist, librarian } = await loadFixture(deployFixture);
      await library.connect(owner).registerUpload(HASH_1, archivist.address, "Test Book");

      await expect(
        stake.connect(librarian).challengeUpload(HASH_1, "No stake")
      ).to.be.revertedWith("No active stake");
    });

    it("should revert on double challenge", async function () {
      const { library, stake, owner, archivist, librarian, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);

      await stake.connect(librarian).challengeUpload(HASH_1, "First challenge");

      await expect(
        stake.connect(librarian).challengeUpload(HASH_1, "Second challenge")
      ).to.be.revertedWith("Upload not in pending status");
    });

    it("should revert if upload is not Pending", async function () {
      const { library, stake, owner, archivist, librarian, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);

      await time.increase(FOURTEEN_DAYS);
      await stake.connect(archivist).unstake(HASH_1);

      await expect(
        stake.connect(librarian).challengeUpload(HASH_1, "Already approved")
      ).to.be.revertedWith("No active stake");
    });
  });

  describe("Resolve Challenge", function () {
    it("should return stake to archivist when approved", async function () {
      const { token, library, stake, owner, archivist, librarian, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);
      await stake.connect(librarian).challengeUpload(HASH_1, "Suspicious");

      const balanceBefore = await token.balanceOf(archivist.address);
      await stake.connect(owner).resolveChallenge(HASH_1, true);
      const balanceAfter = await token.balanceOf(archivist.address);

      // Archivist gets stake back + 50% of librarian's stake
      const librarianSlash = ethers.parseEther("25"); // 50% of 50 ALEX
      expect(balanceAfter - balanceBefore).to.equal(stakeAmount + librarianSlash);
    });

    it("should slash librarian 50% when wrong challenge", async function () {
      const { token, library, stake, owner, archivist, librarian, stakeAmount, librarianStakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);
      await stake.connect(librarian).challengeUpload(HASH_1, "Suspicious");

      await stake.connect(owner).resolveChallenge(HASH_1, true);

      // Librarian's stake should be halved
      const info = await stake.librarians(librarian.address);
      expect(info.amount).to.equal(librarianStakeAmount / 2n);
    });

    it("should emit LibrarianSlashed event when wrong challenge", async function () {
      const { library, stake, owner, archivist, librarian, stakeAmount, librarianStakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);
      await stake.connect(librarian).challengeUpload(HASH_1, "Suspicious");

      const slashAmount = librarianStakeAmount / 2n;
      await expect(stake.connect(owner).resolveChallenge(HASH_1, true))
        .to.emit(stake, "LibrarianSlashed")
        .withArgs(librarian.address, slashAmount, archivist.address);
    });

    it("should set status to Approved when approved", async function () {
      const { library, stake, owner, archivist, librarian, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);
      await stake.connect(librarian).challengeUpload(HASH_1, "Suspicious");

      await stake.connect(owner).resolveChallenge(HASH_1, true);
      expect(await library.getUploadStatus(HASH_1)).to.equal(2); // Approved
    });

    it("should slash archivist stake when rejected", async function () {
      const { token, library, stake, owner, archivist, librarian, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);
      await stake.connect(librarian).challengeUpload(HASH_1, "Bad content");

      const librarianBefore = await token.balanceOf(librarian.address);
      await stake.connect(owner).resolveChallenge(HASH_1, false);
      const librarianAfter = await token.balanceOf(librarian.address);

      // Challenger gets 70% of archivist stake
      const expectedReward = (stakeAmount * 70n) / 100n;
      expect(librarianAfter - librarianBefore).to.equal(expectedReward);
    });

    it("should burn 30% of archivist stake when rejected", async function () {
      const { token, library, stake, owner, archivist, librarian, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);
      await stake.connect(librarian).challengeUpload(HASH_1, "Bad content");

      const totalSupplyBefore = await token.totalSupply();
      await stake.connect(owner).resolveChallenge(HASH_1, false);
      const totalSupplyAfter = await token.totalSupply();

      const expectedBurn = stakeAmount - (stakeAmount * 70n) / 100n;
      expect(totalSupplyBefore - totalSupplyAfter).to.equal(expectedBurn);
    });

    it("should not slash librarian when correct challenge", async function () {
      const { library, stake, owner, archivist, librarian, stakeAmount, librarianStakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);
      await stake.connect(librarian).challengeUpload(HASH_1, "Bad content");

      await stake.connect(owner).resolveChallenge(HASH_1, false);

      // Librarian's stake should be untouched
      const info = await stake.librarians(librarian.address);
      expect(info.amount).to.equal(librarianStakeAmount);
    });

    it("should set status to Rejected when rejected", async function () {
      const { library, stake, owner, archivist, librarian, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);
      await stake.connect(librarian).challengeUpload(HASH_1, "Bad content");

      await stake.connect(owner).resolveChallenge(HASH_1, false);
      expect(await library.getUploadStatus(HASH_1)).to.equal(3); // Rejected
    });

    it("should mark challenge as resolved", async function () {
      const { library, stake, owner, archivist, librarian, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);
      await stake.connect(librarian).challengeUpload(HASH_1, "Suspicious");

      await stake.connect(owner).resolveChallenge(HASH_1, true);
      const challenge = await stake.challenges(HASH_1);
      expect(challenge.resolved).to.be.true;
    });

    it("should emit ChallengeResolved event", async function () {
      const { library, stake, owner, archivist, librarian, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);
      await stake.connect(librarian).challengeUpload(HASH_1, "Suspicious");

      await expect(stake.connect(owner).resolveChallenge(HASH_1, true))
        .to.emit(stake, "ChallengeResolved")
        .withArgs(HASH_1, true);
    });

    it("should emit slashed event when rejected", async function () {
      const { library, stake, owner, archivist, librarian, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);
      await stake.connect(librarian).challengeUpload(HASH_1, "Bad content");

      await expect(stake.connect(owner).resolveChallenge(HASH_1, false))
        .to.emit(stake, "slashed")
        .withArgs(HASH_1, archivist.address, stakeAmount);
    });

    it("should revert if no challenge exists", async function () {
      const { library, stake, owner, archivist, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);

      await expect(
        stake.connect(owner).resolveChallenge(HASH_1, true)
      ).to.be.revertedWith("No challenge exists");
    });

    it("should revert if challenge already resolved", async function () {
      const { library, stake, owner, archivist, librarian, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);
      await stake.connect(librarian).challengeUpload(HASH_1, "Suspicious");
      await stake.connect(owner).resolveChallenge(HASH_1, true);

      await expect(
        stake.connect(owner).resolveChallenge(HASH_1, false)
      ).to.be.revertedWith("Challenge already resolved");
    });

    it("should revert if called by non-owner", async function () {
      const { library, stake, owner, archivist, librarian, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);
      await stake.connect(librarian).challengeUpload(HASH_1, "Suspicious");

      await expect(
        stake.connect(librarian).resolveChallenge(HASH_1, true)
      ).to.be.revertedWithCustomError(stake, "OwnableUnauthorizedAccount");
    });
  });

  describe("Auto-Approval Flow", function () {
    it("full happy path: stake → 14 days → unstake → Approved", async function () {
      const { token, library, stake, owner, archivist, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);

      expect(await library.getUploadStatus(HASH_1)).to.equal(0); // Pending
      const info = await stake.stakes(HASH_1);
      expect(info.active).to.be.true;

      await time.increase(FOURTEEN_DAYS);

      const balanceBefore = await token.balanceOf(archivist.address);
      await stake.connect(archivist).unstake(HASH_1);
      const balanceAfter = await token.balanceOf(archivist.address);

      expect(balanceAfter - balanceBefore).to.equal(stakeAmount);
      expect(await library.getUploadStatus(HASH_1)).to.equal(2); // Approved
      const infoAfter = await stake.stakes(HASH_1);
      expect(infoAfter.active).to.be.false;
    });

    it("full rejection path: stake → challenge → reject → slash", async function () {
      const { token, library, stake, owner, archivist, librarian, stakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);

      await stake.connect(librarian).challengeUpload(HASH_1, "Plagiarized content");
      expect(await library.getUploadStatus(HASH_1)).to.equal(1); // Challenged

      const librarianBefore = await token.balanceOf(librarian.address);
      const supplyBefore = await token.totalSupply();
      await stake.connect(owner).resolveChallenge(HASH_1, false);

      const librarianAfter = await token.balanceOf(librarian.address);
      const supplyAfter = await token.totalSupply();
      const expectedReward = (stakeAmount * 70n) / 100n;
      const expectedBurn = stakeAmount - expectedReward;

      expect(librarianAfter - librarianBefore).to.equal(expectedReward);
      expect(supplyBefore - supplyAfter).to.equal(expectedBurn);
      expect(await library.getUploadStatus(HASH_1)).to.equal(3); // Rejected
    });

    it("full wrong challenge path: stake → challenge → approve → librarian slashed", async function () {
      const { token, library, stake, owner, archivist, librarian, stakeAmount, librarianStakeAmount } = await loadFixture(deployFixture);
      await registerAndStake(library, stake, owner, archivist, HASH_1, stakeAmount);

      await stake.connect(librarian).challengeUpload(HASH_1, "False accusation");

      const archivistBefore = await token.balanceOf(archivist.address);
      await stake.connect(owner).resolveChallenge(HASH_1, true);
      const archivistAfter = await token.balanceOf(archivist.address);

      // Archivist gets stake back + 50% of librarian stake
      const libSlash = librarianStakeAmount / 2n;
      expect(archivistAfter - archivistBefore).to.equal(stakeAmount + libSlash);

      // Librarian stake halved
      const libInfo = await stake.librarians(librarian.address);
      expect(libInfo.amount).to.equal(librarianStakeAmount / 2n);

      expect(await library.getUploadStatus(HASH_1)).to.equal(2); // Approved
    });
  });
});
