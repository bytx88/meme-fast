export const RUG_DRAWDOWN=0.78;
export const RECOVERY_FROM_LOW=0.10;
export const POST_MIGRATION_WINDOW_MS=45*60000;
export const EARLY_AGE_LIMIT_MS=6*3600000;
export const LATE_RECOVERY_WINDOW_MS=24*3600000;
const LOOKBACK_MS=30*60000;
const MIN_SUSTAINED_AGE_MS=30*60000;
const MIN_SAMPLE_GAP_MS=4*60000;
const CONTINUATION_GAIN=0.25;
const LATE_DRAWDOWN=0.30;
const LATE_RECOVERY_FROM_LOW=0.50;

export function observationStart(coin){
 const starts=coin?.launchpad?.completed===true?[coin.graduationObservedAt]:[coin?.poolCreated,coin?.firstSeen].filter(value=>value!=null&&Number.isFinite(Number(value))&&Number(value)>0);
 const start=starts.length?Math.min(...starts.map(Number)):NaN;
 return Number.isFinite(start)&&start>0?start:null;
}

function priceSamples(coin,start,end){
 const rows=new Map();
 for(const row of [...(coin.marketHistoryHourly||[]),...(coin.marketHistory||[]),...(coin.priceHistory5m||[])]){
  if(row.at>=start&&row.at<=end&&Number(row.priceUsd)>0)rows.set(row.at,{at:row.at,price:Number(row.priceUsd)});
 }
 return [...rows.values()].sort((a,b)=>a.at-b.at);
}

export function outcomeCoverage(coin,windowMs,now=Date.now()){
 const start=observationStart(coin);
 if(start===null)return 'insufficient';
 const samples=priceSamples(coin,start,Math.min(now,start+windowMs));
 return samples.length>=4&&samples[0].at<=start+10*60000?'measured':'insufficient';
}

export function evaluatePostMigration(coin,now=Date.now()){
 const start=observationStart(coin);
 if(start===null||now<start)return null;
 const observedUntil=Math.min(now,start+POST_MIGRATION_WINDOW_MS);
 const samples=priceSamples(coin,start,observedUntil);
 if(samples.length<2||samples[0].at>start+10*60000)return null;
 let deepest={drawdown:0,price:samples[0].price,at:samples[0].at},rug=null;
 for(const row of samples){
  const peak=Math.max(...samples.filter(prior=>prior.at<=row.at&&prior.at>=row.at-LOOKBACK_MS).map(prior=>prior.price));
  const drawdown=1-row.price/peak;
  if(drawdown>deepest.drawdown)deepest={drawdown,price:row.price,at:row.at};
  if(drawdown>=RUG_DRAWDOWN&&!rug)rug={state:'rugged',drawdown,at:row.at};
 }
 for(let i=1;i<samples.length;i++){
  const lastTwo=samples.slice(i-1,i+1);
  if(rug&&lastTwo[1].at>=rug.at)break;
  if(lastTwo[1].at-lastTwo[0].at<MIN_SAMPLE_GAP_MS)continue;
  if(lastTwo[1].at-start>=10*60000&&lastTwo.every(row=>row.price>=samples[0].price*(1+CONTINUATION_GAIN))){
   const success={state:'sustained',scenario:'continuation',drawdown:deepest.drawdown,recovery:lastTwo[1].price/samples[0].price-1,at:lastTwo[1].at};
   return rug?{...rug,earlySuccess:success}:success;
  }
  if(observedUntil-start<MIN_SUSTAINED_AGE_MS||lastTwo[1].at-start<20*60000||i<3)continue;
  const prefix=samples.slice(0,i+1);
  let low={drawdown:0,price:prefix[0].price,at:prefix[0].at};
  for(const row of prefix){
   const peak=Math.max(...prefix.filter(prior=>prior.at<=row.at&&prior.at>=row.at-LOOKBACK_MS).map(prior=>prior.price));
   const drawdown=1-row.price/peak;
   if(drawdown>low.drawdown)low={drawdown,price:row.price,at:row.at};
  }
  if(low.drawdown>0&&lastTwo[0].at>=low.at+MIN_SAMPLE_GAP_MS&&lastTwo.every(row=>row.price>=low.price*(1+RECOVERY_FROM_LOW))){
   const success={state:'sustained',scenario:'recovery',drawdown:low.drawdown,recovery:lastTwo[1].price/low.price-1,at:lastTwo[1].at};
   return rug?{...rug,earlySuccess:success}:success;
  }
 }
 return rug;
}

export function evaluateLaterRecovery(coin,now=Date.now()){
 const start=observationStart(coin);
 if(start===null||now-start<=EARLY_AGE_LIMIT_MS)return null;
 const end=Math.min(now,start+LATE_RECOVERY_WINDOW_MS);
 const samples=priceSamples(coin,start,end);
 if(samples.length<4||samples[0].at>start+10*60000)return null;
 let peak=samples[0].price,trough=null;
 for(let i=0;i<samples.length;i++){
  const row=samples[i];
  if(row.price>peak)peak=row.price;
  const drawdown=1-row.price/peak;
  if(drawdown>=LATE_DRAWDOWN&&(!trough||row.price<trough.price))trough={...row,drawdown};
  if(!trough||i<1)continue;
  const lastTwo=samples.slice(i-1,i+1);
  if(lastTwo[1].at<start+POST_MIGRATION_WINDOW_MS)continue;
  if(lastTwo[0].at<trough.at+MIN_SAMPLE_GAP_MS||lastTwo[1].at-lastTwo[0].at<MIN_SAMPLE_GAP_MS)continue;
  if(lastTwo.every(sample=>sample.price>=trough.price*(1+LATE_RECOVERY_FROM_LOW)))
   return {state:'laterRecovery',drawdown:trough.drawdown,recovery:lastTwo[1].price/trough.price-1,at:lastTwo[1].at};
 }
 return null;
}
