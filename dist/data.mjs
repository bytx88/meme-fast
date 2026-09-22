import {canonical,listingKey,uniqueListings,normalizeTrade} from './core.mjs';
import {marketCapSnapshot} from './market-cap.mjs';

// Read pools as soon as they are discovered, without waiting for other listings.
export async function loadListings(input,request,progress=()=>{},isCurrent=()=>true,onSnapshot=()=>{},lookupMarketCap=null) {
  const tokens=uniqueListings(input),poolsByKey=new Map(),rawTrades=new Map(),trades=[];
  const listings=tokens.map(token=>({...token,key:listingKey(token),status:'loading',error:'',poolCount:0,successCount:0,discovered:false}));
  let skipped=0,active=0,discovered=0;
  const tasks=[];
  function updateStatus(listing) {
    if(!listing.discovered||!listing.poolCount)return;
    const pools=[...poolsByKey.values()].filter(p=>p.targets.some(t=>listingKey(t)===listing.key));
    listing.successCount=pools.filter(p=>p.status==='loaded').length;
    listing.status=pools.some(p=>p.status==='pending')?'loading':listing.successCount===listing.poolCount?'loaded':listing.successCount?'partial':'failed';
  }
  function snapshot() {
    if(!isCurrent())return;
    for(const listing of listings)updateStatus(listing);
    const completed=[...poolsByKey.values()].filter(p=>p.status!=='pending').length;
    progress(`Loaded ${completed}/${poolsByKey.size} pools · ${discovered}/${tokens.length} listings checked`);
    onSnapshot({trades:[...trades],pools:[...poolsByKey.values()].map(p=>({...p,targets:[...p.targets]})),listings:listings.map(l=>({...l})),skipped});
  }
  function normalize(pool,token,events) {
    for(const event of events){const trade=normalizeTrade(event,token.address,pool);if(trade)trades.push(trade);else skipped++}
  }
  async function readPool(pool) {
    try {
      const result=await request(`/networks/${encodeURIComponent(pool.network)}/pools/${encodeURIComponent(pool.address)}/trades`,{priority:10});
      if(!isCurrent())return;
      pool.count=result.data.length;pool.status='loaded';rawTrades.set(pool.key,result.data);
      for(const token of pool.targets)normalize(pool,token,result.data);
    } catch(e) {if(!isCurrent())return;pool.failed=true;pool.status='failed';pool.error=e.message}
    snapshot();
  }
  async function discover(token,index) {
    const listing=listings[index];
    try {
      let result;
      try {result=await request(`/networks/${encodeURIComponent(token.network)}/tokens/${encodeURIComponent(token.address)}/pools?include=base_token,quote_token`,{priority:0})}
      catch(e){if(!isCurrent()||!token.poolHints?.length)throw e;result={data:[]};listing.discoveryWarning=e.message}
      if(!isCurrent())return;
      const found=[...(token.poolHints||[]),...result.data].filter(p=>p.attributes?.address&&[p.relationships?.base_token?.data?.id,p.relationships?.quote_token?.data?.id].some(id=>id?.startsWith(`${token.network}_`)&&canonical(id.slice(token.network.length+1))===canonical(token.address)));
      const unique=[...new Map(found.map(p=>[canonical(p.attributes.address),p])).values()].sort((a,b)=>(Number(b.attributes.reserve_in_usd)||0)-(Number(a.attributes.reserve_in_usd)||0)).slice(0,3);
      listing.marketCap=marketCapSnapshot(token,[...unique,...(token.poolHints||[])]);
      if(!listing.marketCap&&lookupMarketCap)tasks.push(async()=>{try{const cap=await lookupMarketCap(token);if(isCurrent()){listing.marketCap=cap;snapshot()}}catch{/* Missing valuation never prevents swaps from loading. */}});
      listing.poolCount=unique.length;listing.status=unique.length?'loading':'no-pools';listing.discovered=true;
      for(const p of unique) {
        const key=`${token.network}:${canonical(p.attributes.address)}`;
        let pool=poolsByKey.get(key);
        if(!pool){pool={key,address:p.attributes.address,name:p.attributes.name,network:token.network,dex:p.relationships?.dex?.data?.id||'',count:0,failed:false,status:'pending',targets:[]};poolsByKey.set(key,pool);const targetPool=pool;tasks.push(()=>readPool(targetPool));tasks[tasks.length-1].priority=10}
        pool.targets.push(token);
        if(pool.status==='loaded')normalize(pool,token,rawTrades.get(key));
      }
    } catch(e) {if(!isCurrent())return;listing.status='failed';listing.error=e.message;listing.discovered=true}
    discovered++;snapshot();
  }
  tokens.forEach((token,index)=>tasks.push(()=>discover(token,index)));
  await new Promise((resolve,reject)=>{
    function pump(){
      if(!isCurrent()){tasks.length=0;if(!active)resolve();return}
      tasks.sort((a,b)=>(b.priority||0)-(a.priority||0));
      while(active<3&&tasks.length){const task=tasks.shift();active++;Promise.resolve().then(task).catch(reject).finally(()=>{active--;pump()})}
      if(!active&&!tasks.length)resolve();
    }
    pump();
  });
  if(!isCurrent())return null;
  return {trades,pools:[...poolsByKey.values()],listings,skipped};
}
