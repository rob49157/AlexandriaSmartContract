const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");

describe("AlexandriaToken", function () {
  async function deployFixture() {
    const [owner, user1, user2] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("AlexandriaToken");
    const token = await Token.deploy();
    return { token, owner, user1, user2 };
  }

  const TOTAL_SUPPLY = ethers.parseEther("1000000000"); // 1 billion

  describe("Deployment", function () {
    it("should deploy with correct name and symbol", async function () {
      const { token } = await loadFixture(deployFixture);
      expect(await token.name()).to.equal("Alexandria");
      expect(await token.symbol()).to.equal("ALEX");
    });

    it("should mint total supply to deployer", async function () {
      const { token, owner } = await loadFixture(deployFixture);
      expect(await token.totalSupply()).to.equal(TOTAL_SUPPLY);
      expect(await token.balanceOf(owner.address)).to.equal(TOTAL_SUPPLY);
    });

    it("should set deployer as owner", async function () {
      const { token, owner } = await loadFixture(deployFixture);
      expect(await token.owner()).to.equal(owner.address);
    });
  });

  describe("Transfers", function () {
    it("should transfer tokens between accounts", async function () {
      const { token, owner, user1 } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("1000");

      await token.transfer(user1.address, amount);
      expect(await token.balanceOf(user1.address)).to.equal(amount);
      expect(await token.balanceOf(owner.address)).to.equal(TOTAL_SUPPLY - amount);
    });

    it("should fail transfer with insufficient balance", async function () {
      const { token, user1, user2 } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("1");

      await expect(
        token.connect(user1).transfer(user2.address, amount)
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });
  });

  describe("Approve and TransferFrom", function () {
    it("should approve and allow transferFrom", async function () {
      const { token, owner, user1, user2 } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("500");

      await token.approve(user1.address, amount);
      expect(await token.allowance(owner.address, user1.address)).to.equal(amount);

      await token.connect(user1).transferFrom(owner.address, user2.address, amount);
      expect(await token.balanceOf(user2.address)).to.equal(amount);
    });

    it("should fail transferFrom without approval", async function () {
      const { token, owner, user1, user2 } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("500");

      await expect(
        token.connect(user1).transferFrom(owner.address, user2.address, amount)
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });
  });

  describe("Burning", function () {
    it("should allow token holder to burn their tokens", async function () {
      const { token, owner } = await loadFixture(deployFixture);
      const burnAmount = ethers.parseEther("1000");

      await token.burn(burnAmount);
      expect(await token.balanceOf(owner.address)).to.equal(TOTAL_SUPPLY - burnAmount);
      expect(await token.totalSupply()).to.equal(TOTAL_SUPPLY - burnAmount);
    });

    it("should allow approved address to burnFrom", async function () {
      const { token, owner, user1 } = await loadFixture(deployFixture);
      const burnAmount = ethers.parseEther("500");

      await token.approve(user1.address, burnAmount);
      await token.connect(user1).burnFrom(owner.address, burnAmount);
      expect(await token.totalSupply()).to.equal(TOTAL_SUPPLY - burnAmount);
    });

    it("should fail burn with insufficient balance", async function () {
      const { token, user1 } = await loadFixture(deployFixture);

      await expect(
        token.connect(user1).burn(ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });
  });

  describe("Pausable", function () {
    it("should allow owner to pause", async function () {
      const { token } = await loadFixture(deployFixture);
      await token.pause();
      expect(await token.paused()).to.be.true;
    });

    it("should block transfers when paused", async function () {
      const { token, owner, user1 } = await loadFixture(deployFixture);
      await token.pause();

      await expect(
        token.transfer(user1.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(token, "EnforcedPause");
    });

    it("should allow transfers after unpause", async function () {
      const { token, owner, user1 } = await loadFixture(deployFixture);
      await token.pause();
      await token.unpause();

      await token.transfer(user1.address, ethers.parseEther("100"));
      expect(await token.balanceOf(user1.address)).to.equal(ethers.parseEther("100"));
    });

    it("should prevent non-owner from pausing", async function () {
      const { token, user1 } = await loadFixture(deployFixture);

      await expect(
        token.connect(user1).pause()
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });

    it("should prevent non-owner from unpausing", async function () {
      const { token, user1 } = await loadFixture(deployFixture);
      await token.pause();

      await expect(
        token.connect(user1).unpause()
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });
  });

  describe("Ownership", function () {
    it("should allow owner to transfer ownership", async function () {
      const { token, owner, user1 } = await loadFixture(deployFixture);
      await token.transferOwnership(user1.address);
      expect(await token.owner()).to.equal(user1.address);
    });

    it("should prevent non-owner from transferring ownership", async function () {
      const { token, user1, user2 } = await loadFixture(deployFixture);

      await expect(
        token.connect(user1).transferOwnership(user2.address)
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });
  });
});
