"""Single-writer source cache and request accounting shared across consumers."""
import hashlib
import json
import sqlite3
import time
import re
from pathlib import Path

RPC_TTL = {'getTransaction': 3600, 'getSignaturesForAddress': 30,
           'getTokenAccountsByOwner': 30, 'getTokenSupply': 60,
           'getTokenLargestAccounts': 60, 'getMultipleAccounts': 30}
QUOTE_TTL = 300  # One market observation per normal five-minute collection cycle.


class SourceUnavailable(ValueError):
    def __init__(self, retry_after):
        self.retry_after = retry_after
        super().__init__('Shared source retry is deferred after an unsuccessful read')


class SourceDeferred(ValueError):
    """Admission delay, not a failed provider observation."""
    def __init__(self, retry_after):
        import math
        self.retry_after = max(1, math.ceil(retry_after))
        super().__init__('Shared market capacity reserved; retry later')


def gecko_ttl(path):
    from urllib.parse import urlsplit, parse_qs
    target = urlsplit(path)
    if target.path.endswith('/info'):
        return 900
    if target.path.endswith('/trades'):
        return 60
    query = parse_qs(target.query)
    if '/ohlcv/' in target.path:
        try:
            if float(query.get('before_timestamp', ['inf'])[0]) < time.time()-3600:
                return 3600
        except ValueError:
            pass
    if query.get('page', ['1'])[0] != '1':
        return 900
    if target.path.endswith(('/new_pools','/trending_pools','/pools')) and not '/tokens/' in target.path:
        return 600
    return 300


def admit_gecko(stream, workload='interactive', sleep=time.sleep):
    """One rolling budget across all Gecko consumers, with two foreground slots.

    Background callers wait outside the single source owner. Journal admission
    before dispatch so failed requests also consume provider capacity.
    """
    if workload not in ('interactive', 'background'):
        raise ValueError('Unknown market workload')
    stream.db.execute('CREATE TABLE IF NOT EXISTS gecko_requests (at REAL, workload TEXT)')
    now = stream.clock()
    stream.db.execute('DELETE FROM gecko_requests WHERE at<=?', (now-60,))
    rows = stream.db.execute('SELECT at,workload FROM gecko_requests ORDER BY at').fetchall()
    delay = max(0, rows[-1][0]+7.5-now) if rows else 0
    if len(rows) >= 8:
        delay = max(delay, rows[-8][0]+60-now)
    background = [at for at, role in rows if role == 'background']
    if workload == 'background' and len(background) >= 6:
        delay = max(delay, background[-6]+60-now)
    stream.db.commit()
    if delay > 0:
        if workload == 'background':
            raise SourceDeferred(delay)
        sleep(delay)
        return admit_gecko(stream, workload, sleep)
    stream.db.execute('INSERT INTO gecko_requests VALUES (?,?)', (now, workload))
    stream.db.commit()


async def background_gecko(fetch, sleep=None):
    """Retry admission outside the owner; the caller bounds the overall timeout."""
    import asyncio
    sleep = sleep or asyncio.sleep
    for attempt in range(5):
        reply = await fetch()
        if not (reply.get('status') == 503 and reply.get('deferred') and attempt < 4):
            return reply
        await sleep(max(1, reply.get('retryAfter', 8)))


def background_gecko_history(fetch, deadline, sleep=time.sleep, clock=time.monotonic, max_attempts=5):
    """Bound historical admission/cooldown retries outside the shared owner.

    The same deadline is shared by a collector's entire backfill batch. A pending
    reply is not a completed historical lookup and must remain eligible to retry.
    """
    pending = dict(status=503, body={'error': 'Historical source retry is pending'},
                   deferred=True, retryAfter=1)
    for attempt in range(max_attempts):
        if clock() >= deadline:
            return dict(pending, retryPending=True)
        reply = fetch()
        if (not isinstance(reply, dict) or not (reply.get('status') == 429
                or (reply.get('status') == 503 and reply.get('deferred') is True))):
            return reply
        pending = reply
        if attempt == max_attempts-1:
            return dict(reply, retryPending=True)
        delay = reply.get('retryAfter', 8)
        if type(delay) not in (int, float) or not math_finite(delay):
            delay = 8
        delay = max(1, delay)
        if clock()+delay >= deadline:
            return dict(reply, retryPending=True)
        sleep(delay)
    return dict(pending, retryPending=True)


