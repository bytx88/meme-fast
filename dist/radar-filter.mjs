import {holdingsFor} from './followed-wallets.mjs';

export function matchesTrackedWalletFilter(coin,enabled,report,now=Date.now()){
 return !enabled||holdingsFor(coin,report,now).length>0;
}

export function matchesChainFilter(coin,filter){
 const network=String(coin?.network||'').toLowerCase();
 if(Array.isArray(filter))return filter.length===0||filter.includes(network);
 if(filter==='all')return true;
 if(filter==='other')return Boolean(network)&&network!=='solana'&&network!=='robinhood';
 return network===filter;
}

// An empty selection means All; toggling the final selected chain resets it.
export function toggleChainFilter(selected,chain){
 if(chain==='all')return [];
 return selected.includes(chain)?selected.filter(value=>value!==chain):[...selected,chain];
}
