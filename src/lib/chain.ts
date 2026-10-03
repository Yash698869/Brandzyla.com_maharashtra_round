import { BrowserProvider, Contract, JsonRpcProvider, Wallet, keccak256, type Signer, type Eip1193Provider, type EventLog } from 'ethers';
import { validateDeployment, validateFinality } from '../../shared/chain-safety.mjs';
import { getStoredPrivateKey } from './auth';
import type { Config, VaultState, TimelineEvent } from './types';

declare global { interface Window { ethereum?: Eip1193Provider & { on?: (event: string, fn: (...args: any[]) => void) => void } } }
let readProvider: JsonRpcProvider | BrowserProvider;
let walletProvider: BrowserProvider | undefined;
export function initializeChain(config: Config) {
  if (config.mode === 'local') readProvider = new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true, cacheTimeout: -1 });
  else { if (!window.ethereum) throw new Error('Install an Ethereum wallet to use the Sepolia deployment'); walletProvider = new BrowserProvider(window.ethereum); readProvider = walletProvider; }
  readProvider.pollingInterval = 400;
}
export async function signerFor(config: Config, address?: string): Promise<Signer> {
  const privateKey = getStoredPrivateKey(address);
  if (privateKey && readProvider) return new Wallet(privateKey, readProvider);
  if (config.mode === 'local') return (readProvider as JsonRpcProvider).getSigner(address);
  if (!walletProvider) throw new Error('Connect your Ethereum wallet');
  const network = await walletProvider.getNetwork(); if (Number(network.chainId) !== config.chainId) throw new Error('Switch your wallet to Ethereum Sepolia');
  const signer = await walletProvider.getSigner(); if (address && (await signer.getAddress()).toLowerCase() !== address.toLowerCase()) throw new Error('Connected account changed. Reconnect the wallet before continuing');
  return signer;
}
export async function connectWallet(config: Config) {
  if (!window.ethereum) throw new Error('No Ethereum wallet found');
  await window.ethereum.request({ method: 'eth_requestAccounts' });
  await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${config.chainId.toString(16)}` }] });
  walletProvider = new BrowserProvider(window.ethereum); readProvider = walletProvider;
  return (await walletProvider.getSigner()).getAddress();
}
export function readContract(config: Config) { return new Contract(config.contractAddress, config.abi, readProvider); }
export async function writableContract(config: Config, address: string) { return new Contract(config.contractAddress, config.abi, await signerFor(config, address)); }
export async function getVault(config: Config, id: string): Promise<VaultState> {
  const contract = readContract(config), v = await contract.getVault(id);
  const guardians = [...v.guardians] as string[];
  const approved = Number(v.status) === 0 ? [] : (await Promise.all(guardians.map(async g => await contract.hasApproved(id, v.requestId, g) ? g : ''))).filter(Boolean);
  return { id, owner: v.owner, beneficiary: v.beneficiary, guardians, inactivity: Number(v.inactivity), challenge: Number(v.challenge), lastCheckIn: Number(v.lastCheckIn), quorumAt: Number(v.quorumAt), finalizedAt: Number(v.finalizedAt), requestId: Number(v.requestId), approvalCount: Number(v.approvalCount), status: Number(v.status), commitment: v.commitment, beneficiaryKeyHash: v.beneficiaryKeyHash, approved };
}
export async function chainTime() { const block = await readProvider.getBlock('latest'); if (!block) throw new Error('Chain unavailable'); return { timestamp: block.timestamp, blockNumber: block.number }; }
export async function history(config: Config): Promise<TimelineEvent[]> {
  const contract = readContract(config);
  const logs = await contract.queryFilter('*', config.deploymentBlock);
  const times = new Map<number, number>();
  const result: TimelineEvent[] = [];
  for (const raw of logs) {
    const log = raw as EventLog; if (!log.fragment) continue;
    let time = times.get(log.blockNumber); if (!time) { time = (await readProvider.getBlock(log.blockNumber))?.timestamp ?? 0; times.set(log.blockNumber, time); }
    result.push({ name: log.fragment.name, vaultId: log.args.vaultId, requestId: log.args.requestId ? Number(log.args.requestId) : undefined, actor: log.args.guardian ?? log.args.owner ?? log.args.beneficiary, hash: log.transactionHash, blockNumber: log.blockNumber, timestamp: time, count: log.args.count ? Number(log.args.count) : undefined });
  }
  return result.reverse();
}
export async function transactionDetails(hash: string) { const tx = await readProvider.getTransaction(hash); const receipt = await readProvider.getTransactionReceipt(hash); return { hash, from: tx?.from, to: tx?.to, block: receipt?.blockNumber, status: receipt?.status === 1 ? 'Confirmed' : 'Pending / reverted', gasUsed: receipt?.gasUsed.toString() }; }
export async function verifyDeployment(config: Config) {
  const [chainId, block, code] = await Promise.all([readProvider.send('eth_chainId', []), readProvider.getBlock(config.deploymentBlock), readProvider.getCode(config.contractAddress)]);
  validateDeployment(config, { chainId: Number(chainId), blockHash: block?.hash, codeHash: keccak256(code) });
}
export async function verifyReleaseFinality(config: Config, vaultId: string, requestId: number) {
  await verifyDeployment(config);
  const contract = readContract(config), v = await getVault(config, vaultId);
  if (v.status !== 2 || v.requestId !== requestId) throw new Error('Recovery is not finalized for this request');
  const logs = await contract.queryFilter(contract.filters.RecoveryFinalized(vaultId, requestId), config.deploymentBlock);
  const event = logs.at(-1); if (!event) throw new Error('No canonical finalization event was found');
  const [receipt, canonicalBlock, tip, chainId] = await Promise.all([readProvider.getTransactionReceipt(event.transactionHash), readProvider.getBlock(event.blockNumber), readProvider.getBlockNumber(), readProvider.send('eth_chainId', [])]);
  validateFinality({ chainId: Number(chainId), expectedChainId: config.chainId, tip, eventBlock: event.blockNumber, eventBlockHash: event.blockHash, receiptBlockHash: receipt?.blockHash, canonicalBlockHash: canonicalBlock?.hash, receiptStatus: receipt?.status, confirmations: config.confirmations });
}
export function friendlyError(error: any) {
  const messages: Record<string, string> = {
    OwnerStillActive: 'The owner is still within their check-in period. Recovery is blocked.',
    Unauthorized: 'This account is not authorized for that action.',
    ChallengeActive: 'The owner’s cancellation window is still open. Recovery must wait.',
    QuorumNotMet: 'Two independent guardian approvals are required.',
    AlreadyApproved: 'This guardian has already approved the current request.',
    StaleRequest: 'This request was superseded. Refresh and use the current request.',
    NoPendingRecovery: 'There is no active recovery request. It may have been cancelled.',
    AlreadyFinalized: 'This vault has already been released. Finalization is irreversible.',
    RecoveryAlreadyPending: 'A recovery request is already open for this vault.',
  };
  const text = `${error?.reason ?? ''} ${error?.shortMessage ?? ''} ${error?.message ?? error}`;
  for (const key of Object.keys(messages)) if (text.includes(key)) return messages[key];
  if (error?.code === 'ACTION_REJECTED' || text.includes('user rejected')) return 'The wallet action was cancelled. You can try again.';
  if (error?.code === 'TIMEOUT') return 'The transaction was submitted but is not confirmed yet. Its encrypted package is preserved. Refresh transaction status before trying again.';
  return error?.reason ?? error?.shortMessage ?? error?.message ?? 'Something went wrong. Try refreshing the connection.';
}