def gecko_path(path):
    from urllib.parse import urlparse, parse_qsl, urlencode
    target = urlparse(path)
    item = r'[A-Za-z0-9_-]{1,100}'
    addresses = r'[A-Za-z0-9]{1,100}(?:,[A-Za-z0-9]{1,100}){0,29}'
    route = (rf'/networks/{item}/(?:new_pools|trending_pools|pools|dexes/{item}/pools|'
             rf'tokens/multi/{addresses}|tokens/{item}/(?:pools|info)|pools/multi/{addresses}|'
             rf'pools/{item}/(?:trades|ohlcv/minute))')
    parameters = parse_qsl(target.query, keep_blank_values=True)
    if (target.scheme or target.netloc or target.fragment or len(path) > 5000
            or not (target.path == '/search/pools' or re.fullmatch(route, target.path))
            or len({key for key, _ in parameters}) != len(parameters)
            or any(key not in {'query', 'include', 'duration', 'page', 'sort', 'aggregate', 'limit',
                               'currency', 'token', 'before_timestamp', 'include_empty_intervals'} for key, _ in parameters)
            or any(key == 'include_empty_intervals' and
                   (not target.path.endswith('/ohlcv/minute') or value not in ('true', 'false'))
                   for key, value in parameters)):
        raise ValueError('Unsupported market source path')
    segments = target.path.split('/')
    if len(segments)>2 and segments[1]=='networks' and segments[2]!='solana':
        segments = [','.join(value.lower() if re.fullmatch(r'0x[0-9A-Fa-f]+',value) else value
                             for value in segment.split(',')) for segment in segments]
    parameters = [(key,','.join(sorted(set(value.split(',')))) if key=='include' else value)
                  for key,value in parameters]
    return '/'.join(segments) + ('?' + urlencode(sorted(parameters)) if parameters else '')


