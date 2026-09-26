export const RUG_DRAWDOWN=0.78;
export const RECOVERY_FROM_LOW=0.10;
export const POST_MIGRATION_WINDOW_MS=45*60000;
const LOOKBACK_MS=30*60000;
const MIN_SUSTAINED_AGE_MS=30*60000;
const MIN_SAMPLE_GAP_MS=4*60000;

export function evaluatePostMigration(coin,now=Date.now()){
 const start=Number(coin?.graduationObservedAt);
 if(coin?.launchpad?.completed!==true||!Number.isFinite(start)||start<=0||now<start)return null;
 const observedUntil=Math.min(now,start+POST_MIGRATION_WINDOW_MS);
 const samples=(coin.marketHistory||[]).filter(row=>row.at>=start&&row.at<=start+POST_MIGRATION_WINDOW_MS&&Number(row.priceUsd)>0).sort((a,b)=>a.at-b.at);
 if(samples.length<2||samples[0].at>start+10*60000)return null;
 let deepest={drawdown:0,price:Number(samples[0].priceUsd),at:samples[0].at};
 for(const row of samples){
  const peak=Math.max(...samples.filter(prior=>prior.at<=row.at&&prior.at>=row.at-LOOKBACK_MS).map(prior=>Number(prior.priceUsd)));
  const drawdown=1-Number(row.priceUsd)/peak;
  if(drawdown>deepest.drawdown)deepest={drawdown,price:Number(row.priceUsd),at:row.at};
  if(drawdown>=RUG_DRAWDOWN)return {state:'rugged',drawdown,at:row.at};
 }
 if(observedUntil-start<MIN_SUSTAINED_AGE_MS||samples.length<4||deepest.drawdown<=0)return null;
 const later=samples.filter(row=>row.at>=deepest.at+MIN_SAMPLE_GAP_MS);
 const lastTwo=later.slice(-2);
 if(lastTwo.length<2||lastTwo[1].at-lastTwo[0].at<MIN_SAMPLE_GAP_MS)return null;
 if(observedUntil-lastTwo[1].at>10*60000)return null;
 if(lastTwo.every(row=>Number(row.priceUsd)>=deepest.price*(1+RECOVERY_FROM_LOW)))
  return {state:'sustained',drawdown:deepest.drawdown,recovery:Number(lastTwo[1].priceUsd)/deepest.price-1,at:lastTwo[1].at};
 return null;
}
