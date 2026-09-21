import {canonical,listingKey,uniqueListings,normalizeTrade} from './core.mjs';
export async function loadListings(input,request,progress=()=>{},isCurrent=()=>true,onSnapshot=()=>{}){
  const tokens=uniqueListings(input),poolsByKey=new Map(),listings=[],trades=[];let skipped=0;
  function snapshot(){if(!isCurrent())return;onSnapshot({trades:[...trades],pools:[...poolsByKey.values()].map(p=>({...p,targets:[...p.targets]})),listings:listings.map(l=>({...l})),skipped})}
  for(const token of tokens){
    if(!isCurrent())return null;
    const listing={...token,key:listingKey(token),status:'loading',error:'',poolCount:0,successCount:0};listings.push(listing);
    progress(`Finding pools · ${listings.length}/${tokens.length} listings`);
    try{
      const j=await request(`/networks/${encodeURIComponent(token.network)}/tokens/${encodeURIComponent(token.address)}/pools?include=base_token,quote_token`);
      if(!isCurrent())return null;
      const found=j.data.filter(p=>[p.relationships?.base_token?.data?.id,p.relationships?.quote_token?.data?.id].some(id=>id&&canonical(id.slice(token.network.length+1))===canonical(token.address))).sort((a,b)=>(Number(b.attributes.reserve_in_usd)||0)-(Number(a.attributes.reserve_in_usd)||0));
      const unique=[...new Map(found.map(p=>[canonical(p.attributes.address),p])).values()].slice(0,3);
      listing.poolCount=unique.length;listing.status=unique.length?'loading':'no-pools';
      for(const p of unique){const key=`${token.network}:${canonical(p.attributes.address)}`;if(!poolsByKey.has(key))poolsByKey.set(key,{key,address:p.attributes.address,name:p.attributes.name,network:token.network,dex:p.relationships?.dex?.data?.id||'',count:0,failed:false,status:'pending',targets:[]});poolsByKey.get(key).targets.push(token)}
    }catch(e){listing.status='failed';listing.error=e.message}
    snapshot();
  }
  const pools=[...poolsByKey.values()];let completed=0;
  for(const pool of pools){
    if(!isCurrent())return null;progress(`Loading swaps · ${++completed}/${pools.length} pools`);
    try{const result=await request(`/networks/${encodeURIComponent(pool.network)}/pools/${encodeURIComponent(pool.address)}/trades`);if(!isCurrent())return null;pool.count=result.data.length;pool.status='loaded';
      for(const token of pool.targets){const listing=listings.find(l=>l.key===listingKey(token));listing.successCount++;for(const event of result.data){const trade=normalizeTrade(event,token.address,pool);if(trade)trades.push(trade);else skipped++}}
    }catch(e){pool.failed=true;pool.status='failed';pool.error=e.message}
    for(const listing of listings)if(listing.poolCount){const pending=[...poolsByKey.values()].some(p=>p.status==='pending'&&p.targets.some(t=>listingKey(t)===listing.key));listing.status=pending?'loading':listing.successCount===listing.poolCount?'loaded':listing.successCount?'partial':'failed'}
    snapshot();
  }
  for(const listing of listings)if(listing.poolCount)listing.status=listing.successCount===listing.poolCount?'loaded':listing.successCount?'partial':'failed';
  return {trades,pools,listings,skipped};
}
