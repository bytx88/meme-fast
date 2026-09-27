export function marketFreshness(coin,now=Date.now(),maxAgeMinutes=15){
 const at=Number(coin?.marketUpdatedAt??coin?.fetchedAt);
 if(!Number.isFinite(at)||at<=0||at>now)return {state:'unknown',usable:false,label:'Market time unknown',at:null};
 const minutes=Math.floor((now-at)/60000),age=minutes<1?'<1m':minutes<60?`${minutes}m`:`${Math.floor(minutes/60)}h`;
 if(now-at>maxAgeMinutes*60000)return {state:'stale',usable:false,label:`Stale · ${age} old`,at};
 const incomplete=['liquidity','volume5m','buys5m','sells5m'].some(key=>coin[key]==null||coin[key]===''||!Number.isFinite(Number(coin[key])));
 return {state:incomplete?'incomplete':'fresh',usable:!incomplete,label:`${incomplete?'Partial':'Fresh'} · ${age} old`,at};
}
export function freshnessCounts(coins,now=Date.now(),maxAgeMinutes=15){
 const counts={fresh:0,stale:0,incomplete:0,unknown:0};
 for(const coin of coins)counts[marketFreshness(coin,now,maxAgeMinutes).state]++;
 return `${counts.fresh} fresh · ${counts.stale} stale · ${counts.incomplete+counts.unknown} partial / unknown`;
}
