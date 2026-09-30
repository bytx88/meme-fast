// Five-day flow is a bounded record of swaps this browser actually observed.
// The public provider only supplies its latest 300 swaps per pool; do not
// invent history for periods the browser never sampled.
const KEY='meme-fast:flow-history:v1';
const FIVE_DAYS=5*24*60*60*1000;
const MAX_STEPS=4000;
const MAX_BYTES=2500000;

export function mergeFlowHistory(current,prior,now=Date.now()) {
  const cutoff=now-FIVE_DAYS,byId=new Map();
  for(const row of [...prior,...current]){
    if(row&&typeof row.id==='string'&&typeof row.tokenKey==='string'&&Number.isFinite(row.time)&&row.time>=cutoff&&row.time<=now&&Number.isFinite(row.usd)&&row.usd>0)byId.set(row.id,row);
  }
  return [...byId.values()].sort((a,b)=>b.time-a.time).slice(0,MAX_STEPS);
}

export function createFlowHistory(getStorage=()=>window.localStorage,now=Date.now){
  function readAll(){
    try {
      const raw=getStorage().getItem(KEY);
      if(!raw||raw.length>MAX_BYTES)return [];
      const parsed=JSON.parse(raw);
      return Array.isArray(parsed)?mergeFlowHistory([],parsed,now()):[];
    }catch{return []}
  }
  return {
    read(keys){const allowed=new Set(keys);return readAll().filter(row=>allowed.has(row.tokenKey))},
    record(rows){
      if(!rows.length)return;
      try {
        let merged=mergeFlowHistory(rows,readAll(),now());
        let raw=JSON.stringify(merged);
        while(raw.length>MAX_BYTES&&merged.length>1){merged=merged.slice(0,Math.floor(merged.length*.8));raw=JSON.stringify(merged)}
        getStorage().setItem(KEY,raw);
      }catch{/* Storage may be unavailable or full; live swaps remain usable. */}
    }
  };
}
