import {marketCapTier} from './market-cap.mjs';
export const CANDLE_MS=15*60*1000;
export const HISTORY_MS=5*24*60*60*1000;

export function normalizeCandles(payload,now=Date.now()){
  const raw=payload?.data?.attributes?.ohlcv_list;
  if(!Array.isArray(raw))throw new Error('Historical candle response is unavailable.');
  const byTime=new Map();
  for(const row of raw){
    if(!Array.isArray(row)||row.length<6||!row.slice(0,6).every(Number.isFinite))continue;
    const [seconds,open,high,low,close,volume]=row,time=seconds*1000;
    // Use complete candles fully inside the rolling window; never invent gap candles.
    if(time<now-HISTORY_MS||time+CANDLE_MS>now||low<=0||high<Math.max(open,close)||low>Math.min(open,close)||volume<0)continue;
    byTime.set(time,{time,open,high,low,close,volume});
  }
  return [...byTime.values()].sort((a,b)=>a.time-b.time);
}

export function candleMarketCaps(candles,snapshot){
  const supply=snapshot?.value/snapshot?.price;
  if(!Number.isFinite(supply)||supply<=0)return null;
  const rows=candles.map(c=>({...c,low:c.low*supply,high:c.high*supply,open:c.open*supply,close:c.close*supply}));
  if(rows.some(c=>![c.low,c.high,c.open,c.close].every(n=>Number.isFinite(n)&&n>0)))return null;
  const buckets=new Map();
  const bucket=value=>{const t=marketCapTier(value);if(!buckets.has(t.low))buckets.set(t.low,{...t,volume:0,count:0,touches:0});return buckets.get(t.low)};
  for(const c of rows){
    const closing=bucket(c.close);closing.volume+=c.volume;closing.count++;
    let value=c.low;
    // Preserve wick-only tiers without allocating any invented volume to them.
    for(let i=0;i<200;i++){
      const t=bucket(value);t.touches++;
      if(t.high>c.high)break;
      value=t.high;
    }
  }
  return {rows,tiers:[...buckets.values()].sort((a,b)=>b.low-a.low),low:rows.length?Math.min(...rows.map(c=>c.low)):null,high:rows.length?Math.max(...rows.map(c=>c.high)):null,volume:rows.reduce((s,c)=>s+c.volume,0)};
}

// One bounded request covers five days (480 15-minute candles). Cache separately
// from swaps so aggregate volume is never counted again as individual trades.
export function createCandleHistory(request,changed=()=>{},now=Date.now){
  const cache=new Map();
  return {read(token,pool){
    if(!token||!pool)return {status:'unavailable',candles:[],message:'No indexed pool available for historical candles.'};
    const key=`${token.network}:${token.address}:${pool.address}`;
    const old=cache.get(key);
    if(old&&(old.status==='loading'||now()-old.at<(old.status==='failed'?60000:300000)))return old;
    const entry={status:'loading',candles:[],pool,at:now()};cache.set(key,entry);
    if(cache.size>20)cache.delete(cache.keys().next().value);
    const path=`/networks/${encodeURIComponent(token.network)}/pools/${encodeURIComponent(pool.address)}/ohlcv/minute?aggregate=15&limit=1000&currency=usd&token=${encodeURIComponent(token.address)}`;
    Promise.resolve().then(()=>request(path)).then(payload=>{
      entry.candles=normalizeCandles(payload,now());entry.status=entry.candles.length?'loaded':'empty';entry.at=now();changed();
    }).catch(error=>{entry.status='failed';entry.message=error.message;entry.at=now();changed()});
    return entry;
  }};
}
