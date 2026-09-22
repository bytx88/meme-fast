import {canonical,listingKey,uniqueListings} from './core.mjs';
const chains={solana:'solana',ethereum:'eth',base:'base',bsc:'bsc',robinhood:'robinhood',arbitrum:'arbitrum',optimism:'optimism',polygon:'polygon_pos',avalanche:'avax'};
export function isSolanaAddress(value){
  if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value))return false;
  const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';let n=0n;
  for(const c of value)n=n*58n+BigInt(alphabet.indexOf(c));
  let bytes=0;while(n){bytes++;n>>=8n}
  return bytes+(value.match(/^1*/)?.[0].length||0)===32;
}
function preferred(tokens,query){
  const address=tokens.filter(t=>canonical(t.address)===canonical(query));if(address.length)return address;
  // A contract input may never resolve to a similarly named but different address.
  if(isSolanaAddress(query)||/^0x[0-9a-f]{40}$/i.test(query))return [];
  const q=query.toLowerCase(),exact=tokens.filter(t=>t.symbol.toLowerCase()===q);
  return exact.length?exact:tokens.filter(t=>t.symbol.toLowerCase().includes(q)||t.name.toLowerCase().includes(q));
}
export function geckoMatches(result,query){
  const tokens=(result.included||[]).filter(t=>t.type==='token'&&t.attributes?.address).map(t=>{
    const a=t.attributes,network=t.id.slice(0,-a.address.length-1);
    const poolHints=result.data.filter(p=>[p.relationships?.base_token?.data?.id,p.relationships?.quote_token?.data?.id].some(id=>id?.startsWith(`${network}_`)&&canonical(id.slice(network.length+1))===canonical(a.address)));
    return {address:a.address,network,symbol:a.symbol||a.name||'Token',name:a.name||a.symbol||'Token',poolHints,liquidity:poolHints.reduce((s,p)=>s+(Number(p.attributes.reserve_in_usd)||0),0)};
  });
  return uniqueListings(preferred(tokens,query)).sort((a,b)=>b.liquidity-a.liquidity).slice(0,12);
}
export function dexMatches(pairs,query){
  const tokens=new Map();
  for(const pair of pairs){
    const network=chains[pair.chainId];if(!network||!pair.pairAddress)continue;
    for(const token of [pair.baseToken,pair.quoteToken]){
      if(!token?.address)continue;
      const t={address:token.address,network,symbol:token.symbol||'Token',name:token.name||token.symbol||'Token'};
      const key=listingKey(t);if(!tokens.has(key))tokens.set(key,{...t,liquidity:0,poolHints:[],lookupSource:'DEX Screener'});
      const match=tokens.get(key);if(match.poolHints.some(p=>canonical(p.attributes.address)===canonical(pair.pairAddress)))continue;
      match.liquidity+=Number(pair.liquidity?.usd)||0;
      match.poolHints.push({attributes:{address:pair.pairAddress,name:`${pair.baseToken?.symbol||'Token'} / ${pair.quoteToken?.symbol||'Token'}`,reserve_in_usd:String(pair.liquidity?.usd||0)},relationships:{base_token:{data:{id:`${network}_${pair.baseToken?.address}`}},quote_token:{data:{id:`${network}_${pair.quoteToken?.address}`}},dex:{data:{id:pair.dexId||''}}}});
    }
  }
  return preferred([...tokens.values()],query).sort((a,b)=>b.liquidity-a.liquidity).slice(0,12);
}
export async function lookupTokens(query,{gecko,dex,signal,onStatus=()=>{}}){
  const options={signal,priority:20};let lastError,successfulLookup=false;
  const attempts=isSolanaAddress(query)?[
    ['Looking up the Solana contract…',async()=>dexMatches((await dex(`/token-pairs/v1/solana/${encodeURIComponent(query)}`,options)).data,query)],
    ['Checking the direct token feed…',async()=>geckoMatches(await gecko(`/networks/solana/tokens/${encodeURIComponent(query)}/pools?include=base_token,quote_token`,options),query)]
  ]:[
    ['Finding matching tokens…',async()=>geckoMatches(await gecko(`/search/pools?query=${encodeURIComponent(query)}&include=base_token,quote_token`,options),query)],
    ['Trying the alternate token feed…',async()=>dexMatches((await dex(`/latest/dex/search?q=${encodeURIComponent(query)}`,options)).data,query)]
  ];
  for(const [message,lookup]of attempts){
    if(signal?.aborted)throw signal.reason;onStatus(message);
    try{const tokens=await lookup();if(signal?.aborted)throw signal.reason;successfulLookup=true;if(tokens.length)return tokens}catch(e){if(signal?.aborted)throw signal.reason;lastError=e}
  }
  if(isSolanaAddress(query))return [{network:'solana',address:query,symbol:'Contract',name:'Solana-format address · not verified',unverified:true,lookupWarning:successfulLookup?'No indexed token was found for this address.':'Both lookup feeds are unavailable. The address has not been verified.',liquidity:0}];
  if(successfulLookup)return [];
  throw lastError||new Error('Token lookup is unavailable. Please try again.');
}
