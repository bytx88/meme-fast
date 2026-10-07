export const PRIORITY_TTL=86400000;
export const tokenKey=id=>String(id).startsWith('solana:')?String(id):String(id).toLowerCase();
export function validPriorityIds(ids){
 if(!Array.isArray(ids)||!ids.length||ids.length>30||ids.some(id=>typeof id!=='string'||! /^(?:solana:[1-9A-HJ-NP-Za-km-z]{32,44}|(?:base|robinhood|bsc):0x[a-fA-F0-9]{40})$/.test(id)))throw new Error('Request 1 to 30 supported token contracts');
 return [...new Set(ids.map(tokenKey))];
}
export function selectMarketTargets(coins,radarCoins,priorityIds=[],now=Date.now(),limit=1800){
 const priority=new Set(priorityIds.map(tokenKey)),radar=new Set(radarCoins.map(c=>tokenKey(c.id)));
 const all=[...new Map([...coins,...radarCoins].filter(c=>c.network&&c.contract_address).map(c=>[tokenKey(c.id),c])).values()];
 const selected=[],seen=new Set();
 const add=coin=>{if(selected.length<limit&&!seen.has(tokenKey(coin.id))){selected.push(coin);seen.add(tokenKey(coin.id))}};
 const oldest=(a,b)=>(a.marketAttemptAt??0)-(b.marketAttemptAt??0)||(a.marketUpdatedAt??0)-(b.marketUpdatedAt??0);
 all.filter(c=>priority.has(tokenKey(c.id))).sort(oldest).slice(0,300).forEach(add);
 all.filter(c=>radar.has(tokenKey(c.id))).sort(oldest).forEach(add);
 all.filter(c=>now-c.firstSeen<3600000).sort(oldest).slice(0,300).forEach(add);
 all.sort(oldest).forEach(add);
 return selected;
}
