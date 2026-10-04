from __future__ import annotations

import os
import json
import tempfile
import unittest
from contextlib import redirect_stderr
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.sign import signers
from pypdf import PdfReader

from fixtures import make_fixture
from verifier.verify_pdf import verify_pdf


class SignedPdfVerificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='heirloom-evidence-test-')
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)

    def check(self, fixture, path=None):
        with patch.dict(os.environ, {'HEIRLOOM_TEST_EVIDENCE_PROFILE': str(fixture['profile'])}):
            return verify_pdf(str(path or fixture['signed']), 'test-local')

    def test_valid_test_issuer(self):
        fixture = make_fixture(self.directory)
        result = self.check(fixture)
        self.assertEqual(result['signature'], 'pass')
        self.assertEqual(result['coverage'], 'pass')
        self.assertEqual(result['chain'], 'pass')
        self.assertEqual(result['revocation'], 'pass')
        self.assertEqual(result['issuer'], 'pass')
        self.assertEqual(result['fields'], 'pass')
        self.assertEqual(result['claims']['name'], 'Demo Person')
        self.assertEqual(result['claims']['identifier'], 'DEMO-042')
        self.assertEqual(result['claims']['dateOfDeath'], '2026-10-01')
        text = PdfReader(str(fixture['signed'])).pages[0].extract_text()
        self.assertIn('DEMO / NOT GOVERNMENT EVIDENCE', text)

    def test_trusted_signature_with_unapproved_issuer_stays_unverified(self):
        fixture = make_fixture(self.directory)
        profile = json.loads(fixture['profile'].read_text(encoding='utf-8'))
        profile['signerFingerprints'] = ['00' * 32]
        fixture['profile'].write_text(json.dumps(profile), encoding='utf-8')
        result = self.check(fixture)
        self.assertEqual(result['signature'], 'pass')
        self.assertEqual(result['coverage'], 'pass')
        self.assertEqual(result['chain'], 'pass')
        self.assertEqual(result['revocation'], 'pass')
        self.assertEqual(result['issuer'], 'indeterminate')
        self.assertEqual(result['fields'], 'indeterminate')
        self.assertIsNone(result['claims'])
        self.assertIn('issuer_unverified', result['reasonCodes'])

    def test_byte_tamper(self):
        fixture = make_fixture(self.directory)
        original = fixture['signed'].read_bytes()
        self.assertIn(b'Demo Person', original)
        changed = self.directory / 'tampered.pdf'
        changed.write_bytes(original.replace(b'Demo Person', b'Dena Person', 1))
        result = self.check(fixture, changed)
        self.assertEqual(result['signature'], 'fail')
        self.assertNotEqual(result['fields'], 'pass')

    def test_incremental_append(self):
        fixture = make_fixture(self.directory)
        appended = self.directory / 'appended.pdf'
        appended.write_bytes(fixture['signed'].read_bytes() + b'\n% unsigned trailing revision\n')
        result = self.check(fixture, appended)
        self.assertNotEqual(result['coverage'], 'pass')
        self.assertNotEqual(result['fields'], 'pass')

    def test_revoked_signer(self):
        fixture = make_fixture(self.directory, revoked=True)
        result = self.check(fixture)
        self.assertEqual(result['revocation'], 'fail')
        self.assertNotEqual(result['fields'], 'pass')

    def test_validation_does_not_log_signer_details(self):
        fixture = make_fixture(self.directory, revoked=True)
        diagnostics = StringIO()
        with redirect_stderr(diagnostics):
            self.check(fixture)
        self.assertNotIn('Heirloom Local Test Issuer', diagnostics.getvalue())

    def test_unknown_revocation(self):
        fixture = make_fixture(self.directory, with_crl=False)
        result = self.check(fixture)
        self.assertEqual(result['revocation'], 'indeterminate')
        self.assertNotEqual(result['fields'], 'pass')

    def test_untrusted_signer(self):
        fixture = make_fixture(self.directory, foreign_signer=True)
        result = self.check(fixture)
        self.assertEqual(result['chain'], 'fail')
        self.assertNotEqual(result['fields'], 'pass')

    def test_qr_only_pdf(self):
        fixture = make_fixture(self.directory)
        result = self.check(fixture, fixture['unsigned'])
        self.assertIn('unsupported_document', result['reasonCodes'])
        self.assertNotEqual(result['signature'], 'pass')

    def test_multiple_signatures(self):
        fixture = make_fixture(self.directory)
        twice_signed = self.directory / 'twice-signed.pdf'
        with fixture['signed'].open('rb') as input_file, twice_signed.open('wb') as output_file:
            signers.PdfSigner(
                signers.PdfSignatureMetadata(field_name='Signature2'),
                signer=fixture['signer'],
            ).sign_pdf(IncrementalPdfFileWriter(input_file), output=output_file)
        result = self.check(fixture, twice_signed)
        self.assertIn('multiple_signatures', result['reasonCodes'])
        self.assertNotEqual(result['fields'], 'pass')


if __name__ == '__main__':
    unittest.main()
