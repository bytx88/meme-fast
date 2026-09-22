import {contractForCopy} from './contract-copy.mjs';
export const FEEDS=[{id:'decrypt',name:'Decrypt',url:'https://decrypt.co/feed',host:'decrypt.co'},{id:'cointelegraph',name:'Cointelegraph',url:'https://cointelegraph.com/rss',host:'cointelegraph.com'}];
export const NETWORKS=[{id:'solana',name:'Solana'},{id:'base',name:'Base'}];
export const numeric=value=>value===null||value===undefined||value===''||!Number.isFinite(Number(value))?null:Number(value);
export function safeURL(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null}catch{return null}}
export function cleanText(value){return String(value??'').replace(/<[^>]*>/g,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(1114111,Number(n)))).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim()}
export function parseNews(data,feed,now=Date.now()) {
 if(data?.status!=='ok'||!Array.isArray(data.items))throw new Error('News feed returned an invalid response.');
 return data.items.flatMap(item=>{
  const url=safeURL(item.link),date=String(item.pubDate??'');
  const time=Date.parse(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(date)?date.replace(' ','T')+'Z':date);
  if(!url||!Number.isFinite(time)||time>now+300000||!cleanText(item.title))return [];
  const host=new URL(url).hostname;if(host!==feed.host&&!host.endsWith('.'+feed.host))return [];
  const canonical=new URL(url);canonical.search='';canonical.hash='';
  return [{id:canonical.href,url,title:cleanText(item.title).slice(0,240),summary:cleanText(item.description||item.content).slice(0,280),publisher:feed.name,feed:feed.id,time}];
 });
}
export function parsePools(data,network,now=Date.now()) {
 if(!Array.isArray(data?.data)||!Array.isArray(data?.included))throw new Error('Market feed returned an invalid response.');
 const tokens=new Map(data.included.filter(t=>t.type==='token').map(t=>[t.id,t.attributes]));
 const coins=new Map();
 for(const pool of data.data){
  const a=pool.attributes,t= tokens.get(pool.relationships?.base_token?.data?.id);if(!a||!t)continue;
  const c={id:`${network.id}:${t.address}`,name:String(t.name||t.symbol||'Unknown token'),symbol:String(t.symbol||'?'),image_url:safeURL(t.image_url),network:network.id,chain:network.name,contract_address:t.address,contract_verified:true,pool:a.address,poolCreated:Date.parse(a.pool_created_at),mc:numeric(a.market_cap_usd),fdv:numeric(a.fdv_usd),volume:numeric(a.volume_usd?.h24),liquidity:numeric(a.reserve_in_usd),buyers:numeric(a.transactions?.h24?.buyers),buys:numeric(a.transactions?.h24?.buys),sells:numeric(a.transactions?.h24?.sells),priceChange:numeric(a.price_change_percentage?.h24),fetchedAt:now};
  if(!contractForCopy(c)||!contractForCopy({...c,contract_address:c.pool}))continue;
  if(['SOL','WETH','ETH','USDC','USDT','USDS','DAI','WBTC','CBBTC','USDE'].includes(c.symbol.toUpperCase()))continue;
  const previous=coins.get(c.id);
  // Use one pool per token: summing pool-level buyers would double-count wallets.
  if(!previous||(c.liquidity??0)>(previous.liquidity??0))coins.set(c.id,c);
 }
 return [...coins.values()];
}
const stop=new Set('the a an and or of to in on for at as is are be by with from after before into new crypto cryptocurrency bitcoin ethereum solana says said its it this that over amid how why what more has have will can could not but than their now just'.split(' '));
const words=title=>[...new Set(title.toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(w=>w.length>3&&!stop.has(w)))];
const groupFor=text=>/\b(ai|artificial intelligence|agent|gemini|openai)\b/i.test(text)?'AI':/\b(meme|memecoin|memecoins|pump\.fun)\b/i.test(text)?'Meme Coins':'Macro Crypto';
function hash(value){let n=2166136261;for(const c of value)n=Math.imul(n^c.charCodeAt(0),16777619);return (n>>>0).toString(36)}
export function clusterNews(articles,now=Date.now()) {
 const clusters=[];
 for(const article of [...articles].sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id))){
  const terms=words(article.title);
  const match=clusters.find(c=>{const overlap=c.terms.filter(w=>terms.includes(w)).length;return overlap>=2&&overlap/Math.max(1,Math.min(c.terms.length,terms.length))>=.4});
  if(match)match.posts.push(article);else clusters.push({id:'news-'+hash(article.id),terms,posts:[article]});
 }
 return clusters.map(c=>{
  const posts=c.posts.sort((a,b)=>b.time-a.time),sources=new Set(posts.map(p=>p.publisher)).size;
  return {...c,title:posts[0].title,summary:posts.length>1?`${posts.length} articles from ${sources} publisher${sources===1?'':'s'} cover this developing story.`:posts[0].summary,group:groupFor(posts.map(p=>p.title).join(' ')),first:Math.min(...posts.map(p=>p.time)),latest:posts[0].time};
 });
}
export function narrativeMetrics(n,hours,now=Date.now()) {
 const posts=n.posts.filter(p=>p.time>=now-hours*3600000&&p.time<=now),sources=new Set(posts.map(p=>p.publisher)).size;
 return {...n,posts,sources,mentions:posts.length,stage:sources>=2?1:0,score:sources*100+posts.length*10+Math.max(0,1-(now-n.latest)/(hours*3600000))};
}
export function addressMatches(n,coins){
 // Exact CA evidence only. Matching a ticker or generic theme is insufficient.
 return coins.filter(c=>n.posts.some(p=>{
  const text=p.title+' '+p.summary+' '+p.url,address=c.contract_address;
  const found=text.match(c.chain==='Solana'?/(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g:/(?<![a-zA-Z0-9])0x[a-fA-F0-9]{40}\b/g)||[];
  return found.some(value=>c.chain==='Solana'?value===address:value.toLowerCase()===address.toLowerCase());
 }));
}
export function buildPublicView(dataset,{hours=4,group='all',stage='all',query=''}={},now=Date.now()) {
 const q=query.trim().toLowerCase(),stageMatch=s=>stage==='all'||stage==='unclassified'&&s===null||stage==='early'&&s!==null&&s<=2||stage==='conversion'&&s>=3&&s<=4||stage==='late'&&s>=5;
 const all=clusterNews(dataset.articles,now).map(n=>narrativeMetrics(n,hours,now));
 const trends=all.filter(n=>n.mentions&&(group==='all'||n.group===group)&&stageMatch(n.stage)&&(!q||`${n.title} ${n.summary} ${addressMatches(n,dataset.coins).map(c=>c.symbol+' '+c.name).join(' ')}`.toLowerCase().includes(q))).sort((a,b)=>b.score-a.score).slice(0,20).map((n,i)=>({...n,rank:i+1}));
 const coins=dataset.coins.filter(c=>(group==='all'||group===c.chain)&&stageMatch(null)&&(!q||`${c.symbol} ${c.name} ${c.contract_address}`.toLowerCase().includes(q))).sort((a,b)=>(b.buyers??-1)-(a.buyers??-1)).slice(0,20).map((c,i)=>({...c,rank:i+1}));
 const crossovers=trends.flatMap(n=>addressMatches(n,coins).map(c=>({id:n.id+':'+c.id,narrative:n,coin:c})));
 return {trends,coins,crossovers,all};
}
export async function fetchPublicSource(source,fetcher=fetch) {
 const url=source.url?`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(source.url)}`:`https://api.geckoterminal.com/api/v2/networks/${source.id}/trending_pools?include=base_token,quote_token&duration=1h`;
 const response=await fetcher(url,{signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error(response.status===429?'Rate limited; try again later.':`Feed unavailable (HTTP ${response.status}).`);
 const data=await response.json();return source.url?parseNews(data,source):parsePools(data,source);
}
export async function fetchNewPools(network,fetcher=fetch) {
 const response=await fetcher(`/api/market/networks/${encodeURIComponent(network.id)}/new_pools?include=base_token,quote_token`,{signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error(response.status===429?'Rate limited; try again later.':`New-pool feed unavailable (HTTP ${response.status}).`);
 return parsePools(await response.json(),network);
}
export function mergeArticles(oldItems,newItems,now=Date.now()) {
 return [...new Map([...oldItems,...newItems].map(p=>[p.id,p])).values()].filter(p=>p.time>=now-72*3600000).sort((a,b)=>b.time-a.time).slice(0,600);
}
export function compareSnapshots(before,after){
 if(!before)return [];
 const changes=[];
 for(const key of ['trends','coins','crossovers']){
  const prev=new Map((before[key]||[]).map(x=>[x.id,x])),next=new Map((after[key]||[]).map(x=>[x.id,x]));
  for(const [id,item] of next){const old=prev.get(id);if(!old)changes.push(`${item.title} entered ${key==='trends'?'Top Trending':key==='coins'?'Top Coins':'Crossovers'}.`);else if(item.rank&&old.rank!==item.rank)changes.push(`${item.title}: #${old.rank} → #${item.rank}.`)}
  for(const [id,item] of prev)if(!next.has(id))changes.push(`${item.title} left ${key==='trends'?'Top Trending':key==='coins'?'Top Coins':'Crossovers'} in the returned sample.`);
 }
 return changes;
}
