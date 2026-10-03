import { isAddress } from 'ethers';
import { validateDeployment } from './chain-safety.mjs';

export function validateSepoliaDeployment(config, expectedCodeHash, observed) {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
  const url = new URL(config.rpcUrl);
  check(url.protocol === 'https:' && !url.username && !url.password, 'Use an HTTPS Sepolia RPC endpoint');
  check(config.chainId === 11155111 && isAddress(config.contractAddress), 'Only Ethereum Sepolia is supported');
  check(Number.isSafeInteger(config.deploymentBlock) && config.deploymentBlock >= 0 && hash(config.deploymentId) && hash(config.transactionHash), 'Invalid deployment receipt');
  check(config.codeHash === expectedCodeHash, 'Deployment does not match the compiled Heirloom contract');
  validateDeployment(config, observed);
  check(observed.receiptStatus === 1 && observed.receiptBlock === config.deploymentBlock && observed.receiptBlockHash === config.deploymentId && observed.receiptContract?.toLowerCase() === config.contractAddress.toLowerCase(), 'Deployment transaction is not confirmed for this contract');
  return true;
}
