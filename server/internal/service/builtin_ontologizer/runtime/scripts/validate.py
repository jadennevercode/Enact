#!/usr/bin/env python3
"""Run the deterministic checks from anywhere.

`python3 -m tools.validators.run` needs the package root on `sys.path` before the
interpreter can even find the module, so it only works from inside the package or
with PYTHONPATH set. This wrapper puts the root on the path first, so a skill can
call it by absolute path from whatever directory the user happens to be in.

    python3 <pkg>/scripts/validate.py <ws> --gate ready_for_review --revision r0002
    python3 <pkg>/scripts/validate.py <ws> --all --release rel-0001
"""

from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
for _extra in (_ROOT, _ROOT / "shared" / "lib"):
    if str(_extra) not in sys.path:
        sys.path.insert(0, str(_extra))

from tools.validators.run import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
