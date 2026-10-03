import { spawn } from 'node:child_process';
import { JsonRpcProvider, keccak256 } from 'ethers';
import { readFileSync, existsSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { validateDeployment } from '../shared/chain-safety.mjs';
import { deploy } from './deploy.mjs';

const children = []; mkdirSync('.runtime', { recursive: true });
function run(args, logfile) {
  const fd = logfile ? openSync(`.runtime/${logfile}`, 'a') : undefined;
  const child = spawn(process.execPath, args, { stdio: logfile ? ['ignore', fd, fd] : 'inherit', windowsHide: true, env: process.env });
  children.push(child); return child;
}
function stop() { children.forEach(c => c.kill()); process.exit(); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);

if (!process.argv.includes('--public')) {
  const probe = new JsonRpcProvider('http://127.0.0.1:8545', 31337, { staticNetwork: true, cacheTimeout: -1 });
  let running = false;
  try { running = (await probe.send('eth_chainId', [])) === '0x7a69'; } catch {}
  if (!running) {
    run(['node_modules/hardhat/dist/src/cli.js', 'node', '--hostname', '127.0.0.1', '--port', '8545'], 'chain.log');
    for (let n = 0; n < 120; n++) {
      try { await probe.send('eth_chainId', []); running = true; break; } catch { await new Promise(r => setTimeout(r, 150)); }
    }
    if (!running) throw new Error('Local chain failed to start. See .runtime/chain.log');
  }
  let existing;
  if (existsSync('.runtime/deployment.json')) existing = JSON.parse(readFileSync('.runtime/deployment.json', 'utf8'));
  let reusable = false;
  if (existing?.chainId === 31337) {
    try {
      const code = await probe.getCode(existing.contractAddress), block = await probe.getBlock(existing.deploymentBlock);
      // A one-time config migration is safe only when the original deployment block still matches.
      if (!existing.codeHash && code !== '0x' && block?.hash === existing.deploymentId) { existing.codeHash = keccak256(code); writeFileSync('.runtime/deployment.json', JSON.stringify(existing, null, 2)); }
      validateDeployment(existing, { chainId: Number(await probe.send('eth_chainId', [])), blockHash: block?.hash, codeHash: keccak256(code) }); reusable = true;
    } catch {}
  }
  if (!reusable) await deploy();
  probe.destroy();
} else {
  const file = existsSync('.runtime/sepolia-deployment.json') ? '.runtime/sepolia-deployment.json' : '.runtime/deployment.json';
  if (!existsSync(file)) throw new Error('Deploy to Sepolia and import its configuration before using --public');
  const config = JSON.parse(readFileSync(file, 'utf8'));
  if (config.mode !== 'public') throw new Error('The saved deployment is local; deploy to Sepolia first');
  process.env.HEIRLOOM_DEPLOYMENT_FILE = file;
  process.env.HEIRLOOM_RELAY_PORT = '3002'; process.env.HEIRLOOM_UI_PORT = '5174';
}
run(['server/index.mjs']); run(['node_modules/vite/bin/vite.js', '--host', '127.0.0.1']);
console.log(`Heirloom → http://127.0.0.1:${process.env.HEIRLOOM_UI_PORT ?? 5173} · keep this terminal running`);
for (const c of children) c.on('exit', code => { if (code) { console.error(`A development service exited (${code}).`); stop(); } });
