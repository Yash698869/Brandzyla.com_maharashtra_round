# Indian Death-Certificate Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give guardians a check-by-check signed-PDF evidence receipt without changing the on-chain recovery authorization.

**Architecture:** A Python pyHanko process validates PDF signatures against explicitly configured trust and issuer profiles and returns temporary extracted claims to the Node relay. The relay checks vault/session state, compares claims with a wallet-signed owner commitment, and persists a request-bound receipt without the raw PDF or personal fields. React owner and guardian workspaces expose enrollment, upload, and receipt status.

**Tech Stack:** Python 3.13, pyHanko 0.37.0, pypdf 6.17.0, Node/Express, WebCrypto PBKDF2, ethers, PostgreSQL/file storage, React/TypeScript, existing Node and Vitest test runners.

**Spec:** `docs/superpowers/specs/2026-10-04-india-death-certificate-verification-design.md`

## Global Constraints

- The existing 2-of-3 guardian approval, owner cancellation window, and on-chain finalization remain the only release authorization.
- An upload never initiates, approves, or finalizes recovery.
- A real government-verified badge is impossible without an independently pinned Indian CCA root, approved DigiLocker/CRS signer profile, revocation evidence, complete-file signature, and identity match.
- No genuine DigiLocker/CRS sample exists yet; the built-in issuer and certificate are labeled `DEMO / NOT GOVERNMENT EVIDENCE`.
- Limit PDFs to 10 MiB and verifier runtime to 20 seconds. Do not persist raw PDFs or extracted identity fields.
- Never fetch untrusted URLs from PDFs or certificates. CRL/OCSP inputs must come from embedded evidence or issuer-profile-allowlisted endpoints.
- Keep existing vaults, users, sessions, encrypted packages, and contract state intact.

## File Map

- `verifier/verify_pdf.py`: PDF/CMS validation entry point and JSON result contract.
- `verifier/issuer_profiles.py`: pinned roots, signer rules, approved revocation sources, and field extraction. No active government profile until a real specimen is validated.
- `verifier/requirements.txt`: pinned Python dependencies.
- `verifier/tests/test_verify_pdf.py`, `verifier/tests/fixtures.py`: generated test CA, CRL, and signed-PDF cases; no test private key in Git.
- `shared/evidence-identity.mjs`: canonicalization, PBKDF2 commitment, and wallet-signing message shared by browser and relay.
- `server/evidence.mjs`: session/chain authorization, bounded Python execution, result classification, and receipt sanitization.
- `server/storage.mjs`: enrollment and evidence receipt storage for both backends.
- `server/index.mjs`: thin evidence routes using `server/evidence.mjs`.
- `src/lib/evidence.ts`, `src/lib/api.ts`, `src/lib/types.ts`: browser commitment and typed API operations.
- `src/components/EvidenceEnrollment.tsx`, `src/components/EvidenceReview.tsx`: owner enrollment and guardian upload/receipt UI.
- `src/pages/OwnerWorkspace.tsx`, `src/pages/GuardianWorkspace.tsx`: mount the focused components.
- `tests/evidence-identity.test.mjs`, `tests/evidence-storage.test.mjs`, `tests/evidence-api.test.mjs`: protocol, persistence, and authorization checks.
- `README.md`: setup, demo, provenance, and limits.

## Review Focus

- A QR-only or image-only PDF must return `unsupported_document`, never `verified` (Task 1).
- Multiple signatures or a post-signing incremental revision must not let text from an unsigned revision establish identity (Task 1).
- A session for one account combined with another wallet's valid signature must not enroll or upload for that account (Task 3).
- Two concurrent uploads for one request must leave one unambiguous receipt with the correct PDF digest (Task 3).
- A page reload or a new recovery request must not present an old receipt as current evidence (Task 4).

---

### Task 1: Fail-closed PDF and issuer verifier

**Files:** Create `verifier/verify_pdf.py`, `verifier/issuer_profiles.py`, `verifier/requirements.txt`, `verifier/tests/fixtures.py`, `verifier/tests/test_verify_pdf.py`.

