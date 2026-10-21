import {FEEDS,NETWORKS,mergeArticles} from './public-radar.mjs';

export function reconcileSharedFeed(previous,feed,now=Date.now()){
 const failedNews=new Set(FEEDS.filter(source=>feed.sources.get(source.id)?.status==='failed').map(source=>source.name));
 const articles=mergeArticles((previous.articles||[]).filter(item=>failedNews.has(item.publisher)),feed.articles,now);
 const coins=new Map();
 for(const row of [...(previous.coins||[]).filter(row=>feed.sources.get(row.network)?.status==='failed'),...feed.coins]){
  if(!(row.fetchedAt>=now-86400000&&row.fetchedAt<=now))continue;
  const old=coins.get(row.id);if(!old||row.fetchedAt>=old.fetchedAt)coins.set(row.id,row);
 }
 return {articles,coins:[...coins.values()]};
}

// Reads the scheduled observations only; opening a page never starts discovery.
export async function loadSharedFeed(fetcher=fetch,now=Date.now()){
 const response=await fetcher('/api/new-coins?view=tweet',{cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error(`Shared feed unavailable (HTTP ${response.status}).`);
 const feed=await response.json();
 if(!Array.isArray(feed.articles)||!Array.isArray(feed.coins))throw new Error('Invalid shared feed.');
 const sources=new Map([...FEEDS,...NETWORKS].map(source=>{
  const saved=source.url?feed.feeds?.[`news_${source.id}`]:feed.marketFeeds?.[source.id]??feed.feeds?.[`${source.id}_trending`];
  const count=source.url?feed.articles.filter(a=>a.publisher===source.name).length:feed.coins.filter(c=>c.network===source.id).length;
  const at=saved?.lastSuccess??null,stale=at===null||now-at>10*60000||at>now;
  return [source.id,{...saved,status:saved?.error||stale?'failed':'loaded',count,at,
   error:saved?.error||(stale?'Shared collection is awaiting refresh.':null)}];
 }));
 return {...feed,sources};
}
