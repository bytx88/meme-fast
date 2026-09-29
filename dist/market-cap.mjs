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

export function marketCapTimeline(rows,bins,snapshot) {
  const supply=snapshot?.value/snapshot?.price;
  if(!Number.isFinite(supply)||supply<=0)return bins.map(()=>null);
  return bins.map((bin,i)=>{
    const latest=rows.filter(r=>r.tokenKey===snapshot.tokenKey&&r.time>=bin.start&&(r.time<bin.end||i===bins.length-1&&r.time===bin.end)&&Number.isFinite(r.price)&&r.price>0).sort((a,b)=>b.time-a.time)[0];
    const value=latest?.price*supply;
    return Number.isFinite(value)&&value>0?value:null;
  });
}
