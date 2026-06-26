"""The canonical handle normalizer — ``services.handles.normalize_handle``.

The single source of truth that keeps ``users.x_handle`` from minting case- or
``@``-variant duplicates across the OAuth resolver and the detection backfill.
"""

from __future__ import annotations

import pytest

from app.services.handles import normalize_handle


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("@Alice", "alice"),
        ("alice", "alice"),
        ("ALICE", "alice"),
        ("  bob  ", "bob"),
        (" @Bob ", "bob"),
        ("@@x", "x"),  # lstrip drops every leading @
        ("MixedCase_99", "mixedcase_99"),
    ],
)
def test_normalize_handle(raw: str, expected: str) -> None:
    assert normalize_handle(raw) == expected


def test_normalize_handle_is_idempotent() -> None:
    once = normalize_handle("@Analyst_27")
    assert normalize_handle(once) == once
