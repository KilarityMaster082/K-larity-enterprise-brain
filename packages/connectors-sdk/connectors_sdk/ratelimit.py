"""Client-side rate limiting for calls to external source APIs.

Owner task: EB-28 Connector SDK and source registry
Borrowed from: Onyx a18fc1a backend/onyx/connectors/cross_connector_utils/rate_limit_wrapper.py (MIT),
itself inspired by https://github.com/tomasbasham/ratelimit. Adapted: thread-safe (lock), injectable
clock/sleep for tests, raises RateLimitedError (retryable) instead of a bare Exception.
Per-tenant limits across workers belong to Temporal task-queue rate limits (EB-29), not here.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from functools import wraps
from typing import Any, TypeVar, cast

from .errors import RateLimitedError

F = TypeVar("F", bound=Callable[..., Any])


class RateLimiter:
    """Allow at most `max_calls` per `period` seconds; sleep with exponential backoff when full."""

    def __init__(self, max_calls: int, period: float, *, sleep_time: float = 2.0, backoff: float = 2.0,
                 max_sleeps: int = 0, clock: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], None] = time.sleep) -> None:
        if max_calls < 1 or period <= 0:
            raise ValueError("max_calls must be >= 1 and period > 0")
        self.max_calls, self.period = max_calls, period
        self.sleep_time, self.backoff, self.max_sleeps = sleep_time, backoff, max_sleeps
        self._clock, self._sleep = clock, sleep
        self._calls: list[float] = []
        self._lock = threading.Lock()

    def acquire(self) -> None:
        sleeps = 0
        while True:
            with self._lock:
                now = self._clock()
                self._calls = [t for t in self._calls if t > now - self.period]
                if len(self._calls) < self.max_calls:
                    self._calls.append(now)
                    return
            if self.max_sleeps and sleeps >= self.max_sleeps:
                raise RateLimitedError(f"rate limit still exceeded after {sleeps} waits")
            self._sleep(self.sleep_time * (self.backoff ** sleeps))
            sleeps += 1

    def __call__(self, func: F) -> F:
        @wraps(func)
        def wrapped(*args: Any, **kwargs: Any) -> Any:
            self.acquire()
            return func(*args, **kwargs)

        return cast(F, wrapped)
