# Portable Custody Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New Heirloom encryption identities have a passphrase-encrypted backup that can be restored in another browser profile without giving the relay a private key.

**Architecture:** A pure Web Crypto codec creates and validates versioned backup files. IndexedDB keeps a non-extractable private key plus its encrypted backup, while the public wallet enrollment flow requires verification of the downloaded file before enrollment. Existing non-extractable identities remain usable and are marked unbacked.

**Tech Stack:** TypeScript, React 19, Web Crypto, IndexedDB, Vitest, fake-indexeddb.

**Spec:** `docs/superpowers/specs/2026-10-03-portable-custody-sepolia-design.md`

## Global Constraints

- Preserve the running Hardhat deployment and existing IndexedDB records; do not change immutable vault packages or relay identity bindings.
- New backups use AES-256-GCM, PBKDF2-HMAC-SHA-256 with at least 600,000 iterations, a random 16-byte salt, and a random 12-byte IV.
- Store only a non-extractable private key after creation; never send the backup or passphrase to the relay.
- Existing non-extractable identities cannot be exported retroactively.
- Same-PC browser profiles demonstrate separated browser storage, not separate people or physical devices.

## Review Focus

- A modified header must fail authentication before IndexedDB changes (Task 1 test).
- An excessive or underspecified KDF iteration count must be rejected before derivation (Task 1 test).
- A backup from another wallet or deployment must not restore (Task 1 test).
- A concurrently created key must not replace the winner in IndexedDB (Task 2 test).
- An already enrolled wallet with no local key must be offered restore rather than silently generating a new key (Task 3 manual check).

---

### Task 1: Backup codec

**Files:** Create `src/lib/identity-backup.ts`; create `src/lib/identity-backup.test.ts`.

**Interfaces:** Produce `BackupContext = { chainId: number; contractAddress: string; deploymentId: string; address: string }`, `IdentityBackup` (versioned JSON with context, publicKey, publicKeyHash, PBKDF2 parameters, salt, IV, ciphertext), `createBackedIdentity(context: BackupContext, passphrase: string): Promise<{ identity: Identity; backup: IdentityBackup }>`, and `restoreBackedIdentity(backup: unknown, passphrase: string, context: BackupContext, enrolledKeyHash?: string): Promise<Identity>`.

- [ ] **Step 1: Write failing codec tests.** Assert round-trip returns the same public-key hash and a non-extractable private key; wrong passphrase, modified ciphertext/header, another address/deployment, public/private mismatch, empty passphrase, malformed base64, oversized JSON, and iteration counts outside 600,000–1,000,000 all reject. Verify `JSON.stringify(backup)` contains neither passphrase nor plaintext PKCS#8 bytes.
- [ ] **Step 2: Run `npx vitest run src/lib/identity-backup.test.ts`.** Expected: new tests fail because the codec exports are absent.
- [ ] **Step 3: Implement the codec.** Generate RSA-OAEP 2048/SHA-256 temporarily extractable, export PKCS#8, encrypt with AES-GCM using a derived 256-bit key and canonical header as AAD, import the private key non-extractable, and clear writable plaintext buffers. Validate size/shape and KDF bounds before derivation; prove the restored pair with an RSA-OAEP challenge.
- [ ] **Step 4: Run `npx vitest run src/lib/identity-backup.test.ts`.** Expected: all codec tests pass.
- [ ] **Step 5: Commit codec and tests** with `feat: add encrypted identity backup codec`.

### Task 2: Atomic browser custody

**Files:** Modify `src/lib/identity.ts`; modify `src/lib/identity.test.ts`.

**Interfaces:** Consume Task 1's codec. Produce `custodyRecord(namespace: string, address: string): Promise<{ identity: Identity; backup?: IdentityBackup; verified: boolean } | undefined>`, `createBackedStoredIdentity(namespace: string, address: string, passphrase: string, context: BackupContext): Promise<IdentityBackup>`, `verifyStoredBackup(namespace: string, address: string, backup: unknown, passphrase: string, context: BackupContext): Promise<void>`, and `restoreStoredIdentity(namespace: string, address: string, backup: unknown, passphrase: string, context: BackupContext, enrolledKeyHash?: string): Promise<Identity>`.

- [ ] **Step 1: Write failing storage tests.** Assert legacy plain `Identity` records still read; new records contain a non-extractable key and encrypted backup; verification marks only the matching saved file; wrong password leaves the record unverified; repeat restore is idempotent; distinct-key restore and two-tab creation never overwrite the first key.
- [ ] **Step 2: Run `npx vitest run src/lib/identity.test.ts`.** Expected: new storage tests fail because the functions are absent.
- [ ] **Step 3: Implement in the existing IndexedDB `identities` store.** Read legacy records as unbacked; store `{ identity, backup, verified }` for new records. Check conflicts inside one readwrite transaction; keep `storedIdentity()` and local `obtainIdentity()` behavior compatible.
- [ ] **Step 4: Run `npx vitest run src/lib/identity.test.ts`.** Expected: all storage tests pass.
- [ ] **Step 5: Commit storage and tests** with `feat: persist portable browser custody`.

### Task 3: Wallet custody UI and documentation

**Files:** Create `src/lib/custody-flow.ts`, `src/lib/custody-flow.test.ts`, and `src/components/CustodyDialog.tsx`; modify `src/App.tsx`, `src/styles.css`, `package.json`, `README.md`, `docs/DEMO.md`, `docs/STATUS.md`.

**Interfaces:** Consume Task 2's custody functions. Produce `custodyStep(enrolled: boolean, record?: { backup?: IdentityBackup; verified: boolean }): 'create' | 'verify' | 'restore' | 'enroll' | 'ready' | 'legacy'`. `CustodyDialog` accepts the active wallet/deployment, current custody step, and `onCreated`, `onVerified`, `onRestored`, and `onClose` callbacks; App owns wallet signatures and relay enrollment.

- [ ] **Step 1: Add failing `custodyStep` tests** for absent local/enrolled keys (`create`), absent local key with relay enrollment (`restore`), unverified backed record (`verify`), verified unenrolled record (`enroll`), verified enrolled record (`ready`), and an old record without backup (`legacy`).
- [ ] **Step 2: Run `npx vitest run src/lib/custody-flow.test.ts`.** Expected: tests fail because `custodyStep` is absent.
- [ ] **Step 3: Implement `custodyStep`, the dialog, and enrollment branches.** New public wallet: create, download, reselect and verify the backup, then sign/enroll. Existing relay identity with no local key: restore. Existing local legacy identity: show unbacked status without replacement. Add re-download for stored encrypted backups, distinguish it from the asset recovery kit, and include both new Vitest files in `test:crypto`.
- [ ] **Step 4: Run `npm test` and `npm run build`.** Expected: all tests pass and the Vite/TypeScript build succeeds. Manually confirm the original Hardhat app, actor switcher, existing vaults, and `npm run demo:check` still work; do not restart its chain.
- [ ] **Step 5: Update the named docs** with backup use, legacy limits, profile workflow, and honest first-round status. Commit with `feat: add identity backup and restore flow`.
