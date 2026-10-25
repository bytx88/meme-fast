"""Project richer Gecko entity observations without fetching them again.

Only primary token/pool entities with the complete market contract participate.
An include changes related resources, never the primary market representation.
Every other query parameter must match exactly. The three deployed contracts use
fixed-key probes so existing observations work immediately after deployment and
provider responses retain the full cache capacity. A bounded index (eight other
contracts per entity/scope) stores query names in the normal bounded cache for
uncommon include combinations. Projection retains the source sample time and
cannot outlive either the source expiry or the requested TTL.
"""
import json
import re
from urllib.parse import parse_qsl, urlencode

MAX_CONTRACTS = 8


def _canonical(network, address):
    return address.lower() if network != 'solana' and re.fullmatch(r'0x[0-9A-Fa-f]+', address) else address


def _contract(query):
    params = parse_qsl(query, keep_blank_values=True)
    if len({name for name, _ in params}) != len(params):
        return None
    includes = dict(params).get('include', '')
    paths = sorted(set(includes.split(','))) if includes else []
    if len(paths) > 16 or any(not re.fullmatch(r'[A-Za-z_]\w*(?:\.[A-Za-z_]\w*){0,3}', path) for path in paths):
        return None
    base = urlencode(sorted((name, value) for name, value in params if name != 'include'))
    return base, paths


def _known_queries(base):
    params = parse_qsl(base, keep_blank_values=True)
    return [urlencode(sorted([*params, ('include', include)])) if include else base
            for include in ('', 'base_token,quote_token', 'top_pools')]


def _cached(stream, namespace, parameters):
    row = stream.db.execute('SELECT expires,sampled,body FROM responses WHERE key=?',
                            (stream.key(namespace, parameters),)).fetchone()
    if not row or not row[1] <= stream.clock() < row[0]:
        return None
    try:
        return row[0], row[1], json.loads(row[2])
    except (TypeError, ValueError):
        return None


def retained_ttl(stream, namespace, parameters, observed_at, ttl):
    """Bound a replay by its retained observation's actual original expiry.

    Read metadata only; a provider response larger than the bounded cache still
    uses its original caller TTL. The caller captures this before other misses
    can evict the retained record or consume the remaining freshness interval.
    """
    saved = stream.db.execute('SELECT expires,sampled FROM responses WHERE key=?',
                              (stream.key(namespace, parameters),)).fetchone()
    if saved and int(saved[1] * 1000) == observed_at:
        return min(ttl, max(0, saved[0] - observed_at / 1000))
    return ttl


def _document(body):
    if (not isinstance(body, dict) or not isinstance(body.get('data'), list)
            or not isinstance(body.get('included', []), list)):
        return None
    indexed = {}
    for row in [*body['data'], *body.get('included', [])]:
        if (not isinstance(row, dict) or not isinstance(row.get('type'), str)
                or not isinstance(row.get('id'), str) or not isinstance(row.get('relationships', {}), dict)):
            return None
        identity = row['type'], row['id']
        if identity in indexed and indexed[identity] != row:
            return None
        indexed[identity] = row
        for rel in row.get('relationships', {}).values():
            if not isinstance(rel, dict):
                return None
            refs = rel.get('data')
            if any(ref is not None and (not isinstance(ref, dict) or not isinstance(ref.get('type'), str)
                                       or not isinstance(ref.get('id'), str))
                   for ref in (refs if isinstance(refs, list) else [refs])):
                return None
    return indexed


def complete_entity(row, network, kind, address):
    """Never promote display metadata or partial pool rows to market evidence."""
    if (not isinstance(row, dict) or row.get('type') != ('token' if kind == 'tokens' else 'pool')
            or not isinstance(row.get('id'), str) or not row['id'].startswith(network + '_')
            or _canonical(network, row['id'][len(network) + 1:]) != _canonical(network, address)):
        return False
    attrs = row.get('attributes')
    if (not isinstance(attrs, dict) or not isinstance(attrs.get('address'), str)
            or _canonical(network, attrs['address']) != _canonical(network, address)):
        return False
    if kind == 'tokens':
        return ('total_reserve_in_usd' in attrs and isinstance(attrs.get('volume_usd'), dict)
                and 'h24' in attrs['volume_usd'])
    return (kind == 'pools' and {'base_token_price_usd', 'quote_token_price_usd', 'reserve_in_usd',
                              'volume_usd', 'transactions', 'price_change_percentage'}.issubset(attrs)
            and all(isinstance(attrs[key], dict) for key in ('volume_usd', 'transactions', 'price_change_percentage')))


def _project(body, network, kind, address, paths):
    indexed = _document(body)
    if indexed is None or len(body['data']) != 1 or not complete_entity(body['data'][0], network, kind, address):
        return None
    root = body['data'][0]
    selected = {}
    for path in paths:
        current = [root]
        for relation in path.split('.'):
            next_rows = []
            for row in current:
                rel = row.get('relationships', {}).get(relation)
                if not isinstance(rel, dict) or 'data' not in rel:
                    return None
                refs = rel['data']
                for ref in refs if isinstance(refs, list) else [refs]:
                    if ref is None:
                        continue
                    identity = ref['type'], ref['id']
                    if identity not in indexed:
                        return None
                    target = indexed[identity]
                    if identity != (root['type'], root['id']):
                        selected[identity] = target
                    next_rows.append(target)
            current = next_rows
    value = {'data': [root]}
    if paths:
        value['included'] = list(selected.values())
    return value


