import test from 'node:test';
import assert from 'node:assert/strict';
import {createDexProxy,dexMarketPath} from '../worker/dex-market.mjs';
import {createProviderFetch} from '../worker/provider-fetch.mjs';
import {marketRefreshInterval,selectMarketTargets} from '../worker/refresh-priority.mjs';
import {refreshMarket,recordMarketHistory,sharedTweetMarket} from '../worker/coin-collector.mjs';

const address='So11111111111111111111111111111111111111112';
test('Tweet derives active old tokens from the shared market pool without borrowing unique-buyer counts',()=>{
 const now=1800000000000,coin={id:'solana:'+address,network:'solana',contract_address:address,
  marketUpdatedAt:now-1000,fetchedAt:now-1000,poolCreated:now-100*86400000,
  liquidity:10000,volume:100000,buys:100,sells:50,buyers:100,marketSource:'DexScreener'};
 const shared=sharedTweetMarket([], [coin], {},now);
 assert.equal(shared.tweetCoins.length,1);assert.equal(shared.tweetCoins[0].buyers,null);
 assert.equal(shared.tweetCoins[0].buys,100);assert.ok(shared.tweetCoins[0].streamScore>0);
 assert.equal(shared.tweetMarketFeeds.solana.lastSuccess,now-1000);
 const stale=sharedTweetMarket([],[],shared,now+1000);
 assert.equal(stale.tweetCoins[0].fetchedAt,now-1000);assert.equal(stale.tweetMarketFeeds.solana.status,'failed');
});
test('A shared cached quote cannot overwrite a newer observation or create a new history sample',()=>{
 const now=1800000000000,coin={network:'solana',contract_address:address,marketUpdatedAt:now-1000,priceUsd:2};
 const pair={chainId:'solana',baseToken:{address},priceUsd:'1',_sourceObservedAt:now-2000};
 assert.equal(refreshMarket([coin],[pair],now)[0],coin);
 const prior={...coin,marketUpdatedAt:now-10000};
 const reused=refreshMarket([prior],[pair],now)[0];
 assert.equal(reused.marketUpdatedAt,now-2000);
 assert.equal(reused.priceUpdatedAt,now-2000);
 assert.equal(recordMarketHistory([reused],now)[0].marketHistory,undefined);
});
test('Restricted token source normalizes searches and rejects arbitrary forwarding',()=>{
 assert.equal(dexMarketPath(new URL('https://site/api/dex/latest/dex/search?q=+cat+')),'latest/dex/search?q=cat');
 for(const path of ['latest/dex/search?q=x&key=y','tokens/v1/unknown/'+address,'tokens/v1/solana/'+address+'?x=y','https://elsewhere'])
  assert.equal(dexMarketPath(new URL('https://site/api/dex/'+path)),null);
});
test('Local token source combines concurrent lookups and preserves cache observation time',async()=>{
 let calls=0,now=1000;
 const proxy=createDexProxy({now:()=>now,fetcher:async()=>{calls++;return new Response('[]')}});
 const request=()=>new Request('https://site/api/dex/token-pairs/v1/solana/'+address);
 const results=await Promise.all([proxy(request()),proxy(request())]);
 assert.equal(calls,1);assert.equal(results[0].headers.get('x-data-observed-at'),'1000');
 now=2000;assert.equal((await proxy(request())).headers.get('x-data-observed-at'),'1000');assert.equal(calls,1);
});
test('Deployed collector uses the shared source owners for both market providers',async()=>{
 const previous=process.env.MEME_SHARED_MARKET_URL;process.env.MEME_SHARED_MARKET_URL='https://site/api/dex';
 try{
  const calls=[],fetcher=createProviderFetch(async url=>{calls.push(url);return new Response('{}')});
  await fetcher('https://api.dexscreener.com/tokens/v1/solana/'+address);
  await fetcher('https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1');
  await fetcher('https://api.dexscreener.com/token-profiles/latest/v1');
  const story='https://r.jina.ai/https://meme.com/memes/jean-phil';
  await fetcher(story);
  await assert.rejects(fetcher('https://api.dexscreener.com/latest/dex/tokens/'+address),/direct fallback disabled/);
  assert.deepEqual(calls,['https://site/api/dex/tokens/v1/solana/'+address,'https://site/api/gecko/networks/solana/new_pools?page=1',
   'https://site/api/dex/token-profiles/latest/v1','https://site/api/context/read?'+new URLSearchParams({url:story})]);
 }finally{if(previous===undefined)delete process.env.MEME_SHARED_MARKET_URL;else process.env.MEME_SHARED_MARKET_URL=previous}
});
test('Quiet markets leave the hot refresh queue while old launches can reactivate',()=>{
 const now=1800000000000,quiet={id:'solana:'+address,network:'solana',contract_address:address,
  firstSeen:now-86400000,marketAttemptAt:now-300000,marketWindows:{m5:{volume:0,buys:0,sells:0},h24:{volume:0}}};
 assert.equal(marketRefreshInterval(quiet,now),Infinity);
 assert.equal(selectMarketTargets([quiet],[],[],now).length,0);
 assert.equal(selectMarketTargets([quiet],[],[quiet.id],now).length,1);
 const active={...quiet,marketWindows:{m5:{volume:1000,buys:10,sells:5}}};
 assert.equal(marketRefreshInterval(active,now),300000);
 assert.equal(selectMarketTargets([active],[],[],now).length,1);
});
