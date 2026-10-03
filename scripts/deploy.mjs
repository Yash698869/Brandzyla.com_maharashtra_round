import { ContractFactory, JsonRpcProvider, Wallet, keccak256 } from 'ethers';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { compileContract } from './compile.mjs';

export async function deploy(rpcUrl = 'http://127.0.0.1:8545', privateKey) {
  const artifact = compileContract(); const provider = new JsonRpcProvider(rpcUrl, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 300;
  const chainId = Number((await provider.getNetwork()).chainId);
  if (chainId !== 31337 && chainId !== 11155111) throw new Error('Deployment supports local chain 31337 or Ethereum Sepolia only');
  if (chainId !== 31337 && !privateKey) throw new Error('Sepolia deployment needs DEPLOYER_PRIVATE_KEY in your private environment');
  const signer = privateKey ? new Wallet(privateKey, provider) : await provider.getSigner(0);
  const contract = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(); await contract.waitForDeployment();
  const receipt = await contract.deploymentTransaction().wait();
  const accounts = chainId === 31337 ? (await provider.listAccounts()).slice(0, 5) : [];
  const names = ['Alex Morgan', 'Sam Morgan', 'Maya Chen', 'James Wilson', 'Priya Shah'];
  const roles = ['owner', 'beneficiary', 'guardian', 'guardian', 'guardian'];
  const config = { chainId, contractAddress: await contract.getAddress(), rpcUrl, abi: artifact.abi, deploymentBlock: receipt.blockNumber, deploymentId: receipt.blockHash, mode: chainId === 31337 ? 'local' : 'public', confirmations: chainId === 31337 ? 1 : 3, explorerUrl: chainId === 11155111 ? 'https://sepolia.etherscan.io' : undefined, actors: await Promise.all(accounts.map(async (s, i) => ({ address: await s.getAddress(), name: names[i], role: roles[i], initials: names[i].split(' ').map(s => s[0]).join('') }))) };
  config.codeHash = keccak256(await provider.getCode(config.contractAddress));
  config.transactionHash = receipt.hash;
  mkdirSync('.runtime', { recursive: true }); writeFileSync(chainId === 31337 ? '.runtime/deployment.json' : '.runtime/sepolia-deployment.json', JSON.stringify(config, null, 2));
  console.log(`Heirloom deployed on ${chainId === 31337 ? 'local Ethereum' : 'Sepolia'}: ${config.contractAddress}`);
  provider.destroy(); return config;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await deploy(process.env.RPC_URL, process.env.DEPLOYER_PRIVATE_KEY);
}
