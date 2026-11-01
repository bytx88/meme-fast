// Collection pauses do not count as observed market time.
export function observedRun(rows,now,maxGap,minSpacing=0){
 const unique=new Map();
 for(const row of rows||[])if(Number.isFinite(row?.at)&&row.at>0&&row.at<=now)unique.set(row.at,row);
 const sorted=[...unique.values()].sort((a,b)=>a.at-b.at),run=[];
 for(const row of sorted){
  if(run.length&&row.at-run.at(-1).at>maxGap)run.length=0;
  if(!run.length||row.at-run.at(-1).at>=minSpacing)run.push(row);
 }
 return run.length&&now-run.at(-1).at<=maxGap?run:[];
}

export function previousObservation(rows,currentAt,minGap,maxGap){
 if(!Number.isFinite(currentAt)||currentAt<=0)return null;
 return [...(rows||[])].filter(row=>Number.isFinite(row?.at)&&row.at>0&&currentAt-row.at>=minGap&&currentAt-row.at<=maxGap)
  .sort((a,b)=>b.at-a.at)[0]||null;
}
