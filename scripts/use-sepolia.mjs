import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { JsonRpcProvider, keccak256 } from 'ethers';
import { compileContract } from './compile.mjs';
import { validateSepoliaDeployment } from '../shared/sepolia-deployment.mjs';

const path = process.argv[2] ?? join(homedir(), 'Downloads', 'heirloom-sepolia.json');
const config = JSON.parse(readFileSync(path, 'utf8'));
const artifact = compileContract();
// Check shape and RPC transport before making any network request.
validateSepoliaDeployment(config, keccak256(artifact.deployedBytecode), { chainId: config.chainId, blockHash: config.deploymentId, codeHash: config.codeHash, receiptStatus: 1, receiptBlock: config.deploymentBlock, receiptBlockHash: config.deploymentId, receiptContract: config.contractAddress });
const provider = new JsonRpcProvider(config.rpcUrl, undefined, { cacheTimeout: -1 });
try {
  const [network, block, code, receipt] = await Promise.all([provider.getNetwork(), provider.getBlock(config.deploymentBlock), provider.getCode(config.contractAddress), provider.getTransactionReceipt(config.transactionHash)]);
  validateSepoliaDeployment(config, keccak256(artifact.deployedBytecode), { chainId: Number(network.chainId), blockHash: block?.hash, codeHash: keccak256(code), receiptStatus: receipt?.status, receiptBlock: receipt?.blockNumber, receiptBlockHash: receipt?.blockHash, receiptContract: receipt?.contractAddress });
  const clean = { chainId: 11155111, contractAddress: config.contractAddress, rpcUrl: config.rpcUrl, abi: artifact.abi, deploymentBlock: config.deploymentBlock, deploymentId: config.deploymentId, codeHash: config.codeHash, transactionHash: config.transactionHash, mode: 'public', confirmations: 3, explorerUrl: 'https://sepolia.etherscan.io', actors: [] };
  mkdirSync('.runtime', { recursive: true }); writeFileSync('.runtime/sepolia-deployment.json', JSON.stringify(clean, null, 2));
  console.log(`Verified Heirloom: https://sepolia.etherscan.io/address/${clean.contractAddress}`);
  console.log('Start the public app in another terminal: npm run dev:sepolia');
  console.log('The local rehearsal can stay running at port 5173. Sepolia opens at http://127.0.0.1:5174');
} finally { provider.destroy(); }
