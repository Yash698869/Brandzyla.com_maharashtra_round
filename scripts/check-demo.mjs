import { readFileSync } from 'node:fs';
import { keccak256 } from 'ethers';
import { validateDeployment } from '../shared/chain-safety.mjs';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const same = (left, right) => left?.toLowerCase() === right?.toLowerCase();
const timeout = () => AbortSignal.timeout(8000);

async function json(url, options) {
  const response = await fetch(url, { ...options, signal: timeout() });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const config = JSON.parse(readFileSync('.runtime/deployment.json', 'utf8'));
  assert(config.mode === 'local' && config.chainId === 31337, 'Start the local Hardhat demo first.');
  const rpcUrl = new URL(config.rpcUrl);
  assert(rpcUrl.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(rpcUrl.hostname) && rpcUrl.port === '8545', 'The demo RPC must be local Hardhat on port 8545.');
  assert(config.actors?.length === 6, 'Expected six demo actors including primary and backup. Restart npm run demo to redeploy.');
  assert(config.abi.some(entry => entry.name === 'registerSuccessionVault'), 'The local demo needs a Succession Graph deployment.');

  let id = 0;
  const rpc = async (method, params = []) => {
    const result = await json(config.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params })
    });
    if (result.error) throw new Error(`${method}: ${result.error.message}`);
    return result.result;
  };

  const deploymentBlock = `0x${config.deploymentBlock.toString(16)}`;
  const [chainId, block, code, tip, unlocked, balances, relayConfig, ui] = await Promise.all([
    rpc('eth_chainId'),
    rpc('eth_getBlockByNumber', [deploymentBlock, false]),
    rpc('eth_getCode', [config.contractAddress, 'latest']),
    rpc('eth_blockNumber'),
    rpc('eth_accounts'),
    Promise.all(config.actors.map(actor => rpc('eth_getBalance', [actor.address, 'latest']))),
    json('http://127.0.0.1:3001/api/config'),
    fetch('http://127.0.0.1:5173/', { signal: timeout() })
  ]);
  assert(ui.ok, 'The demo UI is not responding on port 5173.');
  assert(Number(chainId) === 31337, 'The RPC is not connected to Hardhat chain 31337.');
  assert(code !== '0x' && block, 'The Heirloom contract is missing from the local chain.');
  validateDeployment(config, { chainId: Number(chainId), blockHash: block.hash, codeHash: keccak256(code) });
  assert(relayConfig.mode === 'local' && same(relayConfig.contractAddress, config.contractAddress) && relayConfig.deploymentId === config.deploymentId, 'The encrypted relay is connected to another deployment.');
  assert(config.actors.every((actor, index) => unlocked.some(address => same(address, actor.address)) && BigInt(balances[index]) > 0n), 'One or more demo wallets are locked or have no local ETH.');

  const hashes = config.transactionHash ? [config.transactionHash] : block.transactions;
  const receipts = await Promise.all(hashes.map(hash => rpc('eth_getTransactionReceipt', [hash])));
  const receipt = receipts.find(item => item?.status === '0x1' && same(item.contractAddress, config.contractAddress));
  assert(receipt, 'The contract deployment receipt is missing or failed.');
  const events = await rpc('eth_getLogs', [{ address: config.contractAddress, fromBlock: deploymentBlock, toBlock: 'latest' }]);

  console.log('Heirloom Hardhat demo ready');
  console.log(`Chain: 31337 · block #${Number(tip)}`);
  console.log(`Funded, unlocked demo wallets: ${config.actors.length}/6`);
  console.log(`Contract: ${config.contractAddress}`);
  console.log(`Deployment transaction: ${receipt.transactionHash}`);
  console.log(`Contract events: ${events.length}`);
  console.log('App: http://127.0.0.1:5173/');
}

main().catch(error => {
  console.error(`Hardhat demo is not ready: ${error.message}`);
  process.exitCode = 1;
});
