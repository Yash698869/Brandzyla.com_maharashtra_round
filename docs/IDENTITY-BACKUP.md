# Identity backup design

**Status: proposed for newly created identities only.** No portable private-key backup or restore is implemented. The encrypted **asset recovery kit** contains a vault package and guardian envelopes; it does not contain a guardian's or beneficiary's RSA private identity key.

## Existing custody and irreversible constraints

`src/lib/crypto.ts` creates each RSA-OAEP key pair with `extractable: false`. `src/lib/identity.ts` stores the resulting private `CryptoKey` in IndexedDB under chain ID, contract address, deployment ID, and wallet address. Web Crypto cannot export or wrap that existing non-extractable private key. Wallet signatures prove control of an address but do not derive or recover the separate encryption key.

Each vault's guardian envelopes were sealed to the guardians' enrolled public keys. The beneficiary key hash is fixed in the registered contract state and protected-package commitment. `server/validation.mjs` rejects conflicting enrollment for the same account. Replacing a key in IndexedDB or enrolling a new public key therefore cannot unlock an old vault. A lost beneficiary key prevents that beneficiary from decrypting old releases; loss of two guardian keys can prevent any two-of-three release. Existing keys must be left intact, including their IndexedDB namespace and non-extractable property. There is no automatic migration or retroactive backup for them.

## Backup format and creation for a new identity

Use a distinct, versioned `heirloom-identity-backup` file. It contains the public key, wallet address, chain ID, contract address, deployment ID, public-key hash, algorithm/version identifiers, KDF salt, AES-GCM nonce, and the **encrypted** PKCS#8 private key. It must not be confused with `heirloom-recovery-kit` and must never be accepted by the asset-kit import path. All visible metadata is authenticated as AES-GCM additional data using one canonical encoding.

1. Generate a fresh 256-bit recovery code with `crypto.getRandomValues`; display it separately from the encrypted file. Derive a wrapping key with HKDF-SHA-256, a random salt, and a versioned Heirloom purpose string. Do not use a user-chosen password with this fast derivation; a password option would need a separately reviewed, memory-hard KDF and recovery UX.
2. Generate the RSA-OAEP pair as temporarily extractable **only during first creation**. Wrap the private key as PKCS#8 with AES-256-GCM, then unwrap it immediately as a non-extractable `CryptoKey` for normal custody. Persist only that non-extractable key, the public key, and the encrypted backup in IndexedDB. Do not persist plaintext PKCS#8, the recovery code, or the wrapping key. Clear temporary byte buffers where possible; acknowledge that script compromise during creation can still read an extractable key.
3. Before wallet-signed enrollment, require the user to save the encrypted file separately from the recovery code and prove the code can unwrap it. Check that the reimported key decrypts a random challenge encrypted to the advertised public key. Only enroll the public key after this round trip succeeds. An interrupted flow can retry from the preserved encrypted backup and local non-extractable key; it must never silently generate a replacement for an already enrolled address.
4. Preserve the existing atomic, across-tab identity selection. If two tabs race to create an identity, the downloaded backup and enrolled public key must match the key that won the IndexedDB write. Discard a losing backup, and reject a mismatch before enrollment.

The recovery code is the only secret needed to open a stolen backup file. Treat both parts as sensitive, keep them in separate places, and never put the code in a URL, log, analytics event, or relay response. The relay need not store identity backups for the first release.

## Restore on another device

Require a wallet connection to the backup's exact account and deployment. Validate file version, size, algorithms, nonce, namespace, and authenticated metadata before writing IndexedDB. Unwrap the private key as **non-extractable**, test it against the backup public key with an encrypt/decrypt challenge, then compare its public-key hash with the relay's signed enrolled identity and with any applicable vault beneficiary commitment. If a local identity already has the same hash, treat restore as a no-op; if it differs, refuse to overwrite it. Never call enrollment to replace a conflicting key. A wrong recovery code, tampered file, different wallet, different chain/deployment, or incomplete file must leave local custody unchanged.

## Rollout and checks

Add backup-capable creation as an explicit path only for accounts with no local or relay identity. Keep the old IndexedDB records readable and the old `createIdentity` behavior available until migration checks and browser tests pass. Before changing key generation, test fresh backup/restore across profiles, a code/file mismatch, wrong deployment, corruption, two-tab races, interrupted enrollment, and untouched legacy identities. Confirm a restored guardian can release an envelope created before the device move and a restored beneficiary can decrypt the resulting release. Test that old non-extractable identities cannot be exported and remain usable on their original browser.

For an old vault whose required private key is lost, the current protocol has no key rotation or rewrap operation. If the owner still has the original plaintext, a replacement vault with usable identities can be created under a deployment/account setup that permits those identities; that is a new vault, not recovery of the old ciphertext. A safe rotation design for existing vaults would require a separately reviewed contract and package migration protocol. Do not change key generation for existing enrollments as a shortcut.

Web Crypto's [key export rules](https://www.w3.org/TR/WebCryptoAPI/) and [secure-context requirement](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/exportKey) are the platform constraints behind this design.
