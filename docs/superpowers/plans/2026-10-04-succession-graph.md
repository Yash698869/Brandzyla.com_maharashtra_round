# Succession Graph Implementation Plan

> **For agentic workers:** Use the supplied user specification and test-driven implementation. Preserve the existing primary recovery path.

**Goal:** Add optional backup succession governed by the contract, with recipient-bound encrypted releases and confirmed-state workspaces.

**Architecture:** Keep legacy `registerVault` for explicit version-1 primary-only policies. Add `registerSuccessionVault(vaultId, policy, commitment)` for version 2. Snapshot `selectedBeneficiary` at request creation. Version-2 packages commit backup identity and durations; release AAD includes deployment, vault, request, guardian and recipient. Reuse existing Postgres JSONB payloads.

**Tech Stack:** Solidity, ethers, React/TypeScript, Web Crypto, Express, existing pg storage.

**Spec:** User request in this chat, including all authorization, confidentiality, UI, deployment and testing requirements.

## Global Constraints

- Do not edit `.env`, expose secrets, push, or create another adapter.
- Primary remains eligible after inactivity; backup additionally waits `backupWaitingDuration`.
- No displacement; two configured guardians start the full challenge period; only selected beneficiary finalizes.
- Check-in clears selection, quorum and approvals; monotonically increasing request IDs prevent replay.
- Legacy packages are never reinterpreted as succession packages; old deployments require redeployment.

## Tasks

- [x] Contract and tests: add succession policy struct, key hashes, version, selected recipient, validation and events; test both paths, boundaries, cancellation and stale approvals.
- [x] Crypto and types: add explicit v2 binding/package/release; retain v1 AAD; test exact bytes, both recipients, wrong key/recipient, stale/mixed/duplicate/tampered envelopes.
- [x] Relay and persistence: validate version, committed policy, finalized recipient and guardian signatures against chain state; add v2 relay/Postgres roundtrip coverage without schema migration.
- [x] Creation and workspaces: add backup and waiting selection, graph, policy status and selected-recipient controls; update chain reader, guidance and local demo actors/clock.
- [x] Deployment and documentation: regenerate ABI, document new address and v1 handling; preserve old Sepolia configurations without pretending upgrade.
- [x] Verify: run contract, crypto/relay suites, TypeScript, build; inspect diff and address failures.

## Review Focus

- Optional backup must have consistent zero address/hash/wait values.
- Old Sepolia ABI must read as primary-only; cannot create v2 on it.
- Recipient key reuse between primary and backup would undermine wallet separation and must be rejected.
- Reads must use one confirmed block for policy, approvals and clock.
- Historical encrypted releases must never become valid for a new request or recipient.
