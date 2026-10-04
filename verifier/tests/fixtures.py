"""Disposable signed-PDF fixtures. All keys stay in a temporary directory."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.sign import signers
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject


def _key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _name(common_name: str):
    return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, common_name)])


def _certificate(subject, issuer, public_key, issuer_key, serial, is_ca=False):
    now = datetime.now(timezone.utc)
    builder = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(public_key)
        .serial_number(serial)
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=30))
        .add_extension(x509.BasicConstraints(ca=is_ca, path_length=0 if is_ca else None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=not is_ca,
                content_commitment=not is_ca,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=is_ca,
                crl_sign=is_ca,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
    )
    return builder.sign(issuer_key, hashes.SHA256())


def _pdf(path: Path):
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    font = DictionaryObject(
        {NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')}
    )
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): font})})
    stream = DecodedStreamObject()
    stream.set_data(b'BT /F1 12 Tf 72 720 Td (Name: Demo Person) Tj 0 -18 Td (Identifier: DEMO-042) Tj 0 -18 Td (Date of Death: 2026-10-01) Tj ET')
    page[NameObject('/Contents')] = writer._add_object(stream)
    with path.open('wb') as output:
        writer.write(output)


def make_fixture(directory: Path, *, revoked=False, with_crl=True, foreign_signer=False):
    directory.mkdir(parents=True, exist_ok=True)
    ca_key = _key()
    ca_subject = _name('Heirloom Local Test CA')
    ca_cert = _certificate(ca_subject, ca_subject, ca_key.public_key(), ca_key, 1001, is_ca=True)
    signer_key = _key()
    signer_subject = _name('Heirloom Local Test Issuer')
    signer_ca_key = _key() if foreign_signer else ca_key
    signer_ca_subject = _name('Foreign Test CA') if foreign_signer else ca_subject
    signer_ca_cert = (
        _certificate(signer_ca_subject, signer_ca_subject, signer_ca_key.public_key(), signer_ca_key, 1003, is_ca=True)
        if foreign_signer else ca_cert
    )
    signer_cert = _certificate(signer_subject, signer_ca_subject, signer_key.public_key(), signer_ca_key, 1002)
    root_path = directory / 'test-root.pem'
    root_path.write_bytes(ca_cert.public_bytes(serialization.Encoding.PEM))
    crl_path = directory / 'test.crl'
    now = datetime.now(timezone.utc)
    crl_builder = x509.CertificateRevocationListBuilder().issuer_name(ca_subject).last_update(now - timedelta(minutes=1)).next_update(now + timedelta(days=1))
    if revoked:
        revoked_cert = x509.RevokedCertificateBuilder().serial_number(signer_cert.serial_number).revocation_date(now - timedelta(hours=1)).build()
        crl_builder = crl_builder.add_revoked_certificate(revoked_cert)
    crl_path.write_bytes(crl_builder.sign(ca_key, hashes.SHA256()).public_bytes(serialization.Encoding.DER))
    pfx_path = directory / 'signer.p12'
    pfx_path.write_bytes(pkcs12.serialize_key_and_certificates(
        b'Heirloom Test Signer', signer_key, signer_cert, [signer_ca_cert], serialization.BestAvailableEncryption(b'test-only')
    ))
    unsigned = directory / 'unsigned.pdf'
    signed = directory / 'signed.pdf'
    _pdf(unsigned)
    signer = signers.SimpleSigner.load_pkcs12(str(pfx_path), passphrase=b'test-only')
    with unsigned.open('rb') as input_file, signed.open('wb') as output_file:
        signers.PdfSigner(signers.PdfSignatureMetadata(field_name='Signature1'), signer=signer).sign_pdf(
            IncrementalPdfFileWriter(input_file), output=output_file
        )
    profile = directory / 'profile.json'
    profile.write_text(json.dumps({
        'id': 'test-local',
        'kind': 'test',
        'label': 'Heirloom local test issuer',
        'rootPem': str(root_path),
        'rootFingerprint': ca_cert.fingerprint(hashes.SHA256()).hex(),
        'signerFingerprints': [signer_cert.fingerprint(hashes.SHA256()).hex()],
        'crlFiles': [str(crl_path)] if with_crl else [],
    }), encoding='utf-8')
    return {'signed': signed, 'unsigned': unsigned, 'profile': profile, 'signer': signer, 'pfx': pfx_path}
