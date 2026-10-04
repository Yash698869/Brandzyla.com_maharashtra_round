import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(root, '.runtime', 'evidence-demo', 'signed.pdf');
const tamperedPath = path.join(root, '.runtime', 'evidence-demo', 'tampered.pdf');

function npm(args, env = {}) {
  const result = spawnSync('npm', args, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true, env: { ...process.env, ...env } });
  if (result.error) throw result.error;
  return result;
}

function outputJson(output) {
  const line = output.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) throw new Error('Evidence check did not print a JSON result.');
  return JSON.parse(line);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const fixture = npm(['run', 'evidence:fixture']);
assert(fixture.status === 0, `Could not generate the local certificate fixture:\n${fixture.stderr || fixture.stdout}`);

const valid = npm(['run', 'evidence:check'], { HEIRLOOM_EVIDENCE_PDF: fixturePath });
assert(valid.status === 0, `Valid fixture check failed:\n${valid.stderr || valid.stdout}`);
const validResult = outputJson(valid.stdout);
assert(validResult.status === 'TEST_ISSUER_PDF_VALID', 'The generated local test certificate was not accepted.');
assert(Object.values(validResult.checks).every(value => value === 'pass'), 'The valid fixture did not pass every signature/issuer check.');

const bytes = await readFile(fixturePath);
const signedMarker = Buffer.from('Signature1');
const offset = bytes.indexOf(signedMarker);
assert(offset >= 0, 'Could not find the test PDF signature field for a safe tamper check.');
const byteRangeMatch = bytes.toString('latin1').match(/\/ByteRange\s*\[\s*0\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/);
assert(byteRangeMatch, 'Could not read the PDF signature ByteRange for a safe tamper check.');
const firstLength = Number(byteRangeMatch[1]);
const secondStart = Number(byteRangeMatch[2]);
const secondLength = Number(byteRangeMatch[3]);
const inSignedRange = offset < firstLength || (offset >= secondStart && offset < secondStart + secondLength);
assert(inSignedRange, 'The chosen tamper byte is outside the signed PDF byte ranges.');
bytes[offset] ^= 1;
await writeFile(tamperedPath, bytes);

const tampered = npm(['run', 'evidence:check'], { HEIRLOOM_EVIDENCE_PDF: tamperedPath });
const tamperedResult = outputJson(tampered.stdout);
assert(tamperedResult.status === 'FAILED', 'The modified PDF was not rejected.');
assert(tamperedResult.checks.signature === 'fail', 'The modified PDF did not fail the signature check.');
console.log(JSON.stringify({ valid: validResult.status, validChecks: validResult.checks, tampered: tamperedResult.status, tamperedReasonCodes: tamperedResult.reasonCodes }, null, 2));
