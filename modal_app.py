"""Modal deployment for Meme Fast.

Deploy with:
    py -m modal deploy modal_app.py
"""

from pathlib import Path
import hashlib
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
ASSET_REVISION = os.getenv("MEME_FAST_ASSET_REVISION", "") if RUNNING_IN_MODAL else hashlib.sha256(
    b"versioned-html-assets-v2" + b"".join(path.name.encode() + path.read_bytes() for path in sorted(LOCAL_DIST.iterdir()) if path.is_file())
).hexdigest()[:16]

if not RUNNING_IN_MODAL and not (LOCAL_DIST / "index.html").is_file():
    raise RuntimeError("dist/index.html is missing")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .env({"MEME_FAST_ASSET_REVISION": ASSET_REVISION})
    .apt_install("nodejs")
    .pip_install("fastapi>=0.111.0", "httpx>=0.27.0", "truststore>=0.10.0")
    .add_local_dir(DIST_SOURCE, remote_path=REMOTE_DIST, copy=True)
    .add_local_dir(Path("/app/worker") if RUNNING_IN_MODAL else Path(__file__).parent / "worker", remote_path="/app/worker")
    .add_local_file(Path("/app/x-factor-targets.json") if RUNNING_IN_MODAL else Path(__file__).parent / "x-factor-targets.json", remote_path="/app/x-factor-targets.json")
)

app = modal.App(APP_NAME, image=image)
refresh_priorities = modal.Dict.from_name("meme-fast-refresh-priorities", create_if_missing=True)
history_volume = modal.Volume.from_name("meme-fast-coin-history", create_if_missing=True)


@app.function(schedule=modal.Period(minutes=5), timeout=600, max_containers=1, volumes={"/history": history_volume})
def collect_coins():
    import json
    import subprocess
    import time
    import sys
    if "/app" not in sys.path:
        sys.path.insert(0, "/app")
    from worker.refresh_priority import PRIORITY_TTL
    from worker.snapshot_view import snapshot_view
    history_volume.reload()
    now_ms = int(time.time() * 1000)
    priorities = []
    for token_id, requested_at in refresh_priorities.items():
        if isinstance(requested_at, (int, float)) and 0 <= now_ms - requested_at < PRIORITY_TTL:
            priorities.append((token_id, requested_at))
        else:
            refresh_priorities.pop(token_id, None)
    priority_ids = [item[0] for item in sorted(priorities, key=lambda item: -item[1])[:300]]
    # Index independently while market refresh uses the last atomic pool export.
    indexer = subprocess.Popen(
        ["python", "/app/worker/robinhood_indexer.py", "scan", "/history/robinhood-pools.sqlite", "/history/robinhood-pool-feed.json"],
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
    )
    started = time.monotonic()
    try:
        result = subprocess.run(
            ["node", "/app/worker/coin-collector.mjs", "/history/coins.json"],
            capture_output=True, text=True, timeout=280,
            env={**os.environ, "MEME_REFRESH_PRIORITY_IDS": json.dumps(priority_ids)},
        )
        if result.returncode:
            raise RuntimeError(result.stderr)
        main = Path("/history/coins.json")
        snapshot = json.loads(main.read_text())
        for hours in (1, 6, 12, 36, 120):
            projection = Path(f"/history/coins.snipe.{hours}.json")
            temporary = projection.with_suffix(".json.tmp")
            payload = snapshot_view(snapshot, "coin", hours=hours)
            temporary.write_text(json.dumps(payload, separators=(",", ":")))
            os.replace(temporary, projection)
        history_volume.commit()
        print(result.stdout)
    finally:
        try:
            _, error = indexer.communicate(timeout=max(1, 280 - (time.monotonic() - started)))
            if indexer.returncode:
                print("Robinhood pool indexer:", error[-2000:])
        except subprocess.TimeoutExpired:
            indexer.kill()
            indexer.communicate()
            print("Robinhood pool indexer timed out; keeping its previous atomic export")
        history_volume.commit()


@app.function(schedule=modal.Period(minutes=30), timeout=300, max_containers=1,
              volumes={"/history": history_volume})
