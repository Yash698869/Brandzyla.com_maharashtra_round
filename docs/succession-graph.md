# Succession Graph and deployment compatibility

New vaults use policy/package version 2. An owner selects a primary, an optional backup with a separate enrolled RSA identity, three distinct guardians, inactivity, challenge and backup waiting durations. All roles must have different wallet addresses. Primary and backup encryption key commitments must differ.

Primary request eligibility is `lastCheckIn + inactivity`. Backup eligibility is `lastCheckIn + inactivity + backupWaitingDuration`. The primary remains eligible thereafter. Neither recipient can replace a pending request. `selectedBeneficiary` records the initiating wallet; only it can finalize. Two configured guardians approve the backup request using the same 2-of-3 quorum as primary recovery, and the second approval starts the **full** challenge duration. Guardian approval represents independent off-chain verification; blockchain events do not prove death or incapacity.

Owner check-in before finalization cancels a pending request, clears its selected recipient/quorum/approvals, and refreshes both deadlines. Request IDs increase at every new request. Guardian release envelopes use version-2 authenticated context containing chain ID, contract, vault ID, request ID, guardian and selected recipient. The browser and relay validate the immutable package/policy, finalized recipient and current approvals. Database payloads cannot authorize recovery.

## Existing version-1 vaults

Version-1 packages keep their original cryptographic domain and primary-only interpretation. The new contract retains `registerVault` for deliberate legacy registrations, tagged `policyVersion = 1`. Recovery-kit wrapper version 1 can carry either an explicitly versioned v1 or v2 encrypted package. Changing a version tag or adding a backup to an existing package is unsupported: it changes authenticated data and the on-chain package commitment.

Old deployed contracts are immutable and remain primary-only at their original addresses. Keep their original deployment configuration/ABI, package commitments, identities and ciphertext to recover them through the legacy path. The updated app reads that original ABI and displays them as v1; it refuses v2 creation on an ABI without `registerSuccessionVault`. Do not overwrite an old contract's ABI or fingerprint with the new one. Recovery kits from an old address cannot be imported into a new deployment. To gain succession, create a new v2 vault with the original asset bytes and newly configured policy; this does not alter or revoke the old vault.

## Redeploying

`npm run compile` regenerates `artifacts/Heirloom.json` and `public/heirloom-contract.json` from the current contract. These generated files remain ignored as before.

`npm run demo` compares the local deployed runtime with the newly compiled runtime. A mismatch deploys a fresh local contract/config and exposes six funded demo actors (owner, primary, three guardians, backup). Existing local ciphertext/identities stay associated with their old deployment; use the old configuration if retaining a running old chain. Sample vaults include backup selection, and vault details provide separate inactivity, backup waiting and challenge clock controls. The clock and actor switcher exist only in local mode.

For Sepolia, deploy a **new contract** with `npm run deploy` using privately supplied `RPC_URL` and `DEPLOYER_PRIVATE_KEY`, or rebuild and use the wallet-based `/deploy.html` page. Keep the old config in a separate file first; deployment writes a new config. `npm run sepolia:import -- <new-config-path>` verifies the current runtime fingerprint and imports its new address/ABI. It deliberately rejects an old runtime instead of treating it as upgraded. `npm run dev:sepolia` reads the saved public configuration without replacing its ABI. No Sepolia deployment is performed by this implementation task.

## Persistence and limits

`server/storage.mjs` remains the existing PostgreSQL adapter. Its package/release JSONB columns already carry versioned ciphertext and recipient metadata; the `(vaultId, guardian, requestId)` key is sufficient because the contract fixes one recipient per request. No schema migration is needed. Plaintext assets, AES keys, guardian private keys and decrypted shares never enter relay payloads. Storage roundtrips are tested with pg-mem; a live PostgreSQL service is not required by the test suite.

Two colluding guardians can reconstruct an asset outside the app. The contract controls authorized recovery, but cannot prevent a sufficient custody quorum from colluding. Browser custody, finalization irreversibility and deployment identity constraints remain unchanged. Public status uses the configured confirmed block; pending transaction results may appear only after enough blocks are mined. The graph does not advance eligibility based on the local wall clock.
