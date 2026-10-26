"""Read the former FOMO most-held board only for an explicit Suggest request."""
import math
import os
import time
from contextlib import nullcontext
from datetime import datetime

from worker.meme_preset import read_config, validate_members

SOURCE = 'FOMO most-held'
ENDPOINT = 'https://api.fomoapi.io/v2/leaderboard/tokens/most-held'
NETWORKS = {1399811149: 'solana', 4663: 'robinhood', 56: 'bsc', 1: 'ethereum', 8453: 'base'}
MAX_BOARD_AGE = 3_600_000
MAX_ROWS = 25
MAX_RESPONSE_BYTES = 2_000_000


class Unavailable(ValueError):
    """A safe user-facing provider failure, without credentials or response bodies."""


def _positive_integer(value):
    return type(value) in (int, float) and math.isfinite(value) and value > 0 and value == int(value)


def _captured_at(value, now):
    if not isinstance(value, str):
        raise Unavailable('FOMO returned an invalid leaderboard observation time. No ranking was loaded.')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise ValueError
        stamp = parsed.timestamp()*1000
    except (ValueError, TypeError, OverflowError):
        raise Unavailable('FOMO returned an invalid leaderboard observation time. No ranking was loaded.') from None
    if not math.isfinite(stamp) or not 0 <= now-stamp <= MAX_BOARD_AGE:
        raise Unavailable('The FOMO leaderboard is stale. No ranking was loaded.')
    return stamp


def ranked_suggestions(payload, config, *, now=None):
    """Normalize a live board; ranking and holder counts are never price signals."""
    config = read_config(config)
    now = int(time.time()*1000) if now is None else now
    if isinstance(payload, dict) and payload.get('available') is False:
        raise Unavailable('FOMO most-held leaderboard is currently unavailable. No ranking was loaded.')
    if not isinstance(payload, dict) or payload.get('source') != 'live-fomo' or payload.get('board') != 'most-held':
        raise Unavailable('FOMO returned an unrecognized most-held leaderboard. No ranking was loaded.')
    if payload.get('stale'):
        raise Unavailable('The FOMO leaderboard is stale. No ranking was loaded.')
    stamp = _captured_at(payload.get('capturedAt'), now)
    rows = payload.get('tokens')
    if not isinstance(rows, list) or len(rows) > MAX_ROWS:
        raise Unavailable('FOMO returned an invalid most-held leaderboard. No ranking was loaded.')
    active = {(member['network'], member['contract_address']) for member in config['members']}
    candidates = []
    for position, row in enumerate(rows):
        if not isinstance(row, dict) or not _positive_integer(row.get('rank')):
            continue
        network_id = row.get('network')
        network = NETWORKS.get(network_id) if type(network_id) is int else None
        token = row.get('token')
        if network is None or not isinstance(token, dict):
            continue
        try:
            member = validate_members([dict(network=network, contract_address=token.get('address'),
                                            symbol=token.get('symbol'), name=token.get('name'))])[0]
        except ValueError:
            continue
        identity = (member['network'], member['contract_address'])
        # The current most-held contract permits null: FOMO does not send holder
        # counts on that board. Absence must never discard the ranked token.
        holders = row.get('holders')
        holders = int(holders) if type(holders) in (int, float) and math.isfinite(holders) and holders >= 0 and holders == int(holders) else None
        candidates.append((int(row['rank']), position, identity, member, holders))
    candidates.sort(key=lambda candidate: (candidate[0], candidate[1]))
    selected, seen = [], set(active)
    for rank, _, identity, member, holders in candidates:
        if identity in seen:
            continue
        seen.add(identity)
        selected.append(dict(member, id=identity[0]+':'+identity[1], rank=rank, holders=holders,
                             observedAt=stamp, source=SOURCE, quoteStatus='not_requested',
                             reasons=[f'FOMO most-held rank #{rank}', f'{holders:,} holders' if holders is not None else 'Holder count not provided by FOMO',
                                      'Price quote will be collected after this member is saved']))
    return dict(suggestions=selected, observedAt=stamp, source=SOURCE,
                note=('Live FOMO most-held ranking, in FOMO rank order. Existing basket members are omitted. '
                      'Suggestions do not change membership; add to the draft and save to apply.'))


def fetch_suggestions(config, *, client=None, key=None, now=None):
    """One authenticated request, without retries, saved seed, or other providers."""
    config = read_config(config)
    credential = os.environ.get('FOMO_KEY') if key is None else key
    if not isinstance(credential, str) or not credential.strip() or any(ord(char) < 32 for char in credential):
        raise Unavailable('FOMO authentication is unavailable. No ranking was loaded.')
    if client is None:
        import httpx
        context = httpx.Client(timeout=12, follow_redirects=False)
    else:
        context = nullcontext(client)
    try:
        with context as connection:
            response = connection.get(ENDPOINT, params={'limit': MAX_ROWS},
                                      headers={'authorization': 'Bearer '+credential.strip(),
                                               'accept': 'application/json'})
            if response.status_code in (401, 403):
                raise Unavailable('FOMO authentication is unavailable. No ranking was loaded.')
            if response.status_code == 429:
                raise Unavailable('FOMO rate limit reached. Try Suggest again later.')
            if response.status_code == 402:
                raise Unavailable('FOMO credits are unavailable. No ranking was loaded.')
            if response.status_code != 200:
                raise Unavailable('FOMO leaderboard is unavailable. Try Suggest again later.')
            if len(response.content) > MAX_RESPONSE_BYTES:
                raise Unavailable('FOMO returned an invalid most-held leaderboard. No ranking was loaded.')
            payload = response.json()
    except Unavailable:
        raise
    except Exception:
        raise Unavailable('FOMO leaderboard is unavailable. Try Suggest again later.') from None
    now = int(time.time()*1000) if now is None else now
    return ranked_suggestions(payload, config, now=now)