def index_entity(stream, network, kind, address, query):
    """Call after a gecko:entity write; validates the actual retained record."""
    contract = _contract(query)
    if contract is None:
        return
    base, paths = contract
    if query in _known_queries(base):
        return  # Fixed-key lookup needs no extra record or cache-capacity cost.
    address = _canonical(network, address)
    saved = _cached(stream, 'gecko:entity', [2, network, kind, address, query])
    if saved is None or _project(saved[2], network, kind, address, paths) is None:
        return
    index_key = [1, network, kind, address, base]
    old = _cached(stream, 'gecko:contracts', index_key)
    candidates = old[2] if old and isinstance(old[2], list) else []
    retained = []
    for candidate in set([query, *(value for value in candidates if isinstance(value, str))]):
        entry = _cached(stream, 'gecko:entity', [2, network, kind, address, candidate])
        if entry is not None:
            retained.append((entry[1], entry[0], candidate))
    retained.sort(reverse=True)
    retained = retained[:MAX_CONTRACTS]
    if retained:
        queries = [row[2] for row in retained]
        if old and old[2] == queries and old[0] >= max(row[1] for row in retained):
            return
        # This timestamp belongs only to the lookup index, never provider data.
        now_ms = int(stream.clock() * 1000)
        stream.store('gecko:contracts', index_key, queries, now_ms,
                     max(row[1] for row in retained) - now_ms / 1000)


def lookup_entity(stream, network, kind, address, query, ttl):
    """Return a compatible observation, or None so the caller fetches the miss.

    Writes the projected exact key with the original expiry, allowing ordinary
    batch overlap logic to keep pulling only genuinely missing entities.
    """
    contract = _contract(query)
    if contract is None:
        return None
    base, requested = contract
    address = _canonical(network, address)
    index = _cached(stream, 'gecko:contracts', [1, network, kind, address, base])
    # The fixed probes also migrate retained pre-index data without a new pull.
    queries = index[2][:MAX_CONTRACTS] if index and isinstance(index[2], list) else []
    queries = list(dict.fromkeys([*(value for value in queries if isinstance(value, str)), *_known_queries(base)]))
    candidates = []
    for candidate in queries:
        source_contract = _contract(candidate)
        if source_contract is None or source_contract[0] != base:
            continue
        available = source_contract[1]
        if not all(any(path == existing or existing.startswith(path + '.') for existing in available)
                   for path in requested):
            continue
        saved = _cached(stream, 'gecko:entity', [2, network, kind, address, candidate])
        if saved is None or saved[1] + ttl <= stream.clock():
            continue
        if _project(saved[2], network, kind, address, available) is None:
            continue
        value = _project(saved[2], network, kind, address, requested)
        if value is not None:
            candidates.append((saved[1], saved[0], value))
    if not candidates:
        return None
    sampled, expires, value = max(candidates, key=lambda candidate: candidate[0])
    key = [2, network, kind, address, query]
    stream.store('gecko:entity', key, value, int(sampled * 1000), min(ttl, expires - sampled))
    return stream.lookup('gecko:entity', key)


def seed_top_pools(stream, network, body, observed_at, ttl, query='include=top_pools'):
    """Reuse complete pool resources from token-multi launchpad observations.

    This certifies individual pools only, never a token's complete pool list or
    token aggregate activity. Base/quote includes are certified only when their
    exact resources are present in the same observation.
    """
    contract = _contract(query)
    if contract is None or contract[0] or not any(path == 'top_pools' or path.startswith('top_pools.') for path in contract[1]):
        return
    indexed = _document(body)
    if indexed is None:
        return
    for token in body['data']:
        if token['type'] != 'token' or not token['id'].startswith(network + '_'):
            continue
        refs = token.get('relationships', {}).get('top_pools', {}).get('data')
        for ref in refs if isinstance(refs, list) else [refs]:
            if ref is None or ref.get('type') != 'pool':
                continue
            pool = indexed.get((ref['type'], ref['id']))
            if pool is None or not pool['id'].startswith(network + '_'):
                continue
            address = _canonical(network, pool['id'][len(network) + 1:])
            if not complete_entity(pool, network, 'pools', address):
                continue
            document = {'data': [pool], 'included': list(indexed.values())}
            for relations in ([], ['base_token', 'quote_token']):
                value = _project(document, network, 'pools', address, relations)
                if value is None:
                    continue
                scope = urlencode({'include': ','.join(relations)}) if relations else ''
                stream.store('gecko:entity', [2, network, 'pools', address, scope], value,
                             observed_at, min(ttl, 300))
                index_entity(stream, network, 'pools', address, scope)
