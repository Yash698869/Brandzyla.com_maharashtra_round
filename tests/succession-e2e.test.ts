import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import solc from 'solc';
import { ContractFactory, JsonRpcProvider, id, verifyMessage } from 'ethers';
import { newDb } from 'pg-mem';
import { PostgresStorage } from '../server/storage.mjs';
import { validateRegistration, validateReleaseContext } from '../server/validation.mjs';
import { releaseMessage } from '../shared/protocol.mjs';
import { createIdentity, sealAsset, releaseShare, recoverAsset, packageCommitment, publicKeyHash } from '../src/lib/crypto';
import type { Identity, ProtectedPackage, ShareRelease } from '../src/lib/types';

let node: ChildProcess, provider: JsonRpcProvider, artifact: any, storage: any, pool: any;
let signers: any[], addresses: string[], primary: Identity, backup: Identity, guardians: Identity[];
let fixtureCount = 0;
const binary = Uint8Array.from({ length: 2048 }, (_, i) => (i * 137 + (i >> 3)) & 255);

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

beforeAll(async () => {
  const input = { language: 'Solidity', sources: { 'Heirloom.sol': { content: readFileSync('contracts/Heirloom.sol', 'utf8') } }, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } } } };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  expect((output.errors ?? []).filter((error: any) => error.severity === 'error')).toEqual([]);
  artifact = output.contracts['Heirloom.sol'].Heirloom;
  const port = await freePort(), url = `http://127.0.0.1:${port}`;
  node = spawn(process.execPath, ['node_modules/hardhat/dist/src/cli.js', 'node', '--hostname', '127.0.0.1', '--port', String(port)], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let diagnostics = '';
  node.stderr?.on('data', chunk => { diagnostics += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) });
      if ((await response.json()).result) { ready = true; break; }
    } catch { /* The local test chain is still starting. */ }
    if (node.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error(`Succession test chain did not start: ${diagnostics}`);
  provider = new JsonRpcProvider(url, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 20;
  signers = await Promise.all(Array.from({ length: 7 }, (_, i) => provider.getSigner(i)));
  addresses = await Promise.all(signers.map(signer => signer.getAddress()));
  [primary, backup, ...guardians] = await Promise.all(Array.from({ length: 5 }, () => createIdentity()));
  const adapter = newDb().adapters.createPg();
  pool = new adapter.Pool();
  storage = new PostgresStorage(pool);
  await storage.init();
}, 30000);

afterAll(async () => {
  provider?.destroy();
  node?.kill();
  if (storage) await storage.close();
});

async function advance(seconds: number) {
  await provider.send('evm_increaseTime', [seconds]);
  await provider.send('evm_mine', []);
}

async function state(f: any) {
  const vault = await f.contract.getVault(f.vaultId);
  const approved = [];
  for (const guardian of vault.guardians) if (await f.contract.hasApproved(f.vaultId, vault.requestId, guardian)) approved.push(guardian);
  return {
    beneficiary: vault.beneficiary, beneficiaryKeyHash: vault.beneficiaryKeyHash,
    backupBeneficiary: vault.backupBeneficiary, backupBeneficiaryKeyHash: vault.backupBeneficiaryKeyHash,
    backupWaitingDuration: Number(vault.backupWaitingDuration), inactivity: Number(vault.inactivity), challenge: Number(vault.challenge),
    guardians: Array.from(vault.guardians), approved, commitment: vault.commitment,
    policyVersion: Number(vault.policyVersion), selectedBeneficiary: vault.selectedBeneficiary,
    status: Number(vault.status), requestId: Number(vault.requestId), approvalCount: Number(vault.approvalCount),
  };
}

