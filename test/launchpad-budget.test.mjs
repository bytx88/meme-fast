import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {collect} from '../worker/coin-collector.mjs';
import {stageFor} from '../dist/coin-stages.mjs';

test('new discoveries receive graduation data before deeper discovery exhausts the provider budget',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'meme-launchpad-'));
 const now=Date.now(),address='A'.repeat(32),pool='B'.repeat(32),calls=[];
 const fetcher=async url=>{
  calls.push(url);
  if(url.includes('page=2')||url.includes('page=3'))throw Error('collection budget reached');
  if(url.includes('/tokens/multi/'))return Response.json({data:[{id:`solana_${address}`,attributes:{address,launchpad_details:{graduation_percentage:91,completed:false}}}]});
  if(url.includes('/solana/new_pools'))return Response.json({data:[{attributes:{address:pool,pool_created_at:new Date(now-60000).toISOString(),reserve_in_usd:'10000',volume_usd:{h24:'1000',m5:'100'},transactions:{h24:{buys:10,sells:5},m5:{buys:5,sells:2}}},relationships:{base_token:{data:{id:`solana_${address}`}}}}],included:[{id:`solana_${address}`,type:'token',attributes:{address,name:'Budget coin',symbol:'BUDGET'}}]});
  if(url.includes('geckoterminal.com'))return Response.json({data:[],included:[]});
  throw Error('Other source unavailable');
 };
 try{
  const snapshot=await collect(path.join(directory,'coins.json'),{fetcher,now});
  const coin=snapshot.coins.find(c=>c.contract_address===address);
  assert.equal(stageFor(coin,now),'stretch');
  assert.equal(coin.launchpadUpdatedAt,now);
  assert.equal(coin.launchpadCheckedAt,now);
  assert.equal(snapshot.feeds.launchpad.status,'ok');
  assert.equal(snapshot.feeds.solana.status,'partial');
  assert(calls.findIndex(url=>url.includes('/tokens/multi/'))<calls.findIndex(url=>url.includes('page=2')));
  assert.equal(calls.filter(url=>url.includes('/tokens/multi/')).length,1);
 }finally{await rm(directory,{recursive:true,force:true})}
});
