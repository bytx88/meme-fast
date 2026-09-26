"""Modal deployment for Meme Fast.

Deploy with:
    py -m modal deploy modal_app.py
"""

from pathlib import Path
import os
import re
from urllib.parse import urlencode

import modal


APP_NAME = "meme-fast"
LOCAL_DIST = Path(__file__).parent / "dist"
REMOTE_DIST = "/app/dist"
RUNNING_IN_MODAL = Path(REMOTE_DIST).is_dir() or bool(
    os.getenv("MODAL_TASK_ID") or os.getenv("MODAL_ENVIRONMENT_NAME")
)
DIST_SOURCE = Path(REMOTE_DIST) if RUNNING_IN_MODAL else LOCAL_DIST

if not RUNNING_IN_MODAL and not (LOCAL_DIST / "index.html").is_file():
    raise RuntimeError("dist/index.html is missing")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("nodejs")
    .pip_install("fastapi>=0.111.0", "httpx>=0.27.0", "truststore>=0.10.0")
    .add_local_dir(DIST_SOURCE, remote_path=REMOTE_DIST)
    .add_local_dir(Path("/app/worker") if RUNNING_IN_MODAL else Path(__file__).parent / "worker", remote_path="/app/worker")
)

app = modal.App(APP_NAME, image=image)
history_volume = modal.Volume.from_name("meme-fast-coin-history", create_if_missing=True)


@app.function(schedule=modal.Period(minutes=5), timeout=600, max_containers=1, volumes={"/history": history_volume})
def collect_coins():
    import subprocess
    history_volume.reload()
    try:
        indexer = subprocess.run(
            ["python", "/app/worker/robinhood_indexer.py", "scan", "/history/robinhood-pools.sqlite", "/history/robinhood-pool-feed.json"],
            capture_output=True, text=True, timeout=280,
        )
        if indexer.returncode:
            print("Robinhood pool indexer:", indexer.stderr[-2000:])
    except subprocess.TimeoutExpired:
        print("Robinhood pool indexer timed out; using the previous feed")
    result = subprocess.run(
        ["node", "/app/worker/coin-collector.mjs", "/history/coins.json"],
        capture_output=True, text=True, timeout=280,
    )
    history_volume.commit()
    if result.returncode:
        raise RuntimeError(result.stderr)
    print(result.stdout)


