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
test('third guardian may attest during pending recovery without restarting the challenge', async () => {
  const f = await create(), req = await request(f);
  await approvals(f, req);
  const quorumAt = (await f.contract.getVault(f.vaultId)).quorumAt;
  await advance(10);
  await (await f.contract.connect(signers[4]).approveRecovery(f.vaultId, req)).wait();
  const v = await f.contract.getVault(f.vaultId);
  assert.equal(Number(v.approvalCount), 3);
  assert.equal(v.quorumAt, quorumAt);
  await rejects(() => f.contract.connect(signers[1]).finalizeRecovery.staticCall(f.vaultId, req), 'ChallengeActive');
  await advance(21);
  await (await f.contract.connect(signers[1]).finalizeRecovery(f.vaultId, req)).wait();
  assert.equal(Number((await f.contract.getVault(f.vaultId)).status), 2);
});
test('owner cancellation invalidates old approvals and cannot be triggered by another account', async () => {
  const f = await create(), req = await request(f); await approvals(f, req);
  await rejects(() => f.contract.connect(signers[1]).checkIn.staticCall(f.vaultId), 'Unauthorized');
  await (await f.contract.checkIn(f.vaultId)).wait();
  assert.equal(Number((await f.contract.getVault(f.vaultId)).status), 0);
  assert.equal((await f.contract.getVault(f.vaultId)).selectedBeneficiary, ZeroAddress);
  assert.equal(await f.contract.hasApproved(f.vaultId, req, f.addresses[2]), false);
  assert.equal(await f.contract.hasApproved(f.vaultId, req, f.addresses[3]), false);
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

async function successionFixture(overrides = {}) {
  const f = await fixture();
  const policy = {
    beneficiary: f.addresses[1], backupBeneficiary: f.addresses[5],
    guardians: f.addresses.slice(2, 5), inactivity: 60, challenge: 30,
    backupWaitingDuration: 90, beneficiaryKeyHash: id('primary key'),
    backupBeneficiaryKeyHash: id('backup key'), ...overrides,
  };
  return { ...f, policy };
}
async function createSuccession(overrides = {}) {
  const f = await successionFixture(overrides);
  f.registration = await (await f.contract.registerSuccessionVault(f.vaultId, f.policy, id('succession package'))).wait();
  return f;
}
async function at(timestamp) { await provider.send('evm_setNextBlockTimestamp', [Number(timestamp)]); await provider.send('evm_mine', []); }
function events(f, receipt) { return receipt.logs.map(log => { try { return f.contract.interface.parseLog(log); } catch { return null; } }).filter(Boolean); }

test('legacy registration remains primary-only and snapshots the primary recipient', async () => {
  const f = await create();
  const v = await f.contract.getVault(f.vaultId);
  assert.equal(Number(v.policyVersion), 1);
  assert.equal(v.backupBeneficiary, ZeroAddress);
  assert.equal(v.backupWaitingDuration, 0n);
  assert.equal(v.backupBeneficiaryKeyHash, ZeroHash);
  assert.equal(v.selectedBeneficiary, ZeroAddress);
  await request(f);
  assert.equal((await f.contract.getVault(f.vaultId)).selectedBeneficiary, f.addresses[1]);
});

test('succession registration commits an optional backup and emits its policy', async () => {
  const f = await createSuccession();
  const v = await f.contract.getVault(f.vaultId);
  assert.equal(Number(v.policyVersion), 2);
  assert.equal(v.backupBeneficiary, f.addresses[5]);
  assert.equal(v.backupWaitingDuration, 90n);
  assert.equal(v.beneficiaryKeyHash, id('primary key'));
  assert.equal(v.backupBeneficiaryKeyHash, id('backup key'));
  assert.equal(v.selectedBeneficiary, ZeroAddress);
  const event = events(f, f.registration).find(event => event.name === 'VaultPolicyRegistered');
  assert.ok(event);
  assert.equal(Number(event.args.policyVersion), 2);
  assert.equal(event.args.backupBeneficiary, f.addresses[5]);
  assert.equal(event.args.backupWaitingDuration, 90n);
  assert.equal(event.args.beneficiaryKeyHash, id('primary key'));
  assert.equal(event.args.backupBeneficiaryKeyHash, id('backup key'));
  const primaryOnly = await createSuccession({ backupBeneficiary: ZeroAddress, backupWaitingDuration: 0, backupBeneficiaryKeyHash: ZeroHash });
  await advance(61);
  await (await primaryOnly.contract.connect(signers[1]).requestRecovery(primaryOnly.vaultId)).wait();
  assert.equal((await primaryOnly.contract.getVault(primaryOnly.vaultId)).selectedBeneficiary, primaryOnly.addresses[1]);
  await rejects(() => primaryOnly.contract.connect(signers[5]).requestRecovery.staticCall(primaryOnly.vaultId), 'Unauthorized');
  await rejects(() => f.contract.registerSuccessionVault.staticCall(f.vaultId, f.policy, id('package')), 'VaultAlreadyExists');
});

test('succession registration rejects inconsistent backup values, role overlap and key reuse', async () => {
  const f = await successionFixture();
  const invalidPolicies = [
    { backupBeneficiary: f.addresses[0] }, { backupBeneficiary: f.addresses[1] },
    ...f.addresses.slice(2, 5).map(backupBeneficiary => ({ backupBeneficiary })),
    { backupWaitingDuration: 0 }, { backupBeneficiaryKeyHash: ZeroHash },
    { backupBeneficiaryKeyHash: id('primary key') },
    { backupBeneficiary: ZeroAddress },
    { backupBeneficiary: ZeroAddress, backupBeneficiaryKeyHash: ZeroHash },
    { backupBeneficiary: ZeroAddress, backupWaitingDuration: 0 },
    { beneficiary: ZeroAddress }, { beneficiary: f.addresses[0] },
    { beneficiaryKeyHash: ZeroHash }, { inactivity: 0 }, { challenge: 0 },
    { guardians: [ZeroAddress, f.addresses[3], f.addresses[4]] },
    { guardians: [f.addresses[0], f.addresses[3], f.addresses[4]] },
    { guardians: [f.addresses[1], f.addresses[3], f.addresses[4]] },
    { guardians: [f.addresses[2], f.addresses[2], f.addresses[4]] },
  ];
  for (const invalid of invalidPolicies) {
    await rejects(() => f.contract.registerSuccessionVault.staticCall(f.vaultId, { ...f.policy, ...invalid }, id('package')), 'InvalidPolicy');
  }
  await rejects(() => f.contract.registerSuccessionVault.staticCall(ZeroHash, f.policy, id('package')), 'InvalidPolicy');
  await rejects(() => f.contract.registerSuccessionVault.staticCall(f.vaultId, f.policy, ZeroHash), 'InvalidPolicy');
});

test('primary becomes eligible at inactivity and backup waits until its exact deadline', async () => {
  const f = await createSuccession(), start = (await f.contract.getVault(f.vaultId)).lastCheckIn;
  await at(start + 59n);
  await rejects(() => f.contract.connect(signers[1]).requestRecovery.staticCall(f.vaultId), 'OwnerStillActive');
  await at(start + 60n);
  await f.contract.connect(signers[1]).requestRecovery.staticCall(f.vaultId);
  await rejects(() => f.contract.connect(signers[5]).requestRecovery.staticCall(f.vaultId), 'OwnerStillActive');
  await at(start + 149n);
  await rejects(() => f.contract.connect(signers[5]).requestRecovery.staticCall(f.vaultId), 'OwnerStillActive');
  await provider.send('evm_setNextBlockTimestamp', [Number(start + 150n)]);
  const receipt = await (await f.contract.connect(signers[5]).requestRecovery(f.vaultId, { gasLimit: 500_000 })).wait();
  assert.equal((await provider.getBlock(receipt.blockNumber)).timestamp, Number(start + 150n));
  assert.equal((await f.contract.getVault(f.vaultId)).selectedBeneficiary, f.addresses[5]);
  assert.equal(events(f, receipt).find(event => event.name === 'RecoveryRequested').args.beneficiary, f.addresses[5]);
});

test('pending primary or backup request cannot be displaced by the other recipient', async () => {
  for (const selected of [1, 5]) {
    const f = await createSuccession();
    await advance(151);
    await (await f.contract.connect(signers[selected]).requestRecovery(f.vaultId)).wait();
    for (const caller of [1, 5]) await rejects(() => f.contract.connect(signers[caller]).requestRecovery.staticCall(f.vaultId), 'RecoveryAlreadyPending');
    await rejects(() => f.contract.connect(signers[6]).requestRecovery.staticCall(f.vaultId), 'Unauthorized');
    const v = await f.contract.getVault(f.vaultId);
    assert.equal(v.selectedBeneficiary, f.addresses[selected]);
    assert.equal(v.requestId, 1n);
  }
});

test('backup requires two guardians and the full challenge, then only backup finalizes', async () => {
  const f = await createSuccession();
  await advance(151);
  await (await f.contract.connect(signers[5]).requestRecovery(f.vaultId)).wait();
  await rejects(() => f.contract.connect(signers[6]).approveRecovery.staticCall(f.vaultId, 1), 'Unauthorized');
  await rejects(() => f.contract.connect(signers[5]).finalizeRecovery.staticCall(f.vaultId, 1), 'QuorumNotMet');
  await (await f.contract.connect(signers[2]).approveRecovery(f.vaultId, 1)).wait();
  await rejects(() => f.contract.connect(signers[2]).approveRecovery.staticCall(f.vaultId, 1), 'AlreadyApproved');
  await advance(100);
  await rejects(() => f.contract.connect(signers[5]).finalizeRecovery.staticCall(f.vaultId, 1), 'QuorumNotMet');
  const receipt = await (await f.contract.connect(signers[3]).approveRecovery(f.vaultId, 1)).wait();
  const v = await f.contract.getVault(f.vaultId);
  assert.equal(v.approvalCount, 2n);
  assert.equal(await f.contract.hasApproved(f.vaultId, 1, f.addresses[4]), false);
  assert.equal(events(f, receipt).find(event => event.name === 'ChallengeStarted').args.releaseAfter, v.quorumAt + 30n);
  await rejects(() => f.contract.connect(signers[5]).finalizeRecovery.staticCall(f.vaultId, 1), 'ChallengeActive');
  await at(v.quorumAt + 29n);
  await rejects(() => f.contract.connect(signers[5]).finalizeRecovery.staticCall(f.vaultId, 1), 'ChallengeActive');
  for (const caller of [0, 1, 2, 6]) await rejects(() => f.contract.connect(signers[caller]).finalizeRecovery.staticCall(f.vaultId, 1), 'Unauthorized');
  await provider.send('evm_setNextBlockTimestamp', [Number(v.quorumAt + 30n)]);
  const finalized = await (await f.contract.connect(signers[5]).finalizeRecovery(f.vaultId, 1, { gasLimit: 500_000 })).wait();
  const done = await f.contract.getVault(f.vaultId);
  assert.equal(Number(done.status), 2);
  assert.equal(done.selectedBeneficiary, f.addresses[5]);
  assert.equal(done.finalizedAt, v.quorumAt + 30n);
  assert.equal(events(f, finalized).find(event => event.name === 'RecoveryFinalized').args.beneficiary, f.addresses[5]);
  await rejects(() => f.contract.checkIn.staticCall(f.vaultId), 'AlreadyFinalized');
  for (const caller of [1, 5]) await rejects(() => f.contract.connect(signers[caller]).requestRecovery.staticCall(f.vaultId), 'AlreadyFinalized');
  await rejects(() => f.contract.connect(signers[5]).finalizeRecovery.staticCall(f.vaultId, 1), 'NoPendingRecovery');
  await rejects(() => f.contract.connect(signers[4]).approveRecovery.staticCall(f.vaultId, 1), 'NoPendingRecovery');
});

test('owner check-in clears recipient and approvals, refreshes both deadlines and rejects stale requests', async () => {
  const f = await createSuccession();
  await advance(151);
  await (await f.contract.connect(signers[5]).requestRecovery(f.vaultId)).wait();
  await approvals(f, 1);
  await advance(31);
  for (const caller of [1, 2, 5, 6]) await rejects(() => f.contract.connect(signers[caller]).checkIn.staticCall(f.vaultId), 'Unauthorized');
  const receipt = await (await f.contract.checkIn(f.vaultId)).wait();
  assert.equal(events(f, receipt).find(event => event.name === 'RecoveryCancelled').args.requestId, 1n);
  const v = await f.contract.getVault(f.vaultId);
  assert.equal(Number(v.status), 0);
  assert.equal(v.selectedBeneficiary, ZeroAddress);
  assert.equal(v.approvalCount, 0n);
  assert.equal(v.quorumAt, 0n);
  assert.equal(v.requestId, 1n);
  for (const guardian of f.addresses.slice(2, 5)) assert.equal(await f.contract.hasApproved(f.vaultId, 1, guardian), false);
  await rejects(() => f.contract.connect(signers[5]).finalizeRecovery.staticCall(f.vaultId, 1), 'NoPendingRecovery');
  await at(v.lastCheckIn + 59n);
  await rejects(() => f.contract.connect(signers[1]).requestRecovery.staticCall(f.vaultId), 'OwnerStillActive');
  await at(v.lastCheckIn + 60n);
  await f.contract.connect(signers[1]).requestRecovery.staticCall(f.vaultId);
  await rejects(() => f.contract.connect(signers[5]).requestRecovery.staticCall(f.vaultId), 'OwnerStillActive');
  await at(v.lastCheckIn + 149n);
  await rejects(() => f.contract.connect(signers[5]).requestRecovery.staticCall(f.vaultId), 'OwnerStillActive');
  await at(v.lastCheckIn + 150n);
  await (await f.contract.connect(signers[1]).requestRecovery(f.vaultId)).wait();
  assert.equal((await f.contract.getVault(f.vaultId)).requestId, 2n);
  assert.equal((await f.contract.getVault(f.vaultId)).selectedBeneficiary, f.addresses[1]);
  await rejects(() => f.contract.connect(signers[2]).approveRecovery.staticCall(f.vaultId, 1), 'StaleRequest');
  await rejects(() => f.contract.connect(signers[5]).finalizeRecovery.staticCall(f.vaultId, 1), 'StaleRequest');
  await rejects(() => f.contract.connect(signers[5]).finalizeRecovery.staticCall(f.vaultId, 2), 'Unauthorized');
  await rejects(() => f.contract.connect(signers[1]).finalizeRecovery.staticCall(f.vaultId, 2), 'QuorumNotMet');
  await approvals(f, 2);
  await advance(31);
  await (await f.contract.connect(signers[1]).finalizeRecovery(f.vaultId, 2)).wait();
  assert.equal(Number((await f.contract.getVault(f.vaultId)).status), 2);
});
