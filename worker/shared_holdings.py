"""Reusable complete wallet observations; missing coverage never means zero."""

PROGRAMS = ('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
MAX_AGE_MS = 5 * 60000


def observe(owner, responses, sampled_at, retain_mints=None):
    """Normalize both token programs without losing integer precision or slots.

    Legacy/incomplete payloads can still supply badges through the old parser,
    but cannot certify reusable balances (in particular an absent mint's zero).
    """
    if set(responses) != set(PROGRAMS):
        return None
    balances, seen, slots = {}, set(), {}
    try:
        for program in PROGRAMS:
            payload = responses[program]
            result = payload['result']
            slot = result['context']['slot']
            if payload.get('error') or type(slot) is not int or slot < 0 or not isinstance(result['value'], list):
                return None
            slots[program] = slot
            for row in result['value']:
                account, address = row['account'], row['pubkey']
                info = account['data']['parsed']['info']
                amount, mint = info['tokenAmount'], info['mint']
                raw, decimals = amount['amount'], amount['decimals']
                if (not isinstance(address, str) or not address or address in seen
                        or info['owner'] != owner or account.get('owner', program) != program
                        or not isinstance(mint, str) or not mint
                        or not isinstance(raw, str) or not raw.isascii() or not raw.isdigit()
                        or type(decimals) is not int or not 0 <= decimals <= 18):
                    return None
                seen.add(address)
                old = balances.get(mint)
                if old and (old['decimals'] != decimals or old['program'] != program):
                    return None
                balances[mint] = dict(raw=str(int(raw) + int(old['raw'] if old else 0)),
                                      decimals=decimals, program=program)
        omitted = []
        if retain_mints is not None:
            retained = set(retain_mints)
            omitted = [mint for mint,value in balances.items() if mint not in retained and int(value['raw']) > 0]
            balances = {mint:value for mint,value in balances.items() if mint in retained}
        return dict(version=1, owner=owner, sampledAt=sampled_at, complete=True,
                    programSlots=slots, balances=balances, omittedMints=omitted)
    except (KeyError, TypeError, ValueError):
        return None


def balance(observation, owner, mint, decimals, now, *, max_age_ms=MAX_AGE_MS, not_before=0):
    """Return original evidence or None, so callers fetch only a coverage miss."""
    if not isinstance(observation, dict):
        return None
    at = observation.get('sampledAt')
    slots = observation.get('programSlots', {})
    if (observation.get('version') != 1 or observation.get('owner') != owner
            or observation.get('complete') is not True or type(at) not in (int, float)
            or not not_before <= at <= now or not 0 <= now - at < max_age_ms
            or not isinstance(slots, dict)
            or set(slots) != set(PROGRAMS)
            or any(type(slot) is not int or slot < 0 for slot in slots.values())
            or not isinstance(observation.get('balances'), dict)):
        return None
    row = observation['balances'].get(mint)
    if row is None:
        if not isinstance(observation.get('omittedMints', []), list) or mint in observation.get('omittedMints', []):
            return None
        return dict(raw=0, checkedAt=at, slot=min(slots.values()), source='shared-wallet-scan')
    if not isinstance(row, dict):
        return None
    raw = row.get('raw')
    if (row.get('decimals') != decimals or row.get('program') not in PROGRAMS
            or not isinstance(raw, str) or not raw.isascii() or not raw.isdigit()):
        return None
    return dict(raw=int(raw), checkedAt=at, slot=slots[row['program']], source='shared-wallet-scan')
