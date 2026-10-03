import express from 'express';
import { Contract, JsonRpcProvider, verifyMessage, keccak256 } from 'ethers';
import { validateDeployment } from '../shared/chain-safety.mjs';
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { digest, identityMessage, releaseMessage } from '../shared/protocol.mjs';
import { validatePackageShape, validateIdentity, validateReleaseContext, validateRecoveryKit, validateRegistration } from './validation.mjs';

const config = JSON.parse(readFileSync(process.env.HEIRLOOM_DEPLOYMENT_FILE ?? '.runtime/deployment.json', 'utf8'));
const provider = new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true, cacheTimeout: -1 });
const contract = new Contract(config.contractAddress, config.abi, provider);
async function verifyDeployment() {
  const [chainId, block, code] = await Promise.all([provider.send('eth_chainId', []), provider.getBlock(config.deploymentBlock), provider.getCode(config.contractAddress)]);
  validateDeployment(config, { chainId: Number(chainId), blockHash: block?.hash, codeHash: keccak256(code) });
}
await verifyDeployment();
const file = `.runtime/relay-${config.deploymentId.slice(2, 18)}.json`;
const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { identities: {}, packages: {}, releases: {} };
function save() { mkdirSync('.runtime', { recursive: true }); writeFileSync(`${file}.tmp`, JSON.stringify(data)); renameSync(`${file}.tmp`, file); }
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const route = fn => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
function deployment(p) { if (p.binding.chainId !== config.chainId || !same(p.binding.contract, config.contractAddress)) throw new Error('Wrong chain or contract'); }
function validSignature(message, signature, address) { if (!same(verifyMessage(message, signature), address)) throw new Error('Invalid wallet signature'); }
async function vaultState(id) {
  const v = await contract.getVault(id);
  const guardians = [...v.guardians];
  const approved = [];
  for (const g of guardians) if (await contract.hasApproved(id, v.requestId, g)) approved.push(g);
  return { beneficiary: v.beneficiary, beneficiaryKeyHash: v.beneficiaryKeyHash, commitment: v.commitment, guardians, approved, requestId: Number(v.requestId), status: Number(v.status), finalizedAt: Number(v.finalizedAt) };
}
const app = express(); app.disable('x-powered-by'); app.use(express.json({ limit: '15mb' }));
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && !['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:5174', 'http://localhost:5174', 'http://127.0.0.1:4173', 'http://localhost:4173', 'http://127.0.0.1:3001', 'http://127.0.0.1:3002'].includes(origin)) return res.status(403).json({ error: 'Untrusted request origin' });
  res.set('Cache-Control', 'no-store'); next();
});
app.get('/api/config', route(async (_req, res) => {
  await verifyDeployment();
  const block = await provider.getBlock('latest'); res.json({ ...config, rpcUrl: config.mode === 'local' ? config.rpcUrl : undefined, blockTimestamp: block.timestamp, blockNumber: block.number });
}));
app.get('/api/identities', (_req, res) => res.json(Object.values(data.identities)));
app.post('/api/identities', route(async (req, res) => {
  const identity = req.body; const address = identity.address?.toLowerCase();
  validateIdentity(identity, data.identities[address]);
  validSignature(identityMessage(config, identity.address, identity.publicKey), identity.signature, identity.address);
  data.identities[address] = identity; save(); res.json({ ok: true });
}));
app.get('/api/packages', (_req, res) => res.json(Object.values(data.packages)));
app.post('/api/packages', route(async (req, res) => {
  const p = req.body.package; validatePackageShape(p); deployment(p);
  if (req.body.format) validateRecoveryKit(req.body, config);
  const v = await vaultState(p.binding.vaultId); validateRegistration(p, v);
  const previous = data.packages[p.binding.vaultId];
  if (previous && digest(previous) !== digest(p)) throw new Error('Vault packages are immutable');
  data.packages[p.binding.vaultId] = p; save(); res.json({ ok: true });
}));
app.get('/api/releases/:vaultId', route(async (req, res) => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(req.params.vaultId)) throw new Error('Invalid vault identifier');
  res.json(data.releases[req.params.vaultId] ?? []);
}));
app.post('/api/releases', route(async (req, res) => {
  const { release, signature } = req.body;
  const p = data.packages[release?.binding?.vaultId]; if (!p) throw new Error('Encrypted package missing'); deployment(p);
  const v = await vaultState(p.binding.vaultId); validateRegistration(p, v); validateReleaseContext(release, p, v);
  validSignature(releaseMessage(release), signature, release.guardian);
  if (config.mode === 'public') {
    const finalEvents = await contract.queryFilter(contract.filters.RecoveryFinalized(p.binding.vaultId, release.requestId), config.deploymentBlock);
    const event = finalEvents.at(-1); const tip = await provider.getBlockNumber();
    if (!event || tip - event.blockNumber + 1 < config.confirmations) throw new Error(`Wait for ${config.confirmations} chain confirmations before releasing shares`);
  }
  const entries = data.releases[p.binding.vaultId] ?? [];
  const previous = entries.find(e => same(e.release.guardian, release.guardian) && e.release.requestId === release.requestId);
  if (previous && digest(previous.release) !== digest(release)) throw new Error('This guardian already released a share for this request');
  if (!previous) entries.push({ release, signature });
  data.releases[p.binding.vaultId] = entries; save(); res.json({ ok: true });
}));
app.post('/api/clock', route(async (req, res) => {
  if (config.mode !== 'local' || config.chainId !== 31337 || Number(await provider.send('eth_chainId', [])) !== 31337) throw new Error('Demo clock is available only on the local development chain');
  const seconds = Number(req.body.seconds); if (!Number.isInteger(seconds) || seconds < 1 || seconds > 31536000) throw new Error('Invalid clock advance');
  await provider.send('evm_increaseTime', [seconds]); await provider.send('evm_mine', []); res.json({ ok: true });
}));
app.get('/api/health', (_req, res) => res.json({ ok: true, mode: config.mode }));
app.use(express.static('dist'));
app.use((error, _req, res, _next) => { res.status(400).json({ error: error.reason ?? error.shortMessage ?? error.message ?? 'Request rejected' }); });
const port = Number(process.env.HEIRLOOM_RELAY_PORT ?? 3001);
app.listen(port, '127.0.0.1', () => console.log(`Encrypted relay → http://127.0.0.1:${port} (${config.mode})`));
