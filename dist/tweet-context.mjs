import {safeURL,cleanText} from './public-radar.mjs';
import {tweetCoinOneLiner} from './tweet-view.mjs';

export function tokenProfileContext(payload,coin){
  const data=payload?.data,a=data?.attributes,address=String(coin.contract_address||'');
  const same=value=>coin.network==='solana'?value===address:String(value||'').toLowerCase()===address.toLowerCase();
  if(!address||!a||!same(a.address)||!same(String(data.id||'').replace(coin.network+'_',''))||!String(data.id||'').startsWith(coin.network+'_'))return null;
  const description=cleanText(a.description||'');
  if(!description)return null;
  const links=(a.websites||[]).map(url=>({label:'Website',url:safeURL(url)})).filter(l=>l.url);
  if(/^[A-Za-z0-9_]{1,15}$/.test(a.twitter_handle||''))links.push({type:'twitter',url:`https://x.com/${a.twitter_handle}`});
  return {kind:'verified',profile:{description,links,url:`https://api.geckoterminal.com/api/v2/networks/${coin.network}/tokens/${encodeURIComponent(address)}/info`}};
}

export async function fetchTweetContext(coin,fetcher=fetch){
  let saved=coin.savedContext||null;
  try{
    const response=await fetcher(`/api/coin-context?id=${encodeURIComponent(coin.id)}`,{cache:'no-store',signal:AbortSignal.timeout(12000)});
    if(response.ok)saved=(await response.json()).context||saved;
  }catch{}
  if(tweetCoinOneLiner(saved)&& (saved.kind==='verified'||saved.web?.exact))return saved;
  try{
    const response=await fetcher(`/api/market/networks/${coin.network}/tokens/${encodeURIComponent(coin.contract_address)}/info`,{signal:AbortSignal.timeout(15000)});
    if(response.ok)return tokenProfileContext(await response.json(),coin)||saved;
  }catch{}
  return saved;
}
