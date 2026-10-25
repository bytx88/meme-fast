"""Project compatible Solana account observations across overlapping RPC batches.

Account values retain their field scope, original observation time and context
slot. A composed reply's context slot is a lower bound across its observations;
the per-account evidence explicitly records that it is not an atomic bank read.
"""
import copy
import json

from worker.source_stream import RPC_TTL, SourceDeferred


VERSION = 1
ENTITY_NAMESPACE = 'solana:account'
READ_NAMESPACE = 'solana:account:read'
BATCH_NAMESPACE = 'solana:getMultipleAccounts'


def _integer(value):
    return type(value) is int and value >= 0


def _request(params):
    if (not isinstance(params, list) or not 1 <= len(params) <= 2
            or not isinstance(params[0], list) or len(params[0]) > 100
            or any(not isinstance(address, str) or not address for address in params[0])):
        raise ValueError('Invalid multiple-account request')
    config = params[1] if len(params) == 2 else {}
    if not isinstance(config, dict):
        raise ValueError('Invalid multiple-account configuration')
    if 'minContextSlot' in config and not _integer(config['minContextSlot']):
        raise ValueError('Invalid minimum account slot')
    if 'encoding' in config and config['encoding'] not in ('base58', 'base64', 'base64+zstd', 'jsonParsed'):
        raise ValueError('Invalid account encoding')
    if 'commitment' in config and config['commitment'] not in ('processed', 'confirmed', 'finalized'):
        raise ValueError('Invalid account commitment')
    if 'dataSlice' in config:
        sliced = config['dataSlice']
        if (not isinstance(sliced, dict) or set(sliced) != {'offset', 'length'}
                or not all(_integer(value) for value in sliced.values())):
            raise ValueError('Invalid account data slice')
    # Unknown future options remain in the exact field scope. Never silently
    # drop an option and reuse a representation requested under another one.
    json.dumps(config, allow_nan=False)
    scope = {key: value for key, value in config.items() if key != 'minContextSlot'}
    return params[0], config, scope, config.get('minContextSlot', 0)


def _validate(body, count, minimum_slot, encoding=None):
    if (not isinstance(body, dict) or 'error' in body
            or not isinstance(body.get('context'), dict)
            or not _integer(body['context'].get('slot'))
            or body['context']['slot'] < minimum_slot
            or ('apiVersion' in body['context'] and not isinstance(body['context']['apiVersion'], str))
            or not isinstance(body.get('value'), list) or len(body['value']) != count):
        raise ValueError('Invalid multiple-account observation')
    for account in body['value']:
        if account is None:
            continue  # A measured nonexistent account is reusable evidence.
        if (not isinstance(account, dict) or type(account.get('executable')) is not bool
                or not _integer(account.get('lamports'))
                or not _integer(account.get('rentEpoch'))
                or not isinstance(account.get('owner'), str) or not account['owner']
                or ('space' in account and not _integer(account['space']))):
            raise ValueError('Invalid account observation')
        data = account.get('data')
        encoded = (isinstance(data, list) and len(data) == 2 and isinstance(data[0], str)
                   and data[1] in ('base58', 'base64', 'base64+zstd'))
        parsed = (isinstance(data, dict) and isinstance(data.get('program'), str)
                  and isinstance(data.get('parsed'), dict)
                  and ('space' not in data or _integer(data['space'])))
        if not (encoded or parsed):
            raise ValueError('Invalid account data representation')
        if encoded and data[1] == 'base58' and data[0].startswith('error:'):
            raise ValueError('Account data encoding failed')
        # Agave falls back to plain base64 when zstd compression fails. Keep
        # the requested field scope so this response cannot certify any other
        # encoding contract, while accepting the RPC's documented representation.
        accepted = ('base64+zstd', 'base64') if encoding == 'base64+zstd' else (encoding,)
        if encoding in ('base58', 'base64', 'base64+zstd') and (not encoded or data[1] not in accepted):
            raise ValueError('Account observation does not match requested encoding')
        if encoding == 'jsonParsed' and encoded and data[1] != 'base64':
            raise ValueError('Invalid parsed-account fallback encoding')
    return body


def multiple_accounts(stream, params, fetch, ttl=RPC_TTL['getMultipleAccounts']):
    """Fetch only missing compatible accounts and preserve caller order/nulls.

    ``fetch`` receives normal getMultipleAccounts params and returns its RPC
    ``result``. A minContextSlot constraint can reuse any compatible observation
    at or above that slot, while encodings, commitments and slices stay distinct.
    """
    addresses, config, scope, minimum_slot = _request(params)
    ttl = min(ttl, RPC_TTL['getMultipleAccounts'])
    unique = list(dict.fromkeys(addresses))
    keys = {address: [VERSION, address, scope] for address in unique}
    read_keys = {address: [*keys[address], minimum_slot] for address in unique}
    cached = {}
    for address in unique:
        observation = stream.lookup(ENTITY_NAMESPACE, keys[address])
        if (observation is not None
                and observation['value']['context']['slot'] >= minimum_slot):
            cached[address] = observation
    missing = [address for address in unique if address not in cached]
    # Batch failures are also shared by overlapping callers with this same slot
    # constraint. An unsuccessful stricter constraint cannot block a weaker one.
    for address in missing:
        stream.check_backoff(READ_NAMESPACE, stream.key(READ_NAMESPACE, read_keys[address]))
    if missing or not addresses:
        request = [missing, copy.deepcopy(config)]
        def validated_fetch():
            return _validate(fetch(request), len(missing), minimum_slot, config.get('encoding'))
        try:
            result = stream.get(BATCH_NAMESPACE, [VERSION, request], validated_fetch, ttl)
        except SourceDeferred:
            raise
        except Exception:
            for address in missing:
                stream.defer(READ_NAMESPACE, read_keys[address])
            raise
        if not addresses:
            return result  # Keep the provider's real context for an empty batch.
        body = result['value']
        batch = [stream.key(BATCH_NAMESPACE, [VERSION, request]), result['observedAt']]
        for address, account in zip(missing, body['value']):
            value = dict(account=account, context=body['context'], batch=batch)
            stream.store(ENTITY_NAMESPACE, keys[address], value, result['observedAt'], ttl)
            cached[address] = dict(result, value=value)
    observations = [cached[address] for address in addresses]
    contexts = [row['value']['context'] for row in observations]
    context = copy.deepcopy(contexts[0])
    composed = any(row['value']['batch'] != observations[0]['value']['batch'] for row in observations)
    if composed:
        # The minimum is an observed lower bound, never a fabricated common
        # bank slot. Keep other context fields only when identical throughout.
        context = {key: value for key, value in context.items()
                   if all(other.get(key) == value for other in contexts)}
        context['slot'] = min(row['slot'] for row in contexts)
    value = dict(context=context, value=[copy.deepcopy(row['value']['account']) for row in observations],
                 _sourceProjection='account-observations',
                 _sourceAtomic=not composed,
                 _sourceAccountObservations=[dict(address=address, context=copy.deepcopy(row['value']['context']),
                                                  observedAt=row['observedAt'])
                                             for address, row in zip(addresses, observations)])
    return dict(value=value, observedAt=min(row['observedAt'] for row in observations),
                cache='miss' if missing else 'hit')
