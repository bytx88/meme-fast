export const symbols=['QQQ','BTC','XAU'];
export function compareSeries(series,start){
 const maps=Object.fromEntries(symbols.map(s=>[s,new Map(series[s].filter(p=>/^\d{4}-\d{2}-\d{2}$/.test(p.date)&&Number.isFinite(p.close)&&p.close>0).map(p=>[p.date,p.close]))]));
 const common=[...maps.QQQ.keys()].filter(d=>symbols.every(s=>maps[s].has(d))).sort();
 const anchor=common.filter(d=>d<start).at(-1);
 if(!anchor) throw Error('No common closing prices before the requested start.');
 const baseline=Object.fromEntries(symbols.map(s=>[s,maps[s].get(anchor)]));
 const rows=common.filter(d=>d>=start).map(date=>({date,prices:Object.fromEntries(symbols.map(s=>[s,maps[s].get(date)])),returns:Object.fromEntries(symbols.map(s=>[s,100*(maps[s].get(date)/baseline[s]-1)]))}));
 if(!rows.length) throw Error('No shared observations after the requested start.');
 return {start,anchor,baseline,rows};
}
export function visibleRows(comparison,days){
 if(!days) return comparison.rows;
 const cutoff=new Date(comparison.rows.at(-1).date+'T00:00:00Z');cutoff.setUTCDate(cutoff.getUTCDate()-days);
 return comparison.rows.filter(r=>r.date>=cutoff.toISOString().slice(0,10));
}
