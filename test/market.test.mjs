import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarketProxy,marketPath} from '../worker/market.mjs';
const url='https://site.test/api/market/networks/solana/pools/abc/trades';
test('historical candles permit only the bounded public query and accept object responses',async()=>{
  const candles=url.replace('/trades','/ohlcv/minute')+'?aggregate=15&limit=1000&currency=usd&token=abc';
  assert.ok(marketPath(new URL(candles)));
  for(const bad of [candles.replace('aggregate=15','aggregate=1'),candles.replace('limit=1000','limit=10000'),candles+'&url=secret',candles.replace('token=abc','token=a%2Fb')])assert.equal(marketPath(new URL(bad)),null);
  let calls=0;const proxy=createMarketProxy({fetcher:async()=>{calls++;return Response.json({data:{attributes:{ohlcv_list:[[1,1,1,1,1,10]]}}})}});
  assert.equal((await proxy(new Request(candles))).status,200);assert.equal((await proxy(new Request(candles))).status,200);assert.equal(calls,1);
  const invalid=createMarketProxy({fetcher:async()=>Response.json({data:{}})});assert.equal((await invalid(new Request(candles))).status,502);
});
test('Market route rejects arbitrary destinations and unsupported endpoints',()=>{
  for(const path of ['/api/market/https://attacker.test','/api/market/networks/solana/pools/a/trades?url=https://attacker.test','/api/market/networks/solana/pools/a%2Fb/trades','/api/market/admin'])assert.equal(marketPath(new URL('https://site.test'+path)),null);
  assert.equal(marketPath(new URL(url)),'/networks/solana/pools/abc/trades');
  assert.equal(marketPath(new URL('https://site.test/api/market/networks/solana/new_pools?include=base_token,quote_token')),'/networks/solana/new_pools?include=base_token%2Cquote_token');
  assert.equal(marketPath(new URL('https://site.test/api/market/networks/robinhood/tokens/0x123/info')),'/networks/robinhood/tokens/0x123/info');
  assert.equal(marketPath(new URL('https://site.test/api/market/networks/unknown/tokens/0x123/info')),null);
});
test('Token info accepts a single data object and caches the holder response',async()=>{
  const infoUrl='https://site.test/api/market/networks/robinhood/tokens/0x123/info';
  let calls=0;
  const proxy=createMarketProxy({fetcher:async()=>{calls++;return Response.json({data:{id:'robinhood_0x123',attributes:{holders:{count:12}}}})}});
  assert.equal((await proxy(new Request(infoUrl))).status,200);
  assert.equal((await proxy(new Request(infoUrl))).status,200);
  assert.equal(calls,1);
});
test('Server fetches real provider JSON without forwarding cookies and shares concurrent work',async()=>{
  let calls=0,options;const proxy=createMarketProxy({fetcher:async(destination,opts)=>{calls++;options=opts;assert.equal(destination,'https://api.geckoterminal.com/api/v2/networks/solana/pools/abc/trades');return Response.json({data:[{id:'actual'}]})}});
  const requests=await Promise.all([proxy(new Request(url,{headers:{cookie:'private=secret',authorization:'Bearer secret'}})),proxy(new Request(url))]);
  assert.equal(calls,1);assert.deepEqual(options.headers,{accept:'application/json'});assert.equal(options.redirect,'error');assert.deepEqual(await requests[0].json(),{data:[{id:'actual'}]});
  await proxy(new Request(url));assert.equal(calls,1);
});
test('Expired swaps are fetched again and failed fetches never become empty data',async()=>{
  let time=0,calls=0;const proxy=createMarketProxy({now:()=>time,fetcher:async()=>{if(++calls===1)return Response.json({data:[{id:'actual'}]});throw new Error('offline')}});
  await proxy(new Request(url));time=31000;const result=await proxy(new Request(url));assert.equal(result.status,502);assert.equal((await result.json()).data,undefined);assert.equal(calls,2);
});
test('Rate limits respect provider cooldown while cached paths remain usable',async()=>{
  let time=0,calls=0;const proxy=createMarketProxy({now:()=>time,fetcher:async()=>{calls++;return calls===1?Response.json({data:[{id:'actual'}]}):new Response('',{status:429,headers:{'retry-after':'120'}})}});
  await proxy(new Request(url));assert.equal((await proxy(new Request(url.replace('/abc/','/def/')))).status,429);assert.equal((await proxy(new Request(url))).status,200);
  const limited=await proxy(new Request(url.replace('/abc/','/xyz/')));assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'120');assert.equal(calls,2);
});
test('Invalid provider payloads and unsupported request methods return explicit errors',async()=>{
  const proxy=createMarketProxy({fetcher:async()=>Response.json({unexpected:true})});assert.equal((await proxy(new Request(url))).status,502);assert.equal((await proxy(new Request(url,{method:'POST'}))).status,405);
});

const HISTORY_NOW=2_000_000_000_000;
const historyUrl='https://site.test/api/meme-history/networks/solana/pools/ExactPool123/ohlcv/minute?aggregate=5&limit=302&currency=usd&token=ExactToken123&before_timestamp=1999999999';
const historyPayload=()=>({data:{attributes:{ohlcv_list:[[1999999700,1,1,1,1,10]]}}});

