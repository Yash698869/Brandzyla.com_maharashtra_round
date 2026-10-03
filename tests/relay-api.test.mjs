import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ContractFactory, JsonRpcProvider, id, keccak256 } from 'ethers';
import solc from 'solc';
import { digest, identityMessage, keyHash, releaseMessage } from '../shared/protocol.mjs';

const project = resolve(import.meta.dirname, '..');
const runtime = mkdtempSync(join(tmpdir(), 'heirloom-relay-api-'));
const input = { language: 'Solidity', sources: { 'Heirloom.sol': { content: readFileSync(join(project, 'contracts/Heirloom.sol'), 'utf8') } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } };
const compiled = JSON.parse(solc.compile(JSON.stringify(input)));
assert.deepEqual((compiled.errors ?? []).filter(error => error.severity === 'error'), []);
const contract = compiled.contracts['Heirloom.sol'].Heirloom;
const artifact = { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` };
const publicKey = { kty: 'RSA', n: 'A'.repeat(342), e: 'AQAB', alg: 'RSA-OAEP-256', ext: true, key_ops: ['encrypt'] };
const envelope = { iv: Buffer.alloc(12).toString('base64'), wrappedKey: Buffer.alloc(256).toString('base64'), ciphertext: Buffer.alloc(80).toString('base64') };
let chain, relay, provider;

after(async () => {
  await stop(relay); await stop(chain); provider?.destroy();
  rmSync(runtime, { recursive: true, force: true });
});

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function eventually(check, diagnostics) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if (await check()) return; } catch { /* Wait for the process to bind. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Test service did not start: ${diagnostics()}`);
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill(); await exited;
}
function packageFor(binding, guardians, ciphertext = Buffer.alloc(90).toString('base64')) {
  return { version: 1, binding, beneficiaryPublicKey: publicKey, iv: Buffer.alloc(12).toString('base64'), ciphertext,
    guardianShares: guardians.map(guardian => ({ guardian, envelope })) };
}
function shareRelease(binding, guardian, requestId, ciphertext = envelope.ciphertext) {
  return { version: 1, binding, guardian, requestId, envelope: { ...envelope, ciphertext } };
}

