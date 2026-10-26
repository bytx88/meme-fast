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
test('A shared cached quote cannot overwrite a newer observation and keeps its original history time',()=>{
 const now=1800000000000,coin={network:'solana',contract_address:address,marketUpdatedAt:now-1000,priceUsd:2};
 const pair={chainId:'solana',baseToken:{address},priceUsd:'1',_sourceObservedAt:now-2000};
 assert.equal(refreshMarket([coin],[pair],now)[0],coin);
 const prior={...coin,marketUpdatedAt:now-10000};
 const reused=refreshMarket([prior],[pair],now)[0];
 assert.equal(reused.marketUpdatedAt,now-2000);
 assert.equal(reused.priceUpdatedAt,now-2000);
 const saved=recordMarketHistory([reused],now)[0];
 assert.equal(saved.marketHistory.length,1);
 assert.equal(saved.marketHistory[0].at,now-2000);
 assert.equal(saved.marketHistory[0].priceUsd,1);
 assert.deepEqual(recordMarketHistory([saved],now+1000)[0].marketHistory,saved.marketHistory);
});

test('selected-pool changes replace quote maturity without borrowing the original launch age',()=>{
 const now=1800000000000,observedAt=now-60000;
 const coin={network:'solana',contract_address:address,pool:'original-pool',poolCreated:now-100*86400000,
  marketPoolCreatedAt:now-2*3600000,marketUpdatedAt:now-120000};
 const pair={chainId:'solana',baseToken:{address},pairAddress:'new-pool',pairCreatedAt:now-10*60000,
  liquidity:{usd:12000},priceChange:{h1:17361910275994},_sourceObservedAt:observedAt};
 const older={...pair,pairAddress:'original-pool',pairCreatedAt:coin.marketPoolCreatedAt,liquidity:{usd:4000}};
 const updated=refreshMarket([coin],[older,pair],now)[0];
 assert.equal(updated.pool,'new-pool');
 assert.equal(updated.marketPoolCreatedAt,pair.pairCreatedAt);
 assert.equal(updated.poolCreated,coin.poolCreated);
 assert.equal(updated.marketUpdatedAt,observedAt);
 assert.equal(updated.priceChange1h,pair.priceChange.h1,'raw provider returns remain available for validation');
});

test('a selected quote with unknown or invalid pool creation time cannot inherit a previous age',()=>{
 const now=1800000000000,observedAt=now-60000;
 const coin={network:'solana',contract_address:address,pool:'original-pool',poolCreated:now-100*86400000,
  marketPoolCreatedAt:now-2*3600000,marketUpdatedAt:now-120000};
 for(const pairCreatedAt of [undefined,null,0,-1,true,NaN,Infinity,'invalid',observedAt+1,observedAt-.5]){
  const pair={chainId:'solana',baseToken:{address},pairAddress:'new-pool',pairCreatedAt,_sourceObservedAt:observedAt};
  const updated=refreshMarket([coin],[pair],now)[0];
  assert.equal(updated.pool,'new-pool');
  assert.equal(updated.marketPoolCreatedAt,null,`invalid source timestamp ${pairCreatedAt}`);
  assert.equal(updated.marketUpdatedAt,observedAt);
 }
});

test('a mature anonymous quote cannot inherit the previous selected pool identity',()=>{
 const now=1800000000000,observedAt=now-60000;
 const coin={network:'solana',contract_address:address,pool:'previous-pool',poolCreated:now-100*86400000,
  marketPoolCreatedAt:now-5*60000,marketUpdatedAt:now-120000};
 for(const pairAddress of [undefined,null,'','   ',123]){
  const pair={chainId:'solana',baseToken:{address},pairAddress,pairCreatedAt:now-2*3600000,
   liquidity:{usd:10000},volume:{h1:30000},txns:{h1:{buys:100,sells:50}},priceChange:{h1:5},_sourceObservedAt:observedAt};
  const updated=refreshMarket([coin],[pair],now)[0];
  assert.equal(updated.pool,null);
  assert.equal(updated.marketPoolCreatedAt,pair.pairCreatedAt);
  assert.equal(updated.poolCreated,coin.poolCreated);
  assert.equal(updated.priceChange1h,5);
 }
});

test('new shared observations advance history once without admitting stale or out-of-order quotes',()=>{
 const now=1800000000000,at=now-60000;
 const coin={network:'solana',contract_address:address,marketUpdatedAt:now-300000,
  marketHistory:[{at:now-300000,volume5m:400}],marketHistoryHourly:[{at:now-3600000,volume5m:100}]};
 const pair={chainId:'solana',baseToken:{address},_sourceObservedAt:at,priceUsd:'1',liquidity:{usd:9000},
  volume:{m5:700,h24:12000},txns:{m5:{buys:8,sells:3}}};
 const saved=recordMarketHistory(refreshMarket([coin],[pair],now),now)[0];
 assert.deepEqual(saved.marketHistory.map(row=>row.at),[now-300000,at]);
 assert.equal(saved.marketHistory.at(-1).priceUsd,1);
 assert.equal(saved.recentVolume1h,1100);
 assert.equal(saved.marketHistoryHourly.at(-1).at,at);
 const repeat=recordMarketHistory([saved],now+1000)[0];
 assert.deepEqual(repeat.marketHistory,saved.marketHistory);
 assert.deepEqual(repeat.marketHistoryHourly,saved.marketHistoryHourly);
 for(const marketUpdatedAt of [at-1,now-15*60000,now+1,NaN,undefined]){
  const ignored=recordMarketHistory([{...saved,marketUpdatedAt}],now)[0];
  assert.deepEqual(ignored.marketHistory,saved.marketHistory);
  assert.deepEqual(ignored.marketHistoryHourly,saved.marketHistoryHourly);
 }
 const omitted=recordMarketHistory([{...coin,marketUpdatedAt:at,priceUsd:2,priceUpdatedAt:at-1}],now)[0];
 assert.equal(omitted.marketHistory.at(-1).priceUsd,null);
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

test('six-hour and daily trending markets refresh before shared evidence expires',()=>{
 const now=1800000000000;
 for(const [window,activity] of [['h6',{volume:15000,buys:20,sells:5}],['h24',{volume:15000,buys:25,sells:25}]]){
  const coin={id:'solana:'+address,network:'solana',contract_address:address,firstSeen:now-86400000,
   marketAttemptAt:now,marketUpdatedAt:now,marketWindows:{m5:{volume:0,buys:0,sells:0},[window]:activity}};
  assert.equal(marketRefreshInterval(coin,now),600000);
  assert.equal(selectMarketTargets([coin],[],[],now+600000).length,1);
  assert.ok(marketRefreshInterval(coin,now)<15*60000);
 }
});


test('shared enrichment carries signed one-hour returns with the market observation',()=>{
 const now=1800000000000,coin={network:'solana',contract_address:address};
 for(const change of [-2,0,3]){
  const pair={chainId:'solana',baseToken:{address},priceChange:{h1:change,h24:12},_sourceObservedAt:now-60000};
  const row=refreshMarket([coin],[pair],now)[0];
  assert.equal(row.priceChange1h,change);assert.equal(row.marketUpdatedAt,now-60000);
 }
});
