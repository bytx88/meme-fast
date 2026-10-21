// Collector-only pacing. A request's timeout starts when it leaves the queue.
export function createProviderFetch(direct=fetch,{now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),timeoutMs=15000,initial={},budgetMs=210000,policies={}}={}){
 const upstream=direct;
 if(process.env.MEME_SHARED_MARKET_URL)direct=(target,options)=>{
  const url=new URL(target),supported=/^\/(?:tokens\/v1|token-pairs\/v1)\//.test(url.pathname)||['/latest/dex/search','/token-profiles/latest/v1'].includes(url.pathname);
  const gecko=process.env.MEME_SHARED_MARKET_URL.replace(/\/dex$/,'/gecko');
  if(url.hostname==='r.jina.ai')return upstream(process.env.MEME_SHARED_MARKET_URL.replace(/\/dex$/,'/context/read')+'?'+new URLSearchParams({url:target}),options);
  if(url.hostname==='api.dexscreener.com'&&!supported)throw Error('Unsupported shared Dex source; direct fallback disabled');
  return upstream(url.hostname==='api.dexscreener.com'&&supported?process.env.MEME_SHARED_MARKET_URL+url.pathname+url.search:
   url.hostname==='api.geckoterminal.com'?gecko+url.pathname.replace(/^\/api\/v2/,'')+url.search:target,options);
 };
 const started=now(),states=new Map();
 const shared=Boolean(process.env.MEME_SHARED_MARKET_URL);
 const networkTimeout=shared?Math.max(timeoutMs,30000):timeoutMs;
 const defaults={'api.geckoterminal.com':{interval:shared?0:4500,limit:shared?200:36},'api.dexscreener.com':{interval:shared?0:300,limit:shared?200:100}};
 const stateFor=host=>{
  if(!states.has(host))states.set(host,{tail:Promise.resolve(),next:0,count:0,cooldownUntil:Number(initial[host]?.cooldownUntil)||0});
  return states.get(host);
 };
 const request=async(url,options={})=>{
  const host=new URL(url).hostname,policy=policies[host]||defaults[host];
  if(!policy){
   const remaining=budgetMs-(now()-started);
   if(remaining<=0)throw new Error('Collection time budget reached; retained data kept');
   return direct(url,{...options,signal:AbortSignal.timeout(Math.max(1,Math.min(timeoutMs,remaining)))});
  }
  const state=stateFor(host);
  const turn=state.tail.then(async()=>{
   const dispatch=async()=>{
   if(state.count>=policy.limit||now()-started>=budgetMs)throw new Error(`${host} collection budget reached; retained data kept`);
   const wait=Math.max(0,state.next-now(),state.cooldownUntil-now());
   // Recover within this run when possible; never sleep beyond the collection deadline.
   if(wait>=budgetMs-(now()-started))throw new Error(`${host} rate-limit cooldown exceeds collection budget; retained data kept`);
   if(wait)await sleep(wait);
   if(now()-started>=budgetMs)throw new Error(`${host} collection budget reached; retained data kept`);
   state.count++;state.next=now()+policy.interval;
   // Caller signals were created before queueing; use a fresh deadline here.
   const response=await direct(url,{...options,signal:AbortSignal.timeout(Math.max(1,Math.min(networkTimeout,budgetMs-(now()-started))))});
   if(response.status===429){
    const header=response.headers?.get?.('retry-after'),seconds=header==null?NaN:Number(header);
    const delay=Number.isFinite(seconds)?seconds*1000:Date.parse(header)-now();
    state.cooldownUntil=now()+Math.max(60000,Number.isFinite(delay)?delay:60000);
   }
   return response;
   };
   const response=await dispatch();
   // One retry after the provider's cooldown recovers transient limits without a burst.
   if(response.status===429&&state.cooldownUntil-now()<budgetMs-(now()-started)){
    await response.body?.cancel?.();
    return dispatch();
   }
   return response;
  });
  state.tail=turn.catch(()=>{});
  return turn;
 };
 request.state=()=>Object.fromEntries([...states].map(([host,state])=>[host,{cooldownUntil:state.cooldownUntil}]));
 return request;
}
