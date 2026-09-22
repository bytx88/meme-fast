// Presentation grouping only: each contract retains its own metrics and evidence.
export function groupCoins(coins, context=()=>null){
 const groups=new Map();
 const normalize=value=>String(value||'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
 for(const coin of coins){
  const key=JSON.stringify([coin.network,normalize(coin.name),normalize(coin.symbol)]);
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(coin);
 }
 return [...groups.values()].map(variants=>{
  const ranked=[...variants].sort((a,b)=>Number(Boolean(context(b)))-Number(Boolean(context(a)))||(b.liquidity??0)-(a.liquidity??0));
  return {...ranked[0],variants:ranked};
 });
}
