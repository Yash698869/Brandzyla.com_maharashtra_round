import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import solc from 'solc';
import { ContractFactory, JsonRpcProvider, id, ZeroAddress, ZeroHash } from 'ethers';

let node, provider, signers, artifact;
before(async () => {
  assert.ok(existsSync('contracts/Heirloom.sol'), 'Recovery contract must exist');
  const input = { language: 'Solidity', sources: { 'Heirloom.sol': { content: readFileSync('contracts/Heirloom.sol', 'utf8') } }, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } } } };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  assert.deepEqual((output.errors ?? []).filter(e => e.severity === 'error'), []);
  artifact = output.contracts['Heirloom.sol'].Heirloom;
  node = spawn(process.execPath, ['node_modules/hardhat/dist/src/cli.js', 'node', '--hostname', '127.0.0.1', '--port', '18545'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let diagnostics = '';
  node.stdout.on('data', d => { diagnostics += d; }); node.stderr.on('data', d => { diagnostics += d; });
  provider = new JsonRpcProvider('http://127.0.0.1:18545', undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 30;
  for (let n = 0; n < 100; n++) {
    try { await provider.send('eth_chainId', []); break; } catch { await new Promise(r => setTimeout(r, 100)); }
    if (n === 99) throw new Error(`Test chain did not start: ${diagnostics}`);
  }
  signers = await Promise.all(Array.from({ length: 7 }, (_, i) => provider.getSigner(i)));
}, { timeout: 20000 });
after(async () => { provider?.destroy(); node?.kill(); });

async function fixture(overrides = {}) {
  const contract = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, signers[0]).deploy();
  await contract.waitForDeployment();
  const vaultId = id(`vault-${Math.random()}`);
  const addresses = await Promise.all(signers.map(s => s.getAddress()));
  const guardians = overrides.guardians ?? addresses.slice(2, 5);
  const args = [vaultId, overrides.beneficiary ?? addresses[1], guardians, overrides.inactivity ?? 60, overrides.challenge ?? 30, overrides.commitment ?? id('encrypted package'), overrides.keyHash ?? id('beneficiary key')];
  return { contract, vaultId, addresses, args };
}
async function create() { const f = await fixture(); await (await f.contract.registerVault(...f.args)).wait(); return f; }
async function advance(seconds) { await provider.send('evm_increaseTime', [seconds]); await provider.send('evm_mine', []); }
async function request(f) { await advance(61); await (await f.contract.connect(signers[1]).requestRecovery(f.vaultId)).wait(); return Number((await f.contract.getVault(f.vaultId)).requestId); }
async function approvals(f, requestId) { for (const i of [2, 3]) await (await f.contract.connect(signers[i]).approveRecovery(f.vaultId, requestId)).wait(); }
async function rejects(action, code) { await assert.rejects(action, e => { assert.ok(String(e).includes(code), `Expected ${code}, received ${e}`); return true; }); }

