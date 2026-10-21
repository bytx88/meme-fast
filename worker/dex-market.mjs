// Local/Worker adapter for the same restricted token-source routes as Modal.
export function dexMarketPath(url){
 const prefix='/api/dex/';if(!url.pathname.startsWith(prefix))return null;
 const path=url.pathname.slice(prefix.length);
 if(path==='latest/dex/search'){
  const query=url.searchParams.get('q')?.trim();
  return query&&query.length<=160&&[...url.searchParams.keys()].every(k=>k==='q')?
   path+'?'+new URLSearchParams({q:query}):null;
 }
 return /^(?:token-pairs\/v1|tokens\/v1)\/(?:solana|base|robinhood|bsc|ethereum|arbitrum|optimism|polygon|avalanche)\/[A-Za-z0-9]{20,100}(?:,[A-Za-z0-9]{20,100}){0,29}$/.test(path)&&!url.search?path:null;
}

export function createDexProxy({fetcher=fetch,now=Date.now}={}){
 const cache=new Map(),pending=new Map();let cooldown=0;
 return async request=>{
  const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store',...headers}});
  if(request.method!=='GET')return json({error:'Method not allowed'},405);
  const path=dexMarketPath(new URL(request.url));if(!path)return json({error:'Unknown token market endpoint'},404);
  const old=cache.get(path);if(old&&now()-old.at<60000)return json(old.value,200,{'x-data-observed-at':String(old.at)});
  if(now()<cooldown)return json({error:'Token market source is rate limited'},429,{'retry-after':String(Math.ceil((cooldown-now())/1000))});
  try{
   if(!pending.has(path)){
    const job=(async()=>{
     const response=await fetcher('https://api.dexscreener.com/'+path,{signal:AbortSignal.timeout(15000),redirect:'error'});
     if(response.status===429){cooldown=now()+60000;throw Error('Rate limited')}
     if(!response.ok)throw Error('Token market source unavailable');
     const value=await response.json();if(!Array.isArray(path.startsWith('latest/')?value?.pairs:value))throw Error('Invalid token market response');
     const result={value,at:now()};cache.delete(path);cache.set(path,result);
     if(cache.size>128)cache.delete(cache.keys().next().value);
     return result;
    })();pending.set(path,job);job.finally(()=>pending.delete(path)).catch(()=>{});
   }
   const result=await pending.get(path);return json(result.value,200,{'x-data-observed-at':String(result.at)});
  }catch(error){return json({error:error.message},now()<cooldown?429:503)}
 };
}