test('relay validates chain authorization and keeps acknowledged ciphertext through restart', { timeout: 90000 }, async t => {
  const chainPort = await freePort(), relayPort = await freePort();
  let chainOutput = '', relayOutput = '';
  chain = spawn(process.execPath, [join(project, 'node_modules/hardhat/dist/src/cli.js'), 'node', '--hostname', '127.0.0.1', '--port', String(chainPort)], { cwd: project, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [chain.stdout, chain.stderr]) stream.on('data', chunk => { chainOutput += chunk; });
  const rpcUrl = `http://127.0.0.1:${chainPort}`;
  await eventually(async () => {
    const response = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) });
    return response.ok;
  }, () => chainOutput);
  provider = new JsonRpcProvider(rpcUrl, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 50;
  const signers = await Promise.all(Array.from({ length: 5 }, (_, i) => provider.getSigner(i)));
  const addresses = await Promise.all(signers.map(signer => signer.getAddress()));
  const guardians = addresses.slice(2);
  const vaultId = id('relay-api-vault');
  const binding = { chainId: 31337, beneficiary: addresses[1], beneficiaryKeyHash: keyHash(publicKey), vaultId };
  const deployment = await new ContractFactory(artifact.abi, artifact.bytecode, signers[0]).deploy();
  await deployment.waitForDeployment();
  const receipt = await deployment.deploymentTransaction().wait();
  binding.contract = await deployment.getAddress();
  const config = { chainId: 31337, contractAddress: binding.contract, rpcUrl: `http://127.0.0.1:${chainPort}`, abi: artifact.abi,
    deploymentBlock: receipt.blockNumber, deploymentId: receipt.blockHash, codeHash: keccak256(await provider.getCode(binding.contract)),
    mode: 'local', confirmations: 1 };
  mkdirSync(join(runtime, '.runtime'));
  writeFileSync(join(runtime, '.runtime/deployment.json'), JSON.stringify(config));
  const relayFile = join(runtime, `.runtime/relay-${config.deploymentId.slice(2, 18)}.json`);
  const base = `http://127.0.0.1:${relayPort}`;
  const startRelay = async () => {
    relayOutput = '';
    relay = spawn(process.execPath, [join(project, 'server/index.mjs')], { cwd: runtime, env: { ...process.env, HEIRLOOM_RELAY_PORT: String(relayPort) }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [relay.stdout, relay.stderr]) stream.on('data', chunk => { relayOutput += chunk; });
    await eventually(async () => (await fetch(`${base}/api/health`)).ok, () => relayOutput);
  };
  const get = async path => {
    const response = await fetch(`${base}/api/${path}`);
    return { status: response.status, body: await response.json() };
  };
  const post = async (path, body) => {
    const response = await fetch(`${base}/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  await startRelay();

  await t.test('rejects an identity signed by another wallet', async () => {
    const identity = { address: addresses[2], publicKey, signature: await signers[3].signMessage(identityMessage(config, addresses[2], publicKey)) };
    const response = await post('identities', identity);
    assert.equal(response.status, 400);
    assert.match(response.body.error, /signature/i);
    assert.deepEqual((await get('identities')).body, []);
    identity.signature = await signers[2].signMessage(identityMessage(config, addresses[2], publicKey));
    assert.equal((await post('identities', identity)).status, 200);
  });

  const p = packageFor(binding, guardians);
  await (await deployment.registerVault(vaultId, addresses[1], guardians, 60, 30, digest(p), binding.beneficiaryKeyHash)).wait();
  await t.test('rejects a package whose bytes differ from its on-chain commitment', async () => {
    const altered = structuredClone(p); altered.ciphertext = Buffer.alloc(90, 1).toString('base64');
    const response = await post('packages', { package: altered });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /commitment/i);
    assert.deepEqual((await get('packages')).body, []);
    assert.equal((await post('packages', { package: p })).status, 200);
  });

  await t.test('downloads the committed encrypted package as a recovery-kit file', async () => {
    const response = await fetch(`${base}/api/kits/${vaultId}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition') ?? '', /attachment;.*heirloom-kit-/i);
    assert.deepEqual(await response.json(), { format: 'heirloom-recovery-kit', version: 1, package: p });
  });

  const release = shareRelease(binding, addresses[2], 1);
  const signedRelease = async (value = release, signer = signers[2]) => ({ release: value, signature: await signer.signMessage(releaseMessage(value)) });
  const advance = async seconds => { await provider.send('evm_increaseTime', [seconds]); await provider.send('evm_mine', []); };
  await advance(61);
  await (await deployment.connect(signers[1]).requestRecovery(vaultId)).wait();
  await (await deployment.connect(signers[2]).approveRecovery(vaultId, 1)).wait();
  await (await deployment.connect(signers[3]).approveRecovery(vaultId, 1)).wait();
  await t.test('rejects a share before chain finalization', async () => {
    const response = await post('releases', await signedRelease());
    assert.equal(response.status, 400);
    assert.match(response.body.error, /finalized/i);
    assert.deepEqual((await get(`releases/${vaultId}`)).body, []);
  });
  await (await deployment.checkIn(vaultId)).wait();
  await advance(61);
  await (await deployment.connect(signers[1]).requestRecovery(vaultId)).wait();
  await (await deployment.connect(signers[2]).approveRecovery(vaultId, 2)).wait();
  await (await deployment.connect(signers[3]).approveRecovery(vaultId, 2)).wait();
  await t.test('rejects a superseded request', async () => {
    const response = await post('releases', await signedRelease());
    assert.equal(response.status, 400);
    assert.match(response.body.error, /stale/i);
  });

  await advance(31);
  await (await deployment.connect(signers[1]).finalizeRecovery(vaultId, 2)).wait();
  const currentRelease = shareRelease(binding, addresses[2], 2);
  let storedRelease;
  await t.test('rejects forged and conflicting duplicate guardian releases', async () => {
    const forged = await signedRelease(currentRelease, signers[3]);
    const invalid = await post('releases', forged);
    assert.equal(invalid.status, 400);
    assert.match(invalid.body.error, /signature/i);
    const first = await signedRelease(currentRelease);
    storedRelease = first;
    assert.equal((await post('releases', first)).status, 200);
    const conflicting = shareRelease(binding, addresses[2], 2, Buffer.alloc(80, 1).toString('base64'));
    const duplicate = await post('releases', await signedRelease(conflicting));
    assert.equal(duplicate.status, 400);
    assert.match(duplicate.body.error, /already released/i);
    assert.equal((await post('releases', first)).status, 200);
    assert.deepEqual((await get(`releases/${vaultId}`)).body, [first]);
  });

  await t.test('persists encrypted packages, identities and released shares across relay restart', async () => {
    assert.equal(existsSync(relayFile), true);
    await stop(relay); await startRelay();
    assert.deepEqual((await get('packages')).body, [p]);
    assert.equal((await get('identities')).body.length, 1);
    assert.deepEqual((await get(`releases/${vaultId}`)).body, [storedRelease]);
  });

  await t.test('does not expose a share if its disk write fails', async () => {
    const temporaryFile = `${relayFile}.tmp`;
    mkdirSync(temporaryFile);
    try {
      const second = shareRelease(binding, addresses[3], 2);
      const response = await post('releases', await signedRelease(second, signers[3]));
      assert.equal(response.status, 400);
      assert.equal((await get(`releases/${vaultId}`)).body.length, 1);
    } finally { rmSync(temporaryFile, { recursive: true }); }
  });

  await t.test('does not expose an identity or package if its disk write fails', async () => {
    const otherVaultId = id('relay-api-second-vault');
    const otherBinding = { ...binding, vaultId: otherVaultId };
    const otherPackage = packageFor(otherBinding, guardians);
    await (await deployment.registerVault(otherVaultId, addresses[1], guardians, 60, 30, digest(otherPackage), binding.beneficiaryKeyHash)).wait();
    const otherIdentity = { address: addresses[3], publicKey,
      signature: await signers[3].signMessage(identityMessage(config, addresses[3], publicKey)) };
    const temporaryFile = `${relayFile}.tmp`;
    mkdirSync(temporaryFile);
    try {
      assert.equal((await post('identities', otherIdentity)).status, 400);
      assert.equal((await get('identities')).body.length, 1);
      assert.equal((await post('packages', { package: otherPackage })).status, 400);
      assert.deepEqual((await get('packages')).body, [p]);
    } finally { rmSync(temporaryFile, { recursive: true }); }
  });
});