test('registration rejects duplicate guardians, overlapping roles and invalid policy', async () => {
  for (const invalid of ['duplicates', 'owner', 'beneficiary', 'zero', 'inactivity', 'challenge', 'commitment', 'keyHash']) {
    const f = await fixture();
    if (invalid === 'duplicates') f.args[2][1] = f.args[2][0];
    if (invalid === 'owner') f.args[2][0] = f.addresses[0];
    if (invalid === 'beneficiary') f.args[2][0] = f.addresses[1];
    if (invalid === 'zero') f.args[1] = ZeroAddress;
    if (invalid === 'inactivity') f.args[3] = 0;
    if (invalid === 'challenge') f.args[4] = 0;
    if (invalid === 'commitment') f.args[5] = ZeroHash;
    if (invalid === 'keyHash') f.args[6] = ZeroHash;
    await rejects(() => f.contract.registerVault.staticCall(...f.args), 'InvalidPolicy');
  }
});
test('only designated beneficiary can request, and inactivity alone cannot finalize', async () => {
  const f = await create();
  await rejects(() => f.contract.connect(signers[1]).requestRecovery.staticCall(f.vaultId), 'OwnerStillActive');
  await advance(61);
  await rejects(() => f.contract.connect(signers[5]).requestRecovery.staticCall(f.vaultId), 'Unauthorized');
  await (await f.contract.connect(signers[1]).requestRecovery(f.vaultId)).wait();
  await rejects(() => f.contract.connect(signers[1]).finalizeRecovery.staticCall(f.vaultId, 1), 'QuorumNotMet');
});
test('guardian identity and per-request duplicate voting are enforced', async () => {
  const f = await create(), req = await request(f);
  await rejects(() => f.contract.connect(signers[5]).approveRecovery.staticCall(f.vaultId, req), 'Unauthorized');
  await (await f.contract.connect(signers[2]).approveRecovery(f.vaultId, req)).wait();
  await rejects(() => f.contract.connect(signers[2]).approveRecovery.staticCall(f.vaultId, req), 'AlreadyApproved');
  assert.equal(Number((await f.contract.getVault(f.vaultId)).approvalCount), 1);
  await rejects(() => f.contract.connect(signers[1]).finalizeRecovery.staticCall(f.vaultId, req), 'QuorumNotMet');
});
test('challenge starts at quorum and two guardians recover while the third is unavailable', async () => {
  const f = await create(), req = await request(f);
  await (await f.contract.connect(signers[2]).approveRecovery(f.vaultId, req)).wait();
  await advance(100);
  await (await f.contract.connect(signers[3]).approveRecovery(f.vaultId, req)).wait();
  const v = await f.contract.getVault(f.vaultId);
  assert.ok(Number(v.quorumAt) > 0);
  await rejects(() => f.contract.connect(signers[1]).finalizeRecovery.staticCall(f.vaultId, req), 'ChallengeActive');
  await advance(31);
  await rejects(() => f.contract.connect(signers[5]).finalizeRecovery.staticCall(f.vaultId, req), 'Unauthorized');
  await (await f.contract.connect(signers[1]).finalizeRecovery(f.vaultId, req)).wait();
  assert.equal(Number((await f.contract.getVault(f.vaultId)).status), 2);
  assert.equal(await f.contract.hasApproved(f.vaultId, req, f.addresses[4]), false);
});
test('owner cancellation invalidates old approvals and cannot be triggered by another account', async () => {
  const f = await create(), req = await request(f); await approvals(f, req);
  await rejects(() => f.contract.connect(signers[1]).checkIn.staticCall(f.vaultId), 'Unauthorized');
  await (await f.contract.checkIn(f.vaultId)).wait();
  assert.equal(Number((await f.contract.getVault(f.vaultId)).status), 0);
  await rejects(() => f.contract.connect(signers[1]).finalizeRecovery.staticCall(f.vaultId, req), 'NoPendingRecovery');
  const next = await request(f); assert.equal(next, req + 1);
  await rejects(() => f.contract.connect(signers[2]).approveRecovery.staticCall(f.vaultId, req), 'StaleRequest');
  assert.equal(Number((await f.contract.getVault(f.vaultId)).approvalCount), 0);
  await rejects(() => f.contract.connect(signers[1]).finalizeRecovery.staticCall(f.vaultId, next), 'QuorumNotMet');
});
test('finalization is terminal and a cancelled transaction cannot be revived', async () => {
  const f = await create(), req = await request(f); await approvals(f, req); await advance(31);
  await (await f.contract.checkIn(f.vaultId)).wait();
  await rejects(() => f.contract.connect(signers[1]).finalizeRecovery.staticCall(f.vaultId, req), 'NoPendingRecovery');
  const next = await request(f); await approvals(f, next); await advance(31);
  await (await f.contract.connect(signers[1]).finalizeRecovery(f.vaultId, next)).wait();
  await rejects(() => f.contract.checkIn.staticCall(f.vaultId), 'AlreadyFinalized');
  await rejects(() => f.contract.connect(signers[1]).requestRecovery.staticCall(f.vaultId), 'AlreadyFinalized');
});
test('unknown vault and duplicate registration are rejected', async () => {
  const f = await create();
  await rejects(() => f.contract.registerVault.staticCall(...f.args), 'VaultAlreadyExists');
  await rejects(() => f.contract.getVault(id('unknown')), 'VaultNotFound');
});
