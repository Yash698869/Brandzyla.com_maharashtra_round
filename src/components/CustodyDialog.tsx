import { useState } from 'react';
import { Download, KeyRound, LoaderCircle, Upload } from 'lucide-react';
import Modal from './Modal';
import type { CustodyStep } from '../lib/custody-flow';
import type { IdentityBackup } from '../lib/identity-backup';
import './CustodyDialog.css';

function downloadBackup(backup: IdentityBackup, address: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = `heirloom-identity-${address.slice(2, 10)}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function CustodyDialog({ address, step, backup, onCreate, onVerify, onRestore, onEnroll, onClose }: {
  address: string;
  step: CustodyStep;
  backup?: IdentityBackup;
  onCreate: (passphrase: string) => Promise<IdentityBackup>;
  onVerify: (file: unknown, passphrase: string) => Promise<void>;
  onRestore: (file: unknown, passphrase: string) => Promise<void>;
  onEnroll: () => Promise<void>;
  onClose: () => void;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [file, setFile] = useState<File>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  async function submitted() {
    if (working) return;
    setWorking(true); setError('');
    try {
      if (step === 'create') {
        if (passphrase.length < 12) throw new Error('Use a strong, unique passphrase of at least 12 characters.');
        if (passphrase !== confirm) throw new Error('The passphrases do not match.');
        downloadBackup(await onCreate(passphrase), address);
        setPassphrase(''); setConfirm('');
      } else if (step === 'verify' || step === 'restore') {
        if (!file || file.size > 32_768) throw new Error('Choose a valid identity backup file (32 KB maximum).');
        const parsed = JSON.parse(await file.text());
        if (step === 'verify') await onVerify(parsed, passphrase);
        else await onRestore(parsed, passphrase);
        setPassphrase('');
      } else if (step === 'enroll') await onEnroll();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Identity backup failed.'); }
    finally { setWorking(false); }
  }

  const title = step === 'create' ? 'Protect your custody key.' : step === 'restore' ? 'Restore your custody key.' : step === 'verify' ? 'Verify your saved backup.' : 'Your custody key.';
  return <Modal title={title} eyebrow="BROWSER IDENTITY" onClose={working ? () => {} : onClose}>
    <div className="custody-dialog">
      <p>Wallet <strong>{address.slice(0, 8)}…{address.slice(-6)}</strong></p>
      {step === 'create' && <><p>Heirloom will download an encrypted identity backup. Keep the file and its passphrase separately; both are needed if this browser is lost.</p><label>Backup passphrase<input type="password" autoComplete="new-password" value={passphrase} onChange={event => setPassphrase(event.target.value)} placeholder="Strong, unique passphrase"/></label><label>Confirm passphrase<input type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} /></label></>}
      {step === 'verify' && <><p>Reselect the file you downloaded and enter its passphrase. Enrollment stays locked until the file restores the same key.</p>{backup && <button className="button secondary full" type="button" onClick={() => downloadBackup(backup, address)}><Download size={16}/>Download backup again</button>}</>}
      {step === 'restore' && <p>This wallet is enrolled, but this browser has no matching private identity. Restore it from the encrypted identity backup, then continue using your vaults.</p>}
      {(step === 'verify' || step === 'restore') && <><label>Identity backup file<input type="file" accept="application/json,.json" onChange={event => setFile(event.target.files?.[0])}/></label><label>Backup passphrase<input type="password" autoComplete="current-password" value={passphrase} onChange={event => setPassphrase(event.target.value)}/></label></>}
      {step === 'enroll' && <p>Your downloaded backup has been verified. Sign the enrollment message with this wallet to publish only your public encryption key.</p>}
      {step === 'ready' && <><p>This browser has a verified, non-extractable custody key. Save a copy of the encrypted backup if you need one.</p>{backup && <button className="button secondary full" type="button" onClick={() => downloadBackup(backup, address)}><Download size={16}/>Download encrypted backup</button>}</>}
      {step === 'legacy' && <p>This older browser key is non-extractable and has no backup. Existing vaults still work here, but losing this browser can permanently block recovery. Create a new identity on a fresh deployment for portable custody.</p>}
      {error && <div className="inline-error" role="alert">{error}</div>}
      {['create', 'verify', 'restore', 'enroll'].includes(step) && <button className="button primary full" type="button" disabled={working} onClick={submitted}>{working ? <><LoaderCircle className="spin" size={16}/>Working…</> : step === 'create' ? <><Download size={16}/>Create & download backup</> : step === 'verify' ? <><Upload size={16}/>Verify backup</> : step === 'restore' ? <><KeyRound size={16}/>Restore identity</> : 'Sign wallet enrollment'}</button>}
      <small>The relay never receives your private key, passphrase, or backup file. An asset recovery kit is a different file.</small>
    </div>
  </Modal>;
}
