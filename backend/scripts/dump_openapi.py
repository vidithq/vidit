"""Dump the FastAPI OpenAPI spec as deterministic JSON to the path in argv[1].

Feeds the frontend codegen (``make gen-api-types``, ``openapi-typescript``).
``sort_keys=True`` keeps the output byte-stable so the CI drift gate
(``git diff --exit-code``) fires only on a real schema change. Written to a
file, not stdout, so an import-time log line can't land in it.
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
