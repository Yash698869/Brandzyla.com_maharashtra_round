# Verification — 4 October 2026

Implemented on `feature/succession-graph`, based on `07348f9`. Changes remain uncommitted. No push, `.env` edit or public deployment was performed.

## Changed files

- Authorization: `contracts/Heirloom.sol` and `tests/contract.test.mjs`.
- Versioned encryption: `src/lib/types.ts`, `src/lib/crypto.ts`, `src/lib/crypto.test.ts`.
- Relay: `server/validation.mjs`, `server/index.mjs`, `tests/relay.test.mjs`, `tests/relay-api.test.mjs`.
- Browser flow: `src/App.tsx`, `src/lib/chain.ts`, `src/lib/registration.ts`, `src/lib/recovery.test.ts`, `src/lib/workspace-policy.ts`, `src/lib/workspace-policy.test.ts`.
- UI: `src/components/CreateVault.tsx`, `src/components/SuccessionGraph.tsx`, `src/components/SuccessionGraph.test.tsx`, `src/components/DevDemoDrawer.tsx`, all three role workspace pages, `src/pages/LogInPage.tsx`, `src/lib/auth.ts`, `src/styles.css`.
- Deployment/demo: `scripts/deploy.mjs`, `scripts/dev.mjs`, `scripts/check-demo.mjs`; ABI/bytecode regenerated at the existing ignored artifact paths.
- Integrated recovery: `tests/succession-e2e.test.ts`; `package.json` includes the new integration and UI suites.
- Documentation: `README.md`, `docs/succession-graph.md`, this report and the implementation plan.

The existing `server/storage.mjs` is reused unchanged. Versioned encrypted packages and releases fit its current JSONB columns and request/guardian uniqueness key. No database adapter or migration was added.

## Results

| Command/check | Result |
| --- | --- |
| `npm test` | PASS: contract 14, crypto/integration/UI 68, relay/auth 40 |
| `npx tsc -b` | PASS |
| `npm run build` | PASS: Solidity compiled (5,973-byte creation bytecode), TypeScript and Vite production output |
| `npm run demo:check` | PASS: six funded local actors, valid contract/receipt/fingerprint, healthy relay/UI |
| `git diff --check` | PASS |
| Independent code review | No actionable correctness/security issue found |

Coverage includes original primary recovery, backup before/at its deadline, no displacement, unavailable third guardian, insufficient/duplicate approval, full challenge, wrong-wallet request/finalization, owner cancellation and refreshed deadlines, stale/mixed/duplicate/wrong-recipient/tampered releases, and exact original binary bytes. The integrated tests use a real local Hardhat contract and the existing Postgres adapter with pg-mem.

Browser verification created three encrypted local sample vaults, checked primary/backup eligibility against confirmed chain time, initiated a backup request, observed its frozen selected path in the owner graph, and canceled it through owner check-in. The graph defaults to all owner assets and can focus on one. Desktop and 390px mobile checks confirmed stacking and no horizontal document overflow (three graphs, content width equal to viewport width).

## Verification conditions and remaining limits

Sandbox-only Vitest initially encountered a Windows temp-file rename permission error, and local RPC tests required execution outside the sandbox. A complete run with workspace temp files had one intermittent identity-enrollment HTTP 400 and two resulting persistence assertions; the initial assertion did not include its response error. Targeted and full reruns passed, including a complete run with the normal system temp directory. The harness now reports enrollment rejection details and explicitly isolates its deployment file/database environment. A transient filesystem lock is plausible but unconfirmed; no storage workaround was introduced without evidence.

Live PostgreSQL and Sepolia were not exercised. PostgreSQL schema/payload behavior is covered through pg-mem; public deployment requires a new contract/address. Existing version-1 vaults remain primary-only on their original deployments. See `docs/succession-graph.md` for redeployment and compatibility instructions. Two colluding guardians can reconstruct an asset outside the authorized application path, as in the original custody model.
