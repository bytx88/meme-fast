import {FEEDS,NETWORKS} from './public-radar.mjs';

// Reads the scheduled observations only; opening a page never starts discovery.
export async function loadSharedFeed(fetcher=fetch,now=Date.now()){
 const response=await fetcher('/api/new-coins?view=tweet',{cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error(`Shared feed unavailable (HTTP ${response.status}).`);
 const feed=await response.json();
 if(!Array.isArray(feed.articles)||!Array.isArray(feed.coins))throw new Error('Invalid shared feed.');
 const sources=new Map([...FEEDS,...NETWORKS].map(source=>{
  const saved=feed.feeds?.[source.url?`news_${source.id}`:`${source.id}_trending`];
  const count=source.url?feed.articles.filter(a=>a.publisher===source.name).length:feed.coins.filter(c=>c.network===source.id).length;
  const at=saved?.lastSuccess??null,stale=at===null||now-at>10*60000||at>now;
  return [source.id,{...saved,status:saved?.error||stale?'failed':'loaded',count,at,
   error:saved?.error||(stale?'Shared collection is awaiting refresh.':null)}];
 }));
 return {...feed,sources};
}
