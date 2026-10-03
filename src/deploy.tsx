import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserProvider, ContractFactory, formatEther, keccak256 } from 'ethers';
import { ArrowLeft, ArrowRight, Check, Download, ExternalLink, LoaderCircle, Network, Wallet } from 'lucide-react';
import { Brand, VaultIllustration } from './components/Brand';
import { friendlyError } from './lib/chain';
import { validateSepoliaDeployment } from '../shared/sepolia-deployment.mjs';
import './styles.css';
import './deploy.css';

const pendingKey = 'heirloom-sepolia-deployment-transaction';
function Deploy() {
  const [artifact, setArtifact] = useState<any>(); const [address, setAddress] = useState('');
  const [balance, setBalance] = useState(''); const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  const [hash, setHash] = useState(localStorage.getItem(pendingKey) ?? ''); const [config, setConfig] = useState<any>();
  const [rpcUrl, setRpcUrl] = useState('https://ethereum-sepolia-rpc.publicnode.com');
  useEffect(() => { fetch('/heirloom-contract.json').then(r => { if (!r.ok) throw new Error('Run npm run compile before opening the deployment page'); return r.json(); }).then(setArtifact).catch(e => setError(e.message)); }, []);
  async function wallet() {
    if (!window.ethereum) throw new Error('Open this page in the browser where your Ethereum wallet is installed.');
    await window.ethereum.request({ method: 'eth_requestAccounts' });
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] });
    const provider = new BrowserProvider(window.ethereum), signer = await provider.getSigner();
    const account = await signer.getAddress(); setAddress(account); setBalance(formatEther(await provider.getBalance(account)));
    if (Number((await provider.getNetwork()).chainId) !== 11155111) throw new Error('Switch to Ethereum Sepolia before deploying.');
    return { provider, signer };
  }
  async function run(label: string, fn: () => Promise<void>) { setBusy(label); setError(''); try { await fn(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(''); } }
  async function deploy() {
    await run(hash ? 'Checking deployment' : 'Preparing wallet transaction', async () => {
      const url = new URL(rpcUrl); if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use an HTTPS Sepolia RPC endpoint.');
      const { provider, signer } = await wallet(); let txHash = hash;
      if (!txHash) {
        const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
        const request = await factory.getDeployTransaction();
        const gas = await signer.estimateGas(request), fee = await provider.getFeeData();
        const required = gas * (fee.maxFeePerGas ?? fee.gasPrice ?? 0n);
        if (await provider.getBalance(await signer.getAddress()) < required) throw new Error('This wallet needs Sepolia test ETH. Request it from a faucet, then try again.');
        setBusy('Confirm deployment in your wallet');
        const contract = await factory.deploy(); const tx = contract.deploymentTransaction()!;
        txHash = tx.hash; setHash(txHash); localStorage.setItem(pendingKey, txHash);
      }
      setBusy('Waiting for the Sepolia receipt');
      const receipt = await provider.waitForTransaction(txHash, 1, 90000);
      if (!receipt?.contractAddress) throw new Error('The deployment has not confirmed yet. Keep this transaction and check again.');
      const [block, code] = await Promise.all([provider.getBlock(receipt.blockNumber), provider.getCode(receipt.contractAddress)]);
      const candidate = { chainId: 11155111, contractAddress: receipt.contractAddress, rpcUrl, deploymentBlock: receipt.blockNumber, deploymentId: receipt.blockHash, codeHash: keccak256(code), transactionHash: txHash };
      validateSepoliaDeployment(candidate, keccak256(artifact.deployedBytecode), { chainId: Number((await provider.getNetwork()).chainId), blockHash: block?.hash, codeHash: keccak256(code), receiptStatus: receipt.status, receiptBlock: receipt.blockNumber, receiptBlockHash: receipt.blockHash, receiptContract: receipt.contractAddress });
      setConfig(candidate);
    });
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'heirloom-sepolia.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="deployment-shell"><header><Brand/><a href="/" className="text-button"><ArrowLeft size={15}/>Back to your vaults</a></header><main className="deployment-main"><div className="deployment-intro"><span className="eyebrow">A PUBLIC PROOF OF YOUR PROTOCOL</span><h1>Put your promise<br/>on Ethereum.</h1><p>Deploy Heirloom’s recovery contract on Sepolia. Your wallet signs the transaction. Your keys stay with you.</p><VaultIllustration/></div><section className="deployment-card"><span className="deploy-network"><Network size={16}/>ETHEREUM SEPOLIA · 11155111</span><h2>{config ? 'Your contract is on-chain.' : 'One contract. No admin override.'}</h2><p>Two guardian approvals, a full cancellation window, and a permanent record of every recovery action.</p><div className="deployment-steps"><span><Check size={15}/>Compiled Solidity contract</span><span><Check size={15}/>Testnet only · no real ETH needed</span><span><Check size={15}/>Local rehearsal stays available</span></div><label className="deploy-label">Sepolia RPC endpoint<input value={rpcUrl} disabled={!!busy || !!config} onChange={e => setRpcUrl(e.target.value)} type="url" required/></label><div className="deploy-wallet">{address ? <><span>{address}</span><strong>{Number(balance).toFixed(5)} Sepolia ETH</strong></> : <span>Connect the wallet with your test ETH.</span>}</div>{error && <div className="inline-error" role="alert">{error}</div>}{!config && <><button className="button secondary full" disabled={!!busy} onClick={() => run('Connecting your wallet', async () => { await wallet(); })}><Wallet size={17}/>Connect Sepolia wallet</button><button className="button primary full" disabled={!!busy || !artifact} onClick={deploy}>{busy ? <><LoaderCircle className="spin" size={16}/>{busy}</> : <>{hash ? 'Check submitted deployment' : 'Deploy Heirloom contract'}<ArrowRight size={17}/></>}</button></>}{hash && <a className="deploy-transaction" href={`https://sepolia.etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer">Inspect deployment on Etherscan<ExternalLink size={14}/></a>}{config && <div className="deploy-success"><code>{config.contractAddress}</code><button className="button primary full" onClick={download}><Download size={16}/>Download deployment configuration</button><p>Save the file, then run these commands in another terminal:</p><pre>npm run sepolia:import<br/>npm run dev:sepolia</pre><p>Public app: <a href="http://127.0.0.1:5174">127.0.0.1:5174</a></p></div>}<p className="deploy-faucet">Need test ETH? <a href="https://www.alchemy.com/faucets/ethereum-sepolia" target="_blank" rel="noreferrer">Open the Sepolia faucet <ExternalLink size={11}/></a></p><small className="deploy-note">The local demo at port 5173 uses a development chain. This page deploys a separate contract on the public Sepolia network.</small></section></main></div>;
}
createRoot(document.getElementById('root')!).render(<Deploy/>);
