import { useEffect, useState, useCallback, useRef } from 'react';
import { LayoutDashboard, FolderLock, UsersRound, Activity, ShieldCheck, ArrowUpRight, ArrowRight, Plus, Bell, ChevronDown, ChevronRight, FileText, Heart, KeyRound, LockKeyhole, CircleCheck, Clock3, Download, Upload, Search, ExternalLink, CircleHelp, X, LoaderCircle, Check, Fingerprint, CircleAlert, Network, Play, RefreshCw, Sprout, Wallet, ShieldOff } from 'lucide-react';
import { hexlify, randomBytes, verifyMessage } from 'ethers';
import { Brand, VaultIllustration } from './components/Brand';
import Modal from './components/Modal';
import CreateVault, { type CreateInput } from './components/CreateVault';
import { api } from './lib/api';
import { initializeChain, signerFor, writableContract, getVault, chainTime, history, friendlyError, connectWallet, transactionDetails, verifyDeployment, verifyReleaseFinality } from './lib/chain';
import { obtainIdentity, storedIdentity, persistPending, pendingRegistrations, clearPending } from './lib/identity';
import { registerWithRecovery, type PendingRegistration } from './lib/registration';
import { sealAsset, publicKeyHash, packageCommitment, releaseShare, recoverAsset } from './lib/crypto';
import { identityMessage, releaseMessage } from '../shared/protocol.mjs';
import type { Config, Actor, Vault, TimelineEvent, IdentityRecord, ProtectedPackage, AssetData } from './lib/types';

type Page = 'overview' | 'assets' | 'recovery' | 'guardians' | 'activity';
const short = (address = '') => `${address.slice(0, 6)}…${address.slice(-4)}`;
const same = (a = '', b = '') => a.toLowerCase() === b.toLowerCase();
function duration(seconds: number) { if (seconds >= 86400) return `${Math.ceil(seconds / 86400)} days`; if (seconds >= 3600) return `${Math.ceil(seconds / 3600)} hours`; if (seconds >= 60) return `${Math.ceil(seconds / 60)} min`; return `${Math.max(0, Math.ceil(seconds))} sec`; }
const statusLabel = (v: Vault) => v.state.status === 2 ? 'Released' : v.state.status === 1 ? 'Recovery pending' : 'Protected';
function download(value: unknown, name: string) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
const eventCopy: Record<string, string> = { VaultRegistered: 'Vault encrypted & registered', OwnerCheckedIn: 'Owner checked in', RecoveryRequested: 'Recovery requested', GuardianApproved: 'Guardian approval confirmed', ChallengeStarted: 'Cancellation window opened', RecoveryCancelled: 'Recovery cancelled by owner', RecoveryFinalized: 'Recovery finalized on-chain' };
const pages: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [{ id: 'overview', label: 'Overview', icon: LayoutDashboard }, { id: 'assets', label: 'My vaults', icon: FolderLock }, { id: 'recovery', label: 'Recovery center', icon: ShieldCheck }, { id: 'guardians', label: 'Guardians', icon: UsersRound }, { id: 'activity', label: 'Activity log', icon: Activity }];

