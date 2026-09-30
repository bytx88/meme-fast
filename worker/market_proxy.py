"""Bounded process-local market cache shared by concurrent Modal requests."""

import asyncio
import json
import time
from collections import OrderedDict
from email.utils import parsedate_to_datetime


class MarketProxy:
    def __init__(self, fetcher, clock=time.time, max_entries=128):
        self.fetcher = fetcher
        self.clock = clock
        self.max_entries = max_entries
        self.cache = OrderedDict()
        self.inflight = {}
        self.lock = asyncio.Lock()
        self.cooldown_until = 0

    def _retry_seconds(self, header):
        try:
            return max(60, int(header))
        except (TypeError, ValueError):
            try:
                return max(60, int(parsedate_to_datetime(header).timestamp() - self.clock()))
            except (TypeError, ValueError, OverflowError):
                return 60

    async def _fetch(self, path):
        try:
            response = await self.fetcher("https://api.geckoterminal.com/api/v2" + path)
            if response.status_code == 429:
                retry = self._retry_seconds(response.headers.get("retry-after"))
                self.cooldown_until = self.clock() + retry
                return 429, b'{"error":"The swap provider is busy. Try again in a minute."}', {"retry-after": str(retry)}
            if response.status_code != 200:
                return response.status_code, json.dumps({"error": f"The swap provider returned HTTP {response.status_code}."}).encode(), {}
            payload = response.json()
            is_info = path.split("?", 1)[0].endswith("/info")
            is_candles = "/ohlcv/" in path
            if not isinstance(payload, dict) or not isinstance(payload.get("data"), dict if is_info or is_candles else list):
                raise ValueError("Invalid market response")
            if is_candles and not isinstance(payload["data"].get("attributes", {}).get("ohlcv_list"), list):
                raise ValueError("Invalid candle response")
            ttl = 900 if is_info else 30 if path.endswith("/trades") else 60 if path.startswith("/search/") else 300
            self.cache[path] = (self.clock() + ttl, response.content)
            self.cache.move_to_end(path)
            while len(self.cache) > self.max_entries:
                self.cache.popitem(last=False)
            return 200, response.content, {}
        except Exception:
            return 502, b'{"error":"Market provider unavailable"}', {}

    async def _fetch_and_clear(self, path):
        try:
            return await self._fetch(path)
        finally:
            async with self.lock:
                if self.inflight.get(path) is asyncio.current_task():
                    del self.inflight[path]

    async def get(self, path):
        async with self.lock:
            cached = self.cache.get(path)
            if cached and cached[0] > self.clock():
                self.cache.move_to_end(path)
                return 200, cached[1], {}
            if self.clock() < self.cooldown_until:
                retry = max(1, int(self.cooldown_until - self.clock()))
                return 429, b'{"error":"The swap provider is busy. Try again in a minute."}', {"retry-after": str(retry)}
            task = self.inflight.get(path)
            if task is None:
                task = asyncio.create_task(self._fetch_and_clear(path))
                self.inflight[path] = task
        return await asyncio.shield(task)
