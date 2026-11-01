import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {collect} from '../worker/coin-collector.mjs';

test('Robinhood and context switches skip outbound work, retain evidence, and resume when enabled',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'meme-switches-')),file=path.join(folder,'coins.json'),now=Date.now();
 const coin=(network,address)=>({id:`${network}:${address}`,network,chain:network==='solana'?'Solana':'Robinhood Chain',contract_address:address,
  name:'Retained token',symbol:'RT',firstSeen:now-60000,marketUpdatedAt:now-60000,pool:'saved-pool',poolCreated:now-60000,
  liquidity:5000,volume:30000,buys:100,sells:50,contextCheckedAt:now-60000,savedContext:{kind:'web',web:{snippet:'Saved evidence'}}});
 const rh=coin('robinhood','0x'+'a'.repeat(40)),sol=coin('solana','A'.repeat(32));
 const article={id:'saved-news',time:now-60000,title:'Saved news',url:'https://example.com/news'};
 const calls=[],fetcher=async url=>{
  calls.push(url);
  if(url.includes('token-profiles/latest/v1'))return {ok:true,json:async()=>[]};
  if(url.includes('/networks/'))return {ok:true,json:async()=>({data:[],included:[]})};
  if(url.includes('dexscreener.com'))return {ok:true,json:async()=>[]};
  return {ok:false,status:503};
 };
 try{
  await writeFile(file,JSON.stringify({version:2,coins:[rh,sol],radarCoins:[],articles:[article],feeds:{robinhood:{lastSuccess:now-60000},dex_profiles:{lastSuccess:now-60000}}}));
  await writeFile(path.join(folder,'robinhood-pool-feed.json'),'corrupt; must not be read while paused');
  const off=await collect(file,{fetcher,now,robinhoodEnabled:false,contextEnabled:false});
  assert(!calls.some(url=>url.includes('/robinhood/')),'no Robinhood discovery, quotes or backfills');
  assert(!calls.some(url=>url.includes('token-profiles')||url.includes('r.jina.ai')||url.includes('rss')),'no context requests');
  assert(calls.some(url=>url.includes('/networks/solana/')));
  assert(calls.some(url=>url.includes('/networks/base/')));
  assert(calls.some(url=>url.includes('tokens/v1/solana/')),'retained Solana quotes still collected');
  assert.equal(off.pipeline.context.status,'paused');
  assert.equal(off.feeds.robinhood.status,'paused');
  assert.equal(off.feeds.robinhood.lastSuccess,now-60000);
  assert.equal(off.feeds.dex_profiles.lastSuccess,now-60000);
  const saved=off.coins.find(row=>row.id===rh.id);
  assert(saved,'retained Robinhood token survives');
  assert.equal(saved.marketUpdatedAt,rh.marketUpdatedAt);
  assert.equal(saved.contextCheckedAt,rh.contextCheckedAt);
  assert.deepEqual(saved.savedContext,rh.savedContext);
  assert.deepEqual(off.articles,[article]);
  await writeFile(path.join(folder,'robinhood-pool-feed.json'),JSON.stringify({pools:[],status:{count:0}}));
  calls.length=0;
  const on=await collect(file,{fetcher,now:now+300000});
  assert(calls.some(url=>url.includes('/robinhood/')),'default resumes Robinhood requests');
  assert(calls.some(url=>url.includes('token-profiles')),'default resumes context');
  assert.notEqual(on.pipeline.context.status,'paused');
 }finally{await rm(folder,{recursive:true,force:true})}
});
