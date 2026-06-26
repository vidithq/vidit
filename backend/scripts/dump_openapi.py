"""Dump the FastAPI OpenAPI spec to stdout as deterministic JSON.

Feeds the frontend codegen chain (``make gen-api-types``): the emitted spec is
piped to ``openapi-typescript`` so the frontend's enum types are generated from
the backend schema rather than hand-maintained. ``sort_keys=True`` keeps the
output byte-stable across runs so the CI drift gate (``git diff --exit-code``)
only fires on a real schema change, not on dict-ordering noise.
"""

import json
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

from app.main import app


def main() -> None:
    print(json.dumps(app.openapi(), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
