# Portable custody and Sepolia proof

## Goal and current state

Heirloom's local Hardhat demo already proves the contract's timing, quorum, cancellation, and recovery rules. The next milestone is to make a guardian or beneficiary's browser encryption identity portable without giving the relay a private key, demonstrate custody in separate browser profiles, and publish an independently inspectable Sepolia contract after the owner funds and signs a deployment. The existing Hardhat demo at port 5173 and its current chain state must remain available.

The application currently generates RSA-OAEP private keys with `extractable: false` and stores them in IndexedDB. Those existing keys cannot be exported through Web Crypto. The relay binds one public encryption key to each wallet address and deployment. The Sepolia browser-wallet deployment page, import validator, public-mode UI, and three-confirmation release checks already exist; no second contract or signing system is needed.

## Scope and sequence

1. Add encrypted backup creation and restoration for **new** browser encryption identities. Do not overwrite or silently replace an existing identity.
2. Rehearse new owner, beneficiary, and three guardian identities in five separate browser profiles on the same PC. Each public-mode profile uses its own wallet account and browser storage. This demonstrates separated browser custody, not five independent people or devices.
3. Use the existing wallet deployment page when the user has Sepolia test ETH. Verify the deployment receipt, contract address, runtime code, block hash, and explorer URL; import its configuration and rehearse public-mode enrollment and recovery. Keep local Hardhat as the fallback.

The backup implementation and automated restore tests do not require Sepolia ETH. The five-profile public-mode rehearsal does require a Sepolia deployment; without funding it remains an explicitly pending integration check. A successful public deployment requires a funded browser wallet and a human wallet signature; the application must not collect, generate for the user, or transmit a wallet private key or seed phrase.

## Identity backup format and cryptography

Create a versioned `heirloom-identity-backup` JSON file containing a non-secret header, KDF parameters, salt, IV, and ciphertext. The header binds chain ID, contract address, deployment block hash (`deploymentId`), wallet address, and the hash of the public encryption key. The private key is exported as PKCS#8 only during initial creation, then encrypted locally with AES-256-GCM. Derive the AES key from a user-entered passphrase using Web Crypto PBKDF2-HMAC-SHA-256 with a random 16-byte salt and at least 600,000 iterations. Bind the complete header as AES-GCM additional authenticated data. Use a new random 12-byte IV for each backup. Bound file size and accepted KDF parameters during import to avoid excessive work from malformed files.

Generate a temporarily extractable RSA-OAEP key pair for new identities, encrypt the PKCS#8 bytes, then import the private key again as **non-extractable** for IndexedDB. Clear writable plaintext byte buffers when possible; do not claim JavaScript memory is guaranteed to be wiped. Store the encrypted backup blob alongside the non-extractable identity in the browser so the user can download it again. Never send the encrypted backup or passphrase to the relay, and never write plaintext private keys to files, logs, localStorage, or Git.

Restore only after checking the connected wallet address in public mode. Decrypt locally; import the private key as non-extractable; prove that it corresponds to the included public key using an RSA-OAEP encrypt/decrypt challenge; and compare the backup's deployment binding and public-key hash with the active deployment and relay enrollment. A different locally stored or already enrolled key is a hard conflict. A repeat import of the same identity is idempotent. Wrong passphrase, tampering, wrong wallet, wrong deployment, malformed file, and key mismatch fail without changing IndexedDB.

Existing identities have no exportable private-key material. Mark them as legacy/unbacked in the UI, preserve their current vault access, and explain that they cannot acquire a backup retroactively. New public deployment identities will be created with the backup flow. The implementation must not reset the current local chain, clear IndexedDB, or change an existing vault's immutable package commitment.

## App and storage flow

Put the backup and restore controls near `Connect & enroll wallet`, with a visible custody status for the connected identity. A new public-mode wallet enrollment asks for a passphrase and confirmation, creates the encrypted backup, downloads it, and stores the non-extractable identity. The user must reselect the downloaded file and enter the passphrase to verify that it restores the same key before signing the existing enrollment message. The UI explains that the downloaded file **and** passphrase are required after browser loss. The user can re-download the encrypted blob later without exposing the stored private key.

When a wallet already has a relay enrollment but this browser lacks the private key, offer `Restore identity` instead of only reporting that the user is locked to another browser. Restoration accepts the backup file and passphrase, validates the active wallet and deployment, then enables existing guardian/beneficiary actions. Distinguish this identity backup from the existing encrypted asset recovery kit, which contains ciphertext and envelopes but no private identity key.

Keep the local actor switcher for the reliable Hardhat presentation. It is a convenience over unlocked development accounts, not an independent-authentication mode. The separate-profile rehearsal uses public mode on one PC: each browser profile has a distinct wallet account and IndexedDB, while the current relay remains bound to loopback. Separate physical devices require authenticated HTTPS hosting and are outside this milestone.

## Sepolia proof

Retain `src/deploy.tsx` as the sole recommended deployment path. The user obtains faucet test ETH in their own wallet, opens `/deploy.html` in that wallet's browser, reviews and signs the transaction, downloads `heirloom-sepolia.json`, and runs `npm run sepolia:import` and `npm run dev:sepolia`. Add a read-only public preflight command that checks chain 11155111, the imported canonical receipt and code fingerprint, configured contract address, relay/UI availability, and explorer links. It must not deploy, sign, or expose secrets.

For the multi-profile demonstration, enroll five distinct wallet addresses in five profiles. The owner, beneficiary, and two acting guardians need enough Sepolia ETH for their contract transactions; the third guardian can remain unavailable after signing enrollment. Public mode uses real elapsed time and three confirmations; it must not expose a clock skip. Record the deployment transaction and at least one recovery receipt as explorer links. If no test ETH is available, complete the backup implementation and local tests, and report public deployment as pending rather than presenting local hashes as public proof.

## Failure handling and verification

- Keep the existing deployment, relay, and identity data intact. Never replace a key when a backup cannot be validated.
- Test backup round-trip, repeat import, wrong passphrase, modified ciphertext/header, wrong wallet/deployment, mismatched public/private key, malicious KDF parameters, and an existing-key conflict.
- Test IndexedDB persistence and concurrency so two tabs cannot overwrite different identities or backup blobs.
- Verify the full automated suite and production build after implementation, then rehearse export and restore across two fresh browser profiles. Rehearse the public transaction path only after the funded wallet is available.
- Update README, the demo guide, threat model, and status file to distinguish backupable new identities, legacy identities, same-PC profiles, and uncompleted Sepolia execution.

## Limits

A stolen encrypted backup can be attacked offline if its passphrase is weak; the UI must call for a strong, unique passphrase. Losing both the file and browser identity, or forgetting the passphrase, can still make recovery impossible. Separate browser profiles on one PC do not prove independent people or devices. Two colluding guardians can still combine their shares outside the contract. A Sepolia deployment gives public transaction evidence but does not by itself make the relay highly available or the protocol audited.

## References

- [Web Crypto exportability rule](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/exportKey)
- [OWASP PBKDF2-HMAC-SHA-256 work factor](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [Ethereum Sepolia and faucet directory](https://ethereum.org/developers/docs/networks/)
