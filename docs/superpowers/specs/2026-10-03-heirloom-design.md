# Heirloom: first-round hackathon design

Date: 2026-10-03
Status: approved by the user; first-round implementation built and locally verified. Public Sepolia execution awaits funded wallet signing.

## Intent and constraints

Build a demonstrable digital inheritance protocol for a hackathon. The first judging round is approximately four hours from the user's stated deadline, with the final submission approximately twenty-four hours away. The user explicitly wants blockchain involvement in the first round. The workspace starts empty; Node, npm, and Git executables are available.

Success is a complete encrypted-asset recovery demonstration, including rejected premature access, recovery despite an unavailable guardian, and owner cancellation. This is a prototype with an explicit threat model, not an audited custody product. Use sample documents and secrets for judging.

Assumptions: a browser app is acceptable;  no mandatory chain or sponsor technology has been specified.No funded testnet account or RPC credentials have been established.

## Approach and alternatives

Recommended: React/TypeScript interface, Solidity recovery contract, local EVM development network, and browser cryptography. Make an Ethereum Sepolia deployment available when a suitable wallet and RPC connection are available. A local EVM executes actual contracts and transactions but does not demonstrate a decentralized validator network; label it clearly.

A UI-only simulation would be faster but would not prove authorization. A public-testnet-first build would provide explorer links sooner but adds wallet, faucet, and network dependencies. Build and verify the contract locally first, with public deployment as the preferred first-round enhancement rather than a prerequisite for demonstrating recovery.

## What blockchain does

One non-upgradeable contract records each vault's owner, beneficiary, three distinct guardian addresses, two-guardian threshold, inactivity duration, challenge duration, and encrypted-package commitment. It enforces recovery transitions and emits events. No privileged administrator may bypass its rules. The first version fixes the policy at registration; edits require a new vault.

Never put plaintext assets, file names, encryption keys, secret shares, or evidence documents on-chain. Commit to the randomized encrypted package, not a low-entropy plaintext secret. Addresses, timing, and recovery activity are public metadata.

The browser uses contract state as the source of authorization. A backend status flag or a disabled UI button is not a security boundary.

## Recovery state machine

1. Registration starts an active vault and records the owner's last check-in.
2. Only the designated beneficiary can request recovery after the inactivity deadline. A request gets a unique monotonically increasing identifier.
3. Only configured guardians can approve that current request. Each address counts once. Approval attests to an independent off-chain verification by that guardian; a wallet signature alone does not prove real-world incapacity.
4. The second approval starts the full challenge window. Inactivity plus two independent attestations are the prototype's combined recovery signals.
5. Before finalization, an owner check-in cancels the current request, invalidates its approvals, and refreshes the inactivity deadline. An explicit cancel action has the same effect.
6. Only the beneficiary can finalize after the full challenge window and required approvals. Checks are performed in the contract. Finalization is terminal for that vault.
7. Guardians release shares only after checking finalized state, the beneficiary, chain ID, contract address, vault ID, and request ID. The beneficiary reconstructs and decrypts locally.

The owner cannot reverse already released information. If cancellation races finalization, chain transaction ordering determines the outcome; do not promise retroactive revocation. Public-network share release must wait for configured confirmations; local demo mode may use immediate confirmation.

## Encryption and key custody

Generate a fresh random AES-256-GCM key and nonce in the owner browser for each protected asset. Encrypt before storage. Use a reviewed existing secret-sharing library to split that key into two-of-three shares; do not invent a sharing algorithm.

Each guardian has a separate encryption identity and receives an encrypted share package. Private decryption keys remain with that guardian. Use supported standard authenticated encryption and key wrapping with separate purposes for wallet authorization and package decryption. Never derive an encryption secret from a public wallet signature.

After authorization, guardians encrypt their released shares to the registered beneficiary encryption key. Bind envelopes to vault, policy version, and request. Only the beneficiary reconstructs the key. Reject duplicate share indices, mixed-vault shares, corrupted ciphertext, wrong recipient packages, and stale request envelopes.