**Interfaces:** `verify_pdf(path: str, profile_id: str) -> dict` returns `signature`, `coverage`, `chain`, `revocation`, `issuer`, and `fields` checks (`pass|fail|indeterminate`), `signerFingerprint`, `issuerLabel`, transient `claims` (`name`, `identifier`, `dateOfDeath`), and stable `reasonCodes`. CLI: `python -m verifier.verify_pdf --input <path> --profile <id>` writes one JSON object to stdout. Only `test-local` is active; a government profile cannot be selected until pinned and approved in code.

- [ ] Write `test_valid_test_issuer`, `test_byte_tamper`, `test_incremental_append`, `test_revoked_signer`, `test_unknown_revocation`, `test_untrusted_signer`, `test_qr_only_pdf`, and `test_multiple_signatures` using generated fixtures; assert `pass` only for the full-file signed test certificate and stable failure codes for the others.
- [ ] Run `py -m unittest discover -s verifier/tests -v`; confirm the new tests fail for missing verifier interfaces.
- [ ] Implement PDF/CMS verification with explicit pyHanko `ValidationContext`, `SignatureCoverageLevel.ENTIRE_FILE`, pinned test CA, revocation policy, and no arbitrary network fetching. Extract fields with a deterministic test profile only after all signed-byte checks pass. Use profile-owned, allowlisted CRL/OCSP sources when available; absent or stale evidence remains `indeterminate`.
- [ ] Run `py -m unittest discover -s verifier/tests -v`; require all cases to pass. Inspect the output for absence of personal fields in diagnostics.
- [ ] Commit the verifier, fixture generator, and tests.

### Task 2: Owner commitment and persistence

**Files:** Create `shared/evidence-identity.mjs`, `tests/evidence-identity.test.mjs`, `tests/evidence-storage.test.mjs`; modify `server/storage.mjs`.

**Interfaces:** `canonicalEvidenceIdentity(name, identifier) -> string`; `async evidenceCommitment(name, identifier, saltHex) -> Promise<string>` uses PBKDF2-SHA-256 with 210,000 iterations and domain separation; `evidenceEnrollmentMessage(config, vaultId, owner, commitment, saltHex) -> string`. Storage methods: `getEvidenceEnrollment(vaultId)`, `saveEvidenceEnrollment(vaultId, record)` (insert-only), `getEvidenceReceipt(vaultId, requestId)`, `saveEvidenceReceipt(vaultId, requestId, receipt)` (atomic replacement). Return only commitment metadata to browser reads.

- [ ] Write protocol tests asserting canonicalization, domain/deployment/request isolation, stable browser/Node commitment bytes, invalid salt rejection, and no plaintext in the saved record. Write equivalent file/PostgreSQL storage tests for insert-only enrollment and request-scoped receipts.
- [ ] Run `node --test tests/evidence-identity.test.mjs tests/evidence-storage.test.mjs`; confirm missing-interface failures.
- [ ] Implement the shared protocol and both storage backends without changing existing user/session/package schemas or fallback migration behavior.
- [ ] Run the two tests and `npm run test:relay`; require pass.
- [ ] Commit the protocol and storage changes.

### Task 3: Authorized evidence relay

**Files:** Create `server/evidence.mjs`, `tests/evidence-api.test.mjs`; modify `server/index.mjs`.

**Interfaces:** `createEvidenceHandlers({ storage, config, vaultState, verifyPdf })` provides Express handlers `enroll`, `getEnrollment`, `upload`, `getCurrentReceipt`; `verifyPdf(path, profileId)` is injectable for relay tests and uses the bounded Python process in production. Extend the existing `vaultState(id)` result to include on-chain `owner`. Routes: `POST /api/evidence/:vaultId/enrollment` accepts `{ owner, commitment, saltHex, signature }`; `GET /api/evidence/:vaultId/enrollment`; `POST /api/evidence/:vaultId` accepts `application/pdf`; `GET /api/evidence/:vaultId`. All routes require a live bearer session bound to the on-chain owner or designated guardian as appropriate. The upload route derives `requestId` from confirmed chain state and stores a sanitized receipt only.

