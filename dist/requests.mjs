const abortError=()=>new DOMException('Request canceled','AbortError');
const limited=()=>new Error('The data provider is rate-limiting requests. Cached results remain available; try again in a minute.');

export function createRequestClient({base='/api/market',fetcher=fetch,interval=2100,concurrency=3,timeout=15000,decode=value=>value}={}) {
  const cache=new Map(),inFlight=new Map(),queue=[];
  let active=0,lastStart=-Infinity,timer=null,cooldownUntil=0;
  const ttl=path=>path.includes('/tokens/')?300000:path.includes('/search/')?60000:30000;
  function pump(){
    if(timer||active>=concurrency||!queue.length)return;
    const delay=Math.max(0,lastStart+interval-Date.now());
    if(delay){timer=setTimeout(()=>{timer=null;pump()},delay);return}
    queue.sort((a,b)=>b.priority-a.priority);
    const job=queue.shift();
    job.signal?.removeEventListener('abort',job.cancel);
    if(job.signal?.aborted){job.reject(abortError());pump();return}
    if(Date.now()<cooldownUntil){job.reject(limited());pump();return}
    active++;lastStart=Date.now();
    (async()=>{
      const signals=[AbortSignal.timeout(timeout)];if(job.signal)signals.push(job.signal);
      const response=await fetcher(base+job.path,{signal:AbortSignal.any(signals)});
      if(response.status===429){
        const retry=response.headers?.get('Retry-After'),seconds=Number(retry);
        const wait=retry?(Number.isFinite(seconds)?seconds*1000:Date.parse(retry)-Date.now()):60000;
        cooldownUntil=Date.now()+Math.max(60000,Number.isFinite(wait)?wait:60000);
        throw limited();
      }
      if(!response.ok)throw new Error(`The data provider could not return swaps (HTTP ${response.status}). Please try again.`);
      const value=decode(await response.json());if(!Array.isArray(value.data))throw new Error('The data provider returned an unexpected response.');
      if(job.signal?.aborted)throw abortError();
      cache.delete(job.path);cache.set(job.path,{time:Date.now(),value});
      if(cache.size>128)cache.delete(cache.keys().next().value);
      return value;
    })().then(job.resolve,e=>job.reject(e.name==='TimeoutError'?new Error('This pool took too long to respond. Other pools can still load.'):e.message==='Failed to fetch'?new Error('Cannot reach this data feed. It may be temporarily unavailable. Other listings can still load.'):e)).finally(()=>{active--;pump()});
    pump();
  }
  return function request(path,{signal,priority=0,force=false}={}){
    if(signal?.aborted)return Promise.reject(abortError());
    const old=cache.get(path);if(!force&&old&&Date.now()-old.time<ttl(path))return Promise.resolve(old.value);
    const previous=inFlight.get(path);if(previous&&previous.signal===signal)return previous.promise;
    if(Date.now()<cooldownUntil)return Promise.reject(limited());
    let job;
    const promise=new Promise((resolve,reject)=>{
      job={path,signal,priority,resolve,reject,cancel:()=>{const i=queue.indexOf(job);if(i>=0){queue.splice(i,1);reject(abortError());pump()}}};
      signal?.addEventListener('abort',job.cancel,{once:true});queue.push(job);pump();
    });
    const entry={signal,promise};inFlight.set(path,entry);
    promise.then(()=>cleanup(),()=>cleanup());
    function cleanup(){signal?.removeEventListener('abort',job.cancel);if(inFlight.get(path)===entry)inFlight.delete(path)}
    return promise;
  };
}