export default function App() {
  const [config, setConfig] = useState<Config>(); const [actor, setActor] = useState<Actor>();
  const [identities, setIdentities] = useState<IdentityRecord[]>([]); const [vaults, setVaults] = useState<Vault[]>([]); const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [page, setPage] = useState<Page>('overview'); const [selected, setSelected] = useState<string>(); const [creating, setCreating] = useState(false); const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(''); const [boot, setBoot] = useState('Connecting to your vault'); const [error, setError] = useState(''); const [toast, setToast] = useState('');
  const [time, setTime] = useState(0); const [block, setBlock] = useState(0); const [search, setSearch] = useState(''); const [filter, setFilter] = useState('All vaults');
  const [releaseCount, setReleaseCount] = useState<Record<string, number>>({}); const [decrypted, setDecrypted] = useState<{ id: string; asset: AssetData }>();
  const [inspection, setInspection] = useState<any>(); const importRef = useRef<HTMLInputElement>(null);
  const [offline, setOffline] = useState(false); const [pending, setPending] = useState<PendingRegistration[]>([]); const [lastHash, setLastHash] = useState('');
  const current = vaults.find(v => v.state.id === selected);
  const namespace = config ? `${config.chainId}:${config.contractAddress}:${config.deploymentId}` : '';
  const metadataKey = (c: Config) => `heirloom-labels:${c.deploymentId}`;
  const notify = (message: string) => { setToast(message); };
  const nameOf = (address: string) => config?.actors.find(a => same(a.address, address))?.name ?? short(address);

  const refresh = useCallback(async (c: Config) => {
    await verifyDeployment(c);
    const ns = `${c.chainId}:${c.contractAddress}:${c.deploymentId}`;
    const preserved = await pendingRegistrations(ns);
    for (const entry of preserved) {
      try {
        const state = await getVault(c, entry.package.binding.vaultId);
        if (state.commitment !== packageCommitment(entry.package)) continue;
        await api.savePackage(entry.package);
        const meta = JSON.parse(localStorage.getItem(metadataKey(c)) ?? '{}'); meta[state.id] = { label: entry.label, category: entry.category, createdAt: entry.createdAt }; localStorage.setItem(metadataKey(c), JSON.stringify(meta));
        await clearPending(ns, state.id);
      } catch { /* An unmined registration remains preserved for export and later reconciliation. */ }
    }
    setPending(await pendingRegistrations(ns));
    const [packages, timeline, clock] = await Promise.all([api.packages(), history(c), chainTime()]);
    const meta = JSON.parse(localStorage.getItem(metadataKey(c)) ?? '{}');
    const loaded = await Promise.all(packages.map(async p => {
      try { const state = await getVault(c, p.binding.vaultId); if (state.commitment !== packageCommitment(p)) throw new Error('Package commitment mismatch'); return { package: p, state, label: meta[state.id]?.label ?? `Protected vault ${short(state.id)}`, category: meta[state.id]?.category ?? 'Encrypted asset', createdAt: meta[state.id]?.createdAt ?? 0 } as Vault; } catch { return undefined; }
    }));
    setVaults(loaded.filter((v): v is Vault => !!v)); setEvents(timeline); setTime(clock.timestamp); setBlock(clock.blockNumber);
    const counts: Record<string, number> = {};
    await Promise.all(loaded.filter((v): v is Vault => !!v && v.state.status === 2).map(async v => { counts[v.state.id] = (await api.releases(v.state.id)).filter(r => r.release.requestId === v.state.requestId).length; }));
    setReleaseCount(counts);
    setOffline(false);
  }, []);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const c = await api.config(); if (!live) return; setConfig(c); initializeChain(c);
        if (c.mode === 'local') setActor(c.actors[0]);
        const existing = await api.identities(); const enrolled = [...existing];
        if (c.mode === 'local') {
          setBoot('Preparing independent demo identities');
          for (const a of c.actors) {
            if (!live) return;
            const key = await storedIdentity(`${c.chainId}:${c.contractAddress}:${c.deploymentId}`, a.address);
            const found = existing.find(i => same(i.address, a.address));
            if (found && !key) continue;
            const identity = key ?? await obtainIdentity(`${c.chainId}:${c.contractAddress}:${c.deploymentId}`, a.address);
            if (!found && live) { const signer = await signerFor(c, a.address); const record = { address: a.address, publicKey: identity.publicKey, signature: await signer.signMessage(identityMessage(c, a.address, identity.publicKey)) }; if (!live) return; await api.enroll(record); enrolled.push(record); }
          }
        }
        if (!live) return; setIdentities(enrolled); await refresh(c); setBoot('');
      } catch (e) { if (live) { setBoot(''); setOffline(true); setError(friendlyError(e)); } }
    })(); return () => { live = false; };
  }, [refresh]);
  useEffect(() => { if (!config || boot || (config.mode === 'public' && !actor)) return; const timer = setInterval(() => refresh(config).catch(() => setOffline(true)), 6000); return () => clearInterval(timer); }, [config, boot, actor, refresh]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { setDecrypted(undefined); }, [actor?.address, selected]);

  async function run(label: string, fn: () => Promise<void>) {
    if (busy) return; setBusy(label); setError('');
    try { await fn(); if (config) await refresh(config); } catch (e) { setError(friendlyError(e)); } finally { setBusy(''); }
  }
  async function create(input: CreateInput, c = config!, owner = actor!) {
    const registry = await api.identities();
    for (const record of registry) if (!same(verifyMessage(identityMessage(c, record.address, record.publicKey), record.signature), record.address)) throw new Error('Identity signature verification failed');
    const beneficiary = registry.find(i => same(i.address, input.beneficiary)); if (!beneficiary) throw new Error('The beneficiary must enroll an encryption identity first');
    const guardians = input.guardians.map(address => { const identity = registry.find(i => same(i.address, address)); if (!identity) throw new Error('Every guardian must enroll an encryption identity first'); return { address, publicKey: identity.publicKey }; });
    const id = hexlify(randomBytes(32));
    const p = await sealAsset(input.bytes, { name: input.name, mime: input.mime }, guardians, { chainId: c.chainId, contract: c.contractAddress.toLowerCase(), vaultId: id, beneficiary: input.beneficiary.toLowerCase(), beneficiaryKeyHash: publicKeyHash(beneficiary.publicKey) }, beneficiary.publicKey);
    const contract = await writableContract(c, owner.address);
    const ns = `${c.chainId}:${c.contractAddress}:${c.deploymentId}`;
    const entry = { package: p, label: input.label, category: input.category, createdAt: Date.now() };
    await registerWithRecovery(entry, async record => { await persistPending(ns, record); if (record.transactionHash) setLastHash(record.transactionHash); }, async () => contract.registerVault(id, input.beneficiary, input.guardians, input.inactivity, input.challenge, packageCommitment(p), p.binding.beneficiaryKeyHash), () => api.savePackage(p).then(() => {}), () => clearPending(ns, id));
    const meta = JSON.parse(localStorage.getItem(metadataKey(c)) ?? '{}'); meta[id] = { label: input.label, category: input.category, createdAt: Date.now() }; localStorage.setItem(metadataKey(c), JSON.stringify(meta)); return id;
  }
  async function submitCreate(input: CreateInput) {
    setBusy('Encrypting & registering'); setError('');
    try { const id = await create(input); setCreating(false); await refresh(config!); setSelected(id); notify('Your asset is encrypted. Recovery policy confirmed on-chain.'); } catch (e) { throw new Error(friendlyError(e)); } finally { setBusy(''); }
  }
  async function samples() {
    await run('Creating sample vaults', async () => {
      const c = config!, owner = c.actors.find(a => a.role === 'owner')!;
      const beneficiary = c.actors.find(a => a.role === 'beneficiary')!.address, guardians = c.actors.filter(a => a.role === 'guardian').map(a => a.address);
      const samples = [{ label: 'Letters for my family', category: 'Family memories', name: 'a-letter-for-sam.txt', text: 'Dear Sam,\n\nSome things should never get lost. The stories, the little moments, the things we built together.\n\nIf you are reading this, know that everything here was kept safe for you. Take care of each other.\n\nWith love,\nAlex' }, { label: 'My digital instructions', category: 'Account access', name: 'digital-instructions.txt', text: 'HEIRLOOM SAMPLE — NO REAL CREDENTIALS\n\nFamily archive: example.com/family\nSample recovery phrase: this is sample data only\n\nAsk Maya about the photo collection and James about the important records.' }, { label: 'Important documents', category: 'Personal documents', name: 'family-records.txt', text: 'HEIRLOOM SAMPLE FAMILY RECORDS\n\nEmergency contact: Sam Morgan\nFamily archive custodian: Priya Shah\n\nThese sample records demonstrate exact byte recovery from encrypted storage.' }];
      for (const s of samples) await create({ ...s, bytes: new TextEncoder().encode(s.text), mime: 'text/plain', beneficiary, guardians, inactivity: 60, challenge: 30 }, c, owner);
      notify('Three sample vaults created with real encryption and Ethereum transactions.');
    });
  }
  async function action(method: 'requestRecovery' | 'approveRecovery' | 'finalizeRecovery' | 'checkIn') {
    if (!current || !actor || !config) return;
    await run(method === 'checkIn' ? 'Confirming check-in' : 'Confirming transaction', async () => {
      const contract = await writableContract(config, actor.address); const args = method === 'requestRecovery' || method === 'checkIn' ? [current.state.id] : [current.state.id, current.state.requestId];
      await contract[method].staticCall(...args); const tx = await contract[method](...args); setLastHash(tx.hash); await tx.wait(1, 90000);
      notify(method === 'checkIn' ? 'Check-in confirmed. Any pending recovery is cancelled.' : 'Transaction confirmed on Ethereum.');
    });
  }
  async function release() {
    if (!current || !actor || !config) return;
    await run('Encrypting guardian release', async () => {
      const state = await getVault(config, current.state.id);
      if (state.status !== 2 || !state.approved.some(g => same(g, actor.address))) throw new Error('Finalize recovery and approve with this guardian before releasing its share');
      await verifyReleaseFinality(config, state.id, state.requestId);
      const identity = await storedIdentity(namespace, actor.address); if (!identity) throw new Error('This guardian encryption key is on its original browser. Use that device.');
      const r = await releaseShare(current.package, actor.address, identity, current.package.beneficiaryPublicKey, state.requestId);
      const signer = await signerFor(config, actor.address); await api.release(r, await signer.signMessage(releaseMessage(r))); notify('Your share was encrypted to the beneficiary. The relay cannot decrypt it.');
    });
  }
  async function decrypt() {
    if (!current || !actor || !config) return;
    await run('Verifying & decrypting', async () => {
      const state = await getVault(config, current.state.id);
      if (state.status !== 2 || !same(state.beneficiary, actor.address)) throw new Error('Only the designated beneficiary can decrypt after finalization');
      const identity = await storedIdentity(namespace, actor.address); if (!identity) throw new Error('Your beneficiary encryption key is on its original browser. Use that device.');
      if (publicKeyHash(identity.publicKey) !== state.beneficiaryKeyHash || packageCommitment(current.package) !== state.commitment) throw new Error('On-chain key or package commitment mismatch');
      const records = (await api.releases(state.id)).filter(r => r.release.requestId === state.requestId);
      for (const r of records) if (!state.approved.some(a => same(a, r.release.guardian)) || !same(verifyMessage(releaseMessage(r.release), r.signature), r.release.guardian)) throw new Error('Guardian signature or approval failed verification');
      const asset = await recoverAsset(current.package, records.map(r => r.release), identity, state.requestId); setDecrypted({ id: state.id, asset }); notify('Asset decrypted locally. Your inherited document is ready.');
    });
  }
  async function enrollWallet() {
    if (!config) return; await run('Connecting wallet', async () => {
      const address = await connectWallet(config); const a: Actor = { address, name: 'Your connected wallet', role: 'owner', initials: 'YW' }; setActor(a);
      const existing = await api.identities(); const enrolled = existing.find(i => same(i.address, address));
      let identity = await storedIdentity(namespace, address);
      if (enrolled && !identity) throw new Error('This wallet already enrolled a key on another browser. Use that browser; this device cannot replace an existing custody key.');
      identity ??= await obtainIdentity(namespace, address);
      if (!enrolled) { const signer = await signerFor(config, address); await api.enroll({ address, publicKey: identity.publicKey, signature: await signer.signMessage(identityMessage(config, address, identity.publicKey)) }); }
      setIdentities(await api.identities()); notify('Wallet connected and encryption identity enrolled.');
    });
  }
  async function importKit(file?: File) {
    if (!file || !config) return;
    await run('Verifying recovery kit', async () => {
      if (file.size > 15 * 1024 * 1024) throw new Error('Recovery kit is too large');
      const kit = JSON.parse(await file.text()); if (kit.format !== 'heirloom-recovery-kit' || kit.version !== 1) throw new Error('Unsupported recovery kit');
      const p: ProtectedPackage = kit.package;
      if (p.binding.chainId !== config.chainId || !same(p.binding.contract, config.contractAddress)) throw new Error('This recovery kit belongs to another chain or contract');
      const state = await getVault(config, p.binding.vaultId); if (packageCommitment(p) !== state.commitment || publicKeyHash(p.beneficiaryPublicKey) !== state.beneficiaryKeyHash) throw new Error('Recovery kit does not match its on-chain commitments');
      await api.savePackage(p); setSelected(state.id); notify('Recovery kit verified against Ethereum and imported.');
    });
  }
  const visible = vaults.filter(v => (!search || v.label.toLowerCase().includes(search.toLowerCase()) || v.category.toLowerCase().includes(search.toLowerCase())) && (filter === 'All vaults' || statusLabel(v) === filter));
  const activeRecoveries = vaults.filter(v => v.state.status === 1).length;
  const protectedCount = vaults.filter(v => v.state.status !== 2).length;
  const guardians = config?.mode === 'local' ? config.actors.filter(a => a.role === 'guardian') : identities.filter(i => !same(i.address, actor?.address)).map(i => ({ address: i.address, name: short(i.address), initials: 'GI', role: 'guardian' as const }));

  function vaultCard(v: Vault, index: number) {
    const Icon = v.category === 'Family memories' ? Heart : v.category === 'Account access' ? KeyRound : FileText;
    return <button className="vault-card" key={v.state.id} onClick={() => setSelected(v.state.id)}><div className="card-top"><span className={`asset-icon color-${index % 3}`}><Icon size={22}/></span><span className={`status-badge status-${v.state.status}`}><span/>{statusLabel(v)}</span></div><h3>{v.label}</h3><p>{v.category}</p><div className="card-policy"><span><UsersRound size={14}/> 2 of 3 guardians</span><span><LockKeyhole size={13}/> AES-256</span></div><div className="card-bottom"><span className="beneficiary-avatar">{nameOf(v.state.beneficiary).slice(0, 1)}</span><span>For <strong>{nameOf(v.state.beneficiary)}</strong></span><ArrowUpRight size={17}/></div></button>;
  }
  function eventRows(items: TimelineEvent[]) {
    return items.map((e, i) => <button className="activity-row" key={`${e.hash}-${e.name}-${i}`} onClick={() => run('Loading transaction', async () => setInspection(await transactionDetails(e.hash)))}><span className={`event-icon ${e.name.includes('Cancel') ? 'cancel' : e.name.includes('Requested') ? 'pending' : ''}`}>{e.name.includes('Cancel') ? <ShieldOff size={17}/> : e.name.includes('Approved') ? <UsersRound size={17}/> : e.name.includes('Check') ? <CircleCheck size={17}/> : <LockKeyhole size={17}/>}</span><span className="event-copy"><strong>{eventCopy[e.name] ?? e.name}</strong><small>{vaults.find(v => v.state.id === e.vaultId)?.label ?? short(e.vaultId)}{e.actor ? ` · ${nameOf(e.actor)}` : ''}</small></span><span className="event-time">Block #{e.blockNumber}<small>{short(e.hash)}</small></span><ArrowUpRight size={15}/></button>);
  }
  return <div className="app-shell">
    <aside className="sidebar"><Brand/><div className="workspace"><span className="workspace-icon"><Sprout size={18}/></span><div>Personal workspace<small>Your legacy, protected</small></div><ChevronDown size={15}/></div><span className="nav-caption">WORKSPACE</span><nav>{pages.map(p => <button key={p.id} className={page === p.id ? 'nav-item active' : 'nav-item'} onClick={() => { setPage(p.id); setSearch(''); }}><p.icon size={19}/>{p.label}{p.id === 'recovery' && activeRecoveries > 0 && <span className="nav-count">{activeRecoveries}</span>}{p.id === 'assets' && <span className="nav-total">{vaults.length}</span>}</button>)}</nav><div className="sidebar-spacer"/><div className="sidebar-note"><span className="note-spark">✳</span><h4>A legacy worth keeping.</h4><p>A little planning today.<br/>Peace of mind for tomorrow.</p><button onClick={() => setHelp(true)}>How Heirloom works <ArrowUpRight size={14}/></button></div><button className="sidebar-help" onClick={() => setHelp(true)}><CircleHelp size={18}/> Help & protocol guide<ArrowUpRight size={14}/></button><div className="sidebar-account"><span className="avatar">{actor?.initials ?? 'HL'}</span><div>{actor?.name ?? 'Your workspace'}<small>{actor?.role ?? 'Connect a wallet'}</small></div><span className="online-dot"/></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><span>Workspace</span><ChevronRight size={13}/><strong>{pages.find(p => p.id === page)?.label}</strong></div><div className="topbar-right"><button className="network-pill" onClick={() => setInspection({ network: config?.mode === 'local' ? 'Local Ethereum development network' : 'Ethereum Sepolia', chainId: config?.chainId, contract: config?.contractAddress, block })}><span className={offline ? "offline-dot" : "online-dot"}/>{offline ? "Connection stale" : config?.mode === 'public' ? 'Ethereum Sepolia' : 'Local Ethereum'}<ChevronDown size={12}/></button><button className="icon-button notification" aria-label="View activity" onClick={() => setPage('activity')}><Bell size={19}/>{events.length > 0 && <i/>}</button><span className="topbar-divider"/><span className="avatar small">{actor?.initials ?? 'HL'}</span></div></header>
    <main>
      <div className="demo-strip"><span><span className="demo-dot"/>{config?.mode === 'public' ? 'PUBLIC TESTNET' : 'LOCAL CHAIN DEMO'}</span><p>{config?.mode === 'public' ? 'Independent wallets · encrypted custody · real Sepolia transactions' : 'Real contracts & encryption · sample actors share this device'}</p>{config?.mode === 'local' ? <div className="actor-switch"><span>Acting as</span><select aria-label="Demo actor" value={actor?.address ?? ''} onChange={e => { setActor(config.actors.find(a => a.address === e.target.value)); setError(''); }}>{config.actors.map(a => <option value={a.address} key={a.address}>{a.name} · {a.role}</option>)}</select><ChevronDown size={13}/></div> : <button onClick={enrollWallet} disabled={!!busy}><Wallet size={14}/>{actor ? short(actor.address) : 'Connect & enroll wallet'}</button>}</div>
      {offline && !boot && <div className="error-banner" role="status"><Network size={17}/><span>Connection lost or changed. Displayed chain data may be stale.</span><button onClick={() => config && run("Reconnecting", () => refresh(config))}>Retry</button></div>}{pending.length > 0 && <div className="error-banner" role="status"><FolderLock size={17}/><span>{pending.length} unfinished registration(s) preserved on this browser.</span><button onClick={() => download({ format: "heirloom-recovery-kit", version: 1, package: pending[0].package }, "heirloom-pending-kit.json")}>Export kit</button></div>}{error && <div className="error-banner" role="alert"><CircleAlert size={18}/><span>{error}</span>{lastHash && <button onClick={() => run("Checking transaction", async () => setInspection(await transactionDetails(lastHash)))}>Check transaction</button>}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={16}/></button></div>}
      {boot ? <div className="loading-screen"><Brand small/><LoaderCircle className="spin" size={24}/><h2>{boot}</h2><p>Keys stay in your browser. Policies live on Ethereum.</p></div> : <>
      <div className="page-heading"><div><span className="eyebrow">{page === 'overview' ? 'YOUR LEGACY, IN GOOD HANDS' : 'YOUR PERSONAL WORKSPACE'}</span><h1>{page === 'overview' ? 'A little peace of mind.' : page === 'assets' ? 'What matters, kept safe.' : page === 'recovery' ? 'Recovery, with care.' : page === 'guardians' ? 'Your circle of trust.' : 'Every step, accounted for.'}</h1><p>{page === 'overview' ? 'Protect what matters. Pass it on to the people who matter.' : page === 'assets' ? 'Your encrypted assets and the people you’re keeping them for.' : page === 'recovery' ? 'Independent approval. Time to intervene. A verifiable path to recovery.' : page === 'guardians' ? 'No one holds all the keys. That’s the point.' : 'An auditable history, written directly to Ethereum.'}</p></div><button className="button primary" onClick={() => setCreating(true)} disabled={!actor || !!busy}><Plus size={17}/>Create a vault</button></div>
      {page === 'overview' && <>
        <section className="hero-panel"><div className="hero-copy"><span className="hero-label"><ShieldCheck size={15}/> BUILT ON TRUST. PROTECTED BY MATH.</span><h2>Some things deserve<br/>to live on.</h2><p>Your documents, memories, and digital life.<br/>Safely yours today. Thoughtfully theirs tomorrow.</p><button onClick={() => setHelp(true)}>Explore your protection <ArrowRight size={16}/></button></div><VaultIllustration/><span className="hero-footnote"><LockKeyhole size={12}/> Encrypted on your device. Always.</span></section>
        <section className="stats-grid"><div className="stat-card"><span className="stat-icon lilac"><FolderLock size={20}/></span><div><span>Protected vaults</span><strong>{protectedCount.toString().padStart(2, '0')}<small>assets secured</small></strong></div><span className="stat-dot"/></div><div className="stat-card"><span className="stat-icon peach"><UsersRound size={20}/></span><div><span>Trusted guardians</span><strong>{guardians?.length.toString().padStart(2, '0') ?? '00'}<small>2 approvals required</small></strong></div></div><div className="stat-card"><span className="stat-icon sage"><ShieldCheck size={20}/></span><div><span>Recovery requests</span><strong>{activeRecoveries.toString().padStart(2, '0')}<small>{activeRecoveries ? 'awaiting authorization' : 'everything is calm'}</small></strong></div><span className={`stat-dot ${activeRecoveries ? 'amber' : ''}`}/></div></section>
        <div className="section-heading"><h2>Your vaults <span>{vaults.length}</span></h2><button className="text-button" onClick={() => setPage('assets')}>View all vaults<ArrowRight size={15}/></button></div>
        {vaults.length > 0 ? <div className="vault-grid">{vaults.slice(0, 3).map(vaultCard)}</div> : <div className="empty-vault"><span className="empty-art"><FolderLock size={30}/></span><div><h3>Your legacy starts here.</h3><p>Create your first vault, or explore with encrypted sample assets.</p></div>{config?.mode === 'local' && <button className="button secondary" disabled={!!busy} onClick={samples}><Play size={15}/>{busy || 'Load sample vaults'}</button>}</div>}
        <div className="dashboard-bottom"><section className="recent-panel"><div className="section-heading"><h2>Recent activity</h2><button className="text-button" onClick={() => setPage('activity')}>View all<ArrowRight size={14}/></button></div>{events.length ? eventRows(events.slice(0, 3)) : <div className="calm-empty"><Activity size={23}/><p>Your story will appear here.<small>Every vault and recovery action gets a real transaction.</small></p></div>}</section><section className="checkin-panel"><span className="checkin-icon"><Fingerprint size={28}/></span><span className="eyebrow">STAY IN CONTROL</span><h3>A check-in goes a long way.</h3><p>Let your guardians know you’re here. Reset your recovery clock with a signed transaction.</p><button className="button secondary" disabled={!actor || !!busy || !vaults.some(v => same(v.state.owner, actor.address) && v.state.status !== 2)} onClick={() => { const v = vaults.find(v => same(v.state.owner, actor?.address) && v.state.status !== 2); if (v) setSelected(v.state.id); }}>Manage check-ins<ArrowRight size={15}/></button></section></div>
      </>}
      {(page === 'assets' || page === 'recovery') && <><div className="asset-toolbar"><div className="search-field"><Search size={17}/><input placeholder="Search your vaults…" value={search} onChange={e => setSearch(e.target.value)}/></div><select aria-label="Filter vault status" value={filter} onChange={e => setFilter(e.target.value)}>{['All vaults', 'Protected', 'Recovery pending', 'Released'].map(f => <option key={f}>{f}</option>)}</select><button className="button secondary small-button" onClick={() => importRef.current?.click()}><Upload size={15}/>Import kit</button></div>{page === 'recovery' && <div className="recovery-explainer"><ShieldCheck size={26}/><div><strong>A deliberate path to recovery.</strong><p>Missed check-in → two guardian attestations → owner cancellation window → beneficiary release.</p></div></div>}<div className="vault-grid">{visible.map(vaultCard)}</div>{!visible.length && <div className="large-empty"><FolderLock size={35}/><h3>{search ? 'No matching vaults.' : 'Your vaults will appear here.'}</h3><p>{search ? 'Try another name or category.' : 'Create a vault or load sample assets to explore the full recovery flow.'}</p>{config?.mode === 'local' && !search && <button className="button secondary" disabled={!!busy} onClick={samples}><Play size={16}/>Load sample vaults</button>}</div>}</>}
      {page === 'guardians' && <><div className="guardian-intro"><span><UsersRound size={24}/></span><div><h3>Shared responsibility. Individual control.</h3><p>Each guardian holds one encrypted key share. Any two can help your beneficiary recover; one can’t act alone.</p></div><span className="threshold-pill">2 / 3 quorum</span></div><div className="guardians-grid">{guardians?.map((g, i) => <div className="guardian-card" key={g.address}><div className={`guardian-avatar ga-${i % 3}`}>{g.initials}</div><h3>{g.name}</h3><span className="guardian-role">Independent guardian</span><span className="wallet-address">{short(g.address)}</span><div className="guardian-status"><span className="online-dot"/>{identities.some(identity => same(identity.address, g.address)) ? 'Encryption identity enrolled' : 'Identity not enrolled'}</div><div className="guardian-card-footer"><KeyRound size={15}/><span>Holds 1 encrypted share per vault</span></div>{config?.mode === 'local' && <button className="button secondary" onClick={() => { setActor(g); setPage('recovery'); }}>View guardian inbox<ArrowRight size={14}/></button>}</div>)}</div><div className="trust-note"><CircleHelp size={19}/><p>Guardians must verify incapacity independently before approving. Two colluding guardians can combine their shares privately; independent selection and custody remain essential.</p></div></>}
      {page === 'activity' && <section className="all-activity"><div className="section-heading"><h2>On-chain history <span>{events.length}</span></h2><button className="text-button" disabled={!!busy} onClick={() => run('Refreshing', async () => {})}><RefreshCw size={14}/>Refresh</button></div>{events.length ? eventRows(events) : <div className="large-empty"><Activity size={32}/><h3>A clean slate.</h3><p>Create a vault to record your first transaction.</p></div>}<div className="chain-footer"><Network size={14}/>Chain {config?.chainId} · Block #{block} · {short(config?.contractAddress)}<span>Click any event to inspect its transaction</span></div></section>}
      <footer className="page-footer"><span><Sprout size={14}/>Made for the things that outlast us.</span><button onClick={() => setHelp(true)}>Heirloom protocol <ArrowUpRight size={12}/></button></footer>
      </>}
    </main></div>
    {busy && !creating && <div className="busy-pill" role="status"><LoaderCircle size={17} className="spin"/>{busy}…</div>}
    {toast && <div className="toast" role="status"><CircleCheck size={19}/>{toast}<button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={14}/></button></div>}
    <input ref={importRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={e => { importKit(e.target.files?.[0]); e.target.value = ''; }}/>
    {creating && config && actor && <CreateVault config={config} identities={identities} account={actor.address} busy={busy} onClose={() => { if (!busy) setCreating(false); }} onCreate={submitCreate}/>}
    {current && config && <Modal title={current.label} eyebrow="ENCRYPTED VAULT" onClose={() => { if (!busy) setSelected(undefined); }} wide>{error && <div className="inline-error" role="alert">{error}</div>}<div className="vault-detail-grid"><div className="vault-detail-main"><div className="detail-asset"><span className="asset-icon color-0"><FolderLock size={26}/></span><div><strong>{current.category}</strong><span>Encrypted on your device · AES-256-GCM</span></div><span className={`status-badge status-${current.state.status}`}><span/>{statusLabel(current)}</span></div><div className="detail-info"><div><span>Beneficiary</span><strong>{nameOf(current.state.beneficiary)}</strong><small>{short(current.state.beneficiary)}</small></div><div><span>Authorization</span><strong>2 of 3 guardians</strong><small>Independent attestations required</small></div><div><span>Check-in period</span><strong>{duration(current.state.inactivity)}</strong><small>Cancellation window: {duration(current.state.challenge)}</small></div><div><span>On-chain commitment</span><strong className="mono">{short(current.state.commitment)}</strong><small>Chain {config.chainId} · {short(config.contractAddress)}</small></div></div>
      <div className="detail-guardians"><h4><UsersRound size={16}/>Guardian approvals</h4>{current.state.guardians.map((g, i) => <div key={g}><span className={`mini-avatar ga-${i}`}>{nameOf(g)[0]}</span><strong>{nameOf(g)}</strong><small>{short(g)}</small><span className={current.state.approved.some(a => same(a, g)) ? 'approved-check' : 'approval-wait'}>{current.state.approved.some(a => same(a, g)) ? <><Check size={13}/>Approved</> : <><Clock3 size={12}/>Waiting</>}</span></div>)}</div>
      <div className="ciphertext-section"><h4><LockKeyhole size={15}/>What storage can see</h4><code>{current.package.ciphertext.slice(0, 190)}…</code><p>Encrypted bytes only. No asset key or plaintext shares.</p></div>
      {decrypted?.id === current.state.id && <div className="decrypted-section"><div><CircleCheck size={18}/><strong>Recovered: {decrypted.asset.name}</strong></div>{decrypted.asset.mime.startsWith('text/') ? <pre>{new TextDecoder().decode(decrypted.asset.bytes)}</pre> : <p>File recovered successfully ({decrypted.asset.bytes.length.toLocaleString()} bytes).</p>}<button className="button secondary" onClick={() => { const a = document.createElement('a'); const url = URL.createObjectURL(new Blob([decrypted.asset.bytes], { type: decrypted.asset.mime })); a.href = url; a.download = decrypted.asset.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}><Download size={15}/>Download inherited asset</button></div>}
      <button className="text-button kit-button" onClick={() => download({ format: 'heirloom-recovery-kit', version: 1, package: current.package }, `heirloom-kit-${current.state.id.slice(2, 10)}.json`)}><Download size={15}/>Export encrypted recovery kit</button>
      </div><div className="recovery-panel"><span className="eyebrow">RECOVERY SAFEGUARDS</span><h3>Every condition matters.</h3><div className="recovery-steps">{[{ label: 'Missed owner check-in', detail: time >= current.state.lastCheckIn + current.state.inactivity ? 'Inactivity period has elapsed' : `${duration(current.state.lastCheckIn + current.state.inactivity - time)} until eligible`, done: time >= current.state.lastCheckIn + current.state.inactivity }, { label: 'Independent guardian quorum', detail: `${current.state.approvalCount} of 2 required approvals`, done: current.state.approvalCount >= 2 }, { label: 'Owner cancellation window', detail: current.state.quorumAt ? `${duration(Math.max(0, current.state.quorumAt + current.state.challenge - time))} remaining` : 'Starts after second approval', done: !!current.state.quorumAt && time >= current.state.quorumAt + current.state.challenge }, { label: 'Beneficiary authorization', detail: current.state.status === 2 ? `${releaseCount[current.state.id] ?? 0} encrypted shares delivered` : 'Owner can intervene until finalization', done: current.state.status === 2 }].map((step, i) => <div className={`recovery-step ${step.done ? 'done' : ''}`} key={step.label}><span>{step.done ? <Check size={13}/> : i + 1}</span><div><strong>{step.label}</strong><small>{step.detail}</small></div></div>)}</div>
      <div className="acting-label">{config.mode === "local" && <select className="detail-actor-select" aria-label="Vault demo actor" value={actor?.address ?? ""} onChange={e => { setActor(config.actors.find(a => a.address === e.target.value)); setError(""); }}>{config.actors.map(a => <option key={a.address} value={a.address}>{a.name} · {a.role}</option>)}</select>}Acting as <strong>{actor?.name ?? 'No wallet connected'}</strong></div>
      {actor && same(actor.address, current.state.owner) && current.state.status !== 2 && <><button className="button primary full" disabled={!!busy} onClick={() => action('checkIn')}><Fingerprint size={17}/>{current.state.status === 1 ? 'I’m here — cancel recovery' : 'Check in now'}</button><p className="action-hint">Signed by the owner. Resets inactivity and cancels any pending request.</p></>}
      {actor && same(actor.address, current.state.beneficiary) && <>{current.state.status === 0 && <button className="button primary full" disabled={!!busy} onClick={() => action('requestRecovery')}><ShieldCheck size={17}/>Request recovery</button>}{current.state.status === 1 && <button className="button primary full" disabled={!!busy} onClick={() => action('finalizeRecovery')}><KeyRound size={17}/>Finalize recovery</button>}{current.state.status === 2 && <button className="button primary full" disabled={!!busy} onClick={decrypt}><LockKeyhole size={17}/>Decrypt inherited asset</button>}<p className="action-hint">The contract checks all conditions. Early attempts are rejected.</p></>}
      {actor && current.state.guardians.some(g => same(g, actor.address)) && <>{current.state.status === 1 && <><div className="attestation-note">Approve only after independently verifying the owner’s unavailability. Your signature attests to that verification.</div><button className="button primary full" disabled={!!busy || current.state.approved.some(g => same(g, actor.address))} onClick={() => action('approveRecovery')}><ShieldCheck size={17}/>{current.state.approved.some(g => same(g, actor.address)) ? 'Approval confirmed' : 'Attest & approve recovery'}</button></>}{current.state.status === 2 && <button className="button primary full" disabled={!!busy || !current.state.approved.some(g => same(g, actor.address))} onClick={release}><KeyRound size={17}/>Release encrypted share</button>}{current.state.status === 0 && <p className="action-hint">The vault is protected. The beneficiary must open an eligible request before guardians can approve.</p>}</>}
      {config.mode === 'local' && <div className="demo-controls"><span><Clock3 size={13}/>LOCAL DEMO CLOCK</span><p>Fast-forward the chain to demonstrate waiting periods.</p><div><button disabled={!!busy} onClick={() => run('Advancing chain clock', async () => { await api.clock(Math.max(1, current.state.lastCheckIn + current.state.inactivity - time + 1)); })}>Skip inactivity<ChevronRight size={13}/></button><button disabled={!!busy || !current.state.quorumAt} onClick={() => run('Advancing chain clock', async () => { await api.clock(Math.max(1, current.state.quorumAt + current.state.challenge - time + 1)); })}>Skip challenge<ChevronRight size={13}/></button></div></div>}
      <span className="detail-request">Request #{current.state.requestId} · Block #{block}</span>
      </div></div></Modal>}
    {help && <Modal title="A legacy with a safety net." eyebrow="THE HEIRLOOM PROTOCOL" onClose={() => setHelp(false)}><div className="help-content"><p>Heirloom protects a digital asset with encryption, independent guardians, and an on-chain recovery policy.</p>{[{ icon: LockKeyhole, title: 'Protect it on your device.', text: 'A fresh AES-256 key encrypts each asset. Its key is split into three shares, each encrypted for one guardian.' }, { icon: UsersRound, title: 'Share the responsibility.', text: 'Recovery requires a missed check-in and two guardian attestations. One guardian or the storage relay cannot reconstruct the key.' }, { icon: Clock3, title: 'Leave room to intervene.', text: 'The second approval opens a cancellation window. An owner check-in stops the attempt until the beneficiary finalizes.' }, { icon: KeyRound, title: 'Pass it on, privately.', text: 'After authorization, two guardians send recipient-encrypted shares. The beneficiary decrypts the inherited asset on their device.' }].map((item, i) => <div className="help-step" key={item.title}><span><item.icon size={20}/></span><div><small>0{i + 1}</small><h3>{item.title}</h3><p>{item.text}</p></div></div>)}<div className="trust-note"><CircleAlert size={17}/><p>Hackathon prototype. Two colluding guardians can bypass off-chain policy. Browser custody keys must be preserved; clearing browser storage loses that identity. The local chain is ephemeral. Use sample assets for the demo.</p></div><button className="button primary full" onClick={() => { setHelp(false); setPage('recovery'); }}>Explore recovery<ArrowRight size={16}/></button></div></Modal>}
    {inspection && <Modal title="Verified on Ethereum." eyebrow="TRANSACTION & NETWORK DETAILS" onClose={() => setInspection(undefined)}><div className="inspection">{Object.entries(inspection).map(([k, value]) => value !== undefined && <div key={k}><span>{k}</span><code>{String(value)}</code></div>)}{inspection.hash && config?.explorerUrl && <a className="button secondary" href={`${config.explorerUrl}/tx/${inspection.hash}`} target="_blank" rel="noreferrer">View on Etherscan<ExternalLink size={15}/></a>}</div></Modal>}
  </div>;
}
