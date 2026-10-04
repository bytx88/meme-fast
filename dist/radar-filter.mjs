import {holdingsFor} from './followed-wallets.mjs';

export function matchesTrackedWalletFilter(coin,enabled,report,now=Date.now()){
 return !enabled||holdingsFor(coin,report,now).length>0;
}

export function matchesChainFilter(coin,filter){
 const network=String(coin?.network||'').toLowerCase();
 if(filter==='all')return true;
 if(filter==='other')return Boolean(network)&&network!=='solana'&&network!=='robinhood';
 return network===filter;
}
