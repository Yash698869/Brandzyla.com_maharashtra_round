import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = process.env.HEIRLOOM_TEST_EVIDENCE_PROFILE || path.join(root, '.runtime', 'evidence-demo', 'profile.json');
const input = process.argv[2] || process.env.HEIRLOOM_EVIDENCE_PDF;
const checkNames = ['signature', 'coverage', 'chain', 'revocation', 'issuer', 'fields'];

function fail(code, checks = Object.fromEntries(checkNames.map(name => [name, 'indeterminate']))) {
  console.log(JSON.stringify({ status: 'INDETERMINATE', issuerLabel: 'Heirloom local test issuer', checks, ownerIdentityMatch: 'not_checked_offline', reasonCodes: [code] }));
  process.exitCode = 1;
}

if (!input) {
  fail('pdf_path_required');
} else {
  try {
    const pdfPath = path.resolve(process.cwd(), input);
    const bytes = await readFile(pdfPath);
    const python = process.env.HEIRLOOM_PYTHON || 'python';
    const result = spawnSync(python, ['-m', 'verifier.verify_pdf', '--input', pdfPath, '--profile', 'test-local'], {
      cwd: root,
      env: { ...process.env, HEIRLOOM_TEST_EVIDENCE_PROFILE: profile },
      encoding: 'utf8',
      timeout: 20_000,
      maxBuffer: 128 * 1024,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.error || result.status === null) {
      fail(result.error?.code === 'ETIMEDOUT' ? 'verifier_timeout' : 'verifier_unavailable');
    } else {
      let raw;
      try { raw = JSON.parse(result.stdout); }
      catch { raw = null; }
      if (!raw || result.status !== 0) {
        fail('verifier_unavailable');
      } else {
        const checks = Object.fromEntries(checkNames.map(name => [name, ['pass', 'fail', 'indeterminate'].includes(raw[name]) ? raw[name] : 'indeterminate']));
        const allPass = Object.values(checks).every(value => value === 'pass');
        const status = allPass ? 'TEST_ISSUER_PDF_VALID' : Object.values(checks).includes('fail') ? 'FAILED' : 'INDETERMINATE';
        const output = {
          status,
          issuerLabel: raw.issuerLabel === 'Heirloom local test issuer' ? raw.issuerLabel : 'Unconfigured test issuer',
          signerFingerprint: /^[0-9a-f]{64}$/i.test(raw.signerFingerprint || '') ? raw.signerFingerprint.toLowerCase() : null,
          pdfSha256: createHash('sha256').update(bytes).digest('hex'),
          checks,
          ownerIdentityMatch: 'not_checked_offline',
          reasonCodes: Array.isArray(raw.reasonCodes) ? raw.reasonCodes.filter(value => typeof value === 'string' && /^[a-z_]{1,48}$/.test(value)).slice(0, 12) : [],
        };
        console.log(JSON.stringify(output));
        if (status !== 'TEST_ISSUER_PDF_VALID') process.exitCode = 1;
      }
    }
  } catch {
    fail('evidence_check_failed');
  }
}
