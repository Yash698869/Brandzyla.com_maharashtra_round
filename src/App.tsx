import { useEffect, useState, useCallback, useRef } from 'react';
import {
  ShieldCheck,
  KeyRound,
  LockKeyhole,
  CircleCheck,
  Clock3,
  Download,
  ExternalLink,
  X,
  LoaderCircle,
  Check,
  Fingerprint,
  CircleAlert,
  ChevronRight,
  UsersRound,
} from 'lucide-react';
import { hexlify, randomBytes, verifyMessage } from 'ethers';
import { Brand } from './components/Brand';
import Modal from './components/Modal';
import CreateVault, { type CreateInput } from './components/CreateVault';
import DevDemoDrawer from './components/DevDemoDrawer';
import {
  getSessionUser,
  restoreSession,
  loginDemoActor,
  logoutUser,
  type UserAccount,
} from './lib/auth';
import { api } from './lib/api';
import {
  initializeChain,
  signerFor,
  writableContract,
  getVault,
  chainTime,
  history,
  friendlyError,
  transactionDetails,
  verifyDeployment,
  verifyReleaseFinality,
} from './lib/chain';
import {
  obtainIdentity,
  storedIdentity,
  persistPending,
  pendingRegistrations,
  clearPending,
} from './lib/identity';
import { registerWithRecovery, type PendingRegistration } from './lib/registration';
import { sealAsset, publicKeyHash, packageCommitment, releaseShare, recoverAsset } from './lib/crypto';
import { identityMessage, releaseMessage } from '../shared/protocol.mjs';
import type { Config, Actor, Vault, TimelineEvent, IdentityRecord, ProtectedPackage, AssetData } from './lib/types';
import { RouterProvider, useRouter } from './lib/router';
import LandingPage from './pages/LandingPage';
import SignUpPage from './pages/SignUpPage';
import LogInPage from './pages/LogInPage';
import OwnerWorkspace from './pages/OwnerWorkspace';
import BeneficiaryWorkspace from './pages/BeneficiaryWorkspace';
import GuardianWorkspace from './pages/GuardianWorkspace';
import AccessDenied from './pages/AccessDenied';

const short = (address = '') => `${address.slice(0, 6)}…${address.slice(-4)}`;
const same = (a = '', b = '') => a.toLowerCase() === b.toLowerCase();

