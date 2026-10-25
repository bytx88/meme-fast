"""Loopback transport from the Node collector to the shared Modal source owners.

The collector keeps its existing HTTP fetch, pacing and deadline behavior. These
requests stay in its container instead of waking the public web application.
"""
import asyncio
import json
import re
from http import HTTPStatus
from urllib.parse import parse_qsl, urlsplit

from worker.context_source import context_target
from worker.publisher_feed import SOURCES as PUBLISHERS
from worker.source_stream import gecko_path


class CollectorSources:
    def __init__(self, market, gecko, context, social, *, header_timeout=5, request_timeout=35):
        self.market, self.gecko, self.context, self.social = market, gecko, context, social
        self.header_timeout, self.request_timeout = header_timeout, request_timeout
        self.server = None
        self.url = None
        self.tasks, self.writers = set(), set()

    async def __aenter__(self):
        self.server = await asyncio.start_server(self._accept, '127.0.0.1', 0, limit=16384)
        port = self.server.sockets[0].getsockname()[1]
        self.url = f'http://127.0.0.1:{port}/api/dex'
        return self.url

    async def __aexit__(self, *error):
        self.server.close()
        for writer in list(self.writers):
            writer.close()
        pending = list(self.tasks)
        for task in pending:
            task.cancel()
        if pending:
            # Do not let a remote RPC that ignores cancellation retain the job.
            await asyncio.wait(pending, timeout=1)
        await self.server.wait_closed()

    def _task(self, operation):
        task = asyncio.create_task(operation)
        self.tasks.add(task)
        def finished(result):
            self.tasks.discard(result)
            if not result.cancelled():
                result.exception()
        task.add_done_callback(finished)
        return task

    def _accept(self, reader, writer):
        self.writers.add(writer)
        self._task(self._serve(reader, writer))

    @staticmethod
    def _json(status, value, headers=None):
        return status, json.dumps(value, separators=(',', ':'), allow_nan=False).encode(), {
            'content-type': 'application/json', 'cache-control': 'no-store', **(headers or {})}

    async def _dispatch(self, target):
        try:
            parsed = urlsplit(target)
        except ValueError:
            return self._json(400, {'error': 'Invalid source target'})
        if parsed.scheme or parsed.netloc or parsed.fragment or not target.startswith('/'):
            return self._json(400, {'error': 'Invalid source target'})
        try:
            pairs = parse_qsl(parsed.query, keep_blank_values=True, max_num_fields=32)
        except ValueError:
            return self._json(400, {'error': 'Invalid source query'})
        query = dict(pairs)
        if len(pairs) != len(query):
            return self._json(400, {'error': 'Duplicate source query parameter'})
        if parsed.path.startswith('/api/publisher/'):
            publisher = parsed.path.removeprefix('/api/publisher/')
            if publisher not in PUBLISHERS or '?' in target:
                return self._json(404, {'error': 'Unknown publisher source'})
            try:
                reply = await self.social(PUBLISHERS[publisher])
                return self._json(200, reply['value'], {'x-data-observed-at': str(reply['observedAt'])})
            except Exception:
                return self._json(503, {'error': 'Shared publisher feed unavailable'})
        if parsed.path.startswith('/api/dex/'):
            path = parsed.path.removeprefix('/api/dex/')
            if path == 'token-profiles/latest/v1' and not query:
                network, addresses, scope = 'profiles', [], 'profiles'
            elif path == 'latest/dex/search' and set(query) == {'q'}:
                text = query['q'].strip()
                if not 1 <= len(text) <= 160:
                    return self._json(400, {'error': 'Invalid market search'})
                network, addresses, scope = 'search', [text], 'quotes'
            else:
                match = re.fullmatch(r'(tokens/v1|token-pairs/v1)/([a-z0-9_-]+)/([A-Za-z0-9,]{20,3100})', path)
                if not match or query:
                    return self._json(404, {'error': 'Unknown token market endpoint'})
                network, addresses = match[2], match[3].split(',')
                scope = 'pools' if match[1] == 'token-pairs/v1' else 'quotes'
            try:
                reply = await self.market(network, addresses, scope=scope)
                return self._json(200, reply['value'], {'x-data-observed-at': str(reply['observedAt'])})
            except Exception:
                return self._json(503, {'error': 'Shared token market source unavailable'})
        if parsed.path.startswith('/api/gecko/'):
            try:
                path = gecko_path(target.removeprefix('/api/gecko'))
            except ValueError:
                return self._json(404, {'error': 'Unknown market source endpoint'})
            try:
                reply = await self.gecko(path, workload='background')
                headers = {}
                if reply.get('deferred'):
                    headers['x-source-deferred'] = '1'
                if 'retryAfter' in reply:
                    headers['retry-after'] = str(reply['retryAfter'])
                return self._json(reply['status'], reply['body'], headers)
            except Exception:
                return self._json(500, {'error': 'Shared market source unavailable'})
        if parsed.path == '/api/context/read' and set(query) == {'url'}:
            try:
                target, _ = context_target(query['url'])
            except ValueError:
                return self._json(400, {'error': 'Unsupported context source'})
            try:
                reply = await self.context(target)
                return 200, reply['value'].encode(), {
                    'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store',
                    'x-data-observed-at': str(reply['observedAt']), 'x-content-type-options': 'nosniff'}
            except Exception:
                return self._json(502, {'error': 'Context source unavailable'})
        return self._json(404, {'error': 'Unknown collector source endpoint'})

    async def _serve(self, reader, writer):
        operation = disconnected = None
        try:
            try:
                raw = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), self.header_timeout)
                lines = raw.decode('ascii').split('\r\n')
                method, target, protocol = lines[0].split(' ')
                if (len(lines[0]) > 8192 or protocol not in ('HTTP/1.0', 'HTTP/1.1')
                        or any(':' not in line for line in lines[1:] if line)):
                    raise ValueError('Invalid HTTP headers')
                headers = {key.lower(): value.strip() for line in lines[1:] if line
                           for key, value in [line.split(':', 1)]}
                if 'transfer-encoding' in headers or int(headers.get('content-length', '0')) != 0:
                    raise ValueError('Source GET must not contain a body')
            except (ValueError, UnicodeError, asyncio.IncompleteReadError, asyncio.LimitOverrunError):
                reply = self._json(400, {'error': 'Invalid source request'})
            except asyncio.TimeoutError:
                reply = self._json(408, {'error': 'Source request headers timed out'})
            else:
                if method != 'GET':
                    reply = self._json(405, {'error': 'Use GET for collector sources'}, {'allow': 'GET'})
                else:
                    operation = self._task(self._dispatch(target))
                    disconnected = self._task(reader.read(1))
                    done, _ = await asyncio.wait({operation, disconnected}, timeout=self.request_timeout,
                                                 return_when=asyncio.FIRST_COMPLETED)
                    if operation in done:
                        reply = operation.result()
                    elif disconnected in done:
                        return
                    else:
                        reply = self._json(504, {'error': 'Shared source request timed out'})
            status, body, headers = reply
            header = f'HTTP/1.1 {status} {HTTPStatus(status).phrase}\r\n'
            header += ''.join(f'{key}: {value}\r\n' for key, value in headers.items())
            header += f'content-length: {len(body)}\r\nconnection: close\r\n\r\n'
            writer.write(header.encode('ascii') + body)
            await asyncio.wait_for(writer.drain(), 5)
        except (ConnectionError, asyncio.TimeoutError):
            pass
        finally:
            for task in (operation, disconnected):
                if task and not task.done():
                    task.cancel()
            writer.close()
            self.writers.discard(writer)
