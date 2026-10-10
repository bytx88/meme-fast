// Evidence rules, not probabilities or claims about trader intent.
export const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const last=a=>a?.at(-1), change=(a,b)=>a&&b?100*(a/b-1):null;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const dateMs=d=>Date.parse(d+'T00:00:00Z');
export function usable(report,key,asOf){
 const feed=report.feeds?.[key];
 if(feed?.status!=='ok'||!feed.latestDate)return false;
 const age=(dateMs(asOf)-dateMs(feed.latestDate))/86400000;
 return age>=0&&age<=(key==='FED'?90:key==='FUNDING'||key==='LIQ'?1:['OI','BTC','SPOT','SPOT_PRICE'].includes(key)?2:4);
}
export function driverContext(rows){
 if(!rows?.length)return null;
 const latest=last(rows), past=rows.slice(-61,-1), five=rows.at(-6);
 const moves=rows.slice(-61).slice(1).map((r,i)=>r.close/rows.slice(-61)[i].close-1);
 const avg=mean(moves), sd=moves.length>=20?Math.sqrt(mean(moves.map(n=>(n-avg)**2))):null;
 const fivePct=five?change(latest.close,five.close):null;
 const scale=sd===null?null:100*sd*Math.sqrt(5);
 return {level:latest.close,date:latest.date,change5:fivePct,
  significant:scale===null||fivePct===null?null:Math.abs(fivePct)>scale,
  scale,percentile:past.length>=20?100*past.filter(r=>r.close<=latest.close).length/past.length:null,sample:past.length};
}
export function ratioReturn(series,a,b,count=5,calendar=null){
 const bm=new Map(series[b]?.map(r=>[r.date,r.close])||[]);
 const dates=calendar?new Set(calendar):null;
 const rows=(series[a]||[]).filter(r=>bm.has(r.date)&&(!dates||dates.has(r.date))).sort((x,y)=>x.date.localeCompare(y.date));
 if(rows.length<=count)return null;
 const end=last(rows),start=rows.at(-1-count);
 return {date:end.date,start:start.date,value:100*((end.close/bm.get(end.date))/(start.close/bm.get(start.date))-1)};
}
export function assess(report,asOf=new Date().toISOString().slice(0,10)){
 const btc=(report.series.BTC||[]).filter(r=>r.date<=asOf), latest=last(btc);
 const q=ratioReturn(report.series,'BTC','QQQ'),g=ratioReturn(report.series,'BTC','XAU',5,(report.series.QQQ||[]).map(r=>r.date));
 const candles=btc.slice(-26);
 const priceFresh=usable(report,'BTC',asOf),ohlc=btc.length>=26&&candles.every((r,i)=>finite(r.high)&&finite(r.low)&&(!i||dateMs(r.date)-dateMs(candles[i-1].date)===86400000));
 const prior=btc.slice(-21,-1), base=btc.slice(-25,-5);
 const high=ohlc?Math.max(...prior.map(r=>r.high)):null,low=ohlc?Math.min(...prior.map(r=>r.low)):null;
 const baseLow=ohlc?Math.min(...base.map(r=>r.low)):null;
 let acceptance=null,failedAcceptance=null;
 if(ohlc)for(let i=Math.max(21,btc.length-40);i<btc.length;i++){
  const base=btc.slice(i-21,i-1),rangeHigh=Math.max(...base.map(r=>r.high));
  if(!base.every(r=>finite(r.high))||!(btc[i-1].close>rangeHigh&&btc[i].close>rangeHigh))continue;
  const remaining=btc.slice(i+1);
  if(remaining.every(r=>r.close>rangeHigh)){
   acceptance={level:rangeHigh,date:btc[i].date,retest:remaining.find(r=>r.low<=rangeHigh&&r.close>rangeHigh)?.date||null};failedAcceptance=null;break;
  }
  if(latest.close<=rangeHigh)failedAcceptance={level:rangeHigh,date:btc[i].date};
 }
 const swept=ohlc&&btc.slice(-5).some(r=>r.low<baseLow)&&latest.close>baseLow;
 const reclaimed=ohlc&&latest.close>high;
 const accepted=!!acceptance;
 const referenceHigh=acceptance?.level??failedAcceptance?.level??high;
 const broken=ohlc&&latest.close<low;
 const oi=report.positioning?.OI||[], funding=report.positioning?.FUNDING||[],flows=report.positioning?.ETF||[];
 const oiFresh=usable(report,'OI',asOf),fundFresh=usable(report,'FUNDING',asOf),etfFresh=usable(report,'ETF',asOf);
 const oi5=oi.length>=6?change(last(oi).btc,oi.at(-6).btc):null;
 const oiPrice=oi.length>=6?change(btc.find(r=>r.date===last(oi).date)?.close,btc.find(r=>r.date===oi.at(-6).date)?.close):null;
 const clearing=oiFresh&&oi5!==null&&oiPrice!==null&&oi5<0&&oiPrice<0;
 const fundingRate=last(funding)?.rate??null;
 const rank=funding.length>=20&&fundingRate!==null?100*(funding.filter(r=>r.rate<fundingRate).length+.5*funding.filter(r=>r.rate===fundingRate).length)/funding.length:null;
 const crowded=fundFresh&&fundingRate>0&&rank>=90;
 const flowDates=(report.series.QQQ||[]).filter(r=>r.date<=last(flows)?.date).slice(-5).map(r=>r.date),flowMap=new Map(flows.map(r=>[r.date,r.millionUsd]));
 const flow5=flowDates.length===5&&flowDates.at(-1)===last(flows)?.date&&flowDates.every(d=>finite(flowMap.get(d)))?flowDates.reduce((n,d)=>n+flowMap.get(d),0):null;
 const spot=report.positioning?.SPOT||[],spotPrice=report.positioning?.SPOT_PRICE||[],latestSpot=last(spot),spot5=spot.slice(-5);
 const spotFresh=usable(report,'SPOT',asOf),spotFiveComplete=spot5.length===5&&dateMs(last(spot5).date)-dateMs(spot5[0].date)===4*86400000;
 const buy5=spotFiveComplete?spot5.reduce((n,r)=>n+r.buy,0):null,sell5=spotFiveComplete?spot5.reduce((n,r)=>n+r.sell,0):null;
 const spotBuyShare5=buy5===null||buy5+sell5<=0?null:100*buy5/(buy5+sell5);
 const spotSellShare=latestSpot?100*latestSpot.sell/(latestSpot.buy+latestSpot.sell):null;
 const priceBar=spotPrice.find(r=>r.date===latestSpot?.date),beforeBar=spotPrice.find(r=>dateMs(r.date)===dateMs(latestSpot?.date)-86400000);
 const absorptionCandidate=spotFresh&&usable(report,'SPOT_PRICE',asOf)&&spotSellShare>=55&&priceBar&&beforeBar&&priceBar.low>=beforeBar.low&&priceBar.close>beforeBar.close;
 const aligned=q&&g&&q.date===g.date&&q.start===g.start;
 const dualStrength=aligned&&usable(report,'QQQ',asOf)&&usable(report,'XAU',asOf)&&q.value>0&&g.value>0;
 const etfDemand=etfFresh&&flow5!==null&&flow5>0,spotDemand=spotFresh&&spotBuyShare5!==null&&spotBuyShare5>=55;
 const demand=etfDemand||spotDemand,demandKnown=etfFresh&&flow5!==null||spotFresh&&spotBuyShare5!==null;
 let phase='Range / reset unconfirmed',summary='The seasonal thesis has no confirmed transition into expansion.',next='Watch for a daily range reclaim, follow-through and improving BTC relative strength.';
 if(!priceFresh||!ohlc){phase='Assessment withheld';summary=!priceFresh?'BTC observations are unavailable or delayed.':'Daily high / low history is incomplete; closes alone cannot identify a sweep.';next='Restore fresh daily OHLC before assessing the price sequence.';}
 else if(broken){phase='Range failure';summary='BTC closed below the preceding 20-day low. The recovery sequence is challenged.';next='Require a recovery above the lost boundary, then a held retest before upgrading the phase.';}
 else if(accepted&&dualStrength&&demand&&fundFresh&&rank!==null&&!crowded){phase='Expansion evidence';summary=`Two closes above the earlier range, leadership versus equities and gold, and ${etfDemand?'positive measured ETF flows':'OKX spot taker-buy share above the 55% participation rule'} support expansion. Demand coverage is ${etfDemand?'US spot ETFs':'one exchange’s BTC spot activity'}.`;next='Watch whether the prior range high holds on a retest; continued leadership and demand are required.';}
 else if(accepted){phase='Price acceptance / confirmation incomplete';summary=`BTC remains above the range reclaimed with two closes on ${acceptance.date}.${acceptance.retest?' A later daily candle touched that level and closed above it.':''} Full demand confirmation remains incomplete.`;next='Check BTC leadership versus both benchmarks and measured spot demand; avoid treating price acceptance as proof of absorption.';}
 else if(failedAcceptance){phase='Reclaim acceptance lost';summary=`BTC is back at or below the range accepted on ${failedAcceptance.date}. The earlier reclaim has not held.`;next='Require a fresh reclaim and acceptance; a calendar window does not repair failed price structure.';}
 else if(reclaimed){phase='Reclaim / acceptance pending';summary='BTC closed above the preceding 20-day high. One close is insufficient to establish a sustained advance.';next='Watch for a second close above the reclaimed range and a subsequent held retest.';}
 else if(swept){phase='Sweep-and-recovery candidate';summary='A recent daily low breached the preceding range and price recovered above that boundary. This is a price pattern, not proof of buyer intent or absorption.';next='Require an upper-range reclaim; check whether OI reduction and spot demand corroborate the reset.';}
 else if(clearing){phase='Position unwind / price still in range';summary='OKX contract OI and BTC price fell over aligned observation dates. Positions contracted; liquidation volume and absorption remain unmeasured.';next='Watch whether downside stops extending, then require a reclaim with improving relative strength.';}
 if(phase==='Range / reset unconfirmed'&&q&&usable(report,'QQQ',asOf))summary=`BTC remains inside the daily range and ${q.value<0?'is losing':q.value>0?'is gaining':'has unchanged'} relative strength versus QQQ. A completed liquidity reset is not established.`;
 if(priceFresh&&ohlc){
  if(accepted)next+=` The retained reclaim reference is $${referenceHigh.toLocaleString('en-US',{maximumFractionDigits:0})}.`;
  else if(!broken)next+=` Upper reference: $${referenceHigh.toLocaleString('en-US',{maximumFractionDigits:0})}.`;
 }
 const check=(label,status,detail)=>({label,status,detail});
 const checks=[
  check('Reset',!priceFresh||!ohlc?'unknown':swept||clearing?'observed':'pending',swept?'Daily sweep-and-recovery pattern observed.':clearing?'Falling price and falling OKX BTC-denominated OI.':'No measured sweep-and-recovery or joint price / OI contraction.'),
  check('Reclaim',!priceFresh||!ohlc?'unknown':reclaimed||accepted?'observed':'pending',referenceHigh===null?'Daily range unavailable.':`Reference: $${referenceHigh.toLocaleString('en-US',{maximumFractionDigits:0})}. ${failedAcceptance?'Earlier acceptance lost.':accepted?'Accepted level retained.':'Prior 20-day high.'}`),
  check('Acceptance',!priceFresh||!ohlc?'unknown':accepted?'observed':'pending',accepted?`Two-close acceptance ${acceptance.date}; no subsequent close at / below the retained level.${acceptance.retest?' Daily retest-and-close candidate '+acceptance.retest+'.':' A subsequent daily retest is not observed.'}`:'Two closes above their preceding 20-day high, retained while subsequent closes stay above it. Breakout search covers the latest 40 daily sessions.'),
  check('Participation',!aligned||!usable(report,'QQQ',asOf)||!usable(report,'XAU',asOf)||!demandKnown||!fundFresh||rank===null?'unknown':dualStrength&&demand&&!crowded?'observed':'pending','Same-date BTC leadership versus QQQ / XAU; positive five-report ETF flows or ≥55% OKX five-day spot taker-buy share; measured funding below the positive upper-decile flag. Channels retain their different coverage scopes.')
 ];
 const observations={
  QQQ:{date:q?.date,start:q?.start,value:q?.value,fresh:priceFresh&&usable(report,'QQQ',asOf),scope:'5 shared sessions'},
  XAU:{date:g?.date,start:g?.start,value:g?.value,fresh:priceFresh&&usable(report,'XAU',asOf),scope:'5 shared sessions'},
  YIELD:{date:last(report.drivers?.YIELD||[])?.date,value:last(report.drivers?.YIELD||[])?.close,fresh:usable(report,'YIELD',asOf),scope:'Yahoo 10Y yield'},
  BRENT:{date:last(report.drivers?.BRENT||[])?.date,value:last(report.drivers?.BRENT||[])?.close,fresh:usable(report,'BRENT',asOf),scope:'Yahoo Brent futures'},
  ETF:{date:last(report.positioning?.ETF||[])?.date,value:last(report.positioning?.ETF||[])?.millionUsd,fresh:etfFresh,scope:report.feeds?.ETF?.provider||'ETF'},
  OI:{date:last(oi)?.date,timestamp:last(oi)?.timestamp,value:last(oi)?.btc,fresh:oiFresh,scope:'OKX BTC units'},
  FUNDING:{date:last(report.positioning?.FUNDING||[])?.date,timestamp:last(report.positioning?.FUNDING||[])?.timestamp,value:fundingRate,fresh:fundFresh,scope:'OKX per payment'},
  SPOT:{date:latestSpot?.date,value:spotBuyShare5,fresh:spotFresh,scope:'OKX 5 daily buckets'},
  STRUCTURE:{date:latest?.date,value:phase,fresh:priceFresh,scope:'Daily OHLC rules'}
 };
 const priorObservations={};
 for(const key of ['YIELD','BRENT','ETF','OI','FUNDING']){
  const list=report.drivers?.[key]||report.positioning?.[key]||[],row=list.at(-2);
  if(row)priorObservations[key]={...observations[key],date:row.date,timestamp:row.timestamp,scope:key==='ETF'?row.provider||'ETF':observations[key].scope,value:key==='ETF'?row.millionUsd:key==='OI'?row.btc:key==='FUNDING'?row.rate:row.close,fresh:true};
 }
 for(const [key,reading] of [['QQQ',q],['XAU',g]])if(reading){
  const series=Object.fromEntries(Object.entries(report.series).map(([k,list])=>[k,list.filter(row=>row.date<reading.date)]));
  const prev=ratioReturn(series,'BTC',key,5,key==='XAU'?series.QQQ.map(r=>r.date):undefined);
  if(prev)priorObservations[key]={...observations[key],...prev,fresh:true};
 }
 const prevSpot=spot.slice(-6,-1);
 if(prevSpot.length===5&&dateMs(last(prevSpot).date)-dateMs(prevSpot[0].date)===4*86400000){const buy=prevSpot.reduce((s,r)=>s+r.buy,0),sell=prevSpot.reduce((s,r)=>s+r.sell,0);if(buy+sell>0)priorObservations.SPOT={...observations.SPOT,date:last(prevSpot).date,value:100*buy/(buy+sell),fresh:true};}
 return {observations,priorObservations,asOf,date:latest?.date,phase,summary,next,high,referenceHigh,low,baseLow,acceptance,failedAcceptance,accepted,reclaimed,swept,broken,checks,
  invalidation:low===null?'Daily range unavailable.':(accepted?`A close at / below $${referenceHigh.toLocaleString('en-US',{maximumFractionDigits:0})} cancels the retained acceptance. `:'')+`Daily close below $${low.toLocaleString('en-US',{maximumFractionDigits:0})} challenges the broader range. Daily retest patterns do not prove order-flow absorption.`,
  q,g,aligned,oi5,oiPrice,oiFresh,clearing,fundingRate,rank,crowded,fundFresh,flow5,etfFresh,spotBuyShare5,spotSellShare,spotFresh,spotDate:latestSpot?.date,absorptionCandidate:!!absorptionCandidate,
  yield:driverContext(report.drivers?.YIELD),oil:driverContext(report.drivers?.BRENT),priceFresh};
}
export function rotationRows(rows){
 if(!rows.length)return [];
 const first=rows[0];
 return rows.map(r=>({date:r.date,prices:r.prices,returns:{
  QQQ:100*((r.prices.BTC/r.prices.QQQ)/(first.prices.BTC/first.prices.QQQ)-1),
  XAU:100*((r.prices.BTC/r.prices.XAU)/(first.prices.BTC/first.prices.XAU)-1)
 }}));
}
export function catalystSelection(news){
 const counts=new Map();
 return [...news].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).filter(row=>{
  const n=counts.get(row.topic)||0;
  if(n>=1||/\b(sentenced|forfeits?|drug|dark web|hires|advisor|adviser)\b/i.test(row.title))return false;
  counts.set(row.topic,n+1);return true;
 }).slice(0,4);
}
