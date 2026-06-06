"""In-memory TTL+LRU cache for expensive query results.

Thread-safe, suitable for single-process deployments.
For multi-process/multi-instance, replace with Redis.
"""

import threading
import time
from collections import OrderedDict
from typing import Any


class TTLCache:
    """TTL cache with LRU eviction and a hard size cap.

    The size cap is a defensive measure against cache-key flooding
    (e.g. an attacker crafting many distinct values for a free-form
    filter param like `author=...`).
    """

    def __init__(self, default_ttl: int = 60, max_size: int = 512):
        self._store: OrderedDict[str, tuple[float, Any]] = OrderedDict()
        self._lock = threading.Lock()
        self._default_ttl = default_ttl
        self._max_size = max_size

    def get(self, key: str) -> Any | None:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            expires_at, value = entry
            if time.monotonic() > expires_at:
                del self._store[key]
                return None
            self._store.move_to_end(key)
            return value

    def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        with self._lock:
            expires_at = time.monotonic() + (ttl or self._default_ttl)
            if key in self._store:
                self._store.move_to_end(key)
            self._store[key] = (expires_at, value)
            while len(self._store) > self._max_size:
                self._store.popitem(last=False)

    def invalidate(self, prefix: str = "") -> None:
        """Remove all entries, or only those whose key starts with prefix."""
        with self._lock:
            if not prefix:
                self._store.clear()
            else:
                keys = [k for k in self._store if k.startswith(prefix)]
                for k in keys:
                    del self._store[k]


# Singleton — shared across the application
points_cache = TTLCache(default_ttl=60, max_size=512)
