import { validateSepoliaDeployment } from './sepolia-deployment.mjs';

export function redactRpcUrl(message, rpcUrl) {
  return rpcUrl ? String(message).replaceAll(rpcUrl, '[private RPC endpoint]') : String(message);
}

export function uiServesDeployment(config, uiConfig) {
  const same = (left, right) => typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase();
  return uiConfig?.mode === 'public' && uiConfig.chainId === 11155111 && uiConfig.confirmations === 3 && same(uiConfig.contractAddress, config.contractAddress) && same(uiConfig.deploymentId, config.deploymentId) && same(uiConfig.codeHash, config.codeHash);
}

export function assessSepoliaReadiness(config, expectedCodeHash, observed, relayConfig, uiOk) {
  validateSepoliaDeployment(config, expectedCodeHash, observed);
  if (config.mode !== 'public' || config.confirmations !== 3 || !uiServesDeployment(config, relayConfig)) throw new Error('Public relay is connected to another deployment or confirmation policy');
  if (!uiOk) throw new Error('The Sepolia app is unavailable or serves another deployment on port 5174');
  return { contractUrl: `https://sepolia.etherscan.io/address/${config.contractAddress}`, transactionUrl: `https://sepolia.etherscan.io/tx/${config.transactionHash}` };
}
