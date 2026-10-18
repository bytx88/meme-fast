"""Paced public Solana reads with bounded fallback and provider cooldowns."""
import os
import time

PUBLIC_ENDPOINTS = ('https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com')


def public_rpc(client, pause=time.sleep, clock=time.monotonic):
    configured = os.getenv('SOLANA_WALLET_RPC_URL')
    endpoints = (configured,) if configured else PUBLIC_ENDPOINTS
    blocked = {}

    def rpc(method, params):
        for endpoint in endpoints:
            key = (endpoint, method)
            if blocked.get(key, 0) > clock():
                continue
            pause(1.6)
            try:
                response = client.post(endpoint, json={'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params})
                if response.status_code in (403, 429):
                    blocked[key] = clock() + 300
                    continue
                response.raise_for_status()
                body = response.json()
                if body.get('error'):
                    blocked[key] = clock() + 300
                    continue
                if method == 'getTransaction' and body.get('result') is None:
                    continue  # Another public node may retain this historical transaction.
                return body.get('result')
            except Exception:
                blocked[key] = clock() + 60
        raise ValueError('Public RPC unavailable or rate limited for this method')

    return rpc
