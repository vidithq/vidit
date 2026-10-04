"""The import directions inside ``tweet_ingest`` that keep the engine pure.

Read off the modules' ``import`` statements: they keep the engine from
depending on a fetch, which would force stubbing X to test a pure module.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

PACKAGE = Path(__file__).resolve().parents[1] / "app" / "services" / "tweet_ingest"

# Modules that derive and never fetch (``urls`` and ``records`` are their vocabulary).
PURE_MODULES = ("records", "extract", "stitch", "resolve")

# The one module in the package allowed to chase (a network fetch).
CHASE_CALLER = "acquire"


def _imported_siblings(path: Path) -> set[str]:
    """The sibling names ``path`` imports (both spellings, including inside functions)."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            if node.level:  # a relative import, so a sibling of this module
                names.add((node.module or "").split(".")[0])
            elif (node.module or "").startswith("app.services.tweet_ingest."):
                names.add(node.module.split(".")[3])
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.startswith("app.services.tweet_ingest."):
                    names.add(alias.name.split(".")[3])
    return names - {""}


@pytest.mark.parametrize("module", PURE_MODULES)
def test_a_pure_module_never_imports_the_fetch(module: str) -> None:
    """No pure module imports ``syndication``, the X I/O."""
    assert "syndication" not in _imported_siblings(PACKAGE / f"{module}.py")


def test_only_the_acquisition_imports_the_chase() -> None:
    """``chase`` is a network fetch: only ``acquire`` imports it."""
    importers = {
        path.stem
        for path in PACKAGE.glob("*.py")
        # ``__init__`` re-exports every module by design.
        if path.stem != "__init__" and "chase" in _imported_siblings(path)
    }
    assert importers == {CHASE_CALLER}