- [ ] Write relay tests covering owner-only pre-claim enrollment, invalid/mismatched wallet/session signature, guardian-only upload/read, owner/beneficiary denial, malformed or >10 MiB upload, verifier timeout, stale request, concurrent uploads, and receipt free of claims/raw PDF.
- [ ] Run `node --test tests/evidence-api.test.mjs`; confirm missing-route failures.
- [ ] Implement session lookup from `storage.getSession`, chain-role checks from `vaultState`, `express.raw({ type: 'application/pdf', limit: '10mb' })`, restricted temporary files with `finally` deletion, a 20-second Python process timeout, profile selection controlled by the relay, and stable HTTP error codes. Re-read chain state after verification and use a request-scoped mutex or transactional compare so parallel uploads do not create conflicting current receipts.
- [ ] Run the new relay test plus `npm run test:relay`; require pass and no PDF or claim text in logs or persistence.
- [ ] Commit the evidence API and tests.

### Task 4: Owner and guardian workspace flow

**Files:** Create `src/lib/evidence.ts`, `src/components/EvidenceEnrollment.tsx`, `src/components/EvidenceReview.tsx`; modify `src/lib/api.ts`, `src/lib/types.ts`, `src/pages/OwnerWorkspace.tsx`, `src/pages/GuardianWorkspace.tsx`, `src/styles.css`.

**Interfaces:** `api.enrollEvidence(vaultId, record)`, `api.evidenceEnrollment(vaultId)`, `api.uploadEvidence(vaultId, file)`, `api.evidenceReceipt(vaultId)`; `EvidenceEnrollment` receives `{ vault, config, ownerAddress }`; `EvidenceReview` receives `{ vault, disabled }`. The enrollment component computes a fresh salt/commitment, asks `signerFor` for the owner signature, and never stores fields in localStorage. The review component displays each check separately and the request-bound receipt.

- [ ] Add focused component/API tests for active-vault enrollment, disabled enrollment after claim, file-size rejection, five distinct result labels, `DEMO / NOT GOVERNMENT EVIDENCE`, and refresh/new-request behavior.
- [ ] Run the focused Vitest files; confirm the new tests fail for missing UI/API operations.
- [ ] Implement typed API and components; mount enrollment in owned-vault view and review in guardian claim cards. Do not wire evidence state into `approveRecovery`, `requestRecovery`, or `finalizeRecovery` actions.
- [ ] Run focused Vitest, `npm run test:crypto`, and `npm run build`; require pass.
- [ ] Commit the UI/API changes.

### Task 5: Local judge demonstration and final verification

**Files:** Modify `README.md`, `package.json` scripts; create `scripts/generate-evidence-demo.py` if fixture generation needs a separate user command.

**Interfaces:** `npm run evidence:fixture` writes a signed test PDF and its test profile to ignored `.runtime/`; `npm run evidence:check -- <pdf>` prints the check-by-check JSON status. Neither command produces a government-verified result.

- [ ] Write a smoke check that generates the valid demo PDF, verifies it, flips one signed byte, and verifies the tampered copy fails; run it and confirm it fails before the script wiring exists.
- [ ] Add the fixture/check scripts and document Python setup, owner enrollment, guardian upload, the demo-only label, exact unsupported real-issuer conditions, and why a genuine DigiLocker/CRS specimen plus out-of-band CCA/issuer fingerprint verification are needed.
- [ ] Run the smoke check, all new verifier/relay/UI tests, `npm test`, `npm run build`, and `git diff --check`; require pass. Manually rehearse enrollment → claim → evidence upload → guardian approval and verify that evidence alone cannot advance the contract.
- [ ] Commit docs/scripts and run a final branch review against the approved spec.
