"""Canonical X handle normalization — the single source of truth.

Every path that *stores* or *looks up* a handle on ``users.x_handle`` (the
OAuth claim/link/register resolver in :mod:`app.services.x_oauth_binding`, the
detection backfill owner in :mod:`app.services.detection`) routes through this,
so the UNIQUE column never mints case- or ``@``-variant duplicates.

``tweet_ingest.syndication.normalise_tweet_url`` keeps its own handle parsing
for building the canonical tweet *link*; this is the normalizer for *storage*.
"""

from __future__ import annotations


def normalize_handle(raw: str) -> str:
    """Reduce an X handle to its storage form: trimmed, no leading ``@``, lower.

    ``"@Alice"`` → ``"alice"``; ``"  Bob "`` → ``"bob"``. Idempotent.
    """
    return raw.strip().lstrip("@").strip().lower()
