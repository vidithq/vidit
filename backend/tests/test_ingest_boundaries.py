"""The import directions inside ``tweet_ingest`` that keep the engine pure.

Two statements, read straight off the modules' ``import`` statements. They are
what stops the engine from growing a dependency on a fetch: a pure module that
imports one can no longer be exercised without stubbing X, and the next reader
puts I/O in it because the door is already open.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

PACKAGE = Path(__file__).resolve().parents[1] / "app" / "services" / "tweet_ingest"

# The bricks that derive everything and fetch nothing: a thread in, a resolution
# out. ``urls`` and ``records`` are the vocabulary they read.
PURE_MODULES = ("records", "extract", "stitch", "resolve")

# The modules allowed to spend the one fetch a chase costs.
CHASE_CALLERS = ("acquire", "archive")


def _imported_siblings(path: Path) -> set[str]:
    """The names ``path`` imports from inside the package, at any depth.

    Both spellings count (``from .x import y`` and ``import ...tweet_ingest.x``),
    and imports written inside a function count too: a deferred import is still
    a dependency.
    """
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
    """No pure module reads ``syndication``, the X I/O.

    The URL vocabulary those modules need lives in ``urls`` and the media type
    in ``records``, so the only thing left in ``syndication`` is the fetch and
    the payload mapping, which the engine has no business holding.
    """
    assert "syndication" not in _imported_siblings(PACKAGE / f"{module}.py")


def test_only_the_two_acquisitions_import_the_chase() -> None:
    """``chase`` is imported by ``acquire`` and ``archive`` and by nothing else.

    A chase is a network fetch, so it belongs to acquisition. A pure module
    reaching for one would mean the resolution fetches while it resolves.
    """
    importers = {path.stem for path in PACKAGE.glob("*.py") if "chase" in _imported_siblings(path)}
    assert importers == set(CHASE_CALLERS)