def collect_x_factor(target_limit=3):
    import subprocess
    history_volume.reload()
    result = subprocess.run(
        ["python", "/app/worker/x_rss_collector.py", "/history/coins.json",
         "/history/x-factor.json", "/app/x-factor-targets.json"],
        capture_output=True, text=True, timeout=260,
        env={**os.environ, "X_FACTOR_TARGET_LIMIT": str(max(1, min(8, int(target_limit))))},
    )
    if result.returncode:
        raise RuntimeError(result.stderr[-2000:])
    history_volume.commit()
    print(result.stdout)


@app.function(schedule=modal.Period(minutes=5), timeout=120, max_containers=1,
              volumes={"/history": history_volume})
def collect_jeanphil_monitor():
    import subprocess
    history_volume.reload()
    result = subprocess.run(
        ["python", "/app/worker/jeanphil_monitor.py", "/history/jeanphil-monitor.json"],
        capture_output=True, text=True, timeout=110,
    )
    if result.returncode:
        raise RuntimeError(result.stderr[-2000:])
    history_volume.commit()
    print(result.stdout)


@app.function(schedule=modal.Period(minutes=5), timeout=480, max_containers=1,
              secrets=[modal.Secret.from_name("meme-fast-fomolist")], volumes={"/history": history_volume})
@modal.concurrent(max_inputs=1)
def collect_meme_index():
    import sys
    if "/app" not in sys.path:
        sys.path.insert(0, "/app")
    from worker.meme_index import collect
    history_volume.reload()
    try:
        report = collect("/history/meme-index.json", checkpoint_commit=history_volume.commit)
    finally:
        history_volume.commit()
    return {"updatedAt": report.get("updatedAt"), "constituents": len(report["basket"]), "error": report.get("error")}


@app.function(timeout=120, max_containers=1, volumes={"/history": history_volume})
def collect_coin_evidence(token_id):
    import json
    import subprocess
    history_volume.reload()
    result = subprocess.run(
        ["python", "/app/worker/coin_rss_evidence.py", "/history/coins.json",
         "/app/x-factor-targets.json", token_id, "/history/coin-rss-evidence"],
        capture_output=True, text=True, timeout=105,
    )
    if result.returncode:
        raise RuntimeError(result.stderr[-1000:])
    history_volume.commit()
    return json.loads(result.stdout)


