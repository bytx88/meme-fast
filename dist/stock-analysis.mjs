export const sectors={XLE:'Energy',XLP:'Consumer staples',XLV:'Health care',XLU:'Utilities',XLB:'Materials',XLRE:'Real estate',XLY:'Consumer discretionary',XLF:'Financials',XLI:'Industrials',XLC:'Communication services',XLK:'Technology'};
export const periods={'1D':1,'1W':5,'1M':21,'3M':63,YTD:0};
export function change(rows,period,end=rows.length-1){
 const last=rows[end];if(!last)return null;
 const start=period==='YTD'?rows.findLastIndex(r=>r.date<last.date.slice(0,4)+'-01-01'):end-periods[period];
 return start<0?null:(last.close/rows[start].close-1)*100;
}
const monthStart=(day,offset=0)=>new Date(Date.UTC(Number(day.slice(0,4)),Number(day.slice(5,7))-1+offset,1)).toISOString().slice(0,10);
const monthName=day=>new Date(day+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'});
export function periodWindows(dates,period,asOf,benchmarkDates=dates){
 const last=dates.length-1;
 if(period==='1M'||period==='3M'){
  const count=period==='1M'?1:3,boundary=monthStart(asOf);
  const window=(offset)=>{
   const from=monthStart(boundary,-offset-count),to=monthStart(boundary,-offset);
   const start=benchmarkDates.findLast(d=>d<from),end=benchmarkDates.findLast(d=>d<to);
   // Missing month-end inputs must not shorten a calendar comparison silently.
   if(!start||!end||start.slice(0,7)!==monthStart(from,-1).slice(0,7)||end.slice(0,7)!==monthStart(to,-1).slice(0,7)||!dates.includes(start)||!dates.includes(end))return null;
   return {start,end,label:count===1?monthName(from):`${monthName(from)} – ${monthName(monthStart(to,-1))}`};
  };
  return {current:window(0),previous:window(count)};
 }
 if(period==='YTD'){
  const year=dates[last]?.slice(0,4),start=dates.findLastIndex(d=>d<year+'-01-01');
  if(start<0)return {current:null,previous:null};
  const previousStart=dates.findLastIndex(d=>d<String(Number(year)-1)+'-01-01'),sessions=last-start;
  return {current:{start:dates[start],end:dates[last],label:`${year} YTD`},previous:previousStart>=0&&dates[previousStart+sessions]?.slice(0,4)===String(Number(year)-1)?{start:dates[previousStart],end:dates[previousStart+sessions],label:`${Number(year)-1} YTD (${sessions} sessions)`}:null};
 }
 const count=periods[period],window=(end,label)=>end-count>=0?{start:dates[end-count],end:dates[end],label}:null;
 return {current:window(last,period==='1D'?'Latest session':'Latest 5 sessions'),previous:window(last-count,period==='1D'?'Prior session':'Prior 5 sessions')};
}
export function analyze(series,period='1M',asOf=new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'})){
 if(!series.SPY?.length)return null;
 const names=Object.keys(sectors), maps=Object.fromEntries(['SPY',...names].map(s=>[s,new Map((series[s]||[]).map(r=>[r.date,r.close]))]));
 const dates=series.SPY.map(r=>r.date).filter(d=>names.every(s=>maps[s].has(d)));
 if(dates.length<80)return null;
 const aligned=Object.fromEntries(['SPY',...names].map(s=>[s,dates.map(date=>({date,close:maps[s].get(date)}))]));
 const windows=periodWindows(dates,period,asOf,series.SPY.map(r=>r.date));
 if(!windows.current)return null;
 const value=(symbol,window)=>window?(maps[symbol].get(window.end)/maps[symbol].get(window.start)-1)*100:null;
 const benchmark=value('SPY',windows.current),previousBenchmark=value('SPY',windows.previous),end=dates.length-1;
 const rows=names.map(symbol=>{
  const data=aligned[symbol],ret=value(symbol,windows.current),relative=ret-benchmark;
  const previousRet=value(symbol,windows.previous),previousRelative=previousRet===null?null:previousRet-previousBenchmark;
  const rs=change(data,'1M')-change(aligned.SPY,'1M');
  const previous=change(data,'1M',end-5)-change(aligned.SPY,'1M',end-5);
  const momentum=rs-previous;
  return {symbol,name:sectors[symbol],ret,relative,previousRet,previousRelative,rs,momentum,quadrant:rs>=0?(momentum>=0?'Leading':'Weakening'):(momentum>=0?'Improving':'Lagging')};
 }).sort((a,b)=>b.ret-a.ret);
 return {rows,benchmark,previousBenchmark,windows,sourceDate:dates.at(-1),date:windows.current.end,start:windows.current.start,advancing:rows.filter(r=>r.ret>0).length,outperforming:rows.filter(r=>r.relative>0).length};
}
