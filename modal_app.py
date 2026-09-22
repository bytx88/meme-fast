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
    .pip_install("fastapi>=0.111.0", "httpx>=0.27.0")
    .add_local_dir(DIST_SOURCE, remote_path=REMOTE_DIST)
)

app = modal.App(APP_NAME, image=image)


@app.function(min_containers=0, timeout=60)
@modal.asgi_app()
def web():
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.responses import FileResponse, Response
    import httpx

    web_app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
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

    @web_app.api_route("/{asset_path:path}", methods=["GET", "HEAD"])
    async def static_app(asset_path: str, request: Request):
        routes = {
            "": "index.html",
            "narratives": "narratives.html",
            "narrative": "narrative.html",
            "new-coins": "new-coins.html",
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
