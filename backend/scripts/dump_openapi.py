"""Dump the FastAPI OpenAPI spec as deterministic JSON to the path in argv[1].

Feeds the frontend codegen chain (``make gen-api-types``): the written spec is
read by ``openapi-typescript`` so the frontend's enum types are generated from
the backend schema rather than hand-maintained. ``sort_keys=True`` keeps the
output byte-stable across runs so the CI drift gate (``git diff --exit-code``)
only fires on a real schema change, not on dict-ordering noise. The spec goes
to a file, not stdout, so a log line printed while the app imports cannot land
in it.
"""

import json
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

from app.main import app


def main() -> None:
    Path(sys.argv[1]).write_text(json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
