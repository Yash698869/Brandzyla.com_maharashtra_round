"""Fail-closed PDF evidence verifier. stdout is JSON; claims are transient."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
from datetime import date, timedelta
from pathlib import Path

from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.validation import validate_pdf_signature
from pyhanko.sign.validation.status import SignatureCoverageLevel
from pyhanko_certvalidator import ValidationContext
from pyhanko_certvalidator.policy_decl import CertRevTrustPolicy, RevocationCheckingPolicy, RevocationCheckingRule
from pypdf import PdfReader

from verifier.issuer_profiles import ProfileError, load_profile


for _library in ('pyhanko', 'pyhanko_certvalidator'):
    logging.getLogger(_library).addHandler(logging.NullHandler())
    logging.getLogger(_library).propagate = False


CHECKS = ('signature', 'coverage', 'chain', 'revocation', 'issuer', 'fields')


def _result(label='Unconfigured issuer'):
    return {**{key: 'indeterminate' for key in CHECKS}, 'signerFingerprint': None,
            'issuerLabel': label, 'claims': None, 'reasonCodes': []}


def _reason(result: dict, code: str):
    if code not in result['reasonCodes']:
        result['reasonCodes'].append(code)
    return result


def _validation_context(profile: dict, *, require_revocation: bool):
    rule = RevocationCheckingRule.CRL_OR_OCSP_REQUIRED if require_revocation else RevocationCheckingRule.NO_CHECK
    policy = CertRevTrustPolicy(
        RevocationCheckingPolicy(ee_certificate_rule=rule, intermediate_ca_cert_rule=rule),
        freshness=timedelta(days=7) if require_revocation else None,
    )
    return ValidationContext(
        trust_roots=[profile['root']],
        crls=profile['crls'] if require_revocation else None,
        allow_fetching=False,
        revinfo_policy=policy,
    )


def _extract_test_claims(path: str):
    reader = PdfReader(path, strict=True)
    if len(reader.pages) != 1:
        return None
    page = reader.pages[0]
    text = page.extract_text() or ''
    patterns = {
        'name': r'(?m)^Name:\s*([^\r\n]+)$',
        'identifier': r'(?m)^Identifier:\s*([A-Z0-9-]+)$',
        'dateOfDeath': r'(?m)^Date of Death:\s*(\d{4}-\d{2}-\d{2})$',
    }
    matches = {key: re.findall(pattern, text) for key, pattern in patterns.items()}
    if any(len(values) != 1 for values in matches.values()):
        return None
    claims = {key: values[0].strip() for key, values in matches.items()}
    try:
        death_date = date.fromisoformat(claims['dateOfDeath'])
    except ValueError:
        return None
    if death_date > date.today() or death_date < date(1900, 1, 1):
        return None
    return claims


def verify_pdf(path: str, profile_id: str) -> dict:
    result = _result()
    try:
        profile = load_profile(profile_id)
    except ProfileError as exc:
        result['issuer'] = 'fail'
        return _reason(result, str(exc))
    result['issuerLabel'] = profile['label']
    file_path = Path(path)
    try:
        if file_path.stat().st_size > 10 * 1024 * 1024 or file_path.stat().st_size < 8:
            result['signature'] = 'fail'
            return _reason(result, 'invalid_pdf')
        with file_path.open('rb') as source:
            if source.read(5) != b'%PDF-':
                result['signature'] = 'fail'
                return _reason(result, 'invalid_pdf')
            source.seek(0)
            reader = PdfFileReader(source, strict=True)
            signatures = reader.embedded_signatures
            if not signatures:
                result['signature'] = 'fail'
                return _reason(result, 'unsupported_document')
            if len(signatures) != 1:
                result['signature'] = 'fail'
                return _reason(result, 'multiple_signatures')
            embedded = signatures[0]
            base = validate_pdf_signature(embedded, signer_validation_context=_validation_context(profile, require_revocation=False))
            if not (base.intact and base.valid):
                result['signature'] = 'fail'
                return _reason(result, 'invalid_signature')
            result['signature'] = 'pass'
            byte_range = [int(n) for n in embedded.sig_object['/ByteRange']]
            if (base.coverage != SignatureCoverageLevel.ENTIRE_FILE or len(byte_range) != 4 or
                    byte_range[0] != 0 or byte_range[2] + byte_range[3] != file_path.stat().st_size):
                result['coverage'] = 'fail'
                return _reason(result, 'incomplete_signature_coverage')
            result['coverage'] = 'pass'
            signer = base.signing_cert
            fingerprint = hashlib.sha256(signer.dump()).hexdigest()
            result['signerFingerprint'] = fingerprint
            if base.trust_problem_indic is not None or base.validation_path is None:
                result['chain'] = 'fail'
                return _reason(result, 'untrusted_signer')
            result['chain'] = 'pass'
            strict = validate_pdf_signature(embedded, signer_validation_context=_validation_context(profile, require_revocation=True))
            if strict.trust_problem_indic is not None or strict.validation_path is None:
                indication = str(strict.trust_problem_indic or '').lower()
                result['revocation'] = 'fail' if 'revoked' in indication else 'indeterminate'
                return _reason(result, 'revoked_signer' if result['revocation'] == 'fail' else 'revocation_unknown')
            result['revocation'] = 'pass'
            if fingerprint not in profile['signer_fingerprints']:
                result['issuer'] = 'fail'
                return _reason(result, 'issuer_mismatch')
            result['issuer'] = 'pass'
        claims = _extract_test_claims(path)
        if claims is None:
            result['fields'] = 'fail'
            return _reason(result, 'unsupported_fields')
        result['fields'] = 'pass'
        result['claims'] = claims
        return result
    except Exception:
        result['signature'] = 'fail' if result['signature'] == 'indeterminate' else result['signature']
        return _reason(result, 'verification_error')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--profile', required=True)
    args = parser.parse_args()
    print(json.dumps(verify_pdf(args.input, args.profile), separators=(',', ':')))


if __name__ == '__main__':
    main()