The owner necessarily knows their own asset and key at creation. A single guardian or storage service cannot reconstruct the asset key from its holdings. Two colluding guardians can bypass the intended off-chain release policy; the smart contract cannot prevent holders of a sufficient share quorum from combining those shares privately. Honest guardian clients and independent custody are explicit assumptions.

The demo may offer separate actor browser sessions and local development accounts. If all actors are operated from one machine, visibly label that arrangement as a demo of roles, not evidence of independent custody. Do not expose development private keys in public-network mode.

## App and storage

Views: owner vault dashboard, create-vault flow, guardian approval/release inbox, beneficiary recovery view, and transaction timeline. Include connection/network state, current account, contract address, transaction receipts, and recovery progress.

Use local off-chain persistence for encrypted payloads and encrypted envelopes, with export/import of a recovery kit. Keep private keys out of shared application storage and server logs. A recovery kit contains ciphertext and the identifiers needed to locate the contract, never sufficient plaintext key material for recovery. A minimal local transport may relay encrypted envelopes but must not authorize recovery.

Show errors for rejected wallet actions, wrong network, failed transactions, unavailable RPC, insufficient approvals, missing packages, and authentication failures. Refresh from confirmed contract state before reporting success. Duplicate clicks must not double-count approvals or create ambiguous pending requests.

## First-round acceptance criteria

- Create a vault containing sample data, then recover exactly the original bytes through the complete flow.
- Requesting before inactivity expires fails at contract level.
- One guardian cannot finalize recovery or decrypt the asset.
- A non-guardian and duplicate approval are rejected.
- Two valid guardians permit recovery while the third is unavailable.
- Even with quorum, finalization before the challenge deadline is rejected.
- Owner cancellation invalidates the attempt; old approvals cannot authorize a later request.
- Wrong beneficiaries cannot request or finalize recovery, and cannot decrypt recipient-bound packages.
- Tampering with ciphertext fails authenticated decryption.
- Events and transaction receipts correspond to real chain actions.
- Local time advancement is available only on the development chain and clearly labelled. Public mode has no bypass or artificial time controls.
- Page reload preserves public vault state and encrypted artifacts; actor custody and recovery-kit behavior are documented.

Tests prioritize contract permission/state transitions, stale attempts, time boundaries, and cryptographic round trips/tampering. Then exercise the integrated browser demo and production build.

## Demo story and time budget

Use two sample vaults: one successful inheritance, one cancellation. For the first, encrypt a family document, show the protected ciphertext, attempt early recovery, advance the local chain clock, collect one approval and show denial, then collect the second, wait through the challenge window, finalize, and decrypt as beneficiary. For the second, show the owner checking in and stopping the pending attempt.

Target allocation after design/planning approval: approximately 50 minutes for foundation and contract; 60 minutes for encryption and role flows; 60 minutes for integration and tests; remaining time for polish, optional public deployment, and rehearsal. Treat these as targets and reduce visual extras before removing core security checks.

First round excludes tokens, NFTs, DAO voting, AI death detection, real money custody, legal verification integrations, and cross-chain support. During the remaining twenty hours, prioritize independent-device testing, public-testnet deployment if still pending, recovery-kit resilience, accessible responsive UI, deployment documentation, and a concise pitch.

## Sources and design limits

- W3C Web Cryptography API: https://www.w3.org/TR/WebCryptoAPI/
- Ethereum development networks: https://ethereum.org/developers/docs/development-networks/
- Ethereum public networks (Sepolia for application development): https://ethereum.org/developers/docs/networks/
- NIST threshold cryptography background: https://csrc.nist.gov/Projects/threshold-cryptography

These sources support the underlying primitives and development-network choices; they do not certify this proposed protocol. The spec deliberately separates on-chain authorization from off-chain custody and recognizes guardian collusion, endpoint compromise, lost ciphertext, and public metadata as limits.
