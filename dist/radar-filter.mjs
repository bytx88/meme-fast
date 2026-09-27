export function matchesChainFilter(coin,filter){
 const network=String(coin?.network||'').toLowerCase();
 if(filter==='all')return true;
 if(filter==='other')return Boolean(network)&&network!=='solana'&&network!=='robinhood';
 return network===filter;
}
