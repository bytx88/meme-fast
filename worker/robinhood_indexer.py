"""Persist Robinhood Chain Uniswap pool identities from public RPC event logs.

Usage: python robinhood_indexer.py scan DB_PATH FEED_PATH
       python robinhood_indexer.py query DB_PATH CONTRACT_OR_POOL
"""

import json
import os
import sqlite3
import ssl
import sys
import time
from pathlib import Path
import httpx

if os.name == "nt":
    import truststore
    TLS_CONTEXT = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
else:
    TLS_CONTEXT = True

RPC_URL = os.environ.get("ROBINHOOD_RPC_URL", "https://rpc.mainnet.chain.robinhood.com")
LAST_RPC_AT = 0.0
SOURCES = (
    ("uniswap_v2", "0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f", "0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9"),
    ("uniswap_v3", "0x1f7d7550b1b028f7571e69a784071f0205fd2efa", "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118"),
    ("uniswap_v4", "0x8366a39cc670b4001a1121b8f6a443a643e40951", "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438"),
)


def open_db(filename):
    Path(filename).parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(filename)
    db.execute("PRAGMA journal_mode=DELETE")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS pools (
            id TEXT PRIMARY KEY, source TEXT NOT NULL, pool TEXT NOT NULL,
            token0 TEXT NOT NULL, token1 TEXT NOT NULL, block INTEGER NOT NULL,
            tx_hash TEXT, checked_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS pools_token0 ON pools(token0);
        CREATE INDEX IF NOT EXISTS pools_token1 ON pools(token1);
        CREATE INDEX IF NOT EXISTS pools_pool ON pools(pool);
        CREATE INDEX IF NOT EXISTS pools_checked ON pools(checked_at);
        CREATE TABLE IF NOT EXISTS cursors (
            source TEXT PRIMARY KEY, live INTEGER NOT NULL,
            backfill INTEGER NOT NULL, backfill_target INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY, value TEXT NOT NULL
        );
    """)
    return db


def rpc(method, params=None):
    global LAST_RPC_AT
    delay = 2.0 - (time.monotonic() - LAST_RPC_AT)
    if delay > 0:
        time.sleep(delay)
    response = httpx.post(RPC_URL, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []}, verify=TLS_CONTEXT, timeout=12)
    LAST_RPC_AT = time.monotonic()
    response.raise_for_status()
    body = response.json()
    if "error" in body or "result" not in body:
        raise RuntimeError(body.get("error", {}).get("message", "Invalid RPC response"))
    return body["result"]


def evm_address(word):
    if not isinstance(word, str) or len(word) != 66 or not word.startswith("0x"):
        return None
    try:
        int(word[2:], 16)
    except ValueError:
        return None
    return "0x" + word[-40:].lower()


def decode_log(log, source):
    name, emitter, topic = source
    topics = log.get("topics") or []
    if log.get("address", "").lower() != emitter or not topics or topics[0].lower() != topic:
        return None
    token0 = evm_address(topics[2 if name == "uniswap_v4" else 1]) if len(topics) > 2 else None
    token1 = evm_address(topics[3 if name == "uniswap_v4" else 2]) if len(topics) > (3 if name == "uniswap_v4" else 2) else None
    data = log.get("data", "")
    pool = topics[1].lower() if name == "uniswap_v4" and len(topics) > 1 else evm_address("0x" + data[2 + (0 if name == "uniswap_v2" else 64):2 + (64 if name == "uniswap_v2" else 128)])
    if not token0 or not token1 or not pool or token0 == token1:
        return None
    return (name + ":" + pool, name, pool, token0, token1, int(log["blockNumber"], 16), log.get("transactionHash"))


def get_cursor(db, source, head):
    row = db.execute("SELECT live, backfill, backfill_target FROM cursors WHERE source=?", (source,)).fetchone()
    if row:
        return list(row)
    live = max(0, head - 3000)
    db.execute("INSERT INTO cursors VALUES (?, ?, ?, ?)", (source, live, 0, live))
    return [live, 0, live]


def scan_window(db, source, start, end, maximum_chunks=1):
    name, emitter, topic = source
    chunks = 0
    while start <= end and chunks < maximum_chunks:
        span = min(50000, end - start + 1)
        while True:
            stop = start + span - 1
            try:
                logs = rpc("eth_getLogs", [{"address": emitter, "topics": [topic], "fromBlock": hex(start), "toBlock": hex(stop)}])
                if not isinstance(logs, list):
                    raise RuntimeError("Invalid log response")
                break
            except httpx.HTTPStatusError as error:
                if error.response.status_code == 429:
                    raise
                if span <= 500:
                    raise
                span = max(500, span // 2)
            except Exception:
                if span <= 500:
                    raise
                span = max(500, span // 2)
        rows = [decoded for log in logs if (decoded := decode_log(log, source))]
        db.executemany("INSERT OR IGNORE INTO pools (id, source, pool, token0, token1, block, tx_hash) VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
        start = stop + 1
        chunks += 1
    return start


def scan(db, now=None):
    now = int(now or time.time() * 1000)
    errors = {}
    head = 0
    name = None
    try:
        if int(rpc("eth_chainId"), 16) != 4663:
            raise RuntimeError("RPC chain ID is not Robinhood mainnet")
        head = max(0, int(rpc("eth_blockNumber"), 16) - 12)
    except Exception as error:
        errors["rpc"] = str(error)
    if not errors:
        next_source = db.execute("SELECT value FROM meta WHERE key='next_source'").fetchone()
        source_index = int(next_source[0]) % len(SOURCES) if next_source else 0
        source = SOURCES[source_index]
        name = source[0]
        live, backfill, target = get_cursor(db, name, head)
        try:
            live = scan_window(db, source, live, head)
            backfill = scan_window(db, source, backfill, min(head, target - 1))
            db.execute("UPDATE cursors SET live=?, backfill=? WHERE source=?", (live, backfill, name))
        except Exception as error:
            errors[name] = str(error)
        db.execute("INSERT INTO meta (key, value) VALUES ('next_source', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (str(source_index + 1),))
    db.commit()
    rows = db.execute("SELECT id, pool, token0, token1 FROM pools WHERE checked_at IS NULL OR checked_at < ? ORDER BY checked_at NULLS FIRST, block DESC LIMIT 60", (now - 6 * 3600000,)).fetchall()
    db.executemany("UPDATE pools SET checked_at=? WHERE id=?", [(now, row[0]) for row in rows])
    db.commit()
    cursors = {source: {"live": live, "backfill": backfill, "backfillTarget": target} for source, live, backfill, target in db.execute("SELECT source, live, backfill, backfill_target FROM cursors")}
    return {"network": "robinhood", "pools": [{"id": row[0], "pool": row[1], "token0": row[2], "token1": row[3]} for row in rows],
            "status": {"lastScanAt": now, "head": head, "count": db.execute("SELECT COUNT(*) FROM pools").fetchone()[0],
                       "backfillComplete": len(cursors) == len(SOURCES) and all(c["backfill"] >= c["backfillTarget"] for c in cursors.values()),
                       "cursors": cursors, "scannedSource": name, "errors": errors}}


def query(db, value):
    value = value.strip().lower()
    if not value.startswith("0x") or len(value) not in (42, 66) or any(c not in "0123456789abcdef" for c in value[2:]):
        raise ValueError("Use a Robinhood token contract or pool ID")
    rows = db.execute("SELECT source, pool, token0, token1, block, tx_hash FROM pools WHERE token0=? OR token1=? OR pool=? ORDER BY block DESC LIMIT 50", (value, value, value)).fetchall()
    return {"network": "robinhood", "query": value, "pools": [dict(zip(("source", "pool", "token0", "token1", "block", "txHash"), row)) for row in rows], "total": len(rows)}


if __name__ == "__main__":
    command, filename, *args = sys.argv[1:]
    connection = open_db(filename)
    try:
        if command == "scan":
            feed = scan(connection)
            output = Path(args[0]); output.parent.mkdir(parents=True, exist_ok=True)
            temporary = output.with_suffix(output.suffix + ".tmp")
            temporary.write_text(json.dumps(feed))
            temporary.replace(output)
            print(json.dumps(feed["status"]))
        elif command == "query":
            print(json.dumps(query(connection, args[0])))
        else:
            raise SystemExit("Unknown command")
    finally:
        connection.close()
