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
  FolderLock,
  Network,
  Wallet,
} from 'lucide-react';
import { hexlify, randomBytes, verifyMessage, ZeroAddress, ZeroHash } from 'ethers';
import { Brand } from './components/Brand';
import Modal from './components/Modal';
import CreateVault, { type CreateInput } from './components/CreateVault';
import DevDemoDrawer from './components/DevDemoDrawer';
import CustodyDialog from './components/CustodyDialog';
import {
  getSessionUser,
  restoreSession,
  loginDemoActor,
  logoutUser,
  formatActorName,
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
  connectWallet,
  transactionDetails,
  verifyDeployment,
  verifyReleaseFinality,
  watchWalletChanges,
} from './lib/chain';
import {
  obtainIdentity,
  storedIdentity,
  custodyRecord,
  createBackedStoredIdentity,
  verifyStoredBackup,
  restoreStoredIdentity,
  walletCustodyStatus,
  persistPending,
  pendingRegistrations,
  clearPending,
} from './lib/identity';
import {
  custodyStep,
  enrollmentMatches,
  needsCustodyKey,
  type CustodyAction,
} from './lib/custody-flow';
import type { IdentityBackup } from './lib/identity-backup';
import {
  registerWithRecovery,
  reconcilePendingRegistration,
  recoveryGuidance,
  buildRecoveryKit,
  parseRecoveryKit,
  verifyRegisteredKit,
  isVaultNotFound,
  downloadRecoveryKit,
  type PendingRegistration,
  type RecoveryKit,
} from './lib/registration';
import { sealAsset, publicKeyHash, packageCommitment, releaseShare, recoverAsset } from './lib/crypto';
import { isBeneficiary, selectedRecipient, beneficiaryDeadline, canRequest, canFinalize } from './lib/workspace-policy';
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
  const [releaseGuardians, setReleaseGuardians] = useState<Record<string, string[]>>({});
  const [decrypted, setDecrypted] = useState<{ id: string; asset: AssetData }>();
  const [inspection, setInspection] = useState<any>();
  const importRef = useRef<HTMLInputElement>(null);
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState<PendingRegistration[]>([]);
  const [pendingMismatch, setPendingMismatch] = useState<string[]>([]);
  const [lastHash, setLastHash] = useState('');
  const [custodyOpen, setCustodyOpen] = useState(false);
  const [custodyLocal, setCustodyLocal] = useState<Awaited<ReturnType<typeof custodyRecord>>>();
  const [custodyEnrolled, setCustodyEnrolled] = useState(false);

  const current = vaults.find(v => v.state.id === selected);
  const deliveredGuardians = current ? releaseGuardians[current.state.id] ?? [] : [];
  const guidance = current ? recoveryGuidance(current.state, actor?.address, time, deliveredGuardians) : undefined;
  const namespace = config ? `${config.chainId}:${config.contractAddress}:${config.deploymentId}` : '';
  const custodyContext = config && actor ? { chainId: config.chainId, contractAddress: config.contractAddress, deploymentId: config.deploymentId, address: actor.address } : undefined;
  const custodyStatus = config?.mode === 'public' && actor ? custodyStep(custodyEnrolled, custodyLocal) : undefined;
  const custodyBlocked = config?.mode === 'public' && custodyStatus !== 'ready' && custodyStatus !== 'legacy';
  const custodyActionBlocked = (action: CustodyAction) => custodyBlocked && needsCustodyKey(action);
  const metadataKey = (c: Config) => `heirloom-labels:${c.deploymentId}`;

  const notify = (message: string) => {
    setToast(message);
  };
  const exportKit = (kit: RecoveryKit, filename: string) => {
    setError('');
    setLastHash('');
    try {
      downloadRecoveryKit(kit, filename);
      notify('Recovery kit download requested. Save the file; it does not contain browser custody keys.');
    } catch (e) {
      setError(friendlyError(e));
    }
  };
  const nameOf = (address: string) => {
    if (currentUser && same(currentUser.address, address)) return formatActorName(currentUser.name);
    const identity = identities.find(i => same(i.address, address));
    if (identity?.name) return formatActorName(identity.name);
    const actor = config?.actors.find(a => same(a.address, address));
    return actor?.name ? formatActorName(actor.name) : short(address);
  };

  const refresh = useCallback(async (c: Config) => {
    await verifyDeployment(c);
    const ns = `${c.chainId}:${c.contractAddress}:${c.deploymentId}`;
    const preserved = await pendingRegistrations(ns);
    const mismatches: string[] = [];
    for (const entry of preserved) {
      try {
        const result = await reconcilePendingRegistration(
          entry,
          () => getVault(c, entry.package.binding.vaultId),
          () => api.savePackage(entry.package).then(() => {}),
          async state => {
            const meta = JSON.parse(localStorage.getItem(metadataKey(c)) ?? '{}');
            meta[state.id] = { label: entry.label, category: entry.category, createdAt: entry.createdAt };
            localStorage.setItem(metadataKey(c), JSON.stringify(meta));
            await clearPending(ns, state.id);
          }
        );
        if (result === 'mismatch') mismatches.push(entry.package.binding.vaultId);
      } catch {
        /* Keep failed relay writes or chain reads for a later retry. */
      }
    }
    setPending(await pendingRegistrations(ns));
    setPendingMismatch(mismatches);
    const clock = await chainTime(c);
    const [packages, timeline, enrolled] = await Promise.all([
      api.packages(),
      history(c, clock.blockNumber),
      api.identities(),
    ]);
    const meta = JSON.parse(localStorage.getItem(metadataKey(c)) ?? '{}');
    const loaded = await Promise.all(
      packages.map(async p => {
        try {
          const state = await getVault(c, p.binding.vaultId, clock.blockNumber);
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
    setIdentities(enrolled);
    const deliveries: Record<string, string[]> = {};
    const counts: Record<string, number> = {};
    await Promise.all(
      loaded
        .filter((v): v is Vault => !!v && v.state.status === 2)
        .map(async v => {
          const rels = (await api.releases(v.state.id)).filter(
            r => r.release.requestId === v.state.requestId
          );
          deliveries[v.state.id] = [...new Set(rels.map(r => r.release.guardian.toLowerCase()))];
          counts[v.state.id] = deliveries[v.state.id].length;
        })
    );
    setReleaseGuardians(deliveries);
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
        const sessionUser = await restoreSession(c);
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
    if (config?.mode !== 'public') return;
    return watchWalletChanges(window.ethereum, () => {
      setActor(undefined);
      setDecrypted(undefined);
      setOffline(true);
      setLastHash('');
      setError('Wallet account or network changed. Reconnect your wallet before continuing.');
    });
  }, [config?.mode]);

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
    setToast('');
    setLastHash('');
    try {
      await fn();
      if (config) {
        try {
          await refresh(config);
        } catch {
          setOffline(true);
          setError('The action completed, but the latest chain state could not be loaded. Retry the connection.');
        }
      }
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
    if (!c.abi.some(entry => entry.type === 'function' && entry.name === 'registerSuccessionVault')) throw new Error('This deployment supports version-1 vaults only. Redeploy the Succession Graph contract to create version-2 vaults.');
    const beneficiary = registry.find(i => same(i.address, input.beneficiary));
    if (!beneficiary) throw new Error('The beneficiary must enroll an encryption identity first');
    const backup = input.backupBeneficiary ? registry.find(i => same(i.address, input.backupBeneficiary)) : undefined;
    if (input.backupBeneficiary && !backup) throw new Error('The backup beneficiary must enroll an encryption identity first');
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
        backupBeneficiary: backup?.address.toLowerCase() ?? ZeroAddress,
        backupBeneficiaryKeyHash: backup ? publicKeyHash(backup.publicKey) : ZeroHash,
        inactivity: input.inactivity,
        challenge: input.challenge,
        backupWaitingDuration: backup ? input.backupWaitingDuration : 0,
      },
      beneficiary.publicKey,
      backup?.publicKey
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
        contract.registerSuccessionVault(
          id,
          { beneficiary: input.beneficiary, backupBeneficiary: backup?.address ?? ZeroAddress,
            guardians: input.guardians, inactivity: input.inactivity, challenge: input.challenge,
            backupWaitingDuration: backup ? input.backupWaitingDuration : 0,
            beneficiaryKeyHash: p.binding.beneficiaryKeyHash, backupBeneficiaryKeyHash: p.binding.backupBeneficiaryKeyHash },
          packageCommitment(p)
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
    setLastHash('');
    try {
      const id = await create(input);
      setCreating(false);
      await refresh(config!);
      setSelected(id);
      notify('Your asset is encrypted. Recovery policy confirmed on-chain.');
    } catch (e) {
      setPending(await pendingRegistrations(namespace));
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
            backupBeneficiary: c.actors.filter(a => a.role === 'beneficiary')[1]?.address ?? '',
            backupWaitingDuration: 60,
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

    await run(method === 'checkIn' ? 'Confirming check-in' : 'Confirming transaction', async () => {
      // Strict contract authorization check
      if (method === 'checkIn' && !same(actor.address, vault.state.owner)) {
        throw new Error(`Wallet mismatch: Connected wallet ${short(actor.address)} is not the vault owner (${short(vault.state.owner)}).`);
      }
      if ((method === 'requestRecovery' && !isBeneficiary(vault.state, actor.address)) ||
          (method === 'finalizeRecovery' && !same(actor.address, selectedRecipient(vault.state)))) {
        throw new Error('Wallet mismatch: only a configured beneficiary can request, and only the selected request beneficiary can finalize.');
      }
      if (method === 'approveRecovery' && !vault.state.guardians.some(g => same(g, actor.address))) {
        throw new Error(`Wallet mismatch: Connected wallet ${short(actor.address)} is not a configured guardian.`);
      }
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

    await run('Encrypting guardian release', async () => {
      if (!vault.state.guardians.some(g => same(g, actor.address))) {
        throw new Error(`Wallet mismatch: Connected wallet ${short(actor.address)} is not a guardian for this vault.`);
      }
      const state = await getVault(config, vault.state.id);
      if (state.status !== 2 || !state.approved.some(g => same(g, actor.address))) {
        throw new Error('Finalize recovery and approve with this guardian before releasing its share');
      }
      await verifyReleaseFinality(config, state.id, state.requestId);
      verifyRegisteredKit(buildRecoveryKit(vault.package), config, state);
      const recipient = selectedRecipient(state);
      const recipientKey = same(recipient, state.beneficiary) ? vault.package.beneficiaryPublicKey : vault.package.backupBeneficiaryPublicKey;
      if (!recipientKey || publicKeyHash(recipientKey) !== (same(recipient, state.beneficiary) ? state.beneficiaryKeyHash : state.backupBeneficiaryKeyHash)) throw new Error('Selected beneficiary key commitment mismatch');
      const identity = await storedIdentity(namespace, actor.address);
      if (!identity) {
        throw new Error('This guardian encryption key is on its original browser. Use that device.');
      }
      const r = await releaseShare(
        vault.package,
        actor.address,
        identity,
        recipientKey,
        state.requestId,
        recipient
      );
      const signer = await signerFor(config, actor.address);
      await api.release(r, await signer.signMessage(releaseMessage(r)));
      notify('Your share was encrypted to the beneficiary. The relay cannot decrypt it.');
    });
  }

  async function decrypt(vault: Vault) {
    if (!vault || !actor || !config) return;

    await run('Verifying & decrypting', async () => {
      if (!same(actor.address, selectedRecipient(vault.state))) {
        throw new Error('Wallet mismatch: only the selected request beneficiary can decrypt.');
      }
      const state = await getVault(config, vault.state.id);
      if (state.status !== 2 || !same(selectedRecipient(state), actor.address)) {
        throw new Error('Only the selected beneficiary can decrypt after finalization');
      }
      await verifyReleaseFinality(config, state.id, state.requestId);
      verifyRegisteredKit(buildRecoveryKit(vault.package), config, state);
      const identity = await storedIdentity(namespace, actor.address);
      if (!identity) {
        throw new Error('Your beneficiary encryption key is on its original browser. Use that device.');
      }
      if (
        publicKeyHash(identity.publicKey) !== (same(actor.address, state.beneficiary) ? state.beneficiaryKeyHash : state.backupBeneficiaryKeyHash) ||
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
      const asset = await recoverAsset(vault.package, records.map(r => r.release), identity, state.requestId, actor.address);
      setDecrypted({ id: state.id, asset });
      notify('Asset decrypted locally. Your inherited document is ready.');
    });
  }

  async function enrollWallet() {
    if (!config) return;
    await run('Connecting wallet', async () => {
      const address = await connectWallet(config);
      const a: Actor = { address, name: 'Your connected wallet', role: 'owner', initials: 'YW' };
      setActor(a);
      const existing = await api.identities();
      const enrolled = existing.find(i => same(i.address, address));
      setIdentities(existing);
      const record = await custodyRecord(namespace, address);
      if (enrolled && record && !enrollmentMatches(record.identity.publicKey, enrolled.publicKey)) {
        throw new Error('This browser holds a different encryption key than the one enrolled for this wallet. Keep the original browser or restore its matching backup.');
      }
      setCustodyLocal(record);
      setCustodyEnrolled(!!enrolled);
      const step = custodyStep(!!enrolled, record);
      if (step === 'legacy' && !enrolled && record) {
        const signer = await signerFor(config, address);
        await api.enroll({
          address,
          publicKey: record.identity.publicKey,
          signature: await signer.signMessage(identityMessage(config, address, record.identity.publicKey)),
        });
        setCustodyEnrolled(true);
        setIdentities(await api.identities());
      }
      if (step === 'ready') notify('Wallet connected. Your backed custody key is ready.');
      setCustodyOpen(true);
    });
  }

  async function createCustody(passphrase: string): Promise<IdentityBackup> {
    if (!custodyContext || !actor) throw new Error('Connect your wallet first');
    const backup = await createBackedStoredIdentity(namespace, actor.address, passphrase, custodyContext);
    setCustodyLocal(await custodyRecord(namespace, actor.address));
    return backup;
  }

  async function enrollCustody() {
    if (!config || !actor) throw new Error('Connect your wallet first');
    const record = await custodyRecord(namespace, actor.address);
    if (!record?.verified) throw new Error('Verify the downloaded identity backup first');
    const signer = await signerFor(config, actor.address);
    await api.enroll({
      address: actor.address,
      publicKey: record.identity.publicKey,
      signature: await signer.signMessage(identityMessage(config, actor.address, record.identity.publicKey)),
    });
    setIdentities(await api.identities());
    setCustodyLocal(record);
    setCustodyEnrolled(true);
    setCustodyOpen(false);
    notify('Custody backup verified and wallet identity enrolled.');
  }

  async function verifyCustody(file: unknown, passphrase: string) {
    if (!custodyContext || !actor) throw new Error('Connect your wallet first');
    await verifyStoredBackup(namespace, actor.address, file, passphrase, custodyContext);
    setCustodyLocal(await custodyRecord(namespace, actor.address));
  }

  async function restoreCustody(file: unknown, passphrase: string) {
    if (!custodyContext || !actor) throw new Error('Connect your wallet first');
    const enrolled = (await api.identities()).find(identity => same(identity.address, actor.address));
    if (!enrolled) throw new Error('This wallet has no enrolled identity to restore');
    await restoreStoredIdentity(namespace, actor.address, file, passphrase, custodyContext, publicKeyHash(enrolled.publicKey));
    setCustodyLocal(await custodyRecord(namespace, actor.address));
    setCustodyEnrolled(true);
    setCustodyOpen(false);
    notify('Identity restored in this browser. Your custody key matches the enrolled wallet.');
  }

  async function importKit(file?: File) {
    if (!file || !config) return;
    await run('Verifying recovery kit', async () => {
      if (file.size > 15 * 1024 * 1024) throw new Error('Recovery kit is too large');
      let raw: unknown;
      try {
        raw = JSON.parse(await file.text());
      } catch {
        throw new Error('Recovery kit must be a valid JSON file');
      }
      const kit = parseRecoveryKit(raw, config);
      const p = kit.package;
      let state;
      try {
        state = await getVault(config, p.binding.vaultId);
      } catch (e) {
        if (!isVaultNotFound(e)) throw e;
        await persistPending(namespace, {
          package: p,
          label: kit.metadata?.label ?? 'Imported encrypted vault',
          category: kit.metadata?.category ?? 'Encrypted asset',
          createdAt: kit.metadata?.createdAt ?? Date.now(),
          transactionHash: kit.transactionHash,
        });
        setPending(await pendingRegistrations(namespace));
        notify('Registration is not on-chain yet. The encrypted kit is saved here and will be checked again after confirmation.');
        return;
      }
      verifyRegisteredKit(raw, config, state);
      await api.savePackage(p);
      if (kit.metadata) {
        const meta = JSON.parse(localStorage.getItem(metadataKey(config)) ?? '{}');
        meta[state.id] = kit.metadata;
        localStorage.setItem(metadataKey(config), JSON.stringify(meta));
      }
      setSelected(state.id);
      notify('Encrypted package verified against the chain and imported. Custody keys remain on their original browser.');
    });
  }

  async function exportRegisteredKit(vault: Vault) {
    if (!config) return;
    await run('Verifying recovery kit', async () => {
      verifyRegisteredKit(await api.kit(vault.state.id), config, vault.state);
      const anchor = document.createElement('a');
      anchor.href = `/api/kits/${vault.state.id}`;
      anchor.download = `heirloom-kit-${vault.state.id.slice(2, 10)}.json`;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
      }
      notify('Verified recovery kit download requested. Confirm that your browser saved the file.');
    });
  }

  const activeRecoveries = vaults.filter(v => v.state.status === 1).length;
  const protectedCount = vaults.filter(v => v.state.status !== 2).length;
  const guardians =
    config?.mode === 'local'
      ? config.actors.filter(a => a.role === 'guardian')
      : identities
          .filter(i => !same(i.address, actor?.address))
          .map(i => ({ address: i.address, name: short(i.address), initials: 'GI', role: 'guardian' as const }));
  const nextAddresses =
    current && guidance
      ? guidance.nextActor === 'beneficiary'
        ? current.state.status === 0 ? [current.state.beneficiary, ...(current.state.backupBeneficiary && current.state.backupBeneficiary !== ZeroAddress ? [current.state.backupBeneficiary] : [])] : [selectedRecipient(current.state)]
        : current.state.status === 1
        ? current.state.guardians.filter(g => !current.state.approved.some(a => same(a, g)))
        : current.state.guardians.filter(
            g => current.state.approved.some(a => same(a, g)) && !deliveredGuardians.some(a => same(a, g))
          )
      : [];
  const actorRole =
    current && actor
      ? same(actor.address, current.state.owner)
        ? 'owner'
        : isBeneficiary(current.state, actor.address)
        ? 'beneficiary'
        : current.state.guardians.some(g => same(g, actor.address))
        ? 'guardian'
        : 'viewer'
      : 'no actor';

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
  const hasBeneficiary = vaults.some(v => isBeneficiary(v.state, currentUser.address));
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
          identities={identities}
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
          identities={identities}
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

        {toast && !error && (
          <div className="toast" role="status">
            <CircleCheck size={19} />
            {toast}
            <button aria-label="Dismiss notification" onClick={() => setToast('')}>
              <X size={14} />
            </button>
          </div>
        )}

        {error && !current && (
          <div className="toast error-banner" role="alert">
            <CircleAlert size={19} />
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError('')}>
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

        {custodyOpen && config?.mode === 'public' && actor && custodyStatus && (
          <CustodyDialog
            key={`${actor.address}:${custodyStatus}`}
            address={actor.address}
            step={custodyStatus}
            backup={custodyLocal?.backup}
            onCreate={createCustody}
            onVerify={verifyCustody}
            onRestore={restoreCustody}
            onEnroll={enrollCustody}
            onClose={() => setCustodyOpen(false)}
          />
        )}

        {pending.map(entry => (
          <div className="error-banner pending-banner" role="status" key={entry.package.binding.vaultId}>
            <FolderLock size={17} />
            <span>
              <strong>{entry.label}</strong>
              {pendingMismatch.includes(entry.package.binding.vaultId)
                ? ' does not match its on-chain commitment. Keep the kit for investigation; this package cannot be published.'
                : ' has an unfinished registration. Its encrypted package is safe on this browser.'}
              {entry.transactionHash && <> Transaction: {short(entry.transactionHash)}.</>}
            </span>
            <button
              onClick={() =>
                exportKit(
                  buildRecoveryKit(
                    entry.package,
                    { label: entry.label, category: entry.category, createdAt: entry.createdAt },
                    entry.transactionHash
                  ),
                  `heirloom-pending-${entry.package.binding.vaultId.slice(2, 10)}.json`
                )
              }
            >
              Export kit
            </button>
          </div>
        ))}

        {config?.mode === 'public' && actor && custodyBlocked && !custodyOpen && (
          <div className="error-banner" role="status">
            <KeyRound size={17} />
            <span>This wallet needs its verified browser custody key before encryption and decryption actions.</span>
            <button onClick={() => setCustodyOpen(true)}>Set up custody</button>
          </div>
        )}
        {config?.mode === 'public' && actor && custodyStatus === 'legacy' && !custodyOpen && (
          <div className="error-banner" role="status">
            <KeyRound size={17} />
            <span>This older browser identity has no portable backup.</span>
            <button onClick={() => setCustodyOpen(true)}>Learn why</button>
          </div>
        )}

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
                    <span>Primary beneficiary</span>
                    <strong>{nameOf(current.state.beneficiary)}</strong>
                    <small>{short(current.state.beneficiary)}</small>
                  </div>
                  <div>
                    <span>Backup beneficiary</span>
                    <strong>{current.state.backupBeneficiary && current.state.backupBeneficiary !== ZeroAddress ? nameOf(current.state.backupBeneficiary) : 'Not configured'}</strong>
                    <small>Primary eligible: {new Date((current.state.lastCheckIn + current.state.inactivity) * 1000).toLocaleString()}</small>
                    {current.state.backupBeneficiary && current.state.backupBeneficiary !== ZeroAddress && <small>Backup eligible: {new Date((current.state.lastCheckIn + current.state.inactivity + (current.state.backupWaitingDuration ?? 0)) * 1000).toLocaleString()}</small>}
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
                  disabled={!!busy || offline}
                  onClick={() => exportRegisteredKit(current)}
                >
                  <Download size={15} />
                  Export encrypted recovery kit
                </button>
                <p className="kit-note">
                  The kit contains encrypted asset data. Its label and browser custody keys stay on this device.
                </p>
              </div>

              <div className="recovery-panel">
                <span className="eyebrow">RECOVERY SAFEGUARDS</span>
                <h3>Every condition matters.</h3>
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
                      label: 'Encrypted share delivery',
                      detail:
                        current.state.status === 2
                          ? `${deliveredGuardians.length} of 2 shares delivered`
                          : 'Starts after finalization',
                      done: deliveredGuardians.length >= 2,
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

                {guidance && (
                  <div className="recovery-next" role="status">
                    <span>Next recovery step</span>
                    <strong>{guidance.nextAction}</strong>
                    <small>
                      {nextAddresses.map(nameOf).join(', ')} · {guidance.nextActor}
                      {guidance.waitSeconds
                        ? ` · ${duration(guidance.waitSeconds)} remaining`
                        : guidance.approvalsNeeded
                        ? ` · ${guidance.approvalsNeeded} more approval${guidance.approvalsNeeded === 1 ? '' : 's'}`
                        : guidance.sharesNeeded
                        ? ` · ${guidance.sharesNeeded} more share${guidance.sharesNeeded === 1 ? '' : 's'}`
                        : ''}
                    </small>
                  </div>
                )}

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
                        disabled={!!busy || offline || custodyActionBlocked('checkIn')}
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
                {currentUser && isBeneficiary(current.state, currentUser.address) ? (
                  <>
                    {current.state.status === 0 && (
                      <button
                        className="button primary full"
                        disabled={
                          !!busy ||
                          offline ||
                          custodyActionBlocked('requestRecovery') ||
                          (guidance && guidance.action !== 'requestRecovery') ||
                          !canRequest(current.state, currentUser.address, time)
                        }
                        onClick={() => action(current, 'requestRecovery')}
                      >
                        <ShieldCheck size={17} />
                        {canRequest(current.state, currentUser.address, time)
                          ? 'Request recovery'
                          : `Eligible in ${duration(beneficiaryDeadline(current.state, currentUser.address) - time)}`}
                      </button>
                    )}
                    {current.state.status === 1 && (
                      <button
                        className="button primary full"
                        disabled={
                          !!busy ||
                          offline ||
                          custodyActionBlocked('finalizeRecovery') ||
                          (guidance && guidance.action !== 'finalizeRecovery') ||
                          !canFinalize(current.state, currentUser.address, time) ||
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
                      <button
                        className="button primary full"
                        disabled={
                          !!busy ||
                          offline ||
                          custodyActionBlocked('decrypt') ||
                          !same(currentUser.address, selectedRecipient(current.state)) ||
                          (guidance && guidance.action !== 'decrypt')
                        }
                        onClick={() => decrypt(current)}
                      >
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
                    {current.state.status === 0 && (
                      <div className="permission-disabled-note">
                        <span>
                          Guardian approval not open yet: This vault is active. Guardians can attest once the owner misses a check-in and beneficiary {nameOf(current.state.beneficiary)} requests recovery.
                        </span>
                      </div>
                    )}
                    {current.state.status === 1 && (
                      <>
                        <div className="attestation-note">
                          Approve only after independently verifying the owner’s unavailability.
                        </div>
                        <button
                          className="button primary full"
                          disabled={
                            !!busy ||
                            offline ||
                            custodyActionBlocked('approveRecovery') ||
                            (guidance && guidance.action !== 'approveRecovery') ||
                            current.state.approved.some(g => same(g, currentUser.address))
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
                          !!busy ||
                          offline ||
                          custodyActionBlocked('release') ||
                          (guidance && guidance.action !== 'release') ||
                          !current.state.approved.some(g => same(g, currentUser.address)) ||
                          deliveredGuardians.some(g => same(g, currentUser.address))
                        }
                        onClick={() => release(current)}
                      >
                        <KeyRound size={17} />
                        {deliveredGuardians.some(g => same(g, currentUser.address))
                          ? 'Share delivered'
                          : 'Release encrypted share'}
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
                        disabled={!!busy || !current.state.backupBeneficiary || current.state.backupBeneficiary === ZeroAddress}
                        onClick={() => run('Advancing chain clock', async () => { await api.clock(Math.max(1, current.state.lastCheckIn + current.state.inactivity + (current.state.backupWaitingDuration ?? 0) - time + 1)); })}
                      >
                        Skip backup waiting
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
                  Request #{current.state.requestId} {current.state.status !== 0 ? `· Selected recipient: ${nameOf(selectedRecipient(current.state))}` : ''} · Confirmed block #{block}
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
