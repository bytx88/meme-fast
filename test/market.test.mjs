import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarketProxy,marketPath} from '../worker/market.mjs';
const url='https://site.test/api/market/networks/solana/pools/abc/trades';
test('Market route rejects arbitrary destinations and unsupported endpoints',()=>{
  for(const path of ['/api/market/https://attacker.test','/api/market/networks/solana/pools/a/trades?url=https://attacker.test','/api/market/networks/solana/pools/a%2Fb/trades','/api/market/admin'])assert.equal(marketPath(new URL('https://site.test'+path)),null);
  assert.equal(marketPath(new URL(url)),'/networks/solana/pools/abc/trades');
  assert.equal(marketPath(new URL('https://site.test/api/market/networks/solana/new_pools?include=base_token,quote_token')),'/networks/solana/new_pools?include=base_token%2Cquote_token');
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