@app.function(min_containers=0, timeout=150, volumes={"/history": history_volume})
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
    import sys
    import time
    from fastapi.responses import JSONResponse
    if "/app" not in sys.path:
        sys.path.insert(0, "/app")
    from worker.market_proxy import MarketProxy
    from worker.snapshot_view import snapshot_view, snapshot_version
    history_lock = asyncio.Lock()
    async def fetch_market(target):
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            return await client.get(target, headers={"accept": "application/json"})
    market_cache = MarketProxy(fetch_market)

    async def load_snapshot():
        async with history_lock:
            await history_volume.reload.aio()
            try:
                return json.loads(Path("/history/coins.json").read_text())
            except FileNotFoundError:
                return {"version": 2, "coins": [], "radarCoins": [], "lastRun": None, "feeds": {}}

    @web_app.post("/api/refresh-priority")
    async def refresh_priority(request: Request):
        from worker.refresh_priority import valid_priority_ids
        body = await request.body()
        if len(body) > 6000:
            raise HTTPException(status_code=400, detail="Priority request too large")
        try:
            ids = valid_priority_ids(json.loads(body).get("ids"))
        except (ValueError, AttributeError, TypeError):
            raise HTTPException(status_code=400, detail="Request 1 to 30 supported token contracts")
        snapshot = await load_snapshot()
        key = lambda value: value if value.startswith("solana:") else value.lower()
        known = {key(coin["id"]) for coin in snapshot.get("coins", []) + snapshot.get("radarCoins", [])}
        accepted = [token_id for token_id in ids if token_id in known]
        now_ms = int(time.time() * 1000)
        await asyncio.gather(*(refresh_priorities.put.aio(token_id, now_ms) for token_id in accepted))
        return JSONResponse({"accepted": len(accepted), "expiresInHours": 24}, headers={"cache-control": "no-store"})

    @web_app.get("/api/x-factor")
    async def x_factor():
        async with history_lock:
            await history_volume.reload.aio()
            try:
                report = json.loads(Path("/history/x-factor.json").read_text())
            except (FileNotFoundError, ValueError):
                report = {"version": 1, "status": "disconnected", "coins": {}}
        return JSONResponse(report, headers={"cache-control": "no-store"})

    @web_app.get("/api/meme-index")
    async def meme_index():
        async with history_lock:
            await history_volume.reload.aio()
            try:
                saved = json.loads(Path("/history/meme-index.json").read_text())
                fields = ("version", "basket", "samples", "readings", "readingAt", "updatedAt",
                          "attemptedAt", "rebalancedAt", "error", "quotes", "altProviderAt", "altMethod")
                report = {field: saved[field] for field in fields if field in saved}
            except (FileNotFoundError, ValueError):
                report = {"version": 1, "basket": [], "samples": [], "readings": [],
                          "error": "Awaiting first collection"}
        return JSONResponse(report, headers={"cache-control": "no-store"})

    @web_app.get("/api/jeanphil-monitor")
    async def jeanphil_monitor():
        async with history_lock:
            await history_volume.reload.aio()
            try:
                report = json.loads(Path("/history/jeanphil-monitor.json").read_text())
            except (FileNotFoundError, ValueError):
                report = {"version": 1, "id": "solana:GTBxUiw6wJdmmkCGZgRHLyYxqu1vG4KtRpeox6yDpump", "market": [], "social": []}
        return JSONResponse(report, headers={"cache-control": "no-store"})

    @web_app.post("/api/coin-evidence")
    async def coin_evidence(request: Request):
        try:
            token_id = (await request.json()).get("id", "")
        except (ValueError, AttributeError):
            raise HTTPException(status_code=400, detail="Invalid token request")
        if not isinstance(token_id, str) or not re.fullmatch(
            r"solana:[1-9A-HJ-NP-Za-km-z]{32,44}|(?:base|robinhood):0x[a-fA-F0-9]{40}", token_id
        ):
            raise HTTPException(status_code=400, detail="Invalid token ID")
        try:
            report = await collect_coin_evidence.remote.aio(token_id)
        except Exception as exc:
            raise HTTPException(status_code=503, detail="Coin RSS evidence is temporarily unavailable.") from exc
        return JSONResponse(report, headers={"cache-control": "no-store"})

    @web_app.get("/api/coin-context")
    async def coin_context(request: Request):
        token_id = request.query_params.get("id", "")
        if not re.fullmatch(
            r"solana:[1-9A-HJ-NP-Za-km-z]{32,44}|(?:base|robinhood):0x[a-fA-F0-9]{40}", token_id
        ):
            raise HTTPException(status_code=400, detail="Invalid token ID")
        snapshot = await load_snapshot()
        coin = next((row for field in ("coins", "radarCoins") for row in snapshot.get(field, [])
                     if row.get("id") == token_id), None)
        return JSONResponse({"id": token_id, "context": coin.get("savedContext") if coin else None},
                            headers={"cache-control": "no-store"})

    @web_app.get("/api/new-coins/version")
    async def new_coins_version():
        async with history_lock:
            await history_volume.reload.aio()
            main = Path("/history/coins.json")
            sidecar = Path("/history/coins.version.json")
            if sidecar.exists() and main.exists() and sidecar.stat().st_mtime_ns >= main.stat().st_mtime_ns:
                try:
                    version = json.loads(sidecar.read_text())
                except (OSError, ValueError):
                    version = snapshot_version(json.loads(main.read_text()))
            elif main.exists():
                version = snapshot_version(json.loads(main.read_text()))
            else:
                version = {"revision": "0", "lastRun": None}
        return JSONResponse(version, headers={"cache-control": "no-store"})

    @web_app.get("/api/new-coins")
    async def new_coins(request: Request):
        view = request.query_params.get("view", "")
        hours_text = request.query_params.get("hours", "120")
        if view == "coin" and hours_text not in ("1", "6", "12", "36", "120"):
            raise HTTPException(status_code=400, detail="Choose a supported Snipe time window")
        if view in ("coin", "health"):
            main = Path("/history/coins.json")
            projection = Path(f"/history/coins.snipe.{hours_text}.json") if view == "coin" else Path("/history/coins.health.json")
            if main.exists() and projection.exists() and projection.stat().st_mtime_ns >= main.stat().st_mtime_ns:
                return Response(projection.read_bytes(), media_type="application/json",
                                headers={"cache-control": "no-store"})
        snapshot = await load_snapshot()
        try:
            payload = snapshot_view(snapshot, view, request.query_params.getlist("id"), name=request.query_params.get("name", ""), hours=int(hours_text) if view == "coin" else 120)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return JSONResponse(payload, headers={"cache-control": "no-store"})

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
        ".svg": "image/svg+xml",
        ".xml": "application/xml",
        ".txt": "text/plain; charset=utf-8",
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
        is_info = bool(re.fullmatch(r"/networks/(solana|base|robinhood)/tokens/[a-zA-Z0-9]{1,100}/info", path))
        is_new_pools = bool(re.fullmatch(r"/networks/[a-z0-9_-]{1,40}/new_pools", path))
        is_trades = bool(re.fullmatch(r"/networks/[a-z0-9_-]{1,40}/pools/[a-zA-Z0-9]{1,100}/trades", path))
        is_candles = bool(re.fullmatch(r"/networks/[a-z0-9_-]{1,40}/pools/[a-zA-Z0-9]{1,100}/ohlcv/minute", path))
        if not (is_search or is_pools or is_info or is_new_pools or is_trades or is_candles):
            raise HTTPException(status_code=404, detail="Unknown market endpoint")

        supplied = set(request.query_params.keys())
        allowed = {"aggregate", "limit", "currency", "token"} if is_candles else {"query", "include"}
        if supplied - allowed:
            raise HTTPException(status_code=404, detail="Unsupported query parameter")
        params = {}
        if is_candles:
            query = request.query_params
            if (query.get("aggregate") != "15" or query.get("limit") != "1000"
                    or query.get("currency") != "usd"
                    or not re.fullmatch(r"[a-zA-Z0-9]{1,100}", query.get("token", ""))):
                raise HTTPException(status_code=400, detail="Invalid candle query")
            params = {"aggregate": "15", "limit": "1000", "currency": "usd", "token": query["token"]}
        if is_search:
            query = request.query_params.get("query", "").strip()
            if not query or len(query) > 160:
                raise HTTPException(status_code=400, detail="Invalid search query")
            params["query"] = query
        if is_search or is_pools or is_new_pools:
            params["include"] = "base_token,quote_token"

        status, content, provider_headers = await market_cache.get(path + ("?" + urlencode(params) if params else ""))
        headers = {"cache-control": "public, max-age=300" if is_info and status == 200 else "no-store", "x-content-type-options": "nosniff"}
        headers.update(provider_headers)
        return Response(content, status_code=status, media_type="application/json", headers=headers)

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
            "": "order-flow.html",
            "narratives": "narratives.html",
            "narrative": "narrative.html",
            "new-coins": "new-coins.html",
            "radar": "radar.html",
            "watchlist": "watchlist.html",
            "sources": "sources.html",
            "jeanphil": "jeanphil.html",
            "about": "about.html",
            "privacy": "privacy.html",
            "terms": "terms.html",
        }
        asset_path = re.sub(r"^_assets/[a-zA-Z0-9_-]+/", "", asset_path)
        relative = routes.get(asset_path, asset_path)
        candidate = (dist / relative).resolve()
        if dist.resolve() not in candidate.parents or not candidate.is_file() or candidate.suffix not in allowed_types:
            raise HTTPException(status_code=404, detail="Not found")
        etag = f'"{ASSET_REVISION}-{candidate.name}"'
        headers = {"cache-control": "no-cache", "etag": etag,
                   "x-content-type-options": "nosniff", "x-meme-fast-revision": ASSET_REVISION}
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers=headers)
        if candidate.suffix == ".html":
            from worker.asset_revision import version_html_assets
            return Response(
                version_html_assets(candidate.read_text(encoding="utf-8"), ASSET_REVISION),
                media_type=allowed_types[candidate.suffix], headers=headers,
            )
        return FileResponse(
            candidate,
            media_type=allowed_types[candidate.suffix],
            headers=headers,
        )

    return web_app
