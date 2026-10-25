import {canonical,listingKey} from './core.mjs';

const ages={DexScreener:60000,GeckoTerminal:300000};
const addresses=pools=>[...new Set(pools.map(pool=>canonical(pool.attributes?.address||'')))].sort();
const belongs=(pool,token)=>[pool.relationships?.base_token?.data?.id,pool.relationships?.quote_token?.data?.id]
 .some(id=>typeof id==='string'&&id.startsWith(token.network+'_')&&canonical(id.slice(token.network.length+1))===canonical(token.address));

// Only the exact token-pools endpoint can certify its provider's complete list.
// Search results and individual pool observations remain ordinary hints.
export function certifyPoolList(tokens,provider,observedAt){
 if(!Object.hasOwn(ages,provider)||!Number.isFinite(observedAt)||observedAt<=0)return tokens;
 return tokens.map(token=>({...token,poolEvidence:{provider,scope:'token-pools',tokenKey:listingKey(token),
  observedAt,addresses:addresses(token.poolHints||[])}}));
}

export function reusablePoolList(token,now=Date.now()){
 const evidence=token.poolEvidence,pools=token.poolHints;
 if(!evidence||token.unverified||evidence.scope!=='token-pools'||evidence.tokenKey!==listingKey(token)||
  !Object.hasOwn(ages,evidence.provider)||!Number.isFinite(evidence.observedAt)||
  now-evidence.observedAt<0||now-evidence.observedAt>=ages[evidence.provider]||
  !Array.isArray(pools)||!pools.length||pools.length>1000||
  pools.some(pool=>!pool||!/^[A-Za-z0-9]{1,100}$/.test(pool.attributes?.address||'')||!belongs(pool,token))||
  !Array.isArray(evidence.addresses)||JSON.stringify(evidence.addresses)!==JSON.stringify(addresses(pools)))return null;
 return evidence;
}