function duration(seconds: number) {
  if (seconds >= 86400) return `${Math.ceil(seconds / 86400)} days`;
  if (seconds >= 3600) return `${Math.ceil(seconds / 3600)} hours`;
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} min`;
  return `${Math.max(0, Math.ceil(seconds))} sec`;
}

const statusLabel = (v: Vault) =>
  v.state.status === 2 ? 'Released' : v.state.status === 1 ? 'Recovery pending' : 'Protected';

function download(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function AppContent() {
  const { path, navigate, query } = useRouter();

  const [config, setConfig] = useState<Config>();
  const [actor, setActor] = useState<Actor>();
  const [currentUser, setCurrentUserState] = useState<UserAccount | null>(() => getSessionUser());
  const [sessionChecked, setSessionChecked] = useState(false);

  const [identities, setIdentities] = useState<IdentityRecord[]>([]);
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);

  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState('');
  const [boot, setBoot] = useState('Connecting to your vault');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [time, setTime] = useState(0);
  const [block, setBlock] = useState(0);
  const [releaseCount, setReleaseCount] = useState<Record<string, number>>({});
  const [decrypted, setDecrypted] = useState<{ id: string; asset: AssetData }>();
  const [inspection, setInspection] = useState<any>();
  const importRef = useRef<HTMLInputElement>(null);
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState<PendingRegistration[]>([]);
  const [lastHash, setLastHash] = useState('');

  const current = vaults.find(v => v.state.id === selected);
  const namespace = config ? `${config.chainId}:${config.contractAddress}:${config.deploymentId}` : '';
  const metadataKey = (c: Config) => `heirloom-labels:${c.deploymentId}`;
  const notify = (message: string) => {
    setToast(message);
  };
  const nameOf = (address: string) =>
    currentUser && same(currentUser.address, address)
      ? currentUser.name
      : config?.actors.find(a => same(a.address, address))?.name ?? short(address);

  const refresh = useCallback(async (c: Config) => {
    await verifyDeployment(c);
    const ns = `${c.chainId}:${c.contractAddress}:${c.deploymentId}`;
    const preserved = await pendingRegistrations(ns);
    for (const entry of preserved) {
      try {
        const state = await getVault(c, entry.package.binding.vaultId);
        if (state.commitment !== packageCommitment(entry.package)) continue;
        await api.savePackage(entry.package);
        const meta = JSON.parse(localStorage.getItem(metadataKey(c)) ?? '{}');
        meta[state.id] = { label: entry.label, category: entry.category, createdAt: entry.createdAt };
        localStorage.setItem(metadataKey(c), JSON.stringify(meta));
        await clearPending(ns, state.id);
      } catch {
        /* preserved for recovery */
      }
    }
    setPending(await pendingRegistrations(ns));
    const [packages, timeline, clock] = await Promise.all([api.packages(), history(c), chainTime()]);
    const meta = JSON.parse(localStorage.getItem(metadataKey(c)) ?? '{}');
    const loaded = await Promise.all(
      packages.map(async p => {
        try {
          const state = await getVault(c, p.binding.vaultId);
          if (state.commitment !== packageCommitment(p)) throw new Error('Package commitment mismatch');
          return {
            package: p,
            state,
            label: meta[state.id]?.label ?? `Protected vault ${short(state.id)}`,
            category: meta[state.id]?.category ?? 'Encrypted asset',
            createdAt: meta[state.id]?.createdAt ?? 0,
          } as Vault;
        } catch {
          return undefined;
        }
      })
    );
    setVaults(loaded.filter((v): v is Vault => !!v));
    setEvents(timeline);
    setTime(clock.timestamp);
    setBlock(clock.blockNumber);
    const counts: Record<string, number> = {};
    await Promise.all(
      loaded
        .filter((v): v is Vault => !!v && v.state.status === 2)
        .map(async v => {
          counts[v.state.id] = (await api.releases(v.state.id)).filter(
            r => r.release.requestId === v.state.requestId
          ).length;
        })
    );
    setReleaseCount(counts);
    setOffline(false);
  }, []);

  // Initialize config, restore session, prepare demo identities
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const c = await api.config();
        if (!live) return;
        setConfig(c);
        initializeChain(c);

        // Check & validate session with server
        const sessionUser = await restoreSession();
        if (!live) return;
        if (sessionUser) {
          setCurrentUserState(sessionUser);
          const matched = c.actors.find(a => same(a.address, sessionUser.address));
          setActor(
            matched || {
              address: sessionUser.address,
              name: sessionUser.name,
              role: sessionUser.role,
              initials: sessionUser.initials,
            }
          );
        } else {
          setCurrentUserState(null);
        }
        setSessionChecked(true);

        const existing = await api.identities();
        const enrolled = [...existing];
        if (c.mode === 'local') {
          setBoot('Preparing independent demo identities');
          for (const a of c.actors) {
            if (!live) return;
            const key = await storedIdentity(`${c.chainId}:${c.contractAddress}:${c.deploymentId}`, a.address);
            const found = existing.find(i => same(i.address, a.address));
            if (found && !key) continue;
            const identity =
              key ?? (await obtainIdentity(`${c.chainId}:${c.contractAddress}:${c.deploymentId}`, a.address));
            if (!found && live) {
              const signer = await signerFor(c, a.address);
              const record = {
                address: a.address,
                publicKey: identity.publicKey,
                signature: await signer.signMessage(identityMessage(c, a.address, identity.publicKey)),
              };
              if (!live) return;
              await api.enroll(record);
              enrolled.push(record);
            }
          }
        }
        if (!live) return;
        setIdentities(enrolled);
        await refresh(c);
        setBoot('');
      } catch (e) {
        if (live) {
          setBoot('');
          setOffline(true);
          setError(friendlyError(e));
          setSessionChecked(true);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!config || boot || (config.mode === 'public' && !actor)) return;
    const timer = setInterval(() => refresh(config).catch(() => setOffline(true)), 6000);
    return () => clearInterval(timer);
  }, [config, boot, actor, refresh]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setDecrypted(undefined);
  }, [actor?.address, selected]);

  function handleAuthSuccess(user: UserAccount) {
    setCurrentUserState(user);
    const matched = config?.actors.find(a => same(a.address, user.address));
    setActor(
      matched || {
        address: user.address,
        name: user.name,
        role: user.role,
        initials: user.initials,
      }
    );
    notify(`Welcome, ${user.name}!`);
    if (config) refresh(config);
  }

  async function handleLogout() {
    await logoutUser();
    setCurrentUserState(null);
    setActor(undefined);
    notify('Signed out successfully.');
    navigate('/');
  }

  async function handleSwitchDemoActor(selectedActor: Actor) {
    setActor(selectedActor);
    try {
      const switched = await loginDemoActor(selectedActor.address);
      setCurrentUserState(switched);
      const roleHome =
        switched.role === 'guardian'
          ? '/guardian'
          : switched.role === 'beneficiary'
          ? '/beneficiary'
          : '/owner';
      navigate(roleHome);
      notify(`Switched session to ${switched.name} (${switched.role})`);
      if (config) await refresh(config);
    } catch (err: any) {
      setError(err?.message || 'Failed to switch demo actor');
    }
  }

  async function run(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError('');
    try {
      await fn();
      if (config) await refresh(config);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy('');
    }
  }

  async function create(input: CreateInput, c = config!, owner = actor!) {
    const registry = await api.identities();
    for (const record of registry) {
      if (
        !same(
          verifyMessage(identityMessage(c, record.address, record.publicKey), record.signature),
          record.address
        )
      ) {
        throw new Error('Identity signature verification failed');
      }
    }
    const beneficiary = registry.find(i => same(i.address, input.beneficiary));
    if (!beneficiary) throw new Error('The beneficiary must enroll an encryption identity first');
    const guardians = input.guardians.map(address => {
      const identity = registry.find(i => same(i.address, address));
      if (!identity) throw new Error('Every guardian must enroll an encryption identity first');
      return { address, publicKey: identity.publicKey };
    });
    const id = hexlify(randomBytes(32));
    const p = await sealAsset(
      input.bytes,
      { name: input.name, mime: input.mime },
      guardians,
      {
        chainId: c.chainId,
        contract: c.contractAddress.toLowerCase(),
        vaultId: id,
        beneficiary: input.beneficiary.toLowerCase(),
        beneficiaryKeyHash: publicKeyHash(beneficiary.publicKey),
      },
      beneficiary.publicKey
    );
    const contract = await writableContract(c, owner.address);
    const ns = `${c.chainId}:${c.contractAddress}:${c.deploymentId}`;
    const entry = { package: p, label: input.label, category: input.category, createdAt: Date.now() };
    await registerWithRecovery(
      entry,
      async record => {
        await persistPending(ns, record);
        if (record.transactionHash) setLastHash(record.transactionHash);
      },
      async () =>
        contract.registerVault(
          id,
          input.beneficiary,
          input.guardians,
          input.inactivity,
          input.challenge,
          packageCommitment(p),
          p.binding.beneficiaryKeyHash
        ),
      () => api.savePackage(p).then(() => {}),
      () => clearPending(ns, id)
    );
    const meta = JSON.parse(localStorage.getItem(metadataKey(c)) ?? '{}');
    meta[id] = { label: input.label, category: input.category, createdAt: Date.now() };
    localStorage.setItem(metadataKey(c), JSON.stringify(meta));
    return id;
  }

  async function submitCreate(input: CreateInput) {
    setBusy('Encrypting & registering');
    setError('');
    try {
      const id = await create(input);
      setCreating(false);
      await refresh(config!);
      setSelected(id);
      notify('Your asset is encrypted. Recovery policy confirmed on-chain.');
    } catch (e) {
      throw new Error(friendlyError(e));
    } finally {
      setBusy('');
    }
  }

  async function samples() {
    await run('Creating sample vaults', async () => {
      const c = config!;
      const owner = c.actors.find(a => a.role === 'owner')!;
      const beneficiary = c.actors.find(a => a.role === 'beneficiary')!.address;
      const guardians = c.actors.filter(a => a.role === 'guardian').map(a => a.address);
      const sampleVaults = [
        {
          label: 'Letters for my family',
          category: 'Family memories',
          name: 'a-letter-for-sam.txt',
          text: 'Dear Sam,\n\nSome things should never get lost. The stories, the little moments, the things we built together.\n\nIf you are reading this, know that everything here was kept safe for you. Take care of each other.\n\nWith love,\nAlex',
        },
        {
          label: 'My digital instructions',
          category: 'Account access',
          name: 'digital-instructions.txt',
          text: 'HEIRLOOM SAMPLE — NO REAL CREDENTIALS\n\nFamily archive: example.com/family\nSample recovery phrase: this is sample data only\n\nAsk Maya about the photo collection and James about the important records.',
        },
        {
          label: 'Important documents',
          category: 'Personal documents',
          name: 'family-records.txt',
          text: 'HEIRLOOM SAMPLE FAMILY RECORDS\n\nEmergency contact: Sam Morgan\nFamily archive custodian: Priya Shah\n\nThese sample records demonstrate exact byte recovery from encrypted storage.',
        },
      ];
      for (const s of sampleVaults) {
        await create(
          {
            ...s,
            bytes: new TextEncoder().encode(s.text),
            mime: 'text/plain',
            beneficiary,
            guardians,
            inactivity: 60,
            challenge: 30,
          },
          c,
          owner
        );
      }
      notify('Three sample vaults created with real encryption and Hardhat transactions.');
    });
  }

  async function action(vault: Vault, method: 'requestRecovery' | 'approveRecovery' | 'finalizeRecovery' | 'checkIn') {
    if (!vault || !actor || !config) return;

    // Strict contract authorization check
    if (method === 'checkIn' && !same(actor.address, vault.state.owner)) {
      throw new Error(`Wallet mismatch: Connected wallet ${short(actor.address)} is not the vault owner (${short(vault.state.owner)}).`);
    }
    if ((method === 'requestRecovery' || method === 'finalizeRecovery') && !same(actor.address, vault.state.beneficiary)) {
      throw new Error(`Wallet mismatch: Connected wallet ${short(actor.address)} is not the designated beneficiary (${short(vault.state.beneficiary)}).`);
    }
    if (method === 'approveRecovery' && !vault.state.guardians.some(g => same(g, actor.address))) {
      throw new Error(`Wallet mismatch: Connected wallet ${short(actor.address)} is not a configured guardian.`);
    }

    await run(method === 'checkIn' ? 'Confirming check-in' : 'Confirming transaction', async () => {
      const contract = await writableContract(config, actor.address);
      const args =
        method === 'requestRecovery' || method === 'checkIn'
          ? [vault.state.id]
          : [vault.state.id, vault.state.requestId];
      await contract[method].staticCall(...args);
      const tx = await contract[method](...args);
      setLastHash(tx.hash);
      await tx.wait(1, 90000);
      notify(
        method === 'checkIn'
          ? 'Check-in confirmed on Ethereum. Any pending recovery claim is cancelled.'
          : 'Transaction confirmed on Ethereum.'
      );
    });
  }

  async function release(vault: Vault) {
    if (!vault || !actor || !config) return;

    if (!vault.state.guardians.some(g => same(g, actor.address))) {
      throw new Error(`Wallet mismatch: Connected wallet ${short(actor.address)} is not a guardian for this vault.`);
    }

    await run('Encrypting guardian release', async () => {
      const state = await getVault(config, vault.state.id);
      if (state.status !== 2 || !state.approved.some(g => same(g, actor.address))) {
        throw new Error('Finalize recovery and approve with this guardian before releasing its share');
      }
      await verifyReleaseFinality(config, state.id, state.requestId);
      const identity = await storedIdentity(namespace, actor.address);
      if (!identity) {
        throw new Error('This guardian encryption key is on its original browser. Use that device.');
      }
      const r = await releaseShare(
        vault.package,
        actor.address,
        identity,
        vault.package.beneficiaryPublicKey,
        state.requestId
      );
      const signer = await signerFor(config, actor.address);
      await api.release(r, await signer.signMessage(releaseMessage(r)));
      notify('Your share was encrypted to the beneficiary. The relay cannot decrypt it.');
    });
  }

  async function decrypt(vault: Vault) {
    if (!vault || !actor || !config) return;

    if (!same(actor.address, vault.state.beneficiary)) {
      throw new Error(`Wallet mismatch: Connected wallet ${short(actor.address)} is not the designated beneficiary (${short(vault.state.beneficiary)}).`);
    }

    await run('Verifying & decrypting', async () => {
      const state = await getVault(config, vault.state.id);
      if (state.status !== 2 || !same(state.beneficiary, actor.address)) {
        throw new Error('Only the designated beneficiary can decrypt after finalization');
      }
      const identity = await storedIdentity(namespace, actor.address);
      if (!identity) {
        throw new Error('Your beneficiary encryption key is on its original browser. Use that device.');
      }
      if (
        publicKeyHash(identity.publicKey) !== state.beneficiaryKeyHash ||
        packageCommitment(vault.package) !== state.commitment
      ) {
        throw new Error('On-chain key or package commitment mismatch');
      }
      const records = (await api.releases(state.id)).filter(r => r.release.requestId === state.requestId);
      for (const r of records) {
        if (
          !state.approved.some(a => same(a, r.release.guardian)) ||
          !same(verifyMessage(releaseMessage(r.release), r.signature), r.release.guardian)
        ) {
          throw new Error('Guardian signature or approval failed verification');
        }
      }
      const asset = await recoverAsset(vault.package, records.map(r => r.release), identity, state.requestId);
      setDecrypted({ id: state.id, asset });
      notify('Asset decrypted locally. Your inherited document is ready.');
    });
  }

  async function importKit(file?: File) {
    if (!file || !config) return;
    await run('Verifying recovery kit', async () => {
      if (file.size > 15 * 1024 * 1024) throw new Error('Recovery kit is too large');
      const kit = JSON.parse(await file.text());
      if (kit.format !== 'heirloom-recovery-kit' || kit.version !== 1) {
        throw new Error('Unsupported recovery kit');
      }
      const p: ProtectedPackage = kit.package;
      if (p.binding.chainId !== config.chainId || !same(p.binding.contract, config.contractAddress)) {
        throw new Error('This recovery kit belongs to another chain or contract');
      }
      const state = await getVault(config, p.binding.vaultId);
      if (
        packageCommitment(p) !== state.commitment ||
        publicKeyHash(p.beneficiaryPublicKey) !== state.beneficiaryKeyHash
      ) {
        throw new Error('Recovery kit does not match its on-chain commitments');
      }
      await api.savePackage(p);
      setSelected(state.id);
      notify('Recovery kit verified against Ethereum and imported.');
    });
  }

  // 1. PUBLIC ROUTES
  if (path === '/' || path === '') {
    return <LandingPage currentUser={currentUser} config={config} onLogout={handleLogout} />;
  }

  if (path === '/signup') {
    if (currentUser) {
      const roleHome =
        currentUser.role === 'guardian'
          ? '/guardian'
          : currentUser.role === 'beneficiary'
          ? '/beneficiary'
          : '/owner';
      navigate(roleHome, true);
      return null;
    }
    return <SignUpPage config={config} onSuccess={handleAuthSuccess} />;
  }

  if (path === '/login') {
    if (currentUser) {
      const roleHome =
        currentUser.role === 'guardian'
          ? '/guardian'
          : currentUser.role === 'beneficiary'
          ? '/beneficiary'
          : '/owner';
      navigate(query.redirect || roleHome, true);
      return null;
    }
    return <LogInPage config={config} onSuccess={handleAuthSuccess} />;
  }

  // 2. SESSION CHECKING SCREEN
  if (!sessionChecked) {
    return (
      <div className="loading-screen full-page">
        <Brand small />
        <LoaderCircle className="spin" size={28} />
        <h2>Restoring session...</h2>
        <p>Verifying cryptographic custody keys.</p>
      </div>
    );
  }

  // 3. UNAUTHENTICATED REDIRECT
  if (!currentUser) {
    const targetUrl = `/login?redirect=${encodeURIComponent(path)}`;
    navigate(targetUrl, true);
    return null;
  }

  // 4. GENERIC /app ROUTE REDIRECTS TO ROLE HOME
  if (path === '/app' || path.startsWith('/app/')) {
    const roleHome =
      currentUser.role === 'guardian'
        ? '/guardian'
        : currentUser.role === 'beneficiary'
        ? '/beneficiary'
        : '/owner';
    navigate(roleHome, true);
    return null;
  }

  // Calculate real assignments for connected wallet
  const hasOwned = vaults.some(v => same(v.state.owner, currentUser.address));
  const hasBeneficiary = vaults.some(v => same(v.state.beneficiary, currentUser.address));
  const hasGuardian = vaults.some(v => v.state.guardians.some(g => same(g, currentUser.address)));

  // 5. OWNER WORKSPACE ROUTE
  if (path.startsWith('/owner')) {
    if (currentUser.role !== 'owner' && !hasOwned) {
      return (
        <AccessDenied
          requiredRole="owner"
          currentUser={currentUser}
          onLogout={handleLogout}
        />
      );
    }

    return (
      <>
        <OwnerWorkspace
          currentUser={currentUser}
          actor={actor || { address: currentUser.address, name: currentUser.name, role: 'owner', initials: currentUser.initials }}
          config={config!}
          vaults={vaults}
          events={events}
          identities={identities}
          time={time}
          block={block}
          busy={busy}
          offline={offline}
          onRefresh={() => refresh(config!)}
          onCreateVault={() => setCreating(true)}
          onSelectVault={setSelected}
          onCheckIn={v => action(v, 'checkIn')}
          onInspectTx={async hash => setInspection(await transactionDetails(hash))}
          onOpenHelp={() => setHelp(true)}
          onLogout={handleLogout}
          onLoadSamples={samples}
          onImportKit={() => importRef.current?.click()}
        />

        {config?.mode === 'local' && (
          <DevDemoDrawer
            config={config}
            currentActorAddress={actor?.address}
            onSwitchActor={handleSwitchDemoActor}
          />
        )}
        {renderModals()}
      </>
    );
  }

  // 6. BENEFICIARY WORKSPACE ROUTE
  if (path.startsWith('/beneficiary')) {
    if (currentUser.role !== 'beneficiary' && !hasBeneficiary) {
      return (
        <AccessDenied
          requiredRole="beneficiary"
          currentUser={currentUser}
          onLogout={handleLogout}
        />
      );
    }

    return (
      <>
        <BeneficiaryWorkspace
          currentUser={currentUser}
          actor={actor || { address: currentUser.address, name: currentUser.name, role: 'beneficiary', initials: currentUser.initials }}
          config={config!}
          vaults={vaults}
          events={events}
          time={time}
          block={block}
          busy={busy}
          offline={offline}
          decrypted={decrypted}
          onRefresh={() => refresh(config!)}
          onSelectVault={setSelected}
          onRequestRecovery={v => action(v, 'requestRecovery')}
          onFinalizeRecovery={v => action(v, 'finalizeRecovery')}
          onDecryptVault={v => decrypt(v)}
          onInspectTx={async hash => setInspection(await transactionDetails(hash))}
          onOpenHelp={() => setHelp(true)}
          onLogout={handleLogout}
        />

        {config?.mode === 'local' && (
          <DevDemoDrawer
            config={config}
            currentActorAddress={actor?.address}
            onSwitchActor={handleSwitchDemoActor}
          />
        )}
        {renderModals()}
      </>
    );
  }

  // 7. GUARDIAN WORKSPACE ROUTE
  if (path.startsWith('/guardian')) {
    if (currentUser.role !== 'guardian' && !hasGuardian) {
      return (
        <AccessDenied
          requiredRole="guardian"
          currentUser={currentUser}
          onLogout={handleLogout}
        />
      );
    }

    return (
      <>
        <GuardianWorkspace
          currentUser={currentUser}
          actor={actor || { address: currentUser.address, name: currentUser.name, role: 'guardian', initials: currentUser.initials }}
          config={config!}
          vaults={vaults}
          events={events}
          time={time}
          block={block}
          busy={busy}
          offline={offline}
          onRefresh={() => refresh(config!)}
          onSelectVault={setSelected}
          onApproveRecovery={v => action(v, 'approveRecovery')}
          onReleaseShare={v => release(v)}
          onInspectTx={async hash => setInspection(await transactionDetails(hash))}
          onOpenHelp={() => setHelp(true)}
          onLogout={handleLogout}
        />

        {config?.mode === 'local' && (
          <DevDemoDrawer
            config={config}
            currentActorAddress={actor?.address}
            onSwitchActor={handleSwitchDemoActor}
          />
        )}
        {renderModals()}
      </>
    );
  }

  // Fallback: navigate to role home
  const defaultHome =
    currentUser.role === 'guardian'
      ? '/guardian'
      : currentUser.role === 'beneficiary'
      ? '/beneficiary'
      : '/owner';
  navigate(defaultHome, true);
  return null;

  function renderModals() {
    return (
      <>
        {busy && !creating && (
          <div className="busy-pill" role="status">
            <LoaderCircle size={17} className="spin" />
            {busy}…
          </div>
        )}

        {toast && (
          <div className="toast" role="status">
            <CircleCheck size={19} />
            {toast}
            <button aria-label="Dismiss notification" onClick={() => setToast('')}>
              <X size={14} />
            </button>
          </div>
        )}

        <input
          ref={importRef}
          className="visually-hidden"
          type="file"
          accept="application/json,.json"
          onChange={e => {
            importKit(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        {creating && config && actor && (
          <CreateVault
            config={config}
            identities={identities}
            account={actor.address}
            busy={busy}
            onClose={() => {
              if (!busy) setCreating(false);
            }}
            onCreate={submitCreate}
          />
        )}

        {current && config && (
          <Modal
            title={current.label}
            eyebrow="ENCRYPTED VAULT"
            onClose={() => {
              if (!busy) setSelected(undefined);
            }}
            wide
          >
            {error && (
              <div className="inline-error" role="alert">
                {error}
              </div>
            )}
            <div className="vault-detail-grid">
              <div className="vault-detail-main">
                <div className="detail-asset">
                  <span className="asset-icon color-0">
                    <LockKeyhole size={26} />
                  </span>
                  <div>
                    <strong>{current.category}</strong>
                    <span>Encrypted on client device · AES-256-GCM</span>
                  </div>
                  <span className={`status-badge status-${current.state.status}`}>
                    <span />
                    {statusLabel(current)}
                  </span>
                </div>

                <div className="detail-info">
                  <div>
                    <span>Vault Owner</span>
                    <strong>{nameOf(current.state.owner)}</strong>
                    <small>{short(current.state.owner)}</small>
                  </div>
                  <div>
                    <span>Beneficiary</span>
                    <strong>{nameOf(current.state.beneficiary)}</strong>
                    <small>{short(current.state.beneficiary)}</small>
                  </div>
                  <div>
                    <span>Authorization</span>
                    <strong>2 of 3 guardians</strong>
                    <small>Independent attestations required</small>
                  </div>
                  <div>
                    <span>Check-in period</span>
                    <strong>{duration(current.state.inactivity)}</strong>
                    <small>Cancellation window: {duration(current.state.challenge)}</small>
                  </div>
                </div>

                <div className="detail-guardians">
                  <h4>
                    <UsersRound size={16} />
                    Guardian approvals
                  </h4>
                  {current.state.guardians.map((g, i) => (
                    <div key={g}>
                      <span className={`mini-avatar ga-${i}`}>{nameOf(g)[0]}</span>
                      <strong>{nameOf(g)}</strong>
                      <small>{short(g)}</small>
                      <span
                        className={
                          current.state.approved.some(a => same(a, g))
                            ? 'approved-check'
                            : 'approval-wait'
                        }
                      >
                        {current.state.approved.some(a => same(a, g)) ? (
                          <>
                            <Check size={13} />
                            Approved
                          </>
                        ) : (
                          <>
                            <Clock3 size={12} />
                            Waiting
                          </>
                        )}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="ciphertext-section">
                  <h4>
                    <LockKeyhole size={15} />
                    Relay Encrypted Storage
                  </h4>
                  <code>{current.package.ciphertext.slice(0, 190)}…</code>
                  <p>Encrypted bytes only. Zero master key access on server.</p>
                </div>

                {decrypted?.id === current.state.id && (
                  <div className="decrypted-section">
                    <div>
                      <CircleCheck size={18} />
                      <strong>Recovered: {decrypted.asset.name}</strong>
                    </div>
                    {decrypted.asset.mime.startsWith('text/') ? (
                      <pre>{new TextDecoder().decode(decrypted.asset.bytes)}</pre>
                    ) : (
                      <p>File recovered ({decrypted.asset.bytes.length.toLocaleString()} bytes).</p>
                    )}
                    <button
                      className="button secondary"
                      onClick={() => {
                        const a = document.createElement('a');
                        const url = URL.createObjectURL(
                          new Blob([decrypted.asset.bytes], { type: decrypted.asset.mime })
                        );
                        a.href = url;
                        a.download = decrypted.asset.name;
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                      }}
                    >
                      <Download size={15} />
                      Download inherited asset
                    </button>
                  </div>
                )}

                <button
                  className="text-button kit-button"
                  onClick={() =>
                    download(
                      { format: 'heirloom-recovery-kit', version: 1, package: current.package },
                      `heirloom-kit-${current.state.id.slice(2, 10)}.json`
                    )
                  }
                >
                  <Download size={15} />
                  Export encrypted recovery kit
                </button>
              </div>

              <div className="recovery-panel">
                <span className="eyebrow">RECOVERY SAFEGUARDS</span>
                <h3>Contract Safeguards</h3>
                <div className="recovery-steps">
                  {[
                    {
                      label: 'Missed owner check-in',
                      detail:
                        time >= current.state.lastCheckIn + current.state.inactivity
                          ? 'Inactivity period has elapsed'
                          : `${duration(current.state.lastCheckIn + current.state.inactivity - time)} until eligible`,
                      done: time >= current.state.lastCheckIn + current.state.inactivity,
                    },
                    {
                      label: 'Independent guardian quorum',
                      detail: `${current.state.approvalCount} of 2 required approvals`,
                      done: current.state.approvalCount >= 2,
                    },
                    {
                      label: 'Owner cancellation window',
                      detail: current.state.quorumAt
                        ? `${duration(
                            Math.max(0, current.state.quorumAt + current.state.challenge - time)
                          )} remaining`
                        : 'Starts after second approval',
                      done:
                        !!current.state.quorumAt &&
                        time >= current.state.quorumAt + current.state.challenge,
                    },
                    {
                      label: 'Beneficiary authorization',
                      detail:
                        current.state.status === 2
                          ? `${releaseCount[current.state.id] ?? 0} encrypted shares delivered`
                          : 'Owner can intervene until finalization',
                      done: current.state.status === 2,
                    },
                  ].map((step, i) => (
                    <div className={`recovery-step ${step.done ? 'done' : ''}`} key={step.label}>
                      <span>{step.done ? <Check size={13} /> : i + 1}</span>
                      <div>
                        <strong>{step.label}</strong>
                        <small>{step.detail}</small>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="wallet-permission-status-box">
                  <span>Connected wallet:</span>
                  <code>{short(currentUser?.address ?? '')}</code>
                </div>

                {/* OWNER ACTIONS */}
                {currentUser && same(currentUser.address, current.state.owner) ? (
                  current.state.status !== 2 && (
                    <>
                      <button
                        className="button primary full"
                        disabled={!!busy}
                        onClick={() => action(current, 'checkIn')}
                      >
                        <Fingerprint size={17} />
                        {current.state.status === 1 ? 'I’m here — cancel recovery' : 'Check in now'}
                      </button>
                      <p className="action-hint">
                        Signed by the owner. Resets inactivity and cancels any pending request.
                      </p>
                    </>
                  )
                ) : (
                  current.state.status === 1 && (
                    <div className="permission-disabled-note">
                      <span>Owner check-in disabled: Connected wallet is not the vault owner.</span>
                    </div>
                  )
                )}

                {/* BENEFICIARY ACTIONS */}
                {currentUser && same(currentUser.address, current.state.beneficiary) ? (
                  <>
                    {current.state.status === 0 && (
                      <button
                        className="button primary full"
                        disabled={!!busy || time < current.state.lastCheckIn + current.state.inactivity}
                        onClick={() => action(current, 'requestRecovery')}
                      >
                        <ShieldCheck size={17} />
                        {time >= current.state.lastCheckIn + current.state.inactivity
                          ? 'Request recovery'
                          : `Eligible in ${duration(current.state.lastCheckIn + current.state.inactivity - time)}`}
                      </button>
                    )}
                    {current.state.status === 1 && (
                      <button
                        className="button primary full"
                        disabled={
                          !!busy ||
                          current.state.approvalCount < 2 ||
                          !current.state.quorumAt ||
                          time < current.state.quorumAt + current.state.challenge
                        }
                        onClick={() => action(current, 'finalizeRecovery')}
                      >
                        <KeyRound size={17} />
                        Finalize recovery
                      </button>
                    )}
                    {current.state.status === 2 && (
                      <button className="button primary full" disabled={!!busy} onClick={() => decrypt(current)}>
                        <LockKeyhole size={17} />
                        Decrypt inherited asset
                      </button>
                    )}
                  </>
                ) : (
                  current.state.status !== 2 && (
                    <div className="permission-disabled-note">
                      <span>Beneficiary actions disabled: Connected wallet is not the designated heir.</span>
                    </div>
                  )
                )}

                {/* GUARDIAN ACTIONS */}
                {currentUser && current.state.guardians.some(g => same(g, currentUser.address)) ? (
                  <>
                    {current.state.status === 1 && (
                      <>
                        <div className="attestation-note">
                          Approve only after independently verifying the owner’s unavailability.
                        </div>
                        <button
                          className="button primary full"
                          disabled={
                            !!busy || current.state.approved.some(g => same(g, currentUser.address))
                          }
                          onClick={() => action(current, 'approveRecovery')}
                        >
                          <ShieldCheck size={17} />
                          {current.state.approved.some(g => same(g, currentUser.address))
                            ? 'Approval confirmed'
                            : 'Attest & approve recovery'}
                        </button>
                      </>
                    )}
                    {current.state.status === 2 && (
                      <button
                        className="button primary full"
                        disabled={
                          !!busy || !current.state.approved.some(g => same(g, currentUser.address))
                        }
                        onClick={() => release(current)}
                      >
                        <KeyRound size={17} />
                        Release encrypted share
                      </button>
                    )}
                  </>
                ) : null}

                {/* DEMO FAST-FORWARD CONTROLS (Local chain only) */}
                {config.mode === 'local' && (
                  <div className="demo-controls">
                    <span>
                      <Clock3 size={13} />
                      LOCAL DEMO CLOCK
                    </span>
                    <p>Fast-forward local chain time to evaluate waiting periods.</p>
                    <div>
                      <button
                        disabled={!!busy}
                        onClick={() =>
                          run('Advancing chain clock', async () => {
                            await api.clock(
                              Math.max(1, current.state.lastCheckIn + current.state.inactivity - time + 1)
                            );
                          })
                        }
                      >
                        Skip inactivity
                        <ChevronRight size={13} />
                      </button>
                      <button
                        disabled={!!busy || !current.state.quorumAt}
                        onClick={() =>
                          run('Advancing chain clock', async () => {
                            await api.clock(
                              Math.max(1, current.state.quorumAt + current.state.challenge - time + 1)
                            );
                          })
                        }
                      >
                        Skip challenge
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  </div>
                )}

                <span className="detail-request">
                  Request #{current.state.requestId} · Block #{block}
                </span>
              </div>
            </div>
          </Modal>
        )}

        {help && (
          <Modal
            title="A legacy with a safety net."
            eyebrow="THE HEIRLOOM PROTOCOL"
            onClose={() => setHelp(false)}
          >
            <div className="help-content">
              <p>
                Heirloom protects a digital asset with client-side encryption, independent guardians, and on-chain recovery policy.
              </p>
              {[
                {
                  icon: LockKeyhole,
                  title: 'Protect it on your device.',
                  text: 'A fresh AES-256 key encrypts each asset. Its key is split into three shares, each encrypted for one guardian.',
                },
                {
                  icon: UsersRound,
                  title: 'Share the responsibility.',
                  text: 'Recovery requires a missed check-in and two guardian attestations. One guardian or the storage relay cannot reconstruct the key.',
                },
                {
                  icon: Clock3,
                  title: 'Leave room to intervene.',
                  text: 'The second approval opens a cancellation window. An owner check-in stops the attempt until the beneficiary finalizes.',
                },
                {
                  icon: KeyRound,
                  title: 'Pass it on, privately.',
                  text: 'After authorization, two guardians send recipient-encrypted shares. The beneficiary decrypts the inherited asset on their device.',
                },
              ].map((item, i) => (
                <div className="help-step" key={item.title}>
                  <span>
                    <item.icon size={20} />
                  </span>
                  <div>
                    <small>0{i + 1}</small>
                    <h3>{item.title}</h3>
                    <p>{item.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </Modal>
        )}

        {inspection && (
          <Modal
            title={config?.mode === 'local' ? 'Verified on Hardhat.' : 'Verified on Ethereum.'}
            eyebrow="TRANSACTION & NETWORK DETAILS"
            onClose={() => setInspection(undefined)}
          >
            <div className="inspection">
              {Object.entries(inspection).map(
                ([k, value]) =>
                  value !== undefined && (
                    <div key={k}>
                      <span>{k}</span>
                      <code>{String(value)}</code>
                    </div>
                  )
              )}
              {inspection.hash && config?.explorerUrl && (
                <a
                  className="button secondary"
                  href={`${config.explorerUrl}/tx/${inspection.hash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on Etherscan
                  <ExternalLink size={15} />
                </a>
              )}
            </div>
          </Modal>
        )}
      </>
    );
  }
}

export default function App() {
  return (
    <RouterProvider>
      <AppContent />
    </RouterProvider>
  );
}
