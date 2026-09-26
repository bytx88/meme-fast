const MINUTE=60000;
const price=row=>Number(row?.priceUsd);

// A conservative chart-pattern screen, not a prediction of a rug or contract assessment.
export function earlyRampWarning(coin,now=Date.now()){
 if(coin?.ruggedAt)return null;
 const created=Number(coin?.poolCreated);
 if(!Number.isFinite(created)||created<=0||now-created<0||now-created>60*MINUTE)return null;
 const history=(coin.marketHistory||[])
  .filter(row=>Number.isFinite(Number(row?.at))&&Number(row.at)>=created&&Number(row.at)<=now&&Number.isFinite(price(row))&&price(row)>0)
  .sort((a,b)=>Number(a.at)-Number(b.at));
 if(history.length<5||now-Number(history.at(-1).at)>10*MINUTE)return null;
 for(let offset=0;offset<=history.length-5;offset++){
  const samples=history.slice(offset,offset+5),first=samples[0],last=samples.at(-1),span=Number(last.at)-Number(first.at);
  if(span<15*MINUTE||span>30*MINUTE||price(last)<2*price(first))continue;
  if(samples.some((row,index)=>index>0&&price(row)<price(samples[index-1])*0.95))continue;
  const liquidity=Number(last.liquidity);
  if(!Number.isFinite(liquidity)||liquidity<3000||liquidity>50000)continue;
  if(!samples.slice(0,3).every(row=>Number(row.buys5m)>=50&&Number(row.sells5m)>0&&Number(row.buys5m)>=2.5*Number(row.sells5m)))continue;
  return {risePercent:Math.round((price(last)/price(first)-1)*100),minutes:Math.round(span/MINUTE)};
 }
 return null;
}
