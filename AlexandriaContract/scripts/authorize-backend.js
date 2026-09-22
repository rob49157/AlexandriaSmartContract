// Authorize the Alexandria backend to call library.registerUpload().
//
// This is step 3b of deployment.md — the one deferred until the backend existed.
//
//   node scripts/authorize-backend.js                 # show current state, change nothing
//   node scripts/authorize-backend.js --grant         # authorize the backend
//   node scripts/authorize-backend.js --revoke        # remove authorization
//   node scripts/authorize-backend.js --grant --address 0xABC...
//
// Why registerUpload needs this at all: it is `onlyAuthorized` and takes an
// explicit `uploader` argument, so it was written for a backend that registers
// on an archivist's behalf. An archivist calling it from their own wallet
// reverts with "Not authorized".
//
// ⚠️ What this grant does and does not give away. `onlyAuthorized` covers two
// functions, so the grant is slightly broader than "register only":
//   CAN    registerUpload(), blacklistUploader(), updateUploadStatus()
//   CANNOT stake, rent, move $ALEX, resolve challenges, pause, transfer ownership
// Revoke at any time with --revoke.
//
// Runs on plain ethers rather than through the hardhat console so it needs no
// interactive session, and so it can fall back to a working RPC when
// sepolia.base.org answers "no backend is currently healthy".

require('dotenv').config();
const { ethers } = require('ethers');

const LIBRARY_ADDRESS = '0x0b26AB8C632586E846DE87D29D665fd727bBe844';
const DEFAULT_BACKEND = '0xccdC69a3020BbaEb5483B2CE20d3fA0c1204b096';

const RPC_URLS = [
  'https://base-sepolia-rpc.publicnode.com',
  process.env.BASE_TESTNET_RPC_URL || 'https://sepolia.base.org',
];

const ABI = [
  'function owner() view returns (address)',
  'function authorizedCallers(address) view returns (bool)',
  'function setAuthorizedCaller(address caller, bool authorized) external',
];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}

async function firstWorkingProvider() {
  for (const url of RPC_URLS) {
    try {
      const provider = new ethers.JsonRpcProvider(url, 84532, { staticNetwork: true });
      await provider.getBlockNumber();
      console.log(`RPC:        ${url}`);
      return provider;
    } catch {
      console.warn(`RPC unreachable, trying next: ${url}`);
    }
  }
  throw new Error('No working Base Sepolia RPC. Check BASE_TESTNET_RPC_URL.');
}

async function main() {
  const grant = process.argv.includes('--grant');
  const revoke = process.argv.includes('--revoke');
  const backend = ethers.getAddress(arg('--address') || DEFAULT_BACKEND);

  if (grant && revoke) throw new Error('Pass --grant or --revoke, not both.');

  const key = (process.env.DEPLOYER_PRIVATE_KEY || '').trim();
  if (!key) throw new Error('DEPLOYER_PRIVATE_KEY is not set in .env');

  const provider = await firstWorkingProvider();
  const wallet = new ethers.Wallet(key.startsWith('0x') ? key : `0x${key}`, provider);
  const library = new ethers.Contract(LIBRARY_ADDRESS, ABI, wallet);

  const [owner, already, balance] = await Promise.all([
    library.owner(),
    library.authorizedCallers(backend),
    provider.getBalance(wallet.address),
  ]);

  console.log(`Library:    ${LIBRARY_ADDRESS}`);
  console.log(`Owner:      ${owner}`);
  console.log(`Signer:     ${wallet.address} (${ethers.formatEther(balance)} ETH)`);
  console.log(`Backend:    ${backend}`);
  console.log(`Authorized: ${already}`);

  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(
      `setAuthorizedCaller is onlyOwner, but the signer is not the owner.\n` +
        `  owner:  ${owner}\n  signer: ${wallet.address}`
    );
  }

  if (!grant && !revoke) {
    console.log('\nRead-only. Re-run with --grant to authorize, or --revoke to remove.');
    return;
  }

  const desired = grant;
  if (already === desired) {
    console.log(`\nAlready ${desired ? 'authorized' : 'unauthorized'} — nothing to do.`);
    return;
  }

  console.log(`\nSending setAuthorizedCaller(${backend}, ${desired})...`);
  const tx = await library.setAuthorizedCaller(backend, desired);
  console.log(`  tx: ${tx.hash}`);

  const receipt = await tx.wait(1);
  // Read the flag back rather than trusting the receipt: a mined transaction is
  // not the same as an applied state change.
  const confirmed = await library.authorizedCallers(backend);

  console.log(`  mined in block ${receipt.blockNumber} (gas ${receipt.gasUsed})`);
  console.log(`  authorizedCallers(${backend}) = ${confirmed}`);
  console.log(`  https://sepolia.basescan.org/tx/${tx.hash}`);

  if (confirmed !== desired) throw new Error('Transaction mined but the flag did not change.');

  if (desired) {
    console.log('\nBackend can now register uploads. Verify from the backend with:');
    console.log('  GET /api/upload/registrar/status');
  }
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  process.exit(1);
});
