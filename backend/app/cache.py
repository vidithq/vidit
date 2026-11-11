"""In-memory TTL+LRU cache. Thread-safe, for single-process deployments (use
Redis across processes)."""

import threading
import time
from collections import OrderedDict
from typing import Any


class TTLCache:
    """TTL cache with LRU eviction and a hard size cap, a defence against
    cache-key flooding (many distinct values of a free-form filter like `author`)."""

    def __init__(self, ttl: int, max_size: int):
        self._store: OrderedDict[str, tuple[float, Any]] = OrderedDict()
        self._lock = threading.Lock()
        self._ttl = ttl
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

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            if key in self._store:
                self._store.move_to_end(key)
            self._store[key] = (time.monotonic() + self._ttl, value)
            while len(self._store) > self._max_size:
                self._store.popitem(last=False)

    def invalidate(self) -> None:
        with self._lock:
            self._store.clear()


points_cache = TTLCache(ttl=60, max_size=512)