def gecko_response(stream, path, fetch, ttl=60):
    """Reuse overlapping multi reads without conflating different field contracts."""
    from urllib.parse import urlsplit
    from worker.gecko_projection import index_entity, lookup_entity, seed_top_pools, retained_ttl
    path = gecko_path(path)
    target = urlsplit(path)
    match = re.fullmatch(r'/networks/([\w-]+)/(tokens|pools)/multi/([A-Za-z0-9,]+)', target.path)
    if not match:
        reply = stream.get('gecko:request', path, lambda: fetch(path), ttl)
        source_ttl = retained_ttl(stream, 'gecko:request', path, reply['observedAt'], ttl)
        seed_gecko_pools(stream, path, reply, source_ttl)
        return reply
    network, kind, addresses = match.groups()
    def canonical(address):
        return address.lower() if network != 'solana' and re.fullmatch(r'0x[0-9A-Fa-f]+',address) else address
    addresses = sorted({canonical(address) for address in addresses.split(',')})
    # Version the projected contract: older entries used case-sensitive IDs and
    # retained unrelated includes from the entire original batch.
    keys = {address:[2,network,kind,address,target.query] for address in addresses}
    cached = {}
    for address,key in keys.items():
        try:
            saved = stream.lookup('gecko:entity', key)
        except SourceUnavailable:
            saved = lookup_entity(stream, network, kind, address, target.query, ttl)
            if saved is None:
                raise
        if saved is None:
            saved = lookup_entity(stream, network, kind, address, target.query, ttl)
        cached[address] = (dict(saved, ttl=retained_ttl(stream, 'gecko:entity', key, saved['observedAt'], ttl))
                           if saved is not None else None)
    missing = [address for address in addresses if cached[address] is None]
    if missing:
        route = f'/networks/{network}/{kind}/multi/' + ','.join(missing)
        route += '?' + target.query if target.query else ''
        def validated_fetch():
            body = fetch(route)
            expected = 'token' if kind == 'tokens' else 'pool'
            if (not isinstance(body,dict) or not isinstance(body.get('data'),list)
                    or not isinstance(body.get('included',[]),list)):
                raise ValueError('Invalid multi market response')
            for row in [*body['data'],*body.get('included',[])]:
                if not isinstance(row,dict) or not isinstance(row.get('id'),str) or not isinstance(row.get('type'),str):
                    raise ValueError('Invalid multi market entity')
                if not isinstance(row.get('relationships',{}),dict):
                    raise ValueError('Invalid market relationships')
                for relationship in row.get('relationships',{}).values():
                    if not isinstance(relationship,dict):
                        raise ValueError('Invalid market relationship')
                    data = relationship.get('data')
                    for reference in data if isinstance(data,list) else [data]:
                        if reference is not None and (not isinstance(reference,dict)
                                or not isinstance(reference.get('type'),str) or not isinstance(reference.get('id'),str)):
                            raise ValueError('Invalid market relationship reference')
            for row in body['data']:
                if (row['type'] != expected or not row['id'].startswith(network+'_')
                        or canonical(row['id'][len(network)+1:]) not in missing):
                    raise ValueError('Market entity does not match requested contracts')
            return body
        try:
            reply = stream.get('gecko:request', [2,route], validated_fetch, ttl)
        except SourceDeferred:
            raise
        except Exception:
            for address in missing:
                stream.defer('gecko:entity',keys[address])
            raise
        body = reply['value']
        source_ttl = retained_ttl(stream, 'gecko:request', [2,route], reply['observedAt'], ttl)
        for address in missing:
            rows = [row for row in body['data'] if canonical(row['id'][len(network)+1:]) == address]
            value = dict(body, data=rows)
            if 'included' in body:
                value['included'] = related_includes(rows,body['included'])
            stream.store('gecko:entity',keys[address],value,reply['observedAt'],source_ttl)
            cached[address] = dict(reply,value=value,ttl=source_ttl)
    for address in addresses:
        index_entity(stream, network, kind, address, target.query)
        if kind == 'tokens':
            observation = cached[address]
            seed_top_pools(stream, network, observation['value'], observation['observedAt'], observation['ttl'], target.query)
    if kind == 'tokens' and target.query == 'include=top_pools':
        # The token-multi primary attributes already report aggregate activity.
        # Mode's bare token read can reuse those complete observations; token
        # display objects included by a pool endpoint never enter this path.
        for address in addresses:
            observation = cached[address]
            rows = observation['value']['data']
            attrs = rows[0].get('attributes',{}) if len(rows)==1 else {}
            if (isinstance(attrs,dict) and isinstance(attrs.get('address'),str)
                    and canonical(attrs['address'])==address
                    and 'total_reserve_in_usd' in attrs and isinstance(attrs.get('volume_usd'),dict)
                    and 'h24' in attrs['volume_usd']):
                stream.store('gecko:entity',[2,network,kind,address,''],dict(data=rows),
                             observation['observedAt'],min(observation['ttl'],300))
                index_entity(stream, network, kind, address, '')
    bodies = [row['value'] for row in sorted(cached.values(),key=lambda row:row['observedAt'])]
    value = dict(bodies[0],data=[entity for body in bodies for entity in body['data']])
    if any('included' in body for body in bodies):
        value['included'] = list({(row.get('type'),row.get('id')):row
            for body in bodies for row in body.get('included',[])}.values())
    return dict(value=value,observedAt=min(row['observedAt'] for row in cached.values()),
                cache='miss' if missing else 'hit')