async function fixture() {
  const contract: any = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, signers[0]).deploy();
  await contract.waitForDeployment();
  const vaultId = id(`succession-e2e-${++fixtureCount}`);
  const binding = { chainId: 31337, contract: await contract.getAddress(), vaultId, beneficiary: addresses[1], beneficiaryKeyHash: publicKeyHash(primary.publicKey), backupBeneficiary: addresses[5], backupBeneficiaryKeyHash: publicKeyHash(backup.publicKey), inactivity: 60, challenge: 30, backupWaitingDuration: 120 };
  const encrypted = await sealAsset(binary, { name: 'private-family-archive.bin', mime: 'application/octet-stream' }, guardians.map((identity, i) => ({ address: addresses[i + 2], publicKey: identity.publicKey })), binding, primary.publicKey, backup.publicKey);
  await (await contract.registerSuccessionVault(vaultId, { ...binding, guardians: addresses.slice(2, 5) }, packageCommitment(encrypted))).wait();
  const f = { contract, vaultId, encrypted };
  expect(validateRegistration(encrypted, await state(f))).toBe(true);
  await storage.savePackage(vaultId, encrypted);
  return f;
}

async function twoApprovals(f: any, requestId: number) {
  for (const i of [2, 3]) await (await f.contract.connect(signers[i]).approveRecovery(f.vaultId, requestId)).wait();
}

async function releasesFor(f: any, identity: Identity, recipient: string, requestId: number): Promise<ShareRelease[]> {
  return Promise.all([0, 1].map(i => releaseShare(f.encrypted, addresses[i + 2], guardians[i], identity.publicKey, requestId, recipient)));
}

async function storeAndRecover(f: any, identity: Identity, recipient: string, requestId: number) {
  const chain = await state(f), releases = await releasesFor(f, identity, recipient, requestId);
  expect(chain).toMatchObject({ status: 2, selectedBeneficiary: recipient, approvalCount: 2 });
  expect(chain.approved).toHaveLength(2);
  for (let i = 0; i < releases.length; i++) {
    expect(validateReleaseContext(releases[i], f.encrypted, chain)).toBe(true);
    const signature = await signers[i + 2].signMessage(releaseMessage(releases[i]));
    expect(verifyMessage(releaseMessage(releases[i]), signature).toLowerCase()).toBe(releases[i].guardian);
    await storage.saveRelease(f.vaultId, { release: releases[i], signature });
  }
  const persisted: ProtectedPackage = await storage.getPackage(f.vaultId);
  const rows: { release: ShareRelease; signature: string }[] = await storage.getReleases(f.vaultId);
  expect(persisted).toEqual(f.encrypted);
  expect(rows.map(row => row.release)).toEqual(releases);
  expect((await pool.query('SELECT payload FROM packages WHERE "vaultId" = $1', [f.vaultId.toLowerCase()])).rows[0].payload).toEqual(persisted);
  expect((await pool.query('SELECT payload FROM releases WHERE "vaultId" = $1', [f.vaultId.toLowerCase()])).rows.map((row: any) => row.payload.release)).toEqual(releases);
  const savedJson = JSON.stringify({ persisted, rows });
  expect(savedJson).not.toContain('private-family-archive.bin');
  expect(savedJson).not.toMatch(/"(?:privateKey|share|bytes|aesKey|d|p|q)":/);
  const recovered = await recoverAsset(persisted, rows.map(row => row.release), identity, requestId, recipient);
  expect(recovered).toMatchObject({ name: 'private-family-archive.bin', mime: 'application/octet-stream' });
  expect(recovered.bytes).toEqual(binary);
  await expect(recoverAsset(persisted, [releases[0]], identity, requestId, recipient)).rejects.toThrow(/quorum|two/i);
  await expect(recoverAsset(persisted, releases, identity, requestId + 1, recipient)).rejects.toThrow(/request/i);
  const other = identity === primary ? backup : primary;
  const otherAddress = identity === primary ? addresses[5] : addresses[1];
  await expect(recoverAsset(persisted, releases, other, requestId, recipient)).rejects.toThrow(/identity/i);
  await expect(recoverAsset(persisted, releases, other, requestId, otherAddress)).rejects.toThrow(/recipient/i);
  expect(() => validateReleaseContext({ ...releases[0], recipient: otherAddress.toLowerCase() }, persisted, chain)).toThrow(/recipient/i);
  const tampered = structuredClone(releases);
  tampered[0].envelope.ciphertext = (tampered[0].envelope.ciphertext[0] === 'A' ? 'B' : 'A') + tampered[0].envelope.ciphertext.slice(1);
  await expect(recoverAsset(persisted, tampered, identity, requestId, recipient)).rejects.toThrow();
  const tamperedPackage = structuredClone(persisted);
  tamperedPackage.ciphertext = (tamperedPackage.ciphertext[0] === 'A' ? 'B' : 'A') + tamperedPackage.ciphertext.slice(1);
  expect(() => validateRegistration(tamperedPackage, chain)).toThrow(/commitment/i);
  await expect(recoverAsset(tamperedPackage, releases, identity, requestId, recipient)).rejects.toThrow();
  return releases;
}

