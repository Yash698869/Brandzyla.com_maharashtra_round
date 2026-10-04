"""Explicit evidence issuer profiles. No government issuer is enabled yet."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

from asn1crypto import pem, x509


class ProfileError(ValueError):
    pass


def load_profile(profile_id: str) -> dict:
    if profile_id != 'test-local':
        raise ProfileError('issuer_profile_unavailable')
    path = os.environ.get('HEIRLOOM_TEST_EVIDENCE_PROFILE')
    if not path:
        raise ProfileError('issuer_profile_unavailable')
    try:
        data = json.loads(Path(path).read_text(encoding='utf-8'))
        if data.get('id') != 'test-local' or data.get('kind') != 'test':
            raise ProfileError('issuer_profile_invalid')
        root_bytes = Path(data['rootPem']).read_bytes()
        if pem.detect(root_bytes):
            _, _, root_bytes = pem.unarmor(root_bytes)
        root = x509.Certificate.load(root_bytes)
        fingerprint = hashlib.sha256(root.dump()).hexdigest()
        if fingerprint != data['rootFingerprint'].lower():
            raise ProfileError('trust_anchor_mismatch')
        signer_fingerprints = frozenset(value.lower() for value in data['signerFingerprints'])
        if not signer_fingerprints or any(len(value) != 64 for value in signer_fingerprints):
            raise ProfileError('issuer_profile_invalid')
        crls = [Path(filename).read_bytes() for filename in data.get('crlFiles', [])]
        return {
            'id': 'test-local',
            'kind': 'test',
            'label': 'Heirloom local test issuer',
            'root': root,
            'root_fingerprint': fingerprint,
            'signer_fingerprints': signer_fingerprints,
            'crls': crls,
        }
    except ProfileError:
        raise
    except (KeyError, OSError, ValueError, TypeError) as exc:
        raise ProfileError('issuer_profile_invalid') from exc
