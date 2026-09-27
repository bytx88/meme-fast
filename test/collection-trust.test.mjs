import test from 'node:test';
import assert from 'node:assert/strict';
import {createProviderFetch} from '../worker/provider-fetch.mjs';
import {selectMarketTargets,validPriorityIds} from '../worker/refresh-priority.mjs';
import {marketFreshness,freshnessCounts} from '../dist/market-freshness.mjs';
import {refreshMarket} from '../worker/coin-collector.mjs';

test('paced queue starts each timeout at dispatch and spaces actual requests',async()=>{
 let clock=1000;const calls=[];
 const fetcher=createProviderFetch(async(url,options)=>{calls.push({at:clock,aborted:options.signal.aborted});return {status:200}},
  {now:()=>clock,sleep:async ms=>{clock+=ms},policies:{'api.dexscreener.com':{interval:500,limit:3}}});
 await Promise.all([1,2,3].map(i=>fetcher(`https://api.dexscreener.com/${i}`,{signal:AbortSignal.abort()})));
 assert.deepEqual(calls,[{at:1000,aborted:false},{at:1500,aborted:false},{at:2000,aborted:false}]);
 await assert.rejects(fetcher('https://api.dexscreener.com/4'),/budget reached/);
});
test('429 stops queued provider traffic and persists Retry-After across runs',async()=>{
 let calls=0;
 const fetcher=createProviderFetch(async()=>{calls++;return {status:429,headers:new Headers({'retry-after':'120'})}}, {now:()=>1000});
 const results=await Promise.allSettled([1,2,3].map(i=>fetcher(`https://api.geckoterminal.com/${i}`)));
 assert.equal(calls,1);assert.equal(results[1].status,'rejected');
 const next=createProviderFetch(async()=>{calls++;return {status:200}},{now:()=>2000,initial:fetcher.state()});
 await assert.rejects(next('https://api.geckoterminal.com/test'),/cooldown/);
 assert.equal(calls,1);
});
test('failed requests do not poison the provider queue',async()=>{
 let calls=0;
 const fetcher=createProviderFetch(async()=>{if(++calls===1)throw Error('network');return {status:200}}, {policies:{'api.dexscreener.com':{interval:0,limit:2}}});
 const result=await Promise.allSettled([1,2].map(i=>fetcher(`https://api.dexscreener.com/${i}`)));
 assert.equal(result[0].status,'rejected');assert.equal(result[1].status,'fulfilled');
});
test('saved contracts precede ranking sample, then retained contracts rotate by attempt',()=>{
 const coins=['saved','ranked','old','attempted'].map((id,i)=>({id:`solana:${id}`,network:'solana',contract_address:id,firstSeen:1,marketAttemptAt:i===3?100:0,marketUpdatedAt:i}));
 assert.deepEqual(selectMarketTargets(coins,[coins[1]],['solana:saved'],1e9,3).map(c=>c.contract_address),['saved','ranked','old']);
 const next=coins.map(c=>({...c,marketAttemptAt:c.contract_address==='old'?200:c.marketAttemptAt}));
 assert.equal(selectMarketTargets(next,[coins[1]],['solana:saved'],1e9,3).at(-1).contract_address,'attempted');
});
test('priority contracts are bounded and Solana identities stay case-sensitive',()=>{
 assert.throws(()=>validPriorityIds(Array(31).fill('base:0x'+'a'.repeat(40))));
 assert.throws(()=>validPriorityIds(['ethereum:0x'+'a'.repeat(40)]));
 const id='solana:'+'A'.repeat(32);assert.deepEqual(validPriorityIds([id,id]),[id]);
 const [coin]=refreshMarket([{id,network:'solana',contract_address:'A'.repeat(32),marketUpdatedAt:1}], [{chainId:'solana',baseToken:{address:'a'.repeat(32)},liquidity:{usd:10000}}],2000);
 assert.equal(coin.marketUpdatedAt,1);
});
test('freshness distinguishes age from partial, missing and future market timestamps',()=>{
 const now=1e9,coin={marketUpdatedAt:now,liquidity:5000,volume5m:0,buys5m:0,sells5m:0};
 assert.equal(marketFreshness(coin,now).state,'fresh');
 assert.equal(marketFreshness({...coin,marketUpdatedAt:now-16*60000},now).state,'stale');
 assert.equal(marketFreshness({...coin,liquidity:null},now).state,'incomplete');
 assert.equal(marketFreshness({...coin,marketUpdatedAt:now+1},now).state,'unknown');
 assert.equal(marketFreshness({...coin,marketUpdatedAt:0},now).state,'unknown');
 assert.match(freshnessCounts([coin,{...coin,liquidity:null},{}],now),/^1 fresh · 0 stale · 2 partial/);
});