test('Meme historical reads require explicit opt-in and do not expand the ordinary market routes',async()=>{
  let calls=0;const fetcher=async()=>{calls++;return Response.json(historyPayload())};
  const defaultProxy=createMarketProxy({fetcher,now:()=>HISTORY_NOW});
  assert.equal((await defaultProxy(new Request(historyUrl))).status,404);assert.equal(calls,0);
  const enabled=createMarketProxy({fetcher,now:()=>HISTORY_NOW,allowMemeHistory:true});
  assert.equal((await enabled(new Request(historyUrl.replace('/api/meme-history/','/api/market/')))).status,404);assert.equal(calls,0);
  assert.equal((await enabled(new Request(historyUrl))).status,200);assert.equal(calls,1);
});

test('Meme history accepts only the exact bounded query with a safe past integer timestamp',async()=>{
  let calls=0;const proxy=createMarketProxy({allowMemeHistory:true,now:()=>HISTORY_NOW,fetcher:async()=>{calls++;return Response.json(historyPayload())}});
  const bad=[
    historyUrl.replace('aggregate=5','aggregate=15'),historyUrl.replace('limit=302','limit=1000'),historyUrl.replace('currency=usd','currency=eth'),
    historyUrl.replace('token=ExactToken123','token=token%2Fother'),historyUrl.replace('before_timestamp=1999999999','before_timestamp=2000000001'),
    historyUrl.replace('before_timestamp=1999999999','before_timestamp=1999999999.0'),historyUrl.replace('before_timestamp=1999999999','before_timestamp=2e9'),
    historyUrl.replace('before_timestamp=1999999999','before_timestamp=0'),historyUrl.replace('before_timestamp=1999999999','before_timestamp=-1'),
    historyUrl.replace('before_timestamp=1999999999','before_timestamp=01999999999'),historyUrl.replace('before_timestamp=1999999999','before_timestamp=9007199254740992'),
    historyUrl+'&limit=302',historyUrl+'&url=https://attacker.test',historyUrl.replace('&token=ExactToken123',''),historyUrl+'#fragment',
    historyUrl.replace('/pools/ExactPool123/','/pools/ExactPool%2Fother/'),historyUrl.replace('/ohlcv/minute','/trades'),
    'https://site.test/api/meme-history/search/pools?query=token'
  ];
  for(const target of bad)assert.equal((await proxy(new Request(target))).status,404,target);
  assert.equal(calls,0);
  assert.equal((await proxy(new Request(historyUrl.replace('before_timestamp=1999999999','before_timestamp=2000000000')))).status,200);
  assert.equal(calls,1);
});

test('Meme history caches for one hour while preserving the original observation timestamp',async()=>{
  let time=HISTORY_NOW,calls=0;
  const proxy=createMarketProxy({allowMemeHistory:true,now:()=>time,fetcher:async()=>{calls++;return Response.json(historyPayload())}});
  const first=await proxy(new Request(historyUrl));assert.equal(first.headers.get('x-data-observed-at'),String(HISTORY_NOW));
  time+=3599999;
  const hit=await proxy(new Request(historyUrl));assert.equal(hit.status,200);assert.equal(hit.headers.get('x-data-observed-at'),String(HISTORY_NOW));assert.equal(calls,1);
  time++;
  const refreshed=await proxy(new Request(historyUrl));assert.equal(refreshed.headers.get('x-data-observed-at'),String(time));assert.equal(calls,2);
});

test('Meme history reuses canonical in-flight work and never forwards credentials',async()=>{
  let calls=0,options,destination,release;
  const gate=new Promise(resolve=>{release=resolve});
  const proxy=createMarketProxy({allowMemeHistory:true,now:()=>HISTORY_NOW,fetcher:async(target,opts)=>{calls++;destination=target;options=opts;await gate;return Response.json(historyPayload())}});
  const reordered=historyUrl.replace('?aggregate=5&limit=302&currency=usd&token=ExactToken123&before_timestamp=1999999999','?before_timestamp=1999999999&token=ExactToken123&currency=usd&limit=302&aggregate=5');
  const pending=[proxy(new Request(historyUrl,{headers:{cookie:'private=secret',authorization:'Bearer private'}})),proxy(new Request(reordered))];
  assert.equal(calls,1);release();const replies=await Promise.all(pending);
  assert.equal(calls,1);assert.deepEqual(options.headers,{accept:'application/json'});assert.equal(options.redirect,'error');
  assert.equal(destination,'https://api.geckoterminal.com/api/v2/networks/solana/pools/ExactPool123/ohlcv/minute?aggregate=5&limit=302&currency=usd&token=ExactToken123&before_timestamp=1999999999');
  assert.deepEqual(await replies[0].json(),historyPayload());assert.equal(replies[1].headers.get('x-data-observed-at'),String(HISTORY_NOW));
});

test('Meme history and chart reads share provider cooldown while cached history stays available',async()=>{
  let time=HISTORY_NOW,calls=0;
  const proxy=createMarketProxy({allowMemeHistory:true,now:()=>time,fetcher:async()=>{calls++;return calls===1?Response.json(historyPayload()):new Response('',{status:429,headers:{'retry-after':'120'}})}});
  assert.equal((await proxy(new Request(historyUrl))).status,200);
  assert.equal((await proxy(new Request(url))).status,429);
  assert.equal((await proxy(new Request(historyUrl.replace('ExactPool123','AnotherPool')))).status,429);
  const cached=await proxy(new Request(historyUrl));assert.equal(cached.status,200);assert.equal(cached.headers.get('x-data-observed-at'),String(HISTORY_NOW));assert.equal(calls,2);
});