def seed_gecko_pools(stream, path, reply, ttl):
    """A complete discovery row can supply a later exact pool batch.

    Ranking, pagination and sort affect membership, not a pool's representation.
    Included token objects cannot certify the richer token-multi contract, and
    a pool batch cannot certify a token's complete pool list.
    """
    from urllib.parse import urlsplit, parse_qsl, urlencode
    from worker.gecko_projection import index_entity
    target = urlsplit(path)
    route = re.fullmatch(r'/networks/([\w-]+)/(?:new_pools|trending_pools|pools|'
                         r'dexes/[\w-]+/pools|tokens/[\w-]+/pools)', target.path)
    params = dict(parse_qsl(target.query,keep_blank_values=True))
    if not route or set(params)-{'include','page','sort','duration'}:
        return
    body = reply['value']
    if (not isinstance(body,dict) or not isinstance(body.get('data'),list)
            or not isinstance(body.get('included',[]),list)):
        return
    network = route[1]
    included = body.get('included',[])
    # Check the whole relationship graph before traversing it. A malformed or
    # partial discovery response remains insufficient for projection reuse.
    for row in [*body['data'],*included]:
        if (not isinstance(row,dict) or not isinstance(row.get('type'),str)
                or not isinstance(row.get('id'),str) or not isinstance(row.get('relationships',{}),dict)):
            return
        for rel in row.get('relationships',{}).values():
            if not isinstance(rel,dict):
                return
            refs = rel.get('data')
            for ref in refs if isinstance(refs,list) else [refs]:
                if ref is not None and (not isinstance(ref,dict) or not isinstance(ref.get('id'),str)
                                        or not isinstance(ref.get('type'),str)):
                    return
    include = params.get('include','')
    scope = urlencode({'include':include}) if 'include' in params else ''
    identities = {(row['type'],row['id']) for row in included}
    for row in body['data']:
        attrs = row.get('attributes')
        if (row['type'] != 'pool' or not row['id'].startswith(network+'_') or not isinstance(attrs,dict)
                or not {'address','base_token_price_usd','quote_token_price_usd','reserve_in_usd',
                        'volume_usd','transactions','price_change_percentage'}.issubset(attrs)
                or any(not isinstance(attrs[key],dict) for key in ('volume_usd','transactions','price_change_percentage'))):
            continue
        address = row['id'][len(network)+1:]
        canonical = lambda value: value.lower() if network!='solana' and re.fullmatch(r'0x[0-9A-Fa-f]+',value) else value
        if not isinstance(attrs['address'],str) or canonical(attrs['address']) != canonical(address):
            continue
        complete = True
        for relation in include.split(',') if include else []:
            rel = row.get('relationships',{}).get(relation)
            if not isinstance(rel,dict) or 'data' not in rel:
                complete = False
                break
            refs = rel['data']
            if any((ref['type'],ref['id']) not in identities for ref in (refs if isinstance(refs,list) else [refs]) if ref is not None):
                complete = False
                break
        if complete:
            value = dict(data=[row])
            if include:
                value['included'] = related_includes([row],included)
            stream.store('gecko:entity',[2,network,'pools',canonical(address),scope],value,
                         reply['observedAt'],min(ttl,300))
            index_entity(stream, network, 'pools', canonical(address), scope)


def related_includes(rows, included):
    """Keep the reachable JSON:API relationship graph, including nested links."""
    indexed = {(row['type'],row['id']):row for row in included}
    pending, seen, result = list(rows), set(), []
    while pending:
        row = pending.pop()
        for relationship in row.get('relationships',{}).values():
            data = relationship.get('data')
            for reference in data if isinstance(data,list) else [data]:
                if not isinstance(reference,dict):
                    continue
                identity = (reference.get('type'),reference.get('id'))
                if identity not in seen and identity in indexed:
                    seen.add(identity)
                    entity = indexed[identity]
                    result.append(entity)
                    pending.append(entity)
    return result


