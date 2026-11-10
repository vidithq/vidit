"""Shared fixtures for the events test package."""

from __future__ import annotations

import pytest

from app.cache import points_cache


@pytest.fixture(autouse=True)
def _clear_points_cache():
    """``points_cache`` is process-global."""
    points_cache.invalidate()
    yield
    points_cache.invalidate()
