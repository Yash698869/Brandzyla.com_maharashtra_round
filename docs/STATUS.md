# First-round handoff

The application is running locally at http://127.0.0.1:5173. The browser-wallet deployment page is http://127.0.0.1:5173/deploy.html. Public deployment has not yet occurred: the user has a wallet but no Sepolia test ETH yet.

New public-mode browser identities now have a passphrase-encrypted backup and local restoration path. Enrollment asks the user to download and verify the file before publishing a public encryption key. The current local Hardhat demo identities remain legacy non-extractable keys and cannot be backed up retroactively. The new public-mode UI and five-profile rehearsal remain unverified against a funded Sepolia deployment.

Verified in the browser before portable custody was added: sample creation, a custom note registration, premature request rejection, two-guardian recovery while the third does not participate, exact letter decryption, owner cancellation, cleared effective approvals, reload, recovery-kit import, confirmed recovery receipt, and desktop/phone layouts. Automated checks: 42 tests pass. Production build passes. The read-only Sepolia readiness check is prepared; it correctly reports that a funded deployment is still missing. New public-mode backup UI awaits a funded Sepolia browser-wallet rehearsal.

## Saved evidence

- `evidence/dashboard.jpg`: desktop dashboard.
- `evidence/mobile.jpg`: narrow-screen dashboard after layout correction.
- `evidence/recovered-letter.jpg`: released vault, two approvals, unavailable third guardian, and recovered sample letter.
- `evidence/confirmed-receipt.jpg`: actual local EVM recovery finalization receipt.
- `evidence/sepolia-deployment.jpg`: prepared wallet page, including its explicit missing-extension handoff message. This is not evidence of a public deployment.

## Still requiring external execution

- Fund a testnet wallet and sign deployment in its own browser; inspect the real public receipt.
- Import the downloaded configuration and start the public app on port 5174.
- Enroll five distinct addresses and rehearse public recovery. Public wallet rejection, gas estimation, and the full live Sepolia flow remain unverified against a real wallet. A read-only public RPC check returned Sepolia chain ID 11155111; that is connectivity evidence, not deployment evidence.

The in-app browser did not expose an event for the blob recovery-kit download. Import was verified with an encrypted fixture from the live relay. The export click ran without a browser console error, but a saved export file was not observed. Check downloads in the wallet browser before relying on them during judging.

## Deferred review minors

- Existing local private identities remain unbacked; new public-mode identities have encrypted backup/restore. A ciphertext recovery kit does not replace either key.
- More relay endpoint tests for signatures, duplicate writes, and direct registration-commitment mismatches. Current validator tests and integrated happy-path checks do not cover every adversarial endpoint input.

Keep the local chain running and use sample assets. The threshold-collusion, single-device demo, lost-device, public-metadata, ephemeral-chain, and unaudited-prototype limits are detailed in README.md.
