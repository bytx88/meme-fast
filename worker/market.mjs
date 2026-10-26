// Only public market-data endpoints are allowed. Never forward browser credentials.
export function marketPath(url) {
  const prefix='/api/market';
  if(!url.pathname.startsWith(prefix+'/'))return null;
  const path=url.pathname.slice(prefix.length);
  const search=path==='/search/pools';
  const pools=/^\/networks\/[a-z0-9_-]{1,40}\/tokens\/[a-zA-Z0-9]{1,100}\/pools$/.test(path);
  const info=/^\/networks\/(?:solana|base|robinhood|bsc)\/tokens\/[a-zA-Z0-9]{1,100}\/info$/.test(path);
  const newPools=/^\/networks\/[a-z0-9_-]{1,40}\/new_pools$/.test(path);
  const trades=/^\/networks\/[a-z0-9_-]{1,40}\/pools\/[a-zA-Z0-9]{1,100}\/trades$/.test(path);
  const candles=/^\/networks\/[a-z0-9_-]{1,40}\/pools\/[a-zA-Z0-9]{1,100}\/ohlcv\/minute$/.test(path);
  if(!search&&!pools&&!info&&!newPools&&!trades&&!candles)return null;
  if(candles){
    const params=url.searchParams;
    if([...params.keys()].some(k=>!['aggregate','limit','currency','token'].includes(k))||params.get('aggregate')!=='15'||params.get('limit')!=='1000'||params.get('currency')!=='usd'||!/^[a-zA-Z0-9]{1,100}$/.test(params.get('token')||''))return null;
    return path+'?'+new URLSearchParams({aggregate:'15',limit:'1000',currency:'usd',token:params.get('token')});
  }
  const query=new URLSearchParams();
  if(search){const value=url.searchParams.get('query')?.trim();if(!value||value.length>160)return null;query.set('query',value)}
  if(search||pools||newPools)query.set('include','base_token,quote_token');
  for(const key of url.searchParams.keys())if(!['query','include'].includes(key))return null;
  return path+(query.size?'?'+query:'');
}

function memeHistoryPath(url,at){
  const prefix='/api/meme-history';
  if(!url.pathname.startsWith(prefix+'/')||url.hash)return null;
  const path=url.pathname.slice(prefix.length);
  if(!/^\/networks\/[a-z0-9_-]{1,40}\/pools\/[a-zA-Z0-9]{1,100}\/ohlcv\/minute$/.test(path))return null;
  const params=url.searchParams,keys=[...params.keys()];
  const required=['aggregate','limit','currency','token','before_timestamp'];
  if(keys.length!==required.length||new Set(keys).size!==required.length||keys.some(key=>!required.includes(key)))return null;
  const token=params.get('token'),before=params.get('before_timestamp');
  if(params.get('aggregate')!=='5'||params.get('limit')!=='302'||params.get('currency')!=='usd'||!/^[a-zA-Z0-9]{1,100}$/.test(token)||!/^\d{1,16}$/.test(before))return null;
  const seconds=Number(before);
  if(!Number.isSafeInteger(seconds)||seconds<=0||String(seconds)!==before||seconds>Math.floor(at/1000))return null;
  return path+'?'+new URLSearchParams({aggregate:'5',limit:'302',currency:'usd',token,before_timestamp:before});
}

export function createMarketProxy({fetcher=fetch,now=Date.now,timeout=12000,allowMemeHistory=false}={}) {
  const cache=new Map(),inflight=new Map();let cooldownUntil=0;
  const json=(value,status=200,extra={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...extra}});
  const error=(message,status,extra)=>json({error:message},status,extra);
  async function read(path,history=false){
    const response=await fetcher('https://api.geckoterminal.com/api/v2'+path,{headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(timeout)});
    if(response.status===429){const retry=response.headers.get('retry-after'),seconds=Number(retry);const wait=retry?(Number.isFinite(seconds)?seconds*1000:Date.parse(retry)-now()):60000;cooldownUntil=now()+Math.max(60000,Number.isFinite(wait)?wait:60000);return {status:429,error:'The swap provider is busy. Try again in a minute.'}}
    if(!response.ok)return {status:response.status,error:`The swap provider returned HTTP ${response.status}.`};
    const data=await response.json();if(path.includes('/ohlcv/')?!Array.isArray(data?.data?.attributes?.ohlcv_list):path.endsWith('/info')?!data.data||typeof data.data!=='object':!Array.isArray(data.data))return {status:502,error:'The swap provider returned an invalid response.'};
    const ttl=history?3600000:path.endsWith('/info')?900000:path.endsWith('/trades')?30000:path.startsWith('/search/')?60000:300000;
    const observedAt=now();
    cache.delete(path);cache.set(path,{data,observedAt,expires:observedAt+ttl});if(cache.size>128)cache.delete(cache.keys().next().value);
    return {data,observedAt};
  }
  return async request=>{
    if(request.method!=='GET')return error('Method not allowed.',405,{allow:'GET'});
    const url=new URL(request.url),history=url.pathname.startsWith('/api/meme-history/');
    const path=history?(allowMemeHistory?memeHistoryPath(url,now()):null):marketPath(url);if(!path)return error('Unknown market endpoint.',404);
    const cached=cache.get(path);if(cached&&cached.expires>now())return json(cached.data,200,{'x-data-observed-at':String(cached.observedAt)});
    if(now()<cooldownUntil)return error('The swap provider is busy. Try again in a minute.',429,{'retry-after':String(Math.ceil((cooldownUntil-now())/1000))});
    try{
      if(!inflight.has(path)){const pending=read(path,history);inflight.set(path,pending);pending.finally(()=>inflight.delete(path)).catch(()=>{})}
      const result=await inflight.get(path);
      return result.data?json(result.data,200,{'x-data-observed-at':String(result.observedAt)}):error(result.error,result.status,result.status===429?{'retry-after':String(Math.ceil((cooldownUntil-now())/1000))}:{});
    }catch(e){return error(e.name==='TimeoutError'?'The swap provider took too long to respond. Try again.':'The server could not reach the swap provider. Try again shortly.',502)}
  };
}