@app.function(min_containers=0, timeout=60, volumes={"/history": history_volume})
@modal.asgi_app()
def web():
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.middleware.gzip import GZipMiddleware
    from fastapi.responses import FileResponse, Response
    import httpx

    web_app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    web_app.add_middleware(GZipMiddleware, minimum_size=1000)
    import asyncio
    import json
    import sqlite3
    import time
    from fastapi.responses import JSONResponse
    history_lock = asyncio.Lock()

    @web_app.get("/api/new-coins")
    async def new_coins(request: Request):
        async with history_lock:
            await history_volume.reload.aio()
            try:
                snapshot = json.loads(Path("/history/coins.json").read_text())
            except FileNotFoundError:
                snapshot = {"version": 2, "coins": [], "radarCoins": [], "lastRun": None, "feeds": {}}
            cutoff = time.time() * 1000 - 5 * 86400000
            view = request.query_params.get("view")
            if view == "watchlist":
                ids = request.query_params.getlist("id")
                if not 1 <= len(ids) <= 30 or any(len(item) > 160 or ":" not in item for item in ids):
                    raise HTTPException(status_code=400, detail="Request 1 to 30 saved token IDs")
                def key(value):
                    return value if value.startswith("solana:") else value.lower()
                available = {key(c["id"]): c for c in snapshot.get("radarCoins", []) if c.get("lastSeenRadarAt", 0) > cutoff}
                for coin in snapshot.get("coins", []):
                    if coin.get("firstSeen", 0) > cutoff:
                        available.setdefault(key(coin["id"]), coin)
                fields = ("id", "name", "symbol", "network", "chain", "contract_address", "image_url", "priceUsd", "priceChange", "mc", "fdv", "liquidity", "volume", "volume5m", "buys5m", "sells5m", "recentVolume1h", "poolCreated", "marketUpdatedAt", "priceUpdatedAt")
                selected = [{field: available[key(item)].get(field) for field in fields} for item in ids if key(item) in available]
                return JSONResponse({"version": 1, "lastRun": snapshot.get("lastRun"), "coins": selected}, headers={"cache-control": "no-store"})
            snapshot["coins"] = [c for c in snapshot["coins"] if c["firstSeen"] > cutoff]
            if view == "coin":
                snapshot["coins"] = [
                    {key: value for key, value in coin.items() if key not in ("marketHistory", "marketHistoryHourly", "priceHistory5m")}
                    for coin in snapshot["coins"]
                ]
                snapshot.pop("radarCoins", None)
            else:
                if view == "radar":
                    snapshot["coins"] = []
                snapshot["radarCoins"] = [c for c in snapshot.get("radarCoins", []) if c.get("lastSeenRadarAt", 0) > cutoff]
        return JSONResponse(snapshot, headers={"cache-control": "no-store"})

    @web_app.get("/api/pool-catalog")
    async def pool_catalog(request: Request):
        query = request.query_params.get("query", "").strip().lower()
        if not re.fullmatch(r"0x[0-9a-f]{40}|0x[0-9a-f]{64}", query):
            raise HTTPException(status_code=400, detail="Use a Robinhood token contract or pool ID")
        async with history_lock:
            await history_volume.reload.aio()
            db_path = Path("/history/robinhood-pools.sqlite")
            if not db_path.exists():
                return JSONResponse({"network": "robinhood", "query": query, "pools": [], "total": 0}, headers={"cache-control": "no-store"})
            connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            try:
                rows = connection.execute(
                    "SELECT source, pool, token0, token1, block, tx_hash FROM pools WHERE token0=? OR token1=? OR pool=? ORDER BY block DESC LIMIT 50",
                    (query, query, query),
                ).fetchall()
            finally:
                connection.close()
        pools = [dict(zip(("source", "pool", "token0", "token1", "block", "txHash"), row)) for row in rows]
        return JSONResponse({"network": "robinhood", "query": query, "pools": pools, "total": len(pools)}, headers={"cache-control": "no-store"})
    dist = Path(REMOTE_DIST)
    allowed_types = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
    }

    @web_app.get("/api/market/{market_path:path}")
    async def market_proxy(market_path: str, request: Request):
        path = "/" + market_path
        is_search = path == "/search/pools"
        is_pools = bool(re.fullmatch(r"/networks/[a-z0-9_-]{1,40}/tokens/[a-zA-Z0-9]{1,100}/pools", path))
        is_new_pools = bool(re.fullmatch(r"/networks/[a-z0-9_-]{1,40}/new_pools", path))
        is_trades = bool(re.fullmatch(r"/networks/[a-z0-9_-]{1,40}/pools/[a-zA-Z0-9]{1,100}/trades", path))
        if not (is_search or is_pools or is_new_pools or is_trades):
            raise HTTPException(status_code=404, detail="Unknown market endpoint")

        supplied = set(request.query_params.keys())
        if supplied - {"query", "include"}:
            raise HTTPException(status_code=404, detail="Unsupported query parameter")
        params = {}
        if is_search:
            query = request.query_params.get("query", "").strip()
            if not query or len(query) > 160:
                raise HTTPException(status_code=400, detail="Invalid search query")
            params["query"] = query
        if is_search or is_pools or is_new_pools:
            params["include"] = "base_token,quote_token"

        target = "https://api.geckoterminal.com/api/v2" + path
        if params:
            target += "?" + urlencode(params)
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
                upstream = await client.get(target, headers={"accept": "application/json"})
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="Market provider unavailable") from exc
        headers = {"cache-control": "no-store", "x-content-type-options": "nosniff"}
        if retry_after := upstream.headers.get("retry-after"):
            headers["retry-after"] = retry_after
        return Response(upstream.content, status_code=upstream.status_code, media_type="application/json", headers=headers)

    context_cache = {}
    context_sources = {
        "jeanphil-story": "https://trenches-on.com/en/runners/2026-09-20-jeanphil/",
        "jeanphil-origin": "https://meme.com/memes/jean-phil",
        "super-inu": "https://opensea.io/token/solana/DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP",
        "ionq-background": "https://www.reddit.com/r/Backpack_official/comments/1wnd2fi/ionq_stock_is_now_tokenized_on_solana_how_ionq/",
    }

    @web_app.get("/api/context/source/{source_id}")
    async def context_source(source_id: str):
        import time
        if source_id not in context_sources:
            raise HTTPException(status_code=404, detail="Unknown story source")
        cached = context_cache.get(source_id)
        if cached and cached[0] > time.time():
            return Response(cached[1], media_type="text/plain")
        try:
            async with httpx.AsyncClient(timeout=25, follow_redirects=False) as client:
                upstream = await client.get("https://r.jina.ai/" + context_sources[source_id])
                upstream.raise_for_status()
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="Story source unavailable") from exc
        body = upstream.text[:60000]
        context_cache[source_id] = (time.time() + 900, body)
        return Response(body, media_type="text/plain", headers={"cache-control": "public, max-age=900"})

    @web_app.get("/api/context/search")
    async def context_search(request: Request):
        name = request.query_params.get("name", "").strip()
        symbol = request.query_params.get("symbol", "").strip()
        contract = request.query_params.get("contract", "").strip()
        if not (1 <= len(name) <= 100 and 1 <= len(symbol) <= 32 and re.fullmatch(r"[A-Za-z0-9]{20,100}", contract)):
            raise HTTPException(status_code=400, detail="Invalid token context query")
        mode = request.query_params.get("mode", "story")
        search = f'"{contract}"' if mode == "contract" else f'"{name}" {symbol} meme origin story'
        target = "https://r.jina.ai/http://html.duckduckgo.com/html/?" + urlencode({"q": search})
        try:
            async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
                upstream = await client.get(target, headers={"accept": "text/plain"})
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="Context provider unavailable") from exc
        if not upstream.is_success:
            raise HTTPException(status_code=502, detail="Context provider unavailable")
        body = upstream.text[:60000]
        return Response(body, media_type="text/plain; charset=utf-8", headers={"cache-control": "public, max-age=300", "x-content-type-options": "nosniff"})

    @web_app.api_route("/{asset_path:path}", methods=["GET", "HEAD"])
    async def static_app(asset_path: str, request: Request):
        routes = {
            "": "index.html",
            "narratives": "narratives.html",
            "narrative": "narrative.html",
            "new-coins": "new-coins.html",
            "radar": "radar.html",
            "watchlist": "watchlist.html",
            "sources": "sources.html",
        }
        relative = routes.get(asset_path, asset_path)
        candidate = (dist / relative).resolve()
        if dist.resolve() not in candidate.parents or not candidate.is_file() or candidate.suffix not in allowed_types:
            raise HTTPException(status_code=404, detail="Not found")
        return FileResponse(
            candidate,
            media_type=allowed_types[candidate.suffix],
            headers={"cache-control": "no-cache", "x-content-type-options": "nosniff"},
        )

    return web_app
