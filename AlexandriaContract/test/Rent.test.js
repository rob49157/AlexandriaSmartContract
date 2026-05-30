const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");

describe("AlexandriaRent", function () {

  async function deployFixture() {
    const [owner, archivist, renter, other] = await ethers.getSigners();

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
      owner.address // treasury = owner for simplicity
    );

    const Rent = await ethers.getContractFactory("AlexandriaRent");
    const rent = await Rent.deploy(await library.getAddress(), await token.getAddress());

    // Wire contracts
    await library.setAuthorizedCaller(owner.address, true);
    await library.setAuthorizedCaller(await stake.getAddress(), true);
    await payment.setStakeContract(await stake.getAddress());
    await payment.setAuthorizedCaller(await rent.getAddress(), true);
    await stake.setPaymentContract(await payment.getAddress());
    await rent.setPaymentContract(await payment.getAddress());

    // Fund accounts
    await token.transfer(archivist.address, ethers.parseEther("1000"));
    await token.transfer(renter.address, ethers.parseEther("1000"));
    await token.transfer(other.address, ethers.parseEther("1000"));
    // Pre-fund payment contract for rental distribution
    await token.transfer(await payment.getAddress(), ethers.parseEther("5000"));

    // Register + approve an upload so it can be rented
    await library.connect(owner).registerUpload(HASH_1, archivist.address, "Test Book");
    await library.connect(owner).updateUploadStatus(HASH_1, 2); // 2 = Approved

    const pricePerDay = ethers.parseEther("10"); // 10 ALEX/day

    return { token, library, stake, payment, rent, owner, archivist, renter, other, pricePerDay };
  }

  const HASH_1 = "xJ4k2mN8pQrS9tV3wY5zA1bC6dE7fG0hI";
  const HASH_2 = "aB3c4dE5fG6hI7jK8lM9nO0pQ1rS2tU3v";

  const DURATION_1DAY  = 1 * 24 * 60 * 60;
  const DURATION_7DAY  = 7 * 24 * 60 * 60;
  const DURATION_30DAY = 30 * 24 * 60 * 60;

  // --- Deployment ---

  describe("Deployment", function () {
    it("should set correct library and token addresses", async function () {
      const { rent, library, token } = await loadFixture(deployFixture);
      expect(await rent.libraryContract()).to.equal(await library.getAddress());
      expect(await rent.tokenContract()).to.equal(await token.getAddress());
    });

    it("should set deployer as owner", async function () {
      const { rent, owner } = await loadFixture(deployFixture);
      expect(await rent.owner()).to.equal(owner.address);
    });
  });

  // --- setBookPrice ---

  describe("setBookPrice", function () {
    it("should allow archivist to set price on approved upload", async function () {
      const { rent, archivist, pricePerDay } = await loadFixture(deployFixture);
      await rent.connect(archivist).setBookPrice(HASH_1, pricePerDay);
      expect(await rent.bookPrices(HASH_1)).to.equal(pricePerDay);
    });

    it("should emit BookPriceSet event", async function () {
      const { rent, archivist, pricePerDay } = await loadFixture(deployFixture);
      await expect(rent.connect(archivist).setBookPrice(HASH_1, pricePerDay))
        .to.emit(rent, "BookPriceSet")
        .withArgs(HASH_1, pricePerDay);
    });

    it("should allow archivist to update price", async function () {
      const { rent, archivist, pricePerDay } = await loadFixture(deployFixture);
      await rent.connect(archivist).setBookPrice(HASH_1, pricePerDay);
      const newPrice = ethers.parseEther("20");
      await rent.connect(archivist).setBookPrice(HASH_1, newPrice);
      expect(await rent.bookPrices(HASH_1)).to.equal(newPrice);
    });

    it("should revert if caller is not the archivist", async function () {
      const { rent, renter, pricePerDay } = await loadFixture(deployFixture);
      await expect(
        rent.connect(renter).setBookPrice(HASH_1, pricePerDay)
      ).to.be.revertedWith("Not the Archivist");
    });

    it("should revert if price is zero", async function () {
      const { rent, archivist } = await loadFixture(deployFixture);
      await expect(
        rent.connect(archivist).setBookPrice(HASH_1, 0)
      ).to.be.revertedWith("Price must be greater than 0");
    });

    it("should revert if upload is not Approved", async function () {
      const { rent, library, owner, archivist, pricePerDay } = await loadFixture(deployFixture);
      await library.connect(owner).registerUpload(HASH_2, archivist.address, "Pending Book");
      await expect(
        rent.connect(archivist).setBookPrice(HASH_2, pricePerDay)
      ).to.be.revertedWith("Book is not approved");
    });

    it("should revert when paused", async function () {
      const { rent, archivist, pricePerDay } = await loadFixture(deployFixture);
      await rent.pause();
      await expect(
        rent.connect(archivist).setBookPrice(HASH_1, pricePerDay)
      ).to.be.revertedWithCustomError(rent, "EnforcedPause");
    });
  });

  // --- rentBook ---

  describe("rentBook", function () {
    async function setupWithPrice(fixture) {
      const f = await loadFixture(() => fixture);
      await f.rent.connect(f.archivist).setBookPrice(HASH_1, f.pricePerDay);
      await f.token.connect(f.renter).approve(await f.rent.getAddress(), ethers.parseEther("1000"));
      return f;
    }

    it("should create rental for 1 day at correct price", async function () {
      const { token, rent, archivist, renter, pricePerDay } = await loadFixture(deployFixture);
      await rent.connect(archivist).setBookPrice(HASH_1, pricePerDay);
      await token.connect(renter).approve(await rent.getAddress(), ethers.parseEther("1000"));

      const before = await token.balanceOf(renter.address);
      await rent.connect(renter).rentBook(HASH_1, DURATION_1DAY);
      const after = await token.balanceOf(renter.address);

      expect(before - after).to.equal(pricePerDay * 1n);
    });

    it("should create rental for 7 days at correct price", async function () {
      const { token, rent, archivist, renter, pricePerDay } = await loadFixture(deployFixture);
      await rent.connect(archivist).setBookPrice(HASH_1, pricePerDay);
      await token.connect(renter).approve(await rent.getAddress(), ethers.parseEther("1000"));

      const before = await token.balanceOf(renter.address);
      await rent.connect(renter).rentBook(HASH_1, DURATION_7DAY);
      const after = await token.balanceOf(renter.address);

      expect(before - after).to.equal(pricePerDay * 7n);
    });

    it("should create rental for 30 days at correct price", async function () {
      const { token, rent, archivist, renter, pricePerDay } = await loadFixture(deployFixture);
      await rent.connect(archivist).setBookPrice(HASH_1, pricePerDay);
      await token.connect(renter).approve(await rent.getAddress(), ethers.parseEther("1000"));

      const before = await token.balanceOf(renter.address);
      await rent.connect(renter).rentBook(HASH_1, DURATION_30DAY);
      const after = await token.balanceOf(renter.address);

      expect(before - after).to.equal(pricePerDay * 30n);
    });

    it("should record correct expiry timestamp", async function () {
      const { rent, token, archivist, renter, pricePerDay } = await loadFixture(deployFixture);
      await rent.connect(archivist).setBookPrice(HASH_1, pricePerDay);
      await token.connect(renter).approve(await rent.getAddress(), ethers.parseEther("1000"));

      const tx = await rent.connect(renter).rentBook(HASH_1, DURATION_7DAY);
      const block = await ethers.provider.getBlock(tx.blockNumber);
      const expectedExpiry = block.timestamp + DURATION_7DAY;

      expect(await rent.rentals(HASH_1, renter.address)).to.equal(expectedExpiry);
    });

    it("should emit BookRented event", async function () {
      const { rent, token, archivist, renter, pricePerDay } = await loadFixture(deployFixture);
      await rent.connect(archivist).setBookPrice(HASH_1, pricePerDay);
      await token.connect(renter).approve(await rent.getAddress(), ethers.parseEther("1000"));

      const tx = rent.connect(renter).rentBook(HASH_1, DURATION_1DAY);
      await expect(tx).to.emit(rent, "BookRented");
    });

    it("should revert if book not approved (Pending)", async function () {
      const { rent, library, owner, token, archivist, renter, pricePerDay } = await loadFixture(deployFixture);
      await library.connect(owner).registerUpload(HASH_2, archivist.address, "Pending Book");
      // Don't approve it — stays Pending
      await token.connect(renter).approve(await rent.getAddress(), ethers.parseEther("1000"));

      await expect(
        rent.connect(renter).rentBook(HASH_2, DURATION_1DAY)
      ).to.be.revertedWith("Book not approved");
    });

    it("should revert if book has no price set", async function () {
      const { rent, token, renter } = await loadFixture(deployFixture);
      await token.connect(renter).approve(await rent.getAddress(), ethers.parseEther("1000"));
      await expect(
        rent.connect(renter).rentBook(HASH_1, DURATION_1DAY)
      ).to.be.revertedWith("Book has no price set");
    });

    it("should revert for invalid duration", async function () {
      const { rent, token, archivist, renter, pricePerDay } = await loadFixture(deployFixture);
      await rent.connect(archivist).setBookPrice(HASH_1, pricePerDay);
      await token.connect(renter).approve(await rent.getAddress(), ethers.parseEther("1000"));

      await expect(
        rent.connect(renter).rentBook(HASH_1, 2 * 24 * 60 * 60) // 2 days — not valid
      ).to.be.revertedWith("Invalid rental duration");
    });

    it("should revert if archivist tries to rent own book", async function () {
      const { rent, token, archivist, pricePerDay } = await loadFixture(deployFixture);
      await rent.connect(archivist).setBookPrice(HASH_1, pricePerDay);
      await token.connect(archivist).approve(await rent.getAddress(), ethers.parseEther("1000"));

      await expect(
        rent.connect(archivist).rentBook(HASH_1, DURATION_1DAY)
      ).to.be.revertedWith("Archivist cannot rent own book");
    });

    it("should revert if address is blacklisted", async function () {
      const { rent, token, archivist, renter, pricePerDay } = await loadFixture(deployFixture);
      await rent.connect(archivist).setBookPrice(HASH_1, pricePerDay);
      await token.connect(renter).approve(await rent.getAddress(), ethers.parseEther("1000"));
      await rent.blacklistAddress(renter.address);

      await expect(
        rent.connect(renter).rentBook(HASH_1, DURATION_1DAY)
      ).to.be.revertedWith("Address is blacklisted");
    });

    it("should revert if book is delisted", async function () {
      const { rent, token, archivist, renter, pricePerDay } = await loadFixture(deployFixture);
      await rent.connect(archivist).setBookPrice(HASH_1, pricePerDay);
      await token.connect(renter).approve(await rent.getAddress(), ethers.parseEther("1000"));
      await rent.delistBook(HASH_1);

      await expect(
        rent.connect(renter).rentBook(HASH_1, DURATION_1DAY)
      ).to.be.revertedWith("Book delisted");
    });

    it("should revert if active rental exists (no extensions)", async function () {
      const { rent, token, archivist, renter, pricePerDay } = await loadFixture(deployFixture);
      await rent.connect(archivist).setBookPrice(HASH_1, pricePerDay);
      await token.connect(renter).approve(await rent.getAddress(), ethers.parseEther("1000"));

      await rent.connect(renter).rentBook(HASH_1, DURATION_7DAY);

      await expect(
        rent.connect(renter).rentBook(HASH_1, DURATION_1DAY)
      ).to.be.revertedWith("Active rental already exists");
    });

    it("should allow re-rental after expiry", async function () {
      const { rent, token, archivist, renter, pricePerDay } = await loadFixture(deployFixture);
      await rent.connect(archivist).setBookPrice(HASH_1, pricePerDay);
      await token.connect(renter).approve(await rent.getAddress(), ethers.parseEther("1000"));

      await rent.connect(renter).rentBook(HASH_1, DURATION_1DAY);
      await time.increase(DURATION_1DAY + 1);

      await expect(
        rent.connect(renter).rentBook(HASH_1, DURATION_1DAY)
      ).to.not.be.reverted;
    });

    it("should revert when paused", async function () {
      const { rent, token, archivist, renter, pricePerDay } = await loadFixture(deployFixture);
      await rent.connect(archivist).setBookPrice(HASH_1, pricePerDay);
      await token.connect(renter).approve(await rent.getAddress(), ethers.parseEther("1000"));
      await rent.pause();

      await expect(
        rent.connect(renter).rentBook(HASH_1, DURATION_1DAY)
      ).to.be.revertedWithCustomError(rent, "EnforcedPause");
    });
  });

  // --- isRentalActive ---

  describe("isRentalActive", function () {
    it("should return true during active rental", async function () {
      const { rent, token, archivist, renter, pricePerDay } = await loadFixture(deployFixture);
      await rent.connect(archivist).setBookPrice(HASH_1, pricePerDay);
      await token.connect(renter).approve(await rent.getAddress(), ethers.parseEther("1000"));
      await rent.connect(renter).rentBook(HASH_1, DURATION_7DAY);

      expect(await rent.isRentalActive(HASH_1, renter.address)).to.be.true;
    });

    it("should return false after rental expires", async function () {
      const { rent, token, archivist, renter, pricePerDay } = await loadFixture(deployFixture);
      await rent.connect(archivist).setBookPrice(HASH_1, pricePerDay);
      await token.connect(renter).approve(await rent.getAddress(), ethers.parseEther("1000"));
      await rent.connect(renter).rentBook(HASH_1, DURATION_1DAY);

      await time.increase(DURATION_1DAY + 1);

      expect(await rent.isRentalActive(HASH_1, renter.address)).to.be.false;
    });

    it("should return false for address with no rental", async function () {
      const { rent, other } = await loadFixture(deployFixture);
      expect(await rent.isRentalActive(HASH_1, other.address)).to.be.false;
    });

    it("should return false for blacklisted address even with active rental", async function () {
      const { rent, token, archivist, renter, pricePerDay } = await loadFixture(deployFixture);
      await rent.connect(archivist).setBookPrice(HASH_1, pricePerDay);
      await token.connect(renter).approve(await rent.getAddress(), ethers.parseEther("1000"));
      await rent.connect(renter).rentBook(HASH_1, DURATION_7DAY);
      await rent.blacklistAddress(renter.address);

      expect(await rent.isRentalActive(HASH_1, renter.address)).to.be.false;
    });

    it("should revert when contract is paused", async function () {
      const { rent, token, archivist, renter, pricePerDay } = await loadFixture(deployFixture);
      await rent.connect(archivist).setBookPrice(HASH_1, pricePerDay);
      await token.connect(renter).approve(await rent.getAddress(), ethers.parseEther("1000"));
      await rent.connect(renter).rentBook(HASH_1, DURATION_7DAY);
      await rent.pause();

      await expect(
        rent.isRentalActive(HASH_1, renter.address)
      ).to.be.revertedWithCustomError(rent, "EnforcedPause");
    });
  });

  // --- blacklistAddress ---

  describe("blacklistAddress", function () {
    it("should blacklist an address", async function () {
      const { rent, renter } = await loadFixture(deployFixture);
      await rent.blacklistAddress(renter.address);
      expect(await rent.blacklisted(renter.address)).to.be.true;
    });

    it("should emit AddressBlacklisted event", async function () {
      const { rent, renter } = await loadFixture(deployFixture);
      await expect(rent.blacklistAddress(renter.address))
        .to.emit(rent, "AddressBlacklisted")
        .withArgs(renter.address);
    });

    it("should revert if called by non-owner", async function () {
      const { rent, renter } = await loadFixture(deployFixture);
      await expect(
        rent.connect(renter).blacklistAddress(renter.address)
      ).to.be.revertedWithCustomError(rent, "OwnableUnauthorizedAccount");
    });

    it("should revert if address is zero", async function () {
      const { rent } = await loadFixture(deployFixture);
      await expect(
        rent.blacklistAddress(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid address");
    });

    it("should revert if already blacklisted", async function () {
      const { rent, renter } = await loadFixture(deployFixture);
      await rent.blacklistAddress(renter.address);
      await expect(
        rent.blacklistAddress(renter.address)
      ).to.be.revertedWith("Already blacklisted");
    });
  });

  // --- delistBook ---

  describe("delistBook", function () {
    it("should delist a book", async function () {
      const { rent } = await loadFixture(deployFixture);
      await rent.delistBook(HASH_1);
      expect(await rent.delisted(HASH_1)).to.be.true;
    });

    it("should emit BookDelisted event", async function () {
      const { rent } = await loadFixture(deployFixture);
      await expect(rent.delistBook(HASH_1))
        .to.emit(rent, "BookDelisted")
        .withArgs(HASH_1);
    });

    it("should revert if called by non-owner", async function () {
      const { rent, renter } = await loadFixture(deployFixture);
      await expect(
        rent.connect(renter).delistBook(HASH_1)
      ).to.be.revertedWithCustomError(rent, "OwnableUnauthorizedAccount");
    });

    it("should revert if book not found", async function () {
      const { rent } = await loadFixture(deployFixture);
      await expect(
        rent.delistBook("nonexistenthash")
      ).to.be.revertedWith("Book not found");
    });

    it("should revert if already delisted", async function () {
      const { rent } = await loadFixture(deployFixture);
      await rent.delistBook(HASH_1);
      await expect(
        rent.delistBook(HASH_1)
      ).to.be.revertedWith("Already delisted");
    });

    it("should honour existing rentals after delisting", async function () {
      const { rent, token, archivist, renter, pricePerDay } = await loadFixture(deployFixture);
      await rent.connect(archivist).setBookPrice(HASH_1, pricePerDay);
      await token.connect(renter).approve(await rent.getAddress(), ethers.parseEther("1000"));
      await rent.connect(renter).rentBook(HASH_1, DURATION_7DAY);

      await rent.delistBook(HASH_1);

      // Existing rental still active
      expect(await rent.isRentalActive(HASH_1, renter.address)).to.be.true;
    });
  });

  // --- Pause / Unpause ---

  describe("Pause / Unpause", function () {
    it("should pause and unpause", async function () {
      const { rent } = await loadFixture(deployFixture);
      await rent.pause();
      expect(await rent.paused()).to.be.true;
      await rent.unpause();
      expect(await rent.paused()).to.be.false;
    });

    it("should revert pause for non-owner", async function () {
      const { rent, renter } = await loadFixture(deployFixture);
      await expect(
        rent.connect(renter).pause()
      ).to.be.revertedWithCustomError(rent, "OwnableUnauthorizedAccount");
    });
  });

  // --- Full Flow ---

  describe("Full Flow", function () {
    it("rent → isRentalActive → expire → isRentalActive false", async function () {
      const { rent, token, archivist, renter, pricePerDay } = await loadFixture(deployFixture);
      await rent.connect(archivist).setBookPrice(HASH_1, pricePerDay);
      await token.connect(renter).approve(await rent.getAddress(), ethers.parseEther("1000"));

      await rent.connect(renter).rentBook(HASH_1, DURATION_1DAY);
      expect(await rent.isRentalActive(HASH_1, renter.address)).to.be.true;

      await time.increase(DURATION_1DAY + 1);
      expect(await rent.isRentalActive(HASH_1, renter.address)).to.be.false;
    });

    it("delist blocks new rentals but honours active ones", async function () {
      const { rent, token, archivist, renter, other, pricePerDay } = await loadFixture(deployFixture);
      await rent.connect(archivist).setBookPrice(HASH_1, pricePerDay);
      await token.connect(renter).approve(await rent.getAddress(), ethers.parseEther("1000"));
      await token.connect(other).approve(await rent.getAddress(), ethers.parseEther("1000"));

      // renter rents before delist
      await rent.connect(renter).rentBook(HASH_1, DURATION_7DAY);
      await rent.delistBook(HASH_1);

      // renter's existing rental still active
      expect(await rent.isRentalActive(HASH_1, renter.address)).to.be.true;

      // other cannot rent after delist
      await expect(
        rent.connect(other).rentBook(HASH_1, DURATION_1DAY)
      ).to.be.revertedWith("Book delisted");
    });
  });
});
