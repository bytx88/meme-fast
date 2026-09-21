export const BANDS=[{name:'XL',label:'≥ $10K',min:10000},{name:'L',label:'$1K–<10K',min:1000},{name:'M',label:'$100–<1K',min:100},{name:'S',label:'< $100',min:0}];
export const canonical=a=>typeof a==='string'&&/^0x/i.test(a)?a.toLowerCase():a;
export function normalizeTrade(event,token,pool){
  const a=event.attributes||{},address=canonical(token),from=canonical(a.from_token_address),to=canonical(a.to_token_address);
  const side=to===address&&from!==address?'buy':from===address&&to!==address?'sell':null;
  const usd=Number(a.volume_in_usd),time=Date.parse(a.block_timestamp);
  if(!event.id||!side||a.volume_in_usd==null||!Number.isFinite(usd)||usd<=0||!Number.isFinite(time))return null;
  return {id:event.id,side,usd,time,pool:pool.name,poolAddress:pool.address,hash:a.tx_hash||'',wallet:a.tx_from_address||''};
}
export function summarize(trades,minutes,now=Date.now()){
  const seen=new Set(),cutoff=now-minutes*60000;
  const rows=trades.filter(t=>{if(!t||seen.has(t.id)||t.time<cutoff||t.time>now)return false;seen.add(t.id);return true}).sort((a,b)=>b.time-a.time);
  const bands=BANDS.map(b=>({...b,buy:0,sell:0}));let buy=0,sell=0,buyCount=0,sellCount=0;
  for(const t of rows){if(t.side==='buy'){buy+=t.usd;buyCount++}else{sell+=t.usd;sellCount++}bands.find(b=>t.usd>=b.min)[t.side]+=t.usd}
  return {rows,bands,buy,sell,net:buy-sell,total:buy+sell,buyCount,sellCount};
}
