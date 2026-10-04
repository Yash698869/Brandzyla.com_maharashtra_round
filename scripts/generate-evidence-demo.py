"""Create a disposable, synthetic signed certificate for the local judge demo."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from verifier.tests.fixtures import make_fixture  # noqa: E402


def main() -> None:
    output = ROOT / '.runtime' / 'evidence-demo'
    output.mkdir(parents=True, exist_ok=True)
    fixture = make_fixture(output)
    # The signing key is needed only while creating the PDF. Keep no private key in the demo output.
    fixture['pfx'].unlink(missing_ok=True)
    fixture['unsigned'].unlink(missing_ok=True)
    print(json.dumps({
        'pdf': str(fixture['signed'].relative_to(ROOT)),
        'profile': str(fixture['profile'].relative_to(ROOT)),
        'label': 'DEMO / NOT GOVERNMENT EVIDENCE',
    }, indent=2))


if __name__ == '__main__':
    main()
