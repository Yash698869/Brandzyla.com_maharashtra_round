import React, { useEffect, useState } from 'react';
import { FileCheck2, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { evidenceStatusLabel, isCurrentEvidenceReceipt, validateEvidenceFile } from '../lib/evidence';
import type { EvidenceReceipt, EvidenceReceiptResponse, Vault } from '../lib/types';

const checks = [
  ['signature', 'PDF signature'], ['coverage', 'Final-file coverage'], ['chain', 'Certificate chain'],
  ['revocation', 'Revocation'], ['issuer', 'Issuer identity'], ['fields', 'Signed fields'], ['identity', 'Owner identity']
] as const;

export function EvidenceReceiptSummary({ receipt, historical }: { receipt: EvidenceReceipt; historical: boolean }) {
  return <div className={`evidence-receipt evidence-${receipt.status}`}>
    <div className="evidence-receipt-title"><strong>{historical ? 'Historical · ' : ''}{evidenceStatusLabel(receipt.status)}</strong><span>Request #{receipt.requestId}</span></div>
    {receipt.status === 'test_issuer_verified' && <p className="evidence-demo-mark">DEMO / NOT GOVERNMENT EVIDENCE</p>}
    <p>Issuer: {receipt.issuerLabel}</p>
    <div className="evidence-check-grid">{checks.map(([key, label]) => <div key={key}><span>{label}</span><strong className={`evidence-check-${receipt.checks[key]}`}>{receipt.checks[key]}</strong></div>)}</div>
    <p className="evidence-digest">PDF SHA-256: {receipt.pdfSha256.slice(0, 16)}…{receipt.pdfSha256.slice(-8)}</p>
    {receipt.reasonCodes.length > 0 && <p className="evidence-muted">Checks needing attention: {receipt.reasonCodes.join(', ').replaceAll('_', ' ')}</p>}
    {historical && <p className="evidence-muted">This receipt belongs to an earlier request and does not verify the current claim.</p>}
  </div>;
}

export default function EvidenceReview({ vault, disabled }: { vault: Vault; disabled: boolean }) {
  const [results, setResults] = useState<EvidenceReceiptResponse>({ receipt: null, historical: null });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = vault.state.requestId;

  useEffect(() => {
    let active = true;
    setResults({ receipt: null, historical: null });
    api.evidenceReceipt(vault.state.id).then(value => { if (active) setResults(value); })
      .catch(() => { if (active) setError('Could not load certificate evidence.'); });
    return () => { active = false; };
  }, [vault.state.id, requestId, vault.state.status]);

  async function upload() {
    if (!file) return;
    setError(''); setBusy(true);
    try {
      validateEvidenceFile(file);
      await api.uploadEvidence(vault.state.id, file);
      setResults(await api.evidenceReceipt(vault.state.id));
      setFile(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Certificate verification failed.'); }
    finally { setBusy(false); }
  }

  const current = isCurrentEvidenceReceipt(results.receipt, vault) ? results.receipt : null;
  return <div className="evidence-panel evidence-review">
    <div className="evidence-heading"><FileCheck2 size={18}/><div><h4>Digital certificate evidence</h4><p>Cryptographic checks help your review; your guardian approval remains separate.</p></div></div>
    {current && <EvidenceReceiptSummary receipt={current} historical={false}/>}
    {!current && <p className="evidence-muted">No certificate receipt for this request. DigiLocker/CRS verification awaits a genuine issuer sample.</p>}
    {results.historical && <EvidenceReceiptSummary receipt={results.historical} historical/>}
    {vault.state.status === 1 && <div className="evidence-upload">
      <label>Upload signed PDF<input type="file" accept="application/pdf,.pdf" disabled={disabled || busy} onChange={event => { setError(''); setFile(event.target.files?.[0] ?? null); }}/></label>
      <button type="button" className="button secondary" disabled={disabled || busy || !file} onClick={upload}><Upload size={15}/>{busy ? 'Verifying…' : 'Verify certificate'}</button>
    </div>}
    {error && <p role="alert" className="evidence-error">{error}</p>}
  </div>;
}
