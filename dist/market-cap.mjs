import {canonical,listingKey} from './core.mjs';

// Pool valuation and price fields describe the base token, never the quote token.
function basePools(token,pools) {
  return pools.filter(p=>{
    const id=p.relationships?.base_token?.data?.id;
    return id?.startsWith(token.network+'_')&&canonical(id.slice(token.network.length+1))===canonical(token.address);
  }).sort((a,b)=>(Number(b.attributes?.reserve_in_usd)||0)-(Number(a.attributes?.reserve_in_usd)||0));
}

export function tokenPriceSnapshot(token,pools,fetchedAt=Date.now()) {
  for(const pool of basePools(token,pools)){
    const value=Number(pool.attributes?.base_token_price_usd);
    if(Number.isFinite(value)&&value>0)return {value,fetchedAt,tokenKey:listingKey(token)};
  }
  return null;
}

export function marketCapSnapshot(token,pools,fetchedAt=Date.now()) {
  for(const pool of basePools(token,pools)){
    const cap=Number(pool.attributes?.market_cap_usd),price=Number(pool.attributes?.base_token_price_usd);
    if(Number.isFinite(cap)&&cap>0)return {value:cap,price:Number.isFinite(price)&&price>0?price:null,fetchedAt,tokenKey:listingKey(token)};
  }
  return null;
}

// A tiny, isolated swap in a thin pool can imply a wildly different price.
// Judge its tier against USD flow from the same selected time window.
export function marketCapTier(value){
  const scale=10**Math.floor(Math.log10(value)),marks=[1,1.2,1.5,2,2.5,3,4,5,6,8,10];
  const index=marks.findIndex((m,i)=>i<marks.length-1&&value<marks[i+1]*scale);
  const i=index<0?marks.length-2:index;
  return {low:marks[i]*scale,high:marks[i+1]*scale};
}
export function credibleMarketCapTrades(rows,snapshot) {
  const supply=snapshot?.value/snapshot?.price;
  if(!Number.isFinite(supply)||supply<=0)return {trades:[],outliers:0,available:false};
  const valid=rows.map(row=>({row,mc:row.price*supply})).filter(({row,mc})=>row.tokenKey===snapshot.tokenKey&&Number.isFinite(row.price)&&row.price>0&&Number.isFinite(mc)&&mc>0&&Number.isFinite(row.usd)&&row.usd>0);
  const sorted=[...valid].sort((a,b)=>a.mc-b.mc),total=sorted.reduce((sum,{row})=>sum+row.usd,0);
  let running=0,reference=null;
  for(const item of sorted){running+=item.row.usd;if(running>=total/2){reference=item.mc;break}}
  const buckets=new Map();
  for(const item of valid){
    const {low}=marketCapTier(item.mc);
    item.low=low;buckets.set(low,(buckets.get(low)||0)+item.row.usd);
  }
  const trades=valid.filter(item=>!((item.mc<reference/4||item.mc>reference*4)&&buckets.get(item.low)<total*.01));
  return {trades,outliers:valid.length-trades.length,available:true};
}

export function marketCapTimeline(rows,bins,snapshot) {
  const {trades,available}=credibleMarketCapTrades(rows,snapshot);
  if(!available)return bins.map(()=>null);
  return bins.map((bin,i)=>{
    const latest=trades.filter(({row})=>row.time>=bin.start&&(row.time<bin.end||i===bins.length-1&&row.time===bin.end)).sort((a,b)=>b.row.time-a.row.time)[0];
    const value=latest?.mc;
    return Number.isFinite(value)&&value>0?value:null;
  });
}
