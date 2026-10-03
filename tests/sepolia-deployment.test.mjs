import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSepoliaDeployment } from '../shared/sepolia-deployment.mjs';

const hash = `0x${'a'.repeat(64)}`, runtime = `0x${'b'.repeat(64)}`;
const config = { chainId: 11155111, contractAddress: `0x${'1'.repeat(40)}`, rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com', deploymentBlock: 50, deploymentId: hash, codeHash: runtime, transactionHash: `0x${'c'.repeat(64)}` };
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
