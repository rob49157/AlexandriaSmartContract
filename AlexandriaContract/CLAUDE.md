# Project Alexandria

## Context & Architecture
Alexandria is a decentralized, censorship-resistant Web3 library designed to preserve human knowledge permanently. 
- **Frontend:** React + Vite (Handles the user dashboard and in-browser PDF decryption).
- **Backend Gateway:** Node.js + Express (Orchestrates uploads, security checks, Lit Protocol encryption, and Arweave indexing).
- **AI Validation:** Python + FastAPI (Microservice running AI agents to validate PDFs, check SimHash, and prevent malware).
- **Blockchain:** Base Testnet / Solidity (Handles the $ALEX token, archivist staking, and time-bound rental mapping).
- **Storage:** Arweave via Irys (Permanent encrypted file storage) + MongoDB (Fast off-chain indexing for search).

## Environment & Tooling Constraints
- **Global Installs Blocked:** Global npm installations are restricted on this machine. ALWAYS use `npx` to execute CLI tools (e.g., `npx hardhat`, `npx vite`).
- **Node Environment:** Node.js is managed via `nvm`. Default to Node v18+ for compatibility with Web3 libraries.
- **Web3 Libraries:** Use `ethers.js` for frontend-to-blockchain interactions. Use `dotenv` strictly for managing private keys and API endpoints.

## Common Commands
*Run all commands from their respective directories.*

**Smart Contracts (`/contracts`)**
- Compile: `npx hardhat compile`
- Test: `npx hardhat test`
- Deploy to Amoy: `npx hardhat run scripts/deploy.js --network amoy`

**Frontend (`/frontend`)**
- Install: `npm install`
- Run Dev Server: `npm run dev`

**Backend Gateway (`/backend`)**
- Run Server: `npm run dev`

**AI Agents (`/ai-validators`)**
- Run FastAPI Server: `uvicorn main:app --reload`

## Code Style & Conventions
- **Solidity:** Use `pragma solidity ^0.8.20`. Follow Contract-Driven Development (update contracts before touching the frontend). Use descriptive error messages in `require` statements to save gas over custom errors for the PoC.
- **JavaScript/React:** Use ES Modules (`import`/`export`). Keep API routing logic in Node.js clean and separated from business logic (like PDF hashing).
- **Python:** Ensure the FastAPI endpoints return strict, predictable JSON structures (e.g., `{"status": "APPROVED"}`).

## Critical Workflows & Gotchas
- **The Zero-Trust Pipeline Sequence:** The Node.js backend MUST run SHA-256 (exact duplicate check), ClamAV (malware), and SimHash (fuzzy duplicate) on the *RAW* PDF before it ever touches Lit Protocol encryption.
- **Separation of Concerns:** The Solidity smart contract never handles the PDF file. It only manages the "rental permission slip." The frontend fetches the encrypted file directly from Arweave and decrypts it locally.
- **Upload Order:** Always secure the Arweave Hash from the Irys upload *before* saving the metadata to MongoDB. The Arweave Hash is the primary key.