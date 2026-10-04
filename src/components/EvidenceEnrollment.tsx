import React, { useEffect, useState } from 'react';
import { FileBadge2, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { signerFor } from '../lib/chain';
import { canEnrollEvidence, prepareEvidenceEnrollment } from '../lib/evidence';
import type { Config, Vault } from '../lib/types';

interface Props { vault: Vault; config: Config; ownerAddress: string }

export default function EvidenceEnrollment({ vault, config, ownerAddress }: Props) {
  const [enrolled, setEnrolled] = useState(false);
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = canEnrollEvidence(vault);

  useEffect(() => {
    let active = true;
    api.evidenceEnrollment(vault.state.id).then(value => { if (active) setEnrolled(value.enrolled); })
      .catch(() => { if (active) setError('Could not load certificate identity status.'); });
    return () => { active = false; };
  }, [vault.state.id]);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const signer = await signerFor(config, ownerAddress);
      const record = await prepareEvidenceEnrollment(config, vault.state.id, ownerAddress, name, identifier, signer);
      await api.enrollEvidence(vault.state.id, record);
      setEnrolled(true); setName(''); setIdentifier('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Identity enrollment failed.'); }
    finally { setBusy(false); }
  }

  return <section className="evidence-panel evidence-enrollment">
    <div className="evidence-heading"><FileBadge2 size={18}/><div><h3>Certificate identity · {vault.label}</h3><p>Bind your legal identity to this vault before any recovery request.</p></div></div>
    {enrolled ? <p className="evidence-good"><ShieldCheck size={16}/> Identity commitment enrolled. Your name and identifier are not stored by the relay.</p>
      : !open ? <p className="evidence-muted">Enrollment closed: this vault has already had a recovery request.</p>
      : <form onSubmit={submit} className="evidence-form">
        <label>Legal name<input value={name} onChange={event => setName(event.target.value)} required autoComplete="name"/></label>
        <label>Certificate identifier<input value={identifier} onChange={event => setIdentifier(event.target.value)} required autoComplete="off"/></label>
        <p className="evidence-muted">Use an identifier expected on the certificate. Do not enter Aadhaar solely for this demo.</p>
        <button type="submit" className="button secondary" disabled={busy}>{busy ? 'Signing identity…' : 'Enroll with owner wallet'}</button>
      </form>}
    {error && <p className="evidence-error" role="alert">{error}</p>}
  </section>;
}
