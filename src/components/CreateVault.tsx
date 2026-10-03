import { useState, type FormEvent } from 'react';
import { FileUp, LockKeyhole, ShieldCheck, ArrowRight, LoaderCircle } from 'lucide-react';
import Modal from './Modal';
import type { Config, IdentityRecord } from '../lib/types';

export interface CreateInput { label: string; category: string; bytes: Uint8Array; name: string; mime: string; beneficiary: string; guardians: string[]; inactivity: number; challenge: number }
export default function CreateVault({ config, identities, account, busy, onClose, onCreate }: { config: Config; identities: IdentityRecord[]; account: string; busy: string; onClose: () => void; onCreate: (input: CreateInput) => Promise<void> }) {
  const others = identities.filter(i => i.address.toLowerCase() !== account.toLowerCase());
  const [label, setLabel] = useState(''); const [category, setCategory] = useState('Personal documents');
  const [text, setText] = useState(''); const [file, setFile] = useState<File>(); const [error, setError] = useState('');
  const [beneficiary, setBeneficiary] = useState(config.actors.find(a => a.role === 'beneficiary')?.address ?? others[0]?.address ?? '');
  const [guardians, setGuardians] = useState(config.actors.filter(a => a.role === 'guardian').map(a => a.address).length ? config.actors.filter(a => a.role === 'guardian').map(a => a.address) : others.slice(1, 4).map(i => i.address));
  const [inactivity, setInactivity] = useState(config.mode === 'local' ? 60 : 604800); const [challenge, setChallenge] = useState(config.mode === 'local' ? 30 : 86400);
  const actorName = (address: string) => config.actors.find(a => a.address.toLowerCase() === address.toLowerCase())?.name ?? `${address.slice(0, 8)}…${address.slice(-4)}`;
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    try {
      if (!file && !text.trim()) throw new Error('Add a file or a private note to protect.');
      if (file && file.size > 5 * 1024 * 1024) throw new Error('Choose a file smaller than 5 MB for this prototype.');
      if (guardians.length !== 3 || new Set([...guardians, beneficiary, account].map(a => a.toLowerCase())).size !== 5) throw new Error('Owner, beneficiary, and all three guardians must be distinct.');
      await onCreate({ label: label.trim(), category, bytes: file ? new Uint8Array(await file.arrayBuffer()) : new TextEncoder().encode(text), name: file?.name ?? 'private-note.txt', mime: file?.type || 'text/plain', beneficiary, guardians, inactivity, challenge });
    } catch (e: any) { setError(e.message); }
  }
  return <Modal title="Protect something meaningful." eyebrow="NEW VAULT" onClose={onClose}><form onSubmit={submit} className="create-form">
    <p className="modal-description">Encrypt an asset on your device. Your guardians hold the pieces to its recovery.</p>
    <label>Vault name<input autoFocus required maxLength={70} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Letters for my family"/></label>
    <div className="form-row"><label>Category<select value={category} onChange={e => setCategory(e.target.value)}><option>Personal documents</option><option>Family memories</option><option>Account access</option><option>Financial records</option></select></label><label>Beneficiary<select required value={beneficiary} onChange={e => setBeneficiary(e.target.value)}><option value="" disabled>Select an enrolled identity</option>{others.map(i => <option key={i.address} value={i.address}>{actorName(i.address)}</option>)}</select></label></div>
    <label className="upload-zone"><FileUp size={24}/><span>{file ? file.name : 'Choose a document to protect'}<small>Any file · up to 5 MB · encrypted locally</small></span><input type="file" onChange={e => setFile(e.target.files?.[0])}/></label>
    {!file && <label>Or write a private note<textarea rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="A message, instructions, or something worth passing on…"/></label>}
    <div className="form-divider"><ShieldCheck size={16}/> Recovery policy</div>
    <div className="guardian-inputs">{[0, 1, 2].map((_, index) => <label key={index}>Guardian {index + 1}<select required value={guardians[index] ?? ''} onChange={e => setGuardians(old => { const next = [...old]; next[index] = e.target.value; return next; })}><option value="" disabled>Select guardian</option>{others.filter(i => i.address !== beneficiary).map(i => <option key={i.address} value={i.address}>{actorName(i.address)}</option>)}</select></label>)}</div>
    <div className="form-row"><label>Missed check-in period<select value={inactivity} onChange={e => setInactivity(Number(e.target.value))}>{config.mode === 'local' ? <><option value={60}>60 seconds · demo</option><option value={300}>5 minutes · demo</option></> : <option value={120}>2 minutes · testnet rehearsal</option>}<option value={604800}>7 days</option><option value={2592000}>30 days</option><option value={7776000}>90 days</option></select></label><label>Owner cancellation window<select value={challenge} onChange={e => setChallenge(Number(e.target.value))}>{config.mode === 'local' ? <><option value={30}>30 seconds · demo</option><option value={120}>2 minutes · demo</option></> : <option value={60}>1 minute · testnet rehearsal</option>}<option value={86400}>24 hours</option><option value={604800}>7 days</option></select></label></div>
    <p className="quiet-note"><LockKeyhole size={14}/> Two of three guardians must attest independently. The owner can cancel until finalization.</p>
    {error && <div className="inline-error" role="alert">{error}</div>}
    <div className="modal-footer"><button type="button" className="button secondary" onClick={onClose} disabled={!!busy}>Cancel</button><button className="button primary" disabled={!!busy}>{busy ? <><LoaderCircle className="spin" size={16}/>{busy}</> : <>Encrypt & create vault<ArrowRight size={16}/></>}</button></div>
  </form></Modal>;
}
