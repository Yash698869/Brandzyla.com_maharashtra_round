# Sepolia Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify and present a public Sepolia Heirloom deployment and a five-profile recovery rehearsal when the user's wallet has test ETH.

**Architecture:** Keep the existing browser-wallet deployment page and import validator as the only deployment route. Add a read-only public readiness check, then use the user's wallet signature and five distinct browser-profile wallets for actual chain transactions. Hardhat stays available as the fallback.

**Tech Stack:** Node.js, ethers 6, Solidity/Hardhat 3, React, Ethereum Sepolia.

**Spec:** `docs/superpowers/specs/2026-10-03-portable-custody-sepolia-design.md`

## Global Constraints

- Deploy only to chain ID 11155111 from the user's browser wallet; do not collect a private key or seed phrase.
- Keep the local Hardhat app at port 5173 and public app at port 5174 with separate relay ports and deployment namespaces.
- Public mode has real elapsed time, no clock skip, and requires three confirmations before share release.
- Do not claim an Etherscan deployment or independent-device proof until it is actually observed.

## Review Focus

- A stale runtime config from another contract must fail preflight (Task 1 check).
- A failed or replaced deployment receipt must fail preflight (Task 1 check).
- A public RPC pointing at another chain must fail before any signed action (Task 1 check).
- A relay/UI bound to an older deployment must fail preflight (Task 1 check).
- A wallet transaction awaiting confirmation must retain its hash and avoid duplicate deployment (Task 2 check).

---

### Task 1: Public readiness check

**Files:** Create `shared/sepolia-readiness.mjs` and `scripts/check-sepolia.mjs`; modify `tests/sepolia-deployment.test.mjs`, `package.json`, `docs/SEPOLIA.md`.

**Interfaces:** Produce `assessSepoliaReadiness(config, expectedCodeHash, observed, relayConfig, uiOk): { contractUrl: string; transactionUrl: string }` in `shared/sepolia-readiness.mjs`, reusing `validateSepoliaDeployment()`. Produce `npm run sepolia:check`, a read-only command using `.runtime/sepolia-deployment.json`, the compiled runtime, public RPC, relay port 3002, and UI port 5174.

- [ ] **Step 1: Add failing readiness tests** in `tests/sepolia-deployment.test.mjs`: wrong chain, changed code/block hash, failed receipt, mismatched relay config, and unavailable UI reject; valid observations return the expected Sepolia Etherscan transaction and contract URLs.
- [ ] **Step 2: Run `node --test tests/sepolia-deployment.test.mjs`.** Expected: new readiness assertions fail because the check does not exist.
- [ ] **Step 3: Implement `check-sepolia.mjs` and package command.** Bound network/UI requests; verify canonical deployment with the existing validator and report contract, receipt, confirmations, and explorer links. Never sign, deploy, or print RPC credentials.
- [ ] **Step 4: Run `npm test`, `npm run build`, and `npm run sepolia:check`.** Tests/build pass; before deployment the last command exits with a clear “fund and deploy first” message.
- [ ] **Step 5: Commit code and docs** with `feat: add Sepolia readiness check`.

### Task 2: Funded deployment and profile rehearsal

**Files:** Modify `README.md`, `docs/DEMO.md`, `docs/STATUS.md` only after observing successful public transactions; `.runtime/sepolia-deployment.json` stays ignored.

**Interfaces:** Consume Task 1's readiness command and the approved portable-custody flow from the companion plan. Produce verified Sepolia Etherscan deployment and recovery links.

- [ ] **Step 1: Confirm funding in the user's wallet.** Use a faucet from Ethereum's Sepolia directory. The user opens `http://127.0.0.1:5173/deploy.html` in the wallet browser and personally signs the deployment. If no test ETH is available, record this task as pending; do not substitute a local transaction.
- [ ] **Step 2: Observe and import the canonical receipt.** Use the page's saved hash to resume a pending deployment without submitting a duplicate; inspect Etherscan; download the config; run `npm run sepolia:import`, `npm run dev:sepolia`, and `npm run sepolia:check`. Expected: all checks pass and the contract/transaction URLs match the chain.
- [ ] **Step 3: Rehearse five distinct profiles on the same PC.** Each profile connects a separate wallet address, creates and verifies its encrypted identity backup, and enrolls. The owner creates a sample vault; the beneficiary requests after real inactivity; two guardians approve and release after the challenge window and three confirmations; the third remains unavailable. Test restoration of one profile from its backup without changing the enrolled key.
- [ ] **Step 4: Preserve evidence and commit accurate docs.** Record observed explorer links and limitations, run `npm run demo:check` to confirm Hardhat fallback still works, and commit with `docs: record verified Sepolia proof`. Do not publish backup files, passphrases, wallet secrets, or unsanitized RPC URLs.
