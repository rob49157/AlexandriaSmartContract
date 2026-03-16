const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");

describe("AlexandriaLibrary", function () {
  async function deployFixture() {
    const [owner, backend, stakeContract, uploader1, uploader2] = await ethers.getSigners();
    const Library = await ethers.getContractFactory("AlexandriaLibrary");
    const library = await Library.deploy();

    // Authorize the backend to register uploads
    await library.setAuthorizedCaller(backend.address, true);

    return { library, owner, backend, stakeContract, uploader1, uploader2 };
  }

  const HASH_1 = "xJ4k2mN8pQrS9tV3wY5zA1bC6dE7fG0hI";
  const HASH_2 = "aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV";
  const METADATA_1 = "The Great Gatsby by F. Scott Fitzgerald";
  const METADATA_2 = "1984 by George Orwell";

  describe("Deployment", function () {
    it("should set deployer as owner", async function () {
      const { library, owner } = await loadFixture(deployFixture);
      expect(await library.owner()).to.equal(owner.address);
    });
  });

  describe("Authorization", function () {
    it("should allow owner to set authorized callers", async function () {
      const { library, stakeContract } = await loadFixture(deployFixture);
      await library.setAuthorizedCaller(stakeContract.address, true);
      expect(await library.authorizedCallers(stakeContract.address)).to.be.true;
    });

    it("should allow owner to revoke authorized callers", async function () {
      const { library, backend } = await loadFixture(deployFixture);
      await library.setAuthorizedCaller(backend.address, false);
      expect(await library.authorizedCallers(backend.address)).to.be.false;
    });

    it("should prevent non-owner from setting authorized callers", async function () {
      const { library, uploader1, uploader2 } = await loadFixture(deployFixture);
      await expect(
        library.connect(uploader1).setAuthorizedCaller(uploader2.address, true)
      ).to.be.revertedWithCustomError(library, "OwnableUnauthorizedAccount");
    });

    it("should emit AuthorizedCallerSet event", async function () {
      const { library, stakeContract } = await loadFixture(deployFixture);
      await expect(library.setAuthorizedCaller(stakeContract.address, true))
        .to.emit(library, "AuthorizedCallerSet")
        .withArgs(stakeContract.address, true);
    });
  });

  describe("Register Upload", function () {
    it("should register upload with correct metadata", async function () {
      const { library, backend, uploader1 } = await loadFixture(deployFixture);

      await library.connect(backend).registerUpload(HASH_1, uploader1.address, METADATA_1);

      const upload = await library.getUpload(HASH_1);
      expect(upload.arweaveHash).to.equal(HASH_1);
      expect(upload.uploader).to.equal(uploader1.address);
      expect(upload.status).to.equal(0); // Pending
      expect(upload.metadata).to.equal(METADATA_1);
      expect(upload.timestamp).to.be.greaterThan(0);
    });

    it("should revert on duplicate arweaveHash registration", async function () {
      const { library, backend, uploader1 } = await loadFixture(deployFixture);

      await library.connect(backend).registerUpload(HASH_1, uploader1.address, METADATA_1);
      await expect(
        library.connect(backend).registerUpload(HASH_1, uploader1.address, METADATA_1)
      ).to.be.revertedWith("Upload already registered");
    });

    it("should revert when called by unauthorized address", async function () {
      const { library, uploader1 } = await loadFixture(deployFixture);

      await expect(
        library.connect(uploader1).registerUpload(HASH_1, uploader1.address, METADATA_1)
      ).to.be.revertedWith("Not authorized");
    });

    it("should revert on empty arweave hash", async function () {
      const { library, backend, uploader1 } = await loadFixture(deployFixture);

      await expect(
        library.connect(backend).registerUpload("", uploader1.address, METADATA_1)
      ).to.be.revertedWith("Empty arweave hash");
    });

    it("should revert on zero address uploader", async function () {
      const { library, backend } = await loadFixture(deployFixture);

      await expect(
        library.connect(backend).registerUpload(HASH_1, ethers.ZeroAddress, METADATA_1)
      ).to.be.revertedWith("Invalid uploader address");
    });

    it("should allow owner to register uploads directly", async function () {
      const { library, owner, uploader1 } = await loadFixture(deployFixture);

      await library.registerUpload(HASH_1, uploader1.address, METADATA_1);
      const upload = await library.getUpload(HASH_1);
      expect(upload.uploader).to.equal(uploader1.address);
    });

    it("should emit UploadRegistered event", async function () {
      const { library, backend, uploader1 } = await loadFixture(deployFixture);

      await expect(library.connect(backend).registerUpload(HASH_1, uploader1.address, METADATA_1))
        .to.emit(library, "UploadRegistered")
        .withArgs(HASH_1, uploader1.address, METADATA_1);
    });

    it("should track uploader's upload list", async function () {
      const { library, backend, uploader1 } = await loadFixture(deployFixture);

      await library.connect(backend).registerUpload(HASH_1, uploader1.address, METADATA_1);
      await library.connect(backend).registerUpload(HASH_2, uploader1.address, METADATA_2);

      const hashes = await library.getUploaderHashes(uploader1.address);
      expect(hashes).to.have.lengthOf(2);
      expect(hashes[0]).to.equal(HASH_1);
      expect(hashes[1]).to.equal(HASH_2);
    });
  });

  describe("Update Upload Status", function () {
    it("should update status from Pending to Challenged", async function () {
      const { library, backend, stakeContract, uploader1 } = await loadFixture(deployFixture);
      await library.setAuthorizedCaller(stakeContract.address, true);
      await library.connect(backend).registerUpload(HASH_1, uploader1.address, METADATA_1);

      await library.connect(stakeContract).updateUploadStatus(HASH_1, 1); // Challenged
      expect(await library.getUploadStatus(HASH_1)).to.equal(1);
    });

    it("should update status from Pending to Approved", async function () {
      const { library, backend, stakeContract, uploader1 } = await loadFixture(deployFixture);
      await library.setAuthorizedCaller(stakeContract.address, true);
      await library.connect(backend).registerUpload(HASH_1, uploader1.address, METADATA_1);

      await library.connect(stakeContract).updateUploadStatus(HASH_1, 2); // Approved
      expect(await library.getUploadStatus(HASH_1)).to.equal(2);
    });

    it("should update status from Challenged to Rejected", async function () {
      const { library, backend, stakeContract, uploader1 } = await loadFixture(deployFixture);
      await library.setAuthorizedCaller(stakeContract.address, true);
      await library.connect(backend).registerUpload(HASH_1, uploader1.address, METADATA_1);

      await library.connect(stakeContract).updateUploadStatus(HASH_1, 1); // Challenged
      await library.connect(stakeContract).updateUploadStatus(HASH_1, 3); // Rejected
      expect(await library.getUploadStatus(HASH_1)).to.equal(3);
    });

    it("should revert when upload not found", async function () {
      const { library, backend } = await loadFixture(deployFixture);

      await expect(
        library.connect(backend).updateUploadStatus(HASH_1, 1)
      ).to.be.revertedWith("Upload not found");
    });

    it("should revert when status is unchanged", async function () {
      const { library, backend, uploader1 } = await loadFixture(deployFixture);
      await library.connect(backend).registerUpload(HASH_1, uploader1.address, METADATA_1);

      await expect(
        library.connect(backend).updateUploadStatus(HASH_1, 0) // Pending to Pending
      ).to.be.revertedWith("Status unchanged");
    });

    it("should revert when called by unauthorized address", async function () {
      const { library, backend, uploader1 } = await loadFixture(deployFixture);
      await library.connect(backend).registerUpload(HASH_1, uploader1.address, METADATA_1);

      await expect(
        library.connect(uploader1).updateUploadStatus(HASH_1, 2)
      ).to.be.revertedWith("Not authorized");
    });

    it("should emit UploadStatusChanged event", async function () {
      const { library, backend, uploader1 } = await loadFixture(deployFixture);
      await library.connect(backend).registerUpload(HASH_1, uploader1.address, METADATA_1);

      await expect(library.connect(backend).updateUploadStatus(HASH_1, 2))
        .to.emit(library, "UploadStatusChanged")
        .withArgs(HASH_1, 0, 2); // Pending -> Approved
    });
  });

  describe("View Functions", function () {
    it("getUpload returns correct data", async function () {
      const { library, backend, uploader1 } = await loadFixture(deployFixture);
      await library.connect(backend).registerUpload(HASH_1, uploader1.address, METADATA_1);

      const upload = await library.getUpload(HASH_1);
      expect(upload.arweaveHash).to.equal(HASH_1);
      expect(upload.uploader).to.equal(uploader1.address);
      expect(upload.metadata).to.equal(METADATA_1);
    });

    it("getUpload reverts for non-existent upload", async function () {
      const { library } = await loadFixture(deployFixture);
      await expect(library.getUpload(HASH_1)).to.be.revertedWith("Upload not found");
    });

    it("getUploadStatus returns correct status", async function () {
      const { library, backend, uploader1 } = await loadFixture(deployFixture);
      await library.connect(backend).registerUpload(HASH_1, uploader1.address, METADATA_1);
      expect(await library.getUploadStatus(HASH_1)).to.equal(0); // Pending
    });

    it("getUploader returns correct address", async function () {
      const { library, backend, uploader1 } = await loadFixture(deployFixture);
      await library.connect(backend).registerUpload(HASH_1, uploader1.address, METADATA_1);
      expect(await library.getUploader(HASH_1)).to.equal(uploader1.address);
    });

    it("uploadExists returns true for registered upload", async function () {
      const { library, backend, uploader1 } = await loadFixture(deployFixture);
      await library.connect(backend).registerUpload(HASH_1, uploader1.address, METADATA_1);
      expect(await library.uploadExists(HASH_1)).to.be.true;
    });

    it("uploadExists returns false for non-existent upload", async function () {
      const { library } = await loadFixture(deployFixture);
      expect(await library.uploadExists(HASH_1)).to.be.false;
    });

    it("getUploaderHashes returns empty array for address with no uploads", async function () {
      const { library, uploader1 } = await loadFixture(deployFixture);
      const hashes = await library.getUploaderHashes(uploader1.address);
      expect(hashes).to.have.lengthOf(0);
    });
  });

  describe("Pausable", function () {
    it("should block registerUpload when paused", async function () {
      const { library, backend, uploader1 } = await loadFixture(deployFixture);
      await library.pause();

      await expect(
        library.connect(backend).registerUpload(HASH_1, uploader1.address, METADATA_1)
      ).to.be.revertedWithCustomError(library, "EnforcedPause");
    });

    it("should block updateUploadStatus when paused", async function () {
      const { library, backend, uploader1 } = await loadFixture(deployFixture);
      await library.connect(backend).registerUpload(HASH_1, uploader1.address, METADATA_1);
      await library.pause();

      await expect(
        library.connect(backend).updateUploadStatus(HASH_1, 2)
      ).to.be.revertedWithCustomError(library, "EnforcedPause");
    });

    it("should allow view functions when paused", async function () {
      const { library, backend, uploader1 } = await loadFixture(deployFixture);
      await library.connect(backend).registerUpload(HASH_1, uploader1.address, METADATA_1);
      await library.pause();

      expect(await library.uploadExists(HASH_1)).to.be.true;
      expect(await library.getUploadStatus(HASH_1)).to.equal(0);
    });
  });
});
