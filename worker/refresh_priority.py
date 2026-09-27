"""Bounded contract-only refresh requests; no watchlist titles or account data."""
import re

PRIORITY_TTL = 86400000
TOKEN = re.compile(r"(?:solana:[1-9A-HJ-NP-Za-km-z]{32,44}|(?:base|robinhood):0x[a-fA-F0-9]{40})")


def valid_priority_ids(ids):
    if not isinstance(ids, list) or not 1 <= len(ids) <= 30 or any(
        not isinstance(item, str) or not TOKEN.fullmatch(item) for item in ids
    ):
        raise ValueError("Request 1 to 30 supported token contracts")
    return list(dict.fromkeys(item if item.startswith("solana:") else item.lower() for item in ids))
