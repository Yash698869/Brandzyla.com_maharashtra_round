# Separate-device custody design

**Status: proposed, not implemented or verified.** The current demo and Sepolia UI run on loopback. Do not describe a one-browser, five-account rehearsal as independent-device custody.

## Current boundary

- `server/index.mjs` listens on `127.0.0.1`, and `vite.config.ts` proxies `/api` to a loopback relay. `scripts/dev.mjs` starts the UI on loopback too. Another device cannot reach this setup.
- The relay accepts requests from a fixed list of local `Origin` values. That check does not authenticate a wallet or authorize a read. Identity enrollment and share release have wallet signatures; package upload is checked against the on-chain commitment. The identity list, package list, recovery-kit download, and releases are currently readable without a wallet session.
- Ciphertext, identities, and signed releases live in one deployment-namespaced JSON file under `.runtime/`. A temporary-file rename protects an individual write, but there is no database transaction across multiple instances, managed backup, replication, or tested restore path.
- Public mode uses the connected browser wallet for chain reads and transactions. The local Hardhat clock and actor switcher are rehearsal tools, not a basis for remote custody.

## Proposed service boundary

Serve the built UI and `/api` from one HTTPS origin reachable by each participant, with TLS and a secure browser context. Put a supported public-chain RPC behind the app's chain configuration. Keep the development chain and `/api/clock` confined to the local demo. The relay remains a ciphertext service: asset encryption, guardian share decryption, and beneficiary reconstruction stay in the browser.

1. **Authenticate the wallet session.** Issue a one-use, short-lived challenge that binds the origin/domain, wallet address, chain ID, contract address, deployment ID, nonce, and expiry. Verify the wallet signature server-side and consume the nonce atomically. Use a short-lived `Secure`, `HttpOnly`, `SameSite` session cookie; rotate it on login and clear it on account or network change. Reject expired challenges and signatures replayed for another deployment or origin. A request's `Origin` is an additional browser check, never the proof of identity.
2. **Authorize each API operation.** Bind the session account to every read and write. Enrollment must sign for that same account and retain the current no-conflicting-key rule. Return package data only for an on-chain owner, beneficiary, or configured guardian of that vault; make the vault listing role-filtered. Permit package publishing or kit restoration only for an authorized vault role after the immutable commitment and beneficiary key checks pass. A release must come from the session's approved guardian, carry that guardian's existing release signature, reference the current finalized request, and pass the existing public-mode confirmation check. Keep public configuration and health responses free of private relay data. Adjust the UI's release-count display if a beneficiary-only release read is used.
3. **Persist ciphertext transactionally.** Replace the single JSON file with durable storage that supports transactions, unique constraints, backups, and restore. A practical first choice is managed PostgreSQL with automated off-host backups and a tested restore procedure. Scope every row by deployment ID. Use unique keys for `(deploymentId, address)` identities, `(deploymentId, vaultId)` packages, and `(deploymentId, vaultId, requestId, guardian)` releases. Repeat submissions with the same digest should succeed idempotently; a different digest for an existing key must fail. Commit a package or release before acknowledging success. Verify stored package digests against on-chain commitments when serving them, and verify backup/restore integrity against the same commitments.
4. **Operate for failure.** Monitor storage errors, failed backups, expired TLS certificates, chain mismatch, and RPC lag. Exercise a restore into a separate environment before treating the service as durable. Preserve deployment fingerprints and the fail-closed behavior on chain or finality errors. Backups must include identities, packages, and releases; they contain public keys and ciphertext, never browser private keys or recovery codes.

## Acceptance evidence required before making a cross-device claim

- On separate devices or isolated browser profiles over HTTPS, enroll five distinct wallets, register a vault, approve with two guardians, release from those guardians, and decrypt exact original bytes on the beneficiary device. Confirm the third guardian stays uninvolved.
- Try an unauthenticated request, a wallet with no role in a vault, a replayed challenge, a session from the wrong deployment, a package with a mismatched commitment, and a release from an unapproved or stale guardian; each must be rejected.
- Restart the relay and restore a backup in a fresh service instance. Confirm packages and releases remain available and their commitments match the chain. Test concurrent writes for idempotency and no lost updates.
- Verify browser secure-context behavior, wallet account/network changes, and confirmation/reorganization handling on the hosted deployment. Record the actual public contract and receipt when deployment occurs.

None of those hosted, multi-device, or restore checks is established by the current local demo or unit tests.
