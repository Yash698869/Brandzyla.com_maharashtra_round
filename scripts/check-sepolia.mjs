import { existsSync, readFileSync } from 'node:fs';
import { FetchRequest, JsonRpcProvider, keccak256 } from 'ethers';
import { assessSepoliaReadiness, redactRpcUrl, uiServesDeployment } from '../shared/sepolia-readiness.mjs';
import { validateSepoliaDeployment } from '../shared/sepolia-deployment.mjs';

let rpcUrl = '';
async function main() {
  if (!existsSync('.runtime/sepolia-deployment.json')) throw new Error('Fund a Sepolia wallet, deploy with /deploy.html, and run npm run sepolia:import first');
  if (!existsSync('artifacts/Heirloom.json')) throw new Error('Run npm run compile before checking the public deployment');
  const config = JSON.parse(readFileSync('.runtime/sepolia-deployment.json', 'utf8'));
  const artifact = JSON.parse(readFileSync('artifacts/Heirloom.json', 'utf8'));
  rpcUrl = config.rpcUrl;
  const expectedCodeHash = keccak256(artifact.deployedBytecode);
  // Reject an unsafe or stale config before contacting any RPC endpoint.
  validateSepoliaDeployment(config, expectedCodeHash, { chainId: config.chainId, blockHash: config.deploymentId, codeHash: config.codeHash, receiptStatus: 1, receiptBlock: config.deploymentBlock, receiptBlockHash: config.deploymentId, receiptContract: config.contractAddress });
  const request = new FetchRequest(config.rpcUrl);
  request.timeout = 8000;
  const provider = new JsonRpcProvider(request, undefined, { cacheTimeout: -1 });
  try {
    const [network, block, code, receipt, relayResponse, uiResponse, uiApiResponse] = await Promise.all([
      provider.getNetwork(), provider.getBlock(config.deploymentBlock), provider.getCode(config.contractAddress), provider.getTransactionReceipt(config.transactionHash),
      fetch('http://127.0.0.1:3002/api/config', { signal: AbortSignal.timeout(8000) }),
      fetch('http://127.0.0.1:5174/', { signal: AbortSignal.timeout(8000) }),
      fetch('http://127.0.0.1:5174/api/config', { signal: AbortSignal.timeout(8000) }),
    ]);
    if (!relayResponse.ok) throw new Error(`Public relay returned HTTP ${relayResponse.status}`);
    if (!uiApiResponse.ok) throw new Error(`Public app API returned HTTP ${uiApiResponse.status}`);
    const relayConfig = await relayResponse.json();
    const uiConfig = await uiApiResponse.json();
    const observed = { chainId: Number(network.chainId), blockHash: block?.hash, codeHash: keccak256(code), receiptStatus: receipt?.status, receiptBlock: receipt?.blockNumber, receiptBlockHash: receipt?.blockHash, receiptContract: receipt?.contractAddress };
    const links = assessSepoliaReadiness(config, expectedCodeHash, observed, relayConfig, uiResponse.ok && uiServesDeployment(config, uiConfig));
    console.log('Heirloom Sepolia deployment ready');
    console.log(`Contract: ${links.contractUrl}`);
    console.log(`Deployment transaction: ${links.transactionUrl}`);
    console.log('Public app: http://127.0.0.1:5174/');
    console.log('Confirmation policy: 3 blocks before share release');
  } finally { provider.destroy(); }
}

main().catch(error => {
  const message = redactRpcUrl(error?.message ?? error, rpcUrl);
  console.error(`Sepolia is not ready: ${message}`);
  process.exitCode = 1;
});
