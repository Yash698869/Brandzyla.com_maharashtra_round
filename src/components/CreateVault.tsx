import { useState, type FormEvent } from 'react';
import { FileUp, LockKeyhole, ShieldCheck, ArrowRight, LoaderCircle } from 'lucide-react';
import Modal from './Modal';
import type { Config, IdentityRecord } from '../lib/types';
import { formatActorName } from '../lib/auth';

export interface CreateInput { label: string; category: string; bytes: Uint8Array; name: string; mime: string; beneficiary: string; backupBeneficiary: string; backupWaitingDuration: number; guardians: string[]; inactivity: number; challenge: number }

const same = (a = '', b = '') => a.toLowerCase() === b.toLowerCase();

function pickInitialGuardians(available: IdentityRecord[], owner: string, ben: string): string[] {
  const pool = available.filter(i => !same(i.address, owner) && !same(i.address, ben));
  const preferred = pool.filter(i => i.role === 'guardian').map(i => i.address);
  const rest = pool.filter(i => i.role !== 'guardian').map(i => i.address);
  const unique = Array.from(new Set([...preferred, ...rest]));
  return unique.slice(0, 3);
}

export default function CreateVault({ config, identities, account, busy, onClose, onCreate }: { config: Config; identities: IdentityRecord[]; account: string; busy: string; onClose: () => void; onCreate: (input: CreateInput) => Promise<void> }) {
  const others = identities.filter(i => !same(i.address, account));
  const [label, setLabel] = useState(''); const [category, setCategory] = useState('Personal documents');
  const [text, setText] = useState(''); const [file, setFile] = useState<File>(); const [error, setError] = useState('');

  const initialBeneficiary =
    others.find(i => i.role === 'beneficiary')?.address ??
    config.actors.find(a => a.role === 'beneficiary' && !same(a.address, account))?.address ??
    others[0]?.address ??
    '';

  const [beneficiary, setBeneficiary] = useState(initialBeneficiary);
  const [backupBeneficiary, setBackupBeneficiary] = useState('');
  const [backupWaitingDuration, setBackupWaitingDuration] = useState(config.mode === 'local' ? 60 : 86400);
  const successionSupported = config.abi.some(entry => entry.type === 'function' && entry.name === 'registerSuccessionVault');
  const [guardians, setGuardians] = useState<string[]>(() =>
    pickInitialGuardians(others, account, initialBeneficiary)
  );

  const [inactivity, setInactivity] = useState(config.mode === 'local' ? 60 : 604800); const [challenge, setChallenge] = useState(config.mode === 'local' ? 30 : 86400);

  const actorName = (address: string) => {
    const fromIdentities = identities.find(i => same(i.address, address))?.name;
    if (fromIdentities) return formatActorName(fromIdentities);
    const fromConfig = config.actors.find(a => same(a.address, address))?.name;
    if (fromConfig) return formatActorName(fromConfig);
    return `${address.slice(0, 8)}…${address.slice(-4)}`;
  };

  const reconcileGuardians = (primary: string, backup: string) => {
    setGuardians(old => {
      const currentThree = old.slice(0, 3);
      const next = currentThree.filter(g => !same(g, primary) && !same(g, backup));
      return currentThree.map(g => {
        if (!same(g, primary) && !same(g, backup)) return g;
        const replacement = others.find(
          i => !same(i.address, primary) && !same(i.address, backup) && !next.some(cg => same(cg, i.address))
        );
        if (replacement) next.push(replacement.address);
        return replacement ? replacement.address : '';
      });
    });
  };
  const handleBeneficiaryChange = (newBen: string) => {
    const backup = same(newBen, backupBeneficiary) ? '' : backupBeneficiary;
    setBeneficiary(newBen);
    setBackupBeneficiary(backup);
    reconcileGuardians(newBen, backup);
  };

  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    try {
      if (!successionSupported) throw new Error('Existing primary-only vaults remain recoverable. Deploy the new contract to create succession vaults.');
      if (!file && !text.trim()) throw new Error('Add a file or a private note to protect.');
      if (file && file.size > 5 * 1024 * 1024) throw new Error('Choose a file smaller than 5 MB for this prototype.');
      const finalGuardians = guardians.slice(0, 3);
      if (finalGuardians.length !== 3 || finalGuardians.some(g => !g)) {
        throw new Error('Please select all three distinct guardians.');
      }
      const participants = [...finalGuardians, beneficiary, account, ...(backupBeneficiary ? [backupBeneficiary] : [])];
      const distinct = new Set(participants.map(a => a.toLowerCase()));
      if (!beneficiary || distinct.size !== participants.length) {
        throw new Error('Owner, primary beneficiary, optional backup, and all three guardians must be distinct.');
      }
      if (backupBeneficiary && (!successionSupported || !Number.isInteger(backupWaitingDuration) || backupWaitingDuration <= 0)) throw new Error('Choose a positive backup waiting period on a succession-enabled deployment.');
      await onCreate({ label: label.trim(), category, bytes: file ? new Uint8Array(await file.arrayBuffer()) : new TextEncoder().encode(text), name: file?.name ?? 'private-note.txt', mime: file?.type || 'text/plain', beneficiary, backupBeneficiary, backupWaitingDuration: backupBeneficiary ? backupWaitingDuration : 0, guardians: finalGuardians, inactivity, challenge });
    } catch (e: any) { setError(e.message); }
  }
  return <Modal title="Protect something meaningful." eyebrow="NEW VAULT" onClose={onClose}><form onSubmit={submit} className="create-form">
    <p className="modal-description">Encrypt an asset on your device. Your guardians hold the pieces to its recovery.</p>
    <label>Vault name<input autoFocus required maxLength={70} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Letters for my family"/></label>
    <div className="form-row"><label>Category<select value={category} onChange={e => setCategory(e.target.value)}><option>Personal documents</option><option>Family memories</option><option>Account access</option><option>Financial records</option></select></label><label>Primary beneficiary<select required value={beneficiary} onChange={e => handleBeneficiaryChange(e.target.value)}><option value="" disabled>Select an enrolled identity</option>{others.map(i => <option key={i.address} value={i.address}>{actorName(i.address)}</option>)}</select></label></div>
    <label className="upload-zone"><FileUp size={24}/><span>{file ? file.name : 'Choose a document to protect'}<small>Any file · up to 5 MB · encrypted locally</small></span><input type="file" onChange={e => setFile(e.target.files?.[0])}/></label>
    {!file && <label>Or write a private note<textarea rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="A message, instructions, or something worth passing on…"/></label>}
    <div className="form-divider"><ShieldCheck size={16}/> Recovery policy</div>
    <label>Optional backup beneficiary<select value={backupBeneficiary} disabled={!successionSupported} onChange={e => { setBackupBeneficiary(e.target.value); reconcileGuardians(beneficiary, e.target.value); }}><option value="">No backup · primary-only recovery</option>{others.filter(i => !same(i.address, beneficiary)).map(i => <option key={i.address} value={i.address}>{actorName(i.address)}</option>)}</select></label>
    {!successionSupported && <p className="policy-form-note">Existing primary-only vaults remain recoverable. Deploy the new contract to create succession vaults.</p>}
    <div className="guardian-inputs">{[0, 1, 2].map((_, index) => {
      const availableForThisSlot = others
        .filter(i => !same(i.address, beneficiary) && !same(i.address, backupBeneficiary))
        .filter(i => {
          const isCurrent = same(i.address, guardians[index]);
          const isChosenInAnotherSlot = guardians.some((g, idx) => idx !== index && same(g, i.address));
          return isCurrent || !isChosenInAnotherSlot;
        });
      return (
        <label key={index}>Guardian {index + 1}
          <select required value={guardians[index] ?? ''} onChange={e => setGuardians(old => { const next = [...old.slice(0, 3)]; next[index] = e.target.value; return next; })}>
            <option value="" disabled>Select guardian</option>
            {availableForThisSlot.map(i => <option key={i.address} value={i.address}>{actorName(i.address)}</option>)}
          </select>
        </label>
      );
    })}</div>
    <div className="form-row"><label>Missed check-in period<select value={inactivity} onChange={e => setInactivity(Number(e.target.value))}>{config.mode === 'local' ? <><option value={60}>60 seconds · demo</option><option value={300}>5 minutes · demo</option></> : <option value={120}>2 minutes · testnet rehearsal</option>}<option value={604800}>7 days</option><option value={2592000}>30 days</option><option value={7776000}>90 days</option></select></label><label>Owner cancellation window<select value={challenge} onChange={e => setChallenge(Number(e.target.value))}>{config.mode === 'local' ? <><option value={30}>30 seconds · demo</option><option value={120}>2 minutes · demo</option></> : <option value={60}>1 minute · testnet rehearsal</option>}<option value={86400}>24 hours</option><option value={604800}>7 days</option></select></label></div>
    {backupBeneficiary && <label>Additional backup waiting period<select value={backupWaitingDuration} onChange={e => setBackupWaitingDuration(Number(e.target.value))}>{config.mode === 'local' ? <><option value={60}>60 seconds · demo</option><option value={300}>5 minutes · demo</option></> : <option value={120}>2 minutes · testnet rehearsal</option>}<option value={86400}>24 hours</option><option value={604800}>7 days</option><option value={2592000}>30 days</option></select></label>}
    {backupBeneficiary && <p className="policy-form-note">The primary can request after inactivity. The backup waits an additional period and can request only when no recovery is pending. An open request keeps its selected recipient.</p>}
    <p className="quiet-note"><LockKeyhole size={14}/> Two of three guardians verify circumstances off-chain. Their quorum starts the full cancellation window. Owner check-in cancels a pending request and resets both eligibility clocks.</p>
    {error && <div className="inline-error" role="alert">{error}</div>}
    <div className="modal-footer"><button type="button" className="button secondary" onClick={onClose} disabled={!!busy}>Cancel</button><button className="button primary" disabled={!!busy || !successionSupported}>{busy ? <><LoaderCircle className="spin" size={16}/>{busy}</> : <>Encrypt & create vault<ArrowRight size={16}/></>}</button></div>
  </form></Modal>;
}
