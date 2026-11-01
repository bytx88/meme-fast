export const sectors={XLE:'Energy',XLP:'Consumer staples',XLV:'Health care',XLU:'Utilities',XLB:'Materials',XLRE:'Real estate',XLY:'Consumer discretionary',XLF:'Financials',XLI:'Industrials',XLC:'Communication services',XLK:'Technology'};
export const periods={'1D':1,'1W':5,'1M':21,'3M':63,YTD:0};
export function change(rows,period,end=rows.length-1){
 const last=rows[end];if(!last)return null;
 const start=period==='YTD'?rows.findLastIndex(r=>r.date<last.date.slice(0,4)+'-01-01'):end-periods[period];
 return start<0?null:(last.close/rows[start].close-1)*100;
}
export function analyze(series,period='1M'){
 if(!series.SPY?.length)return null;
 const names=Object.keys(sectors), maps=Object.fromEntries(['SPY',...names].map(s=>[s,new Map((series[s]||[]).map(r=>[r.date,r.close]))]));
 const dates=series.SPY.map(r=>r.date).filter(d=>names.every(s=>maps[s].has(d)));
 if(dates.length<80)return null;
 const aligned=Object.fromEntries(['SPY',...names].map(s=>[s,dates.map(date=>({date,close:maps[s].get(date)}))]));
 const benchmark=change(aligned.SPY,period), end=dates.length-1;
 const rows=names.map(symbol=>{
  const data=aligned[symbol],ret=change(data,period),relative=ret-benchmark;
  const rs=change(data,'1M')-change(aligned.SPY,'1M');
  const previous=change(data,'1M',end-5)-change(aligned.SPY,'1M',end-5);
  const momentum=rs-previous;
  return {symbol,name:sectors[symbol],ret,relative,rs,momentum,quadrant:rs>=0?(momentum>=0?'Leading':'Weakening'):(momentum>=0?'Improving':'Lagging')};
 }).sort((a,b)=>b.ret-a.ret);
 return {rows,benchmark,date:dates.at(-1),start:period==='YTD'?dates.findLast(d=>d<dates.at(-1).slice(0,4)+'-01-01'):dates[end-periods[period]],advancing:rows.filter(r=>r.ret>0).length,outperforming:rows.filter(r=>r.relative>0).length};
}
