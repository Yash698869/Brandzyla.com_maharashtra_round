import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSepoliaDeployment } from '../shared/sepolia-deployment.mjs';
import { assessSepoliaReadiness, redactRpcUrl, uiServesDeployment } from '../shared/sepolia-readiness.mjs';

const hash = `0x${'a'.repeat(64)}`, runtime = `0x${'b'.repeat(64)}`;
const config = { chainId: 11155111, contractAddress: `0x${'1'.repeat(40)}`, rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com', deploymentBlock: 50, deploymentId: hash, codeHash: runtime, transactionHash: `0x${'c'.repeat(64)}`, mode: 'public', confirmations: 3 };
const observed = { chainId: 11155111, blockHash: hash, codeHash: runtime, receiptStatus: 1, receiptBlock: 50, receiptBlockHash: hash, receiptContract: config.contractAddress };

test('accepts only a confirmed Sepolia deployment of the compiled Heirloom runtime', () => {
  assert.equal(validateSepoliaDeployment(config, runtime, observed), true);
  for (const change of [v => v.chainId = 1, v => v.blockHash = runtime, v => v.codeHash = hash, v => v.receiptStatus = 0, v => v.receiptBlock = 49, v => v.receiptContract = `0x${'2'.repeat(40)}`, v => v.receiptBlockHash = runtime]) {
    const changed = { ...observed }; change(changed);
    assert.throws(() => validateSepoliaDeployment(config, runtime, changed));
  }
});

test('rejects unsafe RPC configuration, wrong network and modified deployment fingerprints', () => {
  for (const change of [c => c.rpcUrl = 'http://127.0.0.1:8545', c => c.rpcUrl = 'file:///secrets', c => c.chainId = 31337, c => c.deploymentBlock = -1, c => c.codeHash = hash, c => c.transactionHash = 'missing']) {
    const changed = { ...config }; change(changed);
    assert.throws(() => validateSepoliaDeployment(changed, runtime, observed));
  }
});

test('public readiness requires the canonical deployment, matching relay and UI', () => {
  const relay = { mode: 'public', chainId: 11155111, contractAddress: config.contractAddress, deploymentId: config.deploymentId, codeHash: config.codeHash, confirmations: 3 };
  assert.deepEqual(assessSepoliaReadiness(config, runtime, observed, relay, true), {
    contractUrl: `https://sepolia.etherscan.io/address/${config.contractAddress}`,
    transactionUrl: `https://sepolia.etherscan.io/tx/${config.transactionHash}`,
  });
  for (const change of [o => o.chainId = 31337, o => o.codeHash = hash, o => o.blockHash = runtime, o => o.receiptStatus = 0, o => o.receiptBlockHash = runtime]) {
    const altered = { ...observed }; change(altered);
    assert.throws(() => assessSepoliaReadiness(config, runtime, altered, relay, true));
  }
  assert.throws(() => assessSepoliaReadiness(config, runtime, observed, { ...relay, contractAddress: `0x${'2'.repeat(40)}` }, true));
  assert.throws(() => assessSepoliaReadiness(config, runtime, observed, relay, false));
});

test('readiness errors stay readable before an RPC URL is loaded', () => {
  assert.equal(redactRpcUrl('Fund a Sepolia wallet first', ''), 'Fund a Sepolia wallet first');
  assert.equal(redactRpcUrl('Request to https://example.com/private-key failed', 'https://example.com/private-key'), 'Request to [private RPC endpoint] failed');
});

test('a healthy UI root cannot hide an API proxy bound to another deployment', () => {
  const publicApi = { mode: 'public', chainId: 11155111, contractAddress: config.contractAddress, deploymentId: config.deploymentId, codeHash: config.codeHash, confirmations: 3 };
  assert.equal(uiServesDeployment(config, publicApi), true);
  assert.equal(uiServesDeployment(config, { ...publicApi, contractAddress: `0x${'2'.repeat(40)}` }), false);
  assert.equal(uiServesDeployment(config, { ...publicApi, mode: 'local' }), false);
  assert.equal(uiServesDeployment(config, { ...publicApi, confirmations: 0 }), false);
});