class SourceStream:
    def __init__(self, directory, clock=time.time, failure_ttl=0):
        Path(directory).mkdir(parents=True, exist_ok=True)
        self.clock = clock
        self.failure_ttl = failure_ttl
        self.db = sqlite3.connect(Path(directory) / 'sources.sqlite', check_same_thread=False)
        self.db.execute('CREATE TABLE IF NOT EXISTS responses (key TEXT PRIMARY KEY, expires REAL, sampled REAL, body TEXT)')
        self.db.execute('CREATE TABLE IF NOT EXISTS metrics (name TEXT PRIMARY KEY, hits INTEGER DEFAULT 0, requests INTEGER DEFAULT 0, failures INTEGER DEFAULT 0)')
        self.db.execute('CREATE TABLE IF NOT EXISTS cooldowns (endpoint TEXT, method TEXT, until REAL, PRIMARY KEY(endpoint,method))')
        self.db.execute('CREATE TABLE IF NOT EXISTS failed_reads (key TEXT PRIMARY KEY, expires REAL)')
        # Prune after each write without rereading up to 32 MB of JSON text.
        # The expression index preserves LENGTH(body)'s existing size contract.
        self.db.execute('CREATE INDEX IF NOT EXISTS responses_expires ON responses(expires)')
        self.db.execute('CREATE INDEX IF NOT EXISTS responses_prune ON responses(sampled,LENGTH(body),key)')
        self.db.execute('CREATE INDEX IF NOT EXISTS failed_reads_expires ON failed_reads(expires,key)')

    def close(self):
        self.db.close()

    @staticmethod
    def key(namespace, parameters):
        return hashlib.sha256(json.dumps([namespace,parameters],sort_keys=True,separators=(',',':')).encode()).hexdigest()

    def defer(self, namespace, parameters):
        if self.failure_ttl:
            self.db.execute('INSERT OR REPLACE INTO failed_reads VALUES (?,?)',
                            (self.key(namespace,parameters),self.clock()+self.failure_ttl))
            self.prune()
            self.db.commit()

    def check_backoff(self, namespace, key):
        if not self.failure_ttl:
            return
        failed = self.db.execute('SELECT expires FROM failed_reads WHERE key=?',(key,)).fetchone()
        if self.failure_ttl and failed and failed[0]>self.clock():
            name=namespace+':backoff'
            self.db.execute('INSERT OR IGNORE INTO metrics(name) VALUES (?)',(name,))
            self.db.execute('UPDATE metrics SET hits=hits+1 WHERE name=?',(name,))
            self.db.commit()
            import math
            raise SourceUnavailable(max(1,math.ceil(failed[0]-self.clock())))

    def lookup(self, namespace, parameters):
        key = hashlib.sha256(json.dumps([namespace, parameters], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        saved = self.db.execute('SELECT expires,sampled,body FROM responses WHERE key=?', (key,)).fetchone()
        if saved and saved[0] > self.clock() and saved[1] <= self.clock():
            self.db.execute('INSERT OR IGNORE INTO metrics(name) VALUES (?)', (namespace,))
            self.db.execute('UPDATE metrics SET hits=hits+1 WHERE name=?', (namespace,))
            self.db.commit()
            return dict(value=json.loads(saved[2]), observedAt=int(saved[1]*1000), cache='hit')
        self.check_backoff(namespace,key)
        return None

    def store(self, namespace, parameters, value, sampled_ms, ttl):
        key = hashlib.sha256(json.dumps([namespace, parameters], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        previous = self.db.execute('SELECT sampled FROM responses WHERE key=?',(key,)).fetchone()
        if previous and previous[0] > sampled_ms/1000:
            return
        body = json.dumps(value, separators=(',', ':'), allow_nan=False)
        if len(body) <= 2_000_000:
            self.db.execute('DELETE FROM failed_reads WHERE key=?',(key,))
            self.db.execute('INSERT OR REPLACE INTO responses VALUES (?, ?, ?, ?)',
                            (key, sampled_ms/1000 + ttl, sampled_ms/1000, body))
            self.prune()
            self.db.commit()

    def prune(self):
        self.db.execute('DELETE FROM responses WHERE expires<=?', (self.clock(),))
        self.db.execute('DELETE FROM failed_reads WHERE expires<=?',(self.clock(),))
        self.db.execute('DELETE FROM failed_reads WHERE key NOT IN (SELECT key FROM failed_reads ORDER BY expires DESC LIMIT 2000)')
        # SQLite 3.40 may otherwise scan JSON bodies instead of this index.
        count, size = self.db.execute('SELECT COUNT(*), COALESCE(SUM(LENGTH(body)),0) FROM responses INDEXED BY responses_prune').fetchone()
        while count > 2000 or size > 32_000_000:
            oldest = self.db.execute('SELECT key,LENGTH(body) FROM responses INDEXED BY responses_prune ORDER BY sampled LIMIT 1').fetchone()
            self.db.execute('DELETE FROM responses WHERE key=?', (oldest[0],))
            count -= 1
            size -= oldest[1]

    def get(self, namespace, parameters, fetch, ttl):
        key = hashlib.sha256(json.dumps([namespace, parameters], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        now = self.clock()
        self.db.execute('INSERT OR IGNORE INTO metrics(name) VALUES (?)', (namespace,))
        saved = self.db.execute('SELECT expires, sampled, body FROM responses WHERE key=?', (key,)).fetchone()
        if saved and saved[0] > now and saved[1] <= now:
            self.db.execute('UPDATE metrics SET hits=hits+1 WHERE name=?', (namespace,))
            self.db.commit()
            return dict(value=json.loads(saved[2]), observedAt=int(saved[1] * 1000), cache='hit')
        self.check_backoff(namespace,key)
        self.db.execute('UPDATE metrics SET requests=requests+1 WHERE name=?', (namespace,))
        try:
            value = fetch()
            if value is None:
                raise ValueError('Source returned no observation')
            body = json.dumps(value, separators=(',', ':'), allow_nan=False)
            sampled = self.clock()
            self.db.execute('DELETE FROM failed_reads WHERE key=?',(key,))
            # Large responses remain usable but do not displace the bounded cache.
            if len(body) <= 2_000_000:
                self.db.execute('INSERT OR REPLACE INTO responses VALUES (?, ?, ?, ?)', (key, sampled + ttl, sampled, body))
            self.prune()
            self.db.commit()
            return dict(value=value, observedAt=int(sampled * 1000), cache='miss')
        except SourceDeferred:
            self.db.execute('UPDATE metrics SET requests=requests-1 WHERE name=?', (namespace,))
            self.db.commit()
            raise
        except Exception:
            self.db.execute('UPDATE metrics SET failures=failures+1 WHERE name=?', (namespace,))
            if self.failure_ttl:
                self.db.execute('INSERT OR REPLACE INTO failed_reads VALUES (?,?)',(key,self.clock()+self.failure_ttl))
                self.prune()
            self.db.commit()
            raise

    def metrics(self):
        return {name: dict(hits=hits, requests=requests, failures=failures)
                for name, hits, requests, failures in self.db.execute('SELECT name,hits,requests,failures FROM metrics')}

    def cooldowns(self):
        return {(endpoint, method): until for endpoint, method, until in self.db.execute('SELECT endpoint,method,until FROM cooldowns')
                if until > self.clock()}

    def save_cooldowns(self, blocked):
        self.db.execute('DELETE FROM cooldowns')
        self.db.executemany('INSERT INTO cooldowns VALUES (?, ?, ?)',
                            ((endpoint, method, until) for (endpoint, method), until in blocked.items() if until > self.clock()))
        self.db.commit()


_sessions = {}


class SourceSession:
    """Single Modal writer keeps its cache warm and batches Volume commits.

    Cache and counters may lose up to 30 seconds on termination; these are
    replaceable source responses, never the retained observation ledger.
    """
    def __init__(self, directory, volume, clock=time.monotonic):
        volume.reload()
        self.directory, self.volume, self.clock = directory, volume, clock
        self.connection, self.last_commit = None, clock()
        self.last_request, self.force_commit = 0, False

    def stream(self):
        if self.connection is None:
            self.connection = SourceStream(self.directory, failure_ttl=30)
        return self.connection

    def finish(self, force=False):
        if force or self.force_commit or self.clock() - self.last_commit >= 30:
            if self.connection is not None:
                self.connection.close()
                self.connection = None
            self.volume.commit()
            self.last_commit = self.clock()
            self.force_commit = False


def source_session(directory, volume):
    if directory not in _sessions:
        _sessions[directory] = SourceSession(directory, volume)
    return _sessions[directory]


def source_metrics(directory):
    result = {}
    for source in ('solana', 'dex', 'rss', 'gecko', 'context'):
        path = Path(directory) / source / 'sources.sqlite'
        if not path.exists():
            result[source] = {}
            continue
        db = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)
        try:
            result[source] = {name: dict(cacheHits=hits, cacheMisses=requests, failures=failures)
                             for name, hits, requests, failures in db.execute('SELECT name,hits,requests,failures FROM metrics')}
        finally:
            db.close()
    return result


def paced_get(session, client, url, interval, **options):
    from urllib.parse import urlparse
    from email.utils import parsedate_to_datetime
    host = urlparse(url).netloc
    stream = session.stream()
    blocked = stream.cooldowns()
    if blocked.get((host, 'get'), 0) > time.time():
        raise ValueError('Source provider cooldown is active')
    delay = session.last_request + interval - time.monotonic()
    if delay > 0:
        time.sleep(delay)
    session.last_request = time.monotonic()
    response = client.get(url, **options)
    if response.status_code == 429:
        header = response.headers.get('retry-after')
        try:
            wait = float(header)
        except (TypeError, ValueError):
            try:
                wait = parsedate_to_datetime(header).timestamp() - time.time()
            except (TypeError, ValueError, OverflowError):
                wait = 60
        blocked[(host, 'get')] = time.time() + max(60, wait if math_finite(wait) else 60)
        stream.save_cooldowns(blocked)
        session.force_commit = True
    response.raise_for_status()
    return response


def math_finite(value):
    import math
    return math.isfinite(value)


def shared_rpc(method, params):
    """Authenticated Modal call; no public generic RPC forwarding endpoint."""
    import modal
    reply = modal.Function.from_name('meme-fast', 'read_source').remote('solana', method, params)
    value = reply['value']
    if isinstance(value, dict):
        value = dict(value, _sourceObservedAt=reply['observedAt'])
    return value


def mint_from_wallet_cache(stream, params):
    """A pair of complete program scans can supply any exact-mint RPC read."""
    from worker.shared_holdings import observe, PROGRAMS, MAX_AGE_MS
    if (len(params) != 3 or not isinstance(params[1],dict) or set(params[1]) != {'mint'}
            or params[2] != {'encoding':'jsonParsed','commitment':'confirmed'}):
        return None
    owner, mint = params[0], params[1]['mint']
    try:
        saved = {program:stream.lookup('solana:getTokenAccountsByOwner',
            [owner,{'programId':program},params[2]]) for program in PROGRAMS}
    except SourceUnavailable:
        return None  # A broad-scan failure must not block a different exact-mint read.
    if not all(saved.values()):
        return None
    sampled = min(row['observedAt'] for row in saved.values())
    if not 0 <= stream.clock()*1000-sampled < MAX_AGE_MS:
        return None
    observed = observe(owner,{program:{'result':row['value']} for program,row in saved.items()},sampled)
    if observed is None:
        return None
    rows = [account for row in saved.values() for account in row['value']['value']
            if account['account']['data']['parsed']['info']['mint'] == mint]
    return dict(value={'context':{'slot':min(observed['programSlots'].values())},'value':rows},
                observedAt=sampled,cache='projected-wallet-scan')


def dex_pairs(value):
    """Validate provider structure before recording a successful observation."""
    if not isinstance(value, list):
        raise ValueError('Invalid token market response')
    for pair in value:
        if (not isinstance(pair, dict) or not isinstance(pair.get('chainId'), str)
                or not isinstance(pair.get('baseToken'), dict)
                or not isinstance(pair['baseToken'].get('address'), str)
                or not pair['baseToken']['address']):
            raise ValueError('Invalid token market pair')
        if 'quoteToken' in pair and (not isinstance(pair['quoteToken'], dict)
                or not isinstance(pair['quoteToken'].get('address'), str)
                or not pair['quoteToken']['address']):
            raise ValueError('Invalid token market quote token')
    return value


def dex_tokens(stream, network, addresses, fetch):
    """Overlapping token batches reuse individual observations; misses batch once."""
    addresses = sorted(set(addresses))
    if not addresses or len(addresses) > 30:
        raise ValueError('Choose 1 to 30 exact contracts')
    cached = {address: stream.lookup('dex:token', [network, address]) for address in addresses}
    missing = [address for address, saved in cached.items() if saved is None]
    if missing:
        try:
            # Older batch entries admitted any list before validating its rows.
            # Existing per-token entries already passed the identity projection.
            reply = stream.get('dex:batch', [2, network, missing],
                               lambda: dex_pairs(fetch(network, missing)), QUOTE_TTL)
        except Exception:
            for address in missing:
                stream.defer('dex:token',[network,address])
            raise
        for address in missing:
            key = address if network == 'solana' else address.lower()
            pairs = [pair for pair in reply['value'] if pair.get('chainId') == network
                     and (pair.get('baseToken', {}).get('address', '') if network == 'solana'
                          else pair.get('baseToken', {}).get('address', '').lower()) == key]
            stream.store('dex:token', [network, address], pairs, reply['observedAt'], QUOTE_TTL)
            cached[address] = dict(reply, value=pairs)
    return dict(value=[dict(pair, _sourceObservedAt=saved['observedAt'])
                       for saved in cached.values() for pair in saved['value']],
                observedAt=min(saved['observedAt'] for saved in cached.values()),
                cache='miss' if missing else 'hit')


def dex_pools(stream, network, address, fetch):
    # The API distinguishes all pools from batch token quotes. Reuse is one-way:
    # a complete pool response can supply a quote; a batch quote cannot certify
    # pool-discovery completeness. https://docs.dexscreener.com/api/reference
    reply = stream.get('dex:pools', [2, network, address],
                       lambda: dex_pairs(fetch(network, address)), 60)
    key = address if network == 'solana' else address.lower()
    quote_pairs = [pair for pair in reply['value'] if pair.get('chainId') == network
                   and (pair.get('baseToken', {}).get('address', '') if network == 'solana'
                        else pair.get('baseToken', {}).get('address', '').lower()) == key]
    stream.store('dex:token', [network, address], quote_pairs, reply['observedAt'], QUOTE_TTL)
    return dict(reply, value=[dict(pair, _sourceObservedAt=reply['observedAt']) for pair in reply['value']])


def shared_dex(network, addresses, scope='quotes'):
    import modal
    return modal.Function.from_name('meme-fast', 'read_market_source').remote(network, addresses, scope=scope)['value']


def source_json(client, url, **kwargs):
    """Keep manual/local reads local; deployed consumers use the common cache."""
    import os
    import re
    if os.getenv('MEME_SHARED_SOURCES') == '1':
        match = re.fullmatch(r'https://api\.dexscreener\.com/(tokens/v1|token-pairs/v1)/([a-z0-9_-]+)/([A-Za-z0-9,]+)', url)
        if match:
            return shared_dex(match[2], match[3].split(','), scope='pools' if match[1]=='token-pairs/v1' else 'quotes')
        if url.startswith('https://api.dexscreener.com/'):
            raise ValueError('Unsupported shared Dex source; direct fallback disabled')
    response = client.get(url, **kwargs)
    response.raise_for_status()
    return response.json()
