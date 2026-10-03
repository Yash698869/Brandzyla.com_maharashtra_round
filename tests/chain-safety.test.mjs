import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDeployment, validateFinality } from '../shared/chain-safety.mjs';
import { identityMessage } from '../shared/protocol.mjs';

const saved = { chainId: 31337, deploymentId: '0xoriginal', codeHash: '0xcode' };
test('deployment verification rejects reused address with another block, bytecode or chain', () => {
  assert.equal(validateDeployment(saved, { chainId: 31337, blockHash: '0xoriginal', codeHash: '0xcode' }), true);
  for (const field of ['chainId', 'blockHash', 'codeHash']) assert.throws(() => validateDeployment(saved, { chainId: 31337, blockHash: '0xoriginal', codeHash: '0xcode', [field]: field === 'chainId' ? 1 : '0xother' }));
});
const confirmed = { chainId: 11155111, expectedChainId: 11155111, tip: 102, eventBlock: 100, eventBlockHash: '0xcanonical', receiptBlockHash: '0xcanonical', canonicalBlockHash: '0xcanonical', receiptStatus: 1, confirmations: 3 };
test('client finality check blocks premature and reorganized releases before encryption', () => {
  assert.equal(validateFinality(confirmed), true);
  for (const invalid of [{ tip: 101 }, { canonicalBlockHash: '0xreorg' }, { receiptBlockHash: '0xother' }, { receiptStatus: 0 }, { chainId: 1 }, { eventBlock: undefined }]) assert.throws(() => validateFinality({ ...confirmed, ...invalid }));
});
test('identity enrollment signatures cannot cross a restarted chain at the same address', () => {
  const c = { chainId: 31337, contractAddress: '0x1111111111111111111111111111111111111111', deploymentId: '0xold' };
  const address = '0x2222222222222222222222222222222222222222', key = { kty: 'RSA', n: 'public', e: 'AQAB' };
  assert.notEqual(identityMessage(c, address, key), identityMessage({ ...c, deploymentId: '0xnew' }, address, key));
});
