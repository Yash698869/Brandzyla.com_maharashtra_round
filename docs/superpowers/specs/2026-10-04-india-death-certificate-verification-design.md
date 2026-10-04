# Heirloom: Indian digital death-certificate verification

Date: 2026-10-04
Status: design approved in conversation; written spec awaiting user review

## Intent and evidence boundary

Give guardians a cryptographically checked death-certificate evidence receipt during a recovery request. The first real issuer target is India DigiLocker/CRS. No genuine digitally signed DigiLocker/CRS death-certificate PDF is available yet, so the implementation must not claim that issuer or field compatibility has been proven. The existing 2-of-3 guardian approval, owner cancellation window, and on-chain finalization remain the only release authorization. A PDF upload never initiates, approves, or finalizes recovery.

Success for the implementable stage is an end-to-end local demonstration with a clearly labeled test issuer, including altered-PDF and revoked/unknown-certificate failures, plus a fail-closed configuration path for an authentic Indian issuer. A real government-verified badge becomes available only after issuer-specific signer identity and document field extraction are configured and validated against an authentic sample.

## Approach

Use a small Python verifier process with pyHanko for PDF/CMS and certificate-path validation, called by the existing Node relay with bounded input, output, and runtime. Keep the relay as the sole API and persistence layer. A generic X.509 signature check alone is insufficient: an India CCA root may anchor signatures from non-government subscribers. An official DigiLocker/CRS QR or portal-only document, or a PDF without a compatible embedded signature, is unsupported by this path and must be reported as such, not accepted.

The verifier's signed-PDF checks are separate: (1) structurally valid embedded CMS/PDF signature, (2) cryptographic integrity of signed bytes, (3) signature coverage of the entire final file with no later incremental changes accepted, (4) signer certificate chain to a configured, fingerprint-pinned Indian CCA trust anchor, (5) signer and intermediate revocation status from valid embedded OCSP/CRL evidence or an allowed responder, (6) exact issuer-profile signer certificate or organization policy match, and (7) profile-specific extraction of deceased identity fields from the signed final revision. Any missing, indeterminate, expired, revoked, or mismatched check blocks a positive result. Valid cryptography without an approved issuer profile is reported as `signed, issuer unverified`.

Do not dynamically trust roots or issuer names supplied by a PDF. A CCA root downloaded from the official site is not active until its fingerprint is checked against an independent official channel and pinned in configuration. A real issuer profile needs independently checked signer certificate fingerprints or a tightly defined certificate policy and tested parsing rules. OCSP/CRL network destinations must be allowlisted by that profile; unavailable or stale revocation evidence is `indeterminate`, never `good`. Validation time and trusted timestamps must be explicit; self-asserted PDF dates do not establish historic validity.

## Identity enrollment and matching

While a vault is active and before any recovery request, its owner enrolls a legal name and a stable identifier that the target certificate is expected to contain. The browser computes a salted, deliberately slow commitment from the canonicalized fields and asks the on-chain owner wallet to sign a domain-separated record bound to chain ID, contract address, vault ID, and commitment version. The relay verifies the signature and stores the commitment, salt, and signature; it does not retain the plaintext fields. Existing vaults can enroll without contract migration. Enrollment is immutable for that vault in this stage; a later correction requires a fresh vault or a separately designed owner-authorized rotation flow. Enrollment after a claim begins is rejected.

At verification, extracted name and identifier are normalized by the issuer profile and recomputed against the enrolled commitment. A missing identifier, ambiguous extraction, or absent enrollment yields `identity unverified`, not a match. Date of death cannot be compared with a value enrolled before death; the profile validates its presence, parseability, plausibility, and signed-document provenance, and the receipt reports it separately. This is evidence of a claim, not a mathematical proof that a person has died. A salted commitment reduces direct exposure but is not a zero-knowledge proof and may still permit guessing if the identifier has low entropy; do not request Aadhaar data merely for a demo.

## API, storage, and UI

The guardian inbox gains an evidence upload and a check-by-check receipt for the current vault/request. The upload endpoint accepts only a live authenticated session for a guardian designated on that vault and a current recovery request, with a 10 MiB PDF limit. The relay verifies chain state, runs the verifier with a 20-second timeout, then persists only the PDF SHA-256 digest, vault/request binding, signer fingerprint and non-sensitive issuer label, check statuses, verification timestamp, and error codes. It never stores the raw PDF or extracted identity fields. A receipt from an old request is displayed as historical and cannot be used for a new request. Designated guardians can read the current receipt; access control is enforced by the relay, not only the UI.

The UI distinguishes `government issuer verified`, `test issuer verified`, `signed but issuer unverified`, `indeterminate`, and `failed`. The first status is impossible without active, independently pinned India trust anchors, an approved DigiLocker/CRS issuer profile, current revocation evidence, and a successful identity match. The local test issuer and generated PDF are visibly marked `DEMO / NOT GOVERNMENT EVIDENCE`. Guardian approval remains an independent action with an explanation that the guardian must consider all evidence and the owner's circumstances.

## Errors, privacy, and operational limits

Reject oversized/non-PDF input, malformed ByteRange, duplicate or unsupported signatures, untrusted chains, missing final-file coverage, unavailable or stale revocation, unconfigured issuers, unsupported field layouts, missing enrollment, and mismatched identity. Return stable reason codes without leaking names or identifiers to logs or the receipt. Bound verifier CPU time and memory as practicable; do not follow arbitrary URLs embedded in an untrusted PDF or certificate. Keep raw uploads in memory or a restricted temporary file deleted on every outcome. Use fixed dependency versions and document the Python runtime prerequisite.

Verification results describe the state observed at verification time. Later revocation or issuer-key compromise can change that assessment. The receipt is relay data, not an on-chain or independently signed government attestation, and neither a successful receipt nor a guardian's approval certifies legal validity. Public testnet deployment, QR-code validation, government API access, and legal adjudication are outside this stage.

## Verification and demonstration

Create synthetic local test CA and signed-PDF fixtures. Test valid full-file signature, a byte changed inside the signed revision, appended incremental changes, untrusted signer, revoked signer, unavailable/stale revocation, unsupported issuer, no enrollment, identity mismatch, stale request receipt, and unauthorized upload/read. Exercise the guardian UI against a local recovery request, then run the existing relay/contract tests and production build. The judge demo shows a green test-issuer receipt and a failed tampered copy, with the live DigiLocker/CRS lane visibly pending an authentic sample and issuer configuration.

## Sources

- India CCA root certificates and out-of-band fingerprint process: https://cca.gov.in/root_certificate.html
- India CCA signature verification and chain/revocation requirements: https://cca.gov.in/signature_verification.html
- India CCA certificate policy and CA scope: https://www.cca.gov.in/faq.html
- DigiLocker government circular listing QR, digital-signature, and issuer-portal verification methods: https://cdn.digilocker.gov.in/assets/img/circulars/Letter-to-All-State-Governments-UTs.pdf
- pyHanko validation and modification analysis: https://docs.pyhanko.eu/en/latest/lib-guide/validation/status.html and https://docs.pyhanko.eu/en/latest/lib-guide/validation/diff-analysis.html
