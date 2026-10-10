export const symbols=['QQQ','BTC','XAU'];
export function compareSeries(series,start,displayStart=start){
 const maps=Object.fromEntries(symbols.map(s=>[s,new Map(series[s].filter(p=>/^\d{4}-\d{2}-\d{2}$/.test(p.date)&&Number.isFinite(p.close)&&p.close>0).map(p=>[p.date,p.close]))]));
 const common=[...maps.QQQ.keys()].filter(d=>symbols.every(s=>maps[s].has(d))).sort();
 const anchor=common.filter(d=>d<start).at(-1);
 if(!anchor) throw Error('No common closing prices before the requested start.');
 const baseline=Object.fromEntries(symbols.map(s=>[s,maps[s].get(anchor)]));
 const rows=common.filter(d=>d>=displayStart).map(date=>({date,prices:Object.fromEntries(symbols.map(s=>[s,maps[s].get(date)])),returns:Object.fromEntries(symbols.map(s=>[s,100*(maps[s].get(date)/baseline[s]-1)]))}));
 if(!rows.length) throw Error('No shared observations after the requested start.');
 return {start,displayStart,anchor,baseline,rows};
}
export function periodReturn(rows,symbol,count){
 if(rows.length<=count||!Number.isFinite(rows.at(-1).prices[symbol])||!Number.isFinite(rows.at(-1-count).prices[symbol])) return null;
 return 100*(rows.at(-1).prices[symbol]/rows.at(-1-count).prices[symbol]-1);
}
export function dailyReview(c){
 const rows=c.rows,last=rows.at(-1),metrics=Object.fromEntries(symbols.map(s=>[s,Object.fromEntries([1,5,20].map(n=>[n,periodReturn(rows,s,n)]))]));
 const prior=rows.slice(-21,-1),low=prior.length===20?Math.min(...prior.map(r=>r.prices.BTC)):null,high=prior.length===20?Math.max(...prior.map(r=>r.prices.BTC)):null;
 const state=low===null?'unknown':last.prices.BTC>high?'breakout':last.prices.BTC<low?'breakdown':'range';
 const b5=metrics.BTC[5],b20=metrics.BTC[20],q5=metrics.QQQ[5];
 const headline=b5===null||b20===null?'Insufficient history':b5>0&&b20>0?'BTC momentum improving':b5>0?'BTC rebound; longer trend still weak':b20>0?'BTC pullback within a stronger month':'BTC momentum weakening';
 const relative=b5===null||q5===null?null:100*((1+b5/100)/(1+q5/100)-1);
 return {date:last.date,price:last.prices.BTC,metrics,low,high,state,headline,relative};
}
export function executionReview(series){
 const btc=new Map(series.BTC.map(r=>[r.date,r.close]));
 const rows=series.QQQ.filter(r=>btc.has(r.date)).sort((a,b)=>a.date.localeCompare(b.date)).map(r=>({date:r.date,prices:{QQQ:r.close,BTC:btc.get(r.date)}}));
 if(!rows.length)throw Error('No common BTC / QQQ observations');
 return dailyReview({rows});
}
export function assetPeriods(series,calendar=null){
 const dates=calendar?new Set(calendar):null;
 const rows=series.filter(r=>!dates||dates.has(r.date)).sort((a,b)=>a.date.localeCompare(b.date));
 const last=rows.at(-1);
 if(!last)return null;
 return {date:last.date,close:last.close,returns:Object.fromEntries([1,5,20].map(n=>[n,rows.length>n?100*(last.close/rows.at(-1-n).close-1):null]))};
}
export function seasonalFrames(first,last){
 const frames=[];
 for(let year=Number(first.slice(0,4))-1;year<=Number(last.slice(0,4));year++){
  for(const [start,end,label] of [[`${year}-10-01`,`${year+1}-01-31`,'Oct–Jan'],[`${year+1}-02-01`,`${year+1}-05-31`,'Feb–May'],[`${year+1}-06-01`,`${year+1}-09-30`,'Jun–Sep']]){
   if(end>=first&&start<=last)frames.push({start,end,label,complete:end<last});
  }
 }
 return frames.sort((a,b)=>a.start.localeCompare(b.start));
}
export function frameReturns(rows,frame){
 const selected=rows.filter(r=>r.date>=frame.start&&r.date<=frame.end);
 const anchor=rows.filter(r=>r.date<frame.start).at(-1);
 if(!selected.length||!anchor)return null;
 return {first:selected[0].date,anchor:anchor.date,last:selected.at(-1).date,returns:Object.fromEntries(symbols.map(s=>[s,100*(selected.at(-1).prices[s]/anchor.prices[s]-1)]))};
}
export function visibleRows(comparison,days){
 if(!days) return comparison.rows;
 const cutoff=new Date(comparison.rows.at(-1).date+'T00:00:00Z');cutoff.setUTCDate(cutoff.getUTCDate()-days);
 return comparison.rows.filter(r=>r.date>=cutoff.toISOString().slice(0,10));
}
