import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import EvidenceEnrollment from './EvidenceEnrollment';
import EvidenceReview, { EvidenceReceiptSummary } from './EvidenceReview';
import type { Config, EvidenceReceipt, Vault } from '../lib/types';

const owner = `0x${'11'.repeat(20)}`;
const config: Config = { chainId: 31337, contractAddress: `0x${'22'.repeat(20)}`, deploymentId: `0x${'33'.repeat(32)}`,
  rpcUrl: 'http://127.0.0.1:8545', abi: [], deploymentBlock: 1, codeHash: 'code', mode: 'local', confirmations: 1, actors: [] };
const vault = { label: 'Family vault', state: { id: `0x${'44'.repeat(32)}`, owner, status: 0, requestId: 0 } } as Vault;
const receipt = { vaultId: vault.state.id, requestId: 1, status: 'test_issuer_verified', pdfSha256: 'ee'.repeat(32),
  signerFingerprint: 'ff'.repeat(32), issuerLabel: 'Heirloom local test issuer', verifiedAt: 1,
  checks: { signature: 'pass', coverage: 'pass', chain: 'pass', revocation: 'pass', issuer: 'pass', fields: 'pass', identity: 'pass' }, reasonCodes: [] } as EvidenceReceipt;

describe('certificate evidence panels', () => {
  it('shows owner enrollment for a new vault and closes it after a claim', () => {
    const active = renderToStaticMarkup(<EvidenceEnrollment vault={vault} config={config} ownerAddress={owner}/>);
    expect(active).toContain('Legal name');
    expect(active).toContain('Certificate identifier');
    const closed = renderToStaticMarkup(<EvidenceEnrollment vault={{ ...vault, state: { ...vault.state, status: 1, requestId: 1 } }} config={config} ownerAddress={owner}/>);
    expect(closed).toContain('Enrollment closed');
  });

  it('shows guardian upload and a clearly marked test issuer receipt', () => {
    const upload = renderToStaticMarkup(<EvidenceReview vault={{ ...vault, state: { ...vault.state, status: 1, requestId: 1 } }} disabled={false}/>);
    expect(upload).toContain('Upload signed PDF');
    const review = renderToStaticMarkup(<EvidenceReceiptSummary receipt={receipt} historical={false}/>);
    expect(review).toContain('Test issuer verified');
    expect(review).toContain('DEMO / NOT GOVERNMENT EVIDENCE');
    expect(review).toContain('Revocation');
    expect(review).toContain('Owner identity');
  });

  it('labels old receipts as historical and keeps all five result labels distinct', () => {
    const old = renderToStaticMarkup(<EvidenceReceiptSummary receipt={receipt} historical/>);
    expect(old).toContain('Historical');
    for (const status of ['government_issuer_verified', 'test_issuer_verified', 'signed_issuer_unverified', 'indeterminate', 'failed'] as const) {
      expect(renderToStaticMarkup(<EvidenceReceiptSummary receipt={{ ...receipt, status }} historical={false}/>)).toContain(status === 'test_issuer_verified' ? 'Test issuer verified' : status === 'government_issuer_verified' ? 'Government issuer verified' : status === 'signed_issuer_unverified' ? 'Signed, issuer unverified' : status === 'indeterminate' ? 'Indeterminate' : 'Failed');
    }
  });
});