describe('succession contract → encrypted relay storage → beneficiary recovery', () => {
  it('lets the finalized primary recover exact binary bytes with the third guardian absent', async () => {
    const f = await fixture();
    await advance(61);
    await expect(f.contract.connect(signers[6]).requestRecovery.staticCall(f.vaultId)).rejects.toThrow(/Unauthorized/);
    await (await f.contract.connect(signers[1]).requestRecovery(f.vaultId)).wait();
    await expect(f.contract.connect(signers[5]).requestRecovery.staticCall(f.vaultId)).rejects.toThrow(/RecoveryAlreadyPending/);
    await twoApprovals(f, 1);
    await expect(f.contract.connect(signers[1]).finalizeRecovery.staticCall(f.vaultId, 1)).rejects.toThrow(/ChallengeActive/);
    await advance(31);
    await expect(f.contract.connect(signers[5]).finalizeRecovery.staticCall(f.vaultId, 1)).rejects.toThrow(/Unauthorized/);
    await expect(f.contract.connect(signers[6]).finalizeRecovery.staticCall(f.vaultId, 1)).rejects.toThrow(/Unauthorized/);
    await (await f.contract.connect(signers[1]).finalizeRecovery(f.vaultId, 1)).wait();
    await storeAndRecover(f, primary, addresses[1], 1);
  }, 20000);

  it('rejects the canceled primary release and recovers through the later finalized backup request', async () => {
    const f = await fixture();
    await advance(61);
    await expect(f.contract.connect(signers[5]).requestRecovery.staticCall(f.vaultId)).rejects.toThrow(/OwnerStillActive/);
    await (await f.contract.connect(signers[1]).requestRecovery(f.vaultId)).wait();
    await twoApprovals(f, 1);
    const stale = await releasesFor(f, primary, addresses[1], 1);
    const pending = await state(f);
    expect(() => validateReleaseContext(stale[0], f.encrypted, pending)).toThrow(/not finalized/i);
    await (await f.contract.checkIn(f.vaultId)).wait();
    const canceled = await state(f);
    expect(canceled.approved).toEqual([]);
    expect(() => validateReleaseContext(stale[0], f.encrypted, canceled)).toThrow(/not finalized/i);
    await expect(f.contract.connect(signers[1]).finalizeRecovery.staticCall(f.vaultId, 1)).rejects.toThrow(/NoPendingRecovery/);
    await advance(181);
    await (await f.contract.connect(signers[5]).requestRecovery(f.vaultId)).wait();
    await expect(f.contract.connect(signers[1]).requestRecovery.staticCall(f.vaultId)).rejects.toThrow(/RecoveryAlreadyPending/);
    await expect(f.contract.connect(signers[2]).approveRecovery.staticCall(f.vaultId, 1)).rejects.toThrow(/StaleRequest/);
    await twoApprovals(f, 2);
    await advance(31);
    await expect(f.contract.connect(signers[1]).finalizeRecovery.staticCall(f.vaultId, 2)).rejects.toThrow(/Unauthorized/);
    await (await f.contract.connect(signers[5]).finalizeRecovery(f.vaultId, 2)).wait();
    const finalized = await state(f);
    expect(() => validateReleaseContext(stale[0], f.encrypted, finalized)).toThrow(/Stale request/i);
    const r = await storeAndRecover(f, backup, addresses[5], 2);
    await expect(recoverAsset(f.encrypted, [stale[0], r[1]], backup, 2, addresses[5])).rejects.toThrow(/recipient/i);
  }, 20000);
});
