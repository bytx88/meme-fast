import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {collect,refreshMarket} from '../worker/coin-collector.mjs';
import {normalizeScreener,passesScreener} from '../dist/coin-screener.mjs';
import {matchesChainFilter,toggleChainFilter} from '../dist/radar-filter.mjs';
import {validPriorityIds} from '../worker/refresh-priority.mjs';
import {contractForCopy,axiomLink,fomoLink} from '../dist/contract-copy.mjs';
import {marketPath} from '../worker/market.mjs';
import {stageFor} from '../dist/coin-stages.mjs';
import {chainMarker} from '../dist/chain-marker.mjs';

const address='0x'+'a'.repeat(40),pool='0x'+'b'.repeat(40);

test('BNB discovery reaches Snipe and Swing before the remaining provider budget fails',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'meme-bnb-')),now=Date.now(),calls=[];
 const payload={data:[{id:`bsc_${pool}`,attributes:{address:pool,pool_created_at:new Date(now-60000).toISOString(),reserve_in_usd:'10000',volume_usd:{h24:'25000',m5:'700'},transactions:{h24:{buys:20,sells:10},m5:{buys:8,sells:3}},base_token_price_usd:'0.01'},relationships:{base_token:{data:{id:`bsc_${address}`}}}}],included:[{id:`bsc_${address}`,type:'token',attributes:{address,name:'BNB sample',symbol:'SAMPLE'}}]};
 try{
  const snapshot=await collect(path.join(directory,'coins.json'),{now,fetcher:async url=>{
   if(!url.includes('geckoterminal.com'))throw Error('other source unavailable');
   calls.push(url);
   if(calls.length>5)throw Error('collection budget reached');
   return Response.json(url.includes('/bsc/')?payload:{data:[],included:[]});
  }});
  for(const rows of [snapshot.coins,snapshot.radarCoins]){
   const coin=rows.find(c=>c.network==='bsc');
   assert(coin);assert.equal(coin.contract_address,address);assert.equal(coin.chain,'BSC');
   assert.equal(coin.marketUpdatedAt,now);assert.equal(coin.volume5m,700);
   assert.equal(contractForCopy(coin),address);assert.equal(stageFor(coin),'unknown');
   assert.equal(coin.launchpadCheckedAt,undefined);
  }
  assert.equal(snapshot.feeds.bsc.status,'ok');assert.equal(snapshot.feeds.bsc_trending.status,'ok');
  assert.equal(snapshot.coverage.sampling.newPoolPagesByChain.bsc,1);
  assert.equal(snapshot.coverage.sampling.newPoolPagesByChain.solana,3);
  assert(calls[4].includes('/bsc/trending_pools'));
  assert.equal(calls.filter(url=>/\/bsc\/(new_pools|trending_pools)\?/.test(url)).length,2);
 }finally{await rm(directory,{recursive:true,force:true})}
});

test('BNB market refresh, filter persistence, priorities and trading links share the exact chain identity',()=>{
 const coin={id:`bsc:${address}`,network:'bsc',chain:'BSC',contract_address:address,contract_verified:true};
 const refreshed=refreshMarket([coin],[{chainId:'bsc',baseToken:{address:address.toUpperCase()},liquidity:{usd:9000},volume:{m5:500,h24:20000},txns:{m5:{buys:4,sells:2}},priceUsd:'0.02'}],5000)[0];
 assert.equal(refreshed.marketUpdatedAt,5000);assert.equal(refreshed.liquidity,9000);
 const settings=normalizeScreener({chain:toggleChainFilter(['base'],'bsc')});
 assert.deepEqual(normalizeScreener(JSON.parse(JSON.stringify(settings))).chain,['base','bsc']);
 assert(passesScreener(refreshed,settings));assert(matchesChainFilter(coin,['bsc']));
 assert.equal(matchesChainFilter({...coin,network:'base'},['bsc']),false);
 assert.deepEqual(validPriorityIds([`bsc:${address.toUpperCase().replace('0X','0x')}`]),[coin.id]);
 assert(axiomLink(coin).endsWith('?chain=bnb'));assert(fomoLink(coin).includes('/bnb/'));
 assert(chainMarker(coin).includes('BNB Chain'));
 assert.equal(marketPath(new URL(`https://site.test/api/market/networks/bsc/tokens/${address}/info`)),`/networks/bsc/tokens/${address}/info`);
});
