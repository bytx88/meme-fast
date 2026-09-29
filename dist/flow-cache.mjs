import {canonical,listingKey} from './core.mjs';
const KEY='meme-fast:flow-snapshots:v1',TTL=24*60*60*1000,MAX_BYTES=1800000;
function valid(s,address,now){
  if(!s||s.version!==1||!Number.isFinite(s.fetched)||s.fetched>now||now-s.fetched>TTL)return false;
  if(!Array.isArray(s.tokens)||s.tokens.length!==1)return false;
  const t=s.tokens[0];
  if(!t||t.unverified||typeof t.address!=='string'||canonical(t.address)!==canonical(address)||![t.network,t.name,t.symbol].every(v=>typeof v==='string'&&v.length>0))return false;
  const key=listingKey(t);
  return Array.isArray(s.trades)&&s.trades.length<=900&&s.trades.every(r=>r&&r.tokenKey===key&&['buy','sell'].includes(r.side)&&Number.isFinite(r.usd)&&r.usd>0&&Number.isFinite(r.time)&&typeof r.id==='string')
    &&Array.isArray(s.pools)&&s.pools.length<=3&&s.pools.some(p=>p?.status==='loaded')&&s.pools.every(p=>p&&typeof p.address==='string'&&Array.isArray(p.targets)&&p.targets.length===1&&listingKey(p.targets[0])===key)
    &&Array.isArray(s.listings)&&s.listings.length===1&&s.listings[0]?.key===key;
}
export function createFlowCache(getStorage=()=>window.localStorage,now=Date.now){
  function entries(){try{const raw=getStorage().getItem(KEY);if(!raw||raw.length>MAX_BYTES)return [];const data=JSON.parse(raw);return Array.isArray(data)?data.filter(s=>valid(s,s?.tokens?.[0]?.address,now())).slice(0,3):[]}catch{return []}}
  return {
    read(address){return entries().find(s=>canonical(s.tokens[0].address)===canonical(address))||null},
    write(state){
      // Cache only an exact, unambiguous contract selection with usable pool data.
      if(state.loadError||state.tokens.length!==1||state.matches.length!==1||canonical(state.searchedQuery)!==canonical(state.tokens[0].address))return false;
      const snapshot={version:1,tokens:state.tokens,trades:state.trades,pools:state.pools,listings:state.listings,skipped:state.skipped||0,fetched:state.fetched};
      if(!valid(snapshot,state.searchedQuery,now()))return false;
      try{const saved=[snapshot,...entries().filter(s=>canonical(s.tokens[0].address)!==canonical(state.searchedQuery))].slice(0,3);while(JSON.stringify(saved).length>MAX_BYTES&&saved.length>1)saved.pop();const raw=JSON.stringify(saved);if(raw.length>MAX_BYTES)return false;getStorage().setItem(KEY,raw);return true}catch{return false}
    }
  };
}
