import test from 'node:test';
import assert from 'node:assert/strict';
import {loadListings} from '../dist/data.mjs';
import {createRequestClient} from '../dist/requests.mjs';
const response=data=>({ok:true,status:200,json:async()=>({data})});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const token={network:'base',address:'0xAAA'};
const pool={attributes:{address:'shared',name:'A / B'},relationships:{base_token:{data:{id:'base_0xAAA'}},quote_token:{data:{id:'base_0xBBB'}}}};
const event={id:'swap',attributes:{from_token_address:'0xAAA',to_token_address:'0xBBB',volume_in_usd:'20',block_timestamp:new Date().toISOString()}};

test('Swaps appear while another listing discovery is blocked; late shared targets reuse completed pool',async()=>{
  let release;const delayed=new Promise(resolve=>release=resolve),snapshots=[],calls=[];
  const pending=loadListings([token,{...token,address:'0xBBB'}],async path=>{
    calls.push(path);if(path.includes('0xBBB'))await delayed;
    return {data:path.includes('/tokens/')?[pool]:[event]};
  },()=>{},()=>true,s=>snapshots.push(s));
  await tick();assert.equal(snapshots.at(-1).trades.length,1);assert.equal(snapshots.at(-1).listings[1].discovered,false);
  release();const result=await pending;
  assert.equal(result.trades.length,2);assert.equal(calls.filter(p=>p.endsWith('/trades')).length,1);
  assert.deepEqual(result.listings.map(l=>l.status),['loaded','loaded']);
});
test('Transport overlaps requests within its bound and shares identical in-flight work',async()=>{
  const releases=[];let calls=0,active=0,max=0;
  const request=createRequestClient({interval:0,concurrency:2,fetcher:async()=>{calls++;active++;max=Math.max(max,active);await new Promise(r=>releases.push(r));active--;return response([])}});
  const a=request('/a'),same=request('/a'),b=request('/b'),c=request('/c');
  assert.equal(a,same);assert.equal(calls,2);releases.shift()();await a;await tick();assert.equal(calls,3);
  for(const release of releases)release();await Promise.all([b,c]);assert.equal(max,2);
  await request('/a');assert.equal(calls,3);
});
test('Aborted queued work is not dispatched; active work releases its slot',async()=>{
  const controller=new AbortController(),started=[];
  const request=createRequestClient({interval:0,concurrency:1,fetcher:(url,{signal})=>{started.push(url);if(url.endsWith('/fresh'))return Promise.resolve(response([]));return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))}});
  const a=request('/old',{signal:controller.signal}),b=request('/queued',{signal:controller.signal});
  const results=Promise.allSettled([a,b]);controller.abort();await results;await request('/fresh');
  assert.equal(started.length,2);assert.ok(started[1].endsWith('/fresh'));
});
test('Search jumps ahead of queued pool discovery without bypassing start pacing',async()=>{
  const started=[];
  const request=createRequestClient({interval:15,fetcher:async url=>{started.push({url,time:Date.now()});return response([])}});
  await Promise.all([request('/first'),request('/discovery'),request('/search/query',{priority:20})]);
  assert.ok(started[1].url.endsWith('/search/query'));
  assert.ok(started[1].time-started[0].time>=14);assert.ok(started[2].time-started[1].time>=14);
});
test('A 429 pauses uncached work but cached data remains available',async()=>{
  let calls=0;const request=createRequestClient({interval:0,fetcher:async url=>{calls++;return url.endsWith('/cached')?response([]):{ok:false,status:429,headers:{get:()=>null}}}});
  await request('/cached');await assert.rejects(request('/limited'),/rate-limiting/);await assert.rejects(request('/another'),/rate-limiting/);await request('/cached');assert.equal(calls,2);
});
