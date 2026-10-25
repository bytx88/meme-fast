import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupTokens} from '../dist/lookup.mjs';
import {loadListings} from '../dist/data.mjs';
import {certifyPoolList,reusablePoolList} from '../dist/pool-evidence.mjs';
const address='Fr24qgw8MwbBmzcesxe4qGBrmFxEH98NjXjcJBW5vP3T';
const pair={chainId:'solana',pairAddress:'poolA',dexId:'meteora',baseToken:{address,symbol:'TEST',name:'Test'},
 quoteToken:{address:'quote',symbol:'SOL'},liquidity:{usd:10000},marketCap:200000,priceUsd:'2'};
const pool=(id='poolA',price=2,cap=190000)=>({id:'solana_'+id,type:'pool',
 attributes:{address:id,reserve_in_usd:'10000',base_token_price_usd:price,market_cap_usd:cap},
 relationships:{base_token:{data:{id:'solana_'+address}},quote_token:{data:{id:'solana_quote'}}}});
const fail=async()=>{throw Error('unexpected provider lookup')};

test('Inspect reuses a fresh Dex valuation while preserving independent Gecko pool discovery',async()=>{
 const at=Date.now()-1000,paths=[];
 const [token]=await lookupTokens(address,{gecko:fail,dex:async()=>({data:[pair],_sourceObservedAt:at})});
 assert.equal(token.poolEvidence.provider,'DexScreener');
 const result=await loadListings([token],async path=>{paths.push(path);return {data:path.includes('/tokens/')?[pool()]:[],_sourceObservedAt:at}},()=>{},()=>true,()=>{},fail);
 assert.deepEqual(paths,[`/networks/solana/tokens/${address}/pools?include=base_token,quote_token`,'/networks/solana/pools/poolA/trades']);
 assert.equal(result.listings[0].price.value,2);
 assert.equal(result.listings[0].marketCap.value,200000);
 assert.equal(result.listings[0].marketCap.fetchedAt,at);
});

test('reused Dex valuation still must agree with independent Gecko pool price',async()=>{
 const at=Date.now(),[token]=await lookupTokens(address,{gecko:fail,dex:async()=>({data:[{...pair,priceUsd:'2000',marketCap:2e12}],_sourceObservedAt:at})});
 const result=await loadListings([token],async path=>({data:path.includes('/tokens/')?[pool()]:[],_sourceObservedAt:at}),()=>{},()=>true,()=>{},fail);
 assert.equal(result.listings[0].marketCap.value,190000);
 assert.equal(result.listings[0].price.value,2);
});

test('a fresh complete Gecko token-pool lookup supplies discovery and prices without another metadata pull',async()=>{
 const at=Date.now()-1000,paths=[];
 const [token]=await lookupTokens(address,{dex:fail,gecko:async()=>({data:[pool()],included:[{type:'token',id:'solana_'+address,attributes:{address,symbol:'TEST',name:'Test'}}],_sourceObservedAt:at})});
 const result=await loadListings([token],async path=>{paths.push(path);return {data:[],_sourceObservedAt:at}});
 assert.deepEqual(paths,['/networks/solana/pools/poolA/trades']);
 assert.equal(result.listings[0].marketCap.fetchedAt,at);
});

test('stale, future, partial, mismatched or changed pool hints cannot certify reused discovery',async()=>{
 const now=Date.now(),token=certifyPoolList([{network:'solana',address,poolHints:[pool()]}],'DexScreener',now)[0];
 assert(reusablePoolList(token,now));
 const changed={...pool(),attributes:{...pool().attributes,address:'poolB'}};
 for(const bad of [
  {...token,poolEvidence:{...token.poolEvidence,observedAt:now-60000}},
  {...token,poolEvidence:{...token.poolEvidence,observedAt:now+60000}},
  {...token,poolEvidence:{...token.poolEvidence,scope:'search'}},
  {...token,poolEvidence:{...token.poolEvidence,tokenKey:'solana:other'}},
  {...token,poolHints:[changed]}, {...token,poolEvidence:undefined}
 ]){
  assert.equal(reusablePoolList(bad,now),null);
  const paths=[];
  await loadListings([bad],async path=>{paths.push(path);return {data:[]}});
  assert(paths[0].includes('/tokens/'+address+'/pools?'));
 }
});

test('search results and un-timestamped direct replies stay partial hints',async()=>{
 const ticker=await lookupTokens('TEST',{gecko:fail,dex:async()=>({data:[pair],_sourceObservedAt:Date.now()})});
 assert.equal(ticker[0].poolEvidence,undefined);
 const direct=await lookupTokens(address,{gecko:fail,dex:async()=>({data:[pair]})});
 assert.equal(direct[0].poolEvidence,undefined);
});

test('malformed or unrelated rows cannot certify the remaining Gecko pool subset as complete',async()=>{
 const at=Date.now(),included=[{type:'token',id:'solana_'+address,attributes:{address,symbol:'TEST',name:'Test'}}];
 for(const extra of [{attributes:{address:'poolB'},relationships:{}},{attributes:{},relationships:{base_token:{data:{id:'solana_'+address}}}}]){
  const [token]=await lookupTokens(address,{dex:fail,gecko:async()=>({data:[pool(),extra],included,_sourceObservedAt:at})});
  assert.equal(token.poolEvidence,undefined);
 }
});

test('incomplete retained valuations request only the missing valuation, while known pools still load',async()=>{
 const at=Date.now(),[token]=await lookupTokens(address,{gecko:fail,dex:async()=>({data:[{...pair,marketCap:null}],_sourceObservedAt:at})});
 let calls=0;
 const result=await loadListings([token],async path=>({data:path.includes('/tokens/')?[pool()]:[],_sourceObservedAt:at}),()=>{},()=>true,()=>{},async()=>{calls++;return {tokenKey:'solana:'+address,value:210000,price:2,fetchedAt:at}});
 assert.equal(calls,1);assert.equal(result.listings[0].marketCap.value,210000);
});

test('a complete Dex list never hides a higher-liquidity pool known only to Gecko',async()=>{
 const at=Date.now(),[token]=await lookupTokens(address,{gecko:fail,dex:async()=>({data:[pair],_sourceObservedAt:at})});
 const extra={...pool('poolB'),attributes:{...pool('poolB').attributes,reserve_in_usd:'50000'}};
 const result=await loadListings([token],async path=>({data:path.includes('/tokens/')?[pool(),extra]:[],_sourceObservedAt:at}));
 assert.deepEqual(result.pools.map(row=>row.address),['poolB','poolA']);
});

test('a quote expiring while independent discovery waits is refreshed before valuation use',async t=>{
 let now=1800000000000,calls=0;
 t.mock.method(Date,'now',()=>now);
 const [token]=await lookupTokens(address,{gecko:fail,dex:async()=>({data:[pair],_sourceObservedAt:now})});
 const result=await loadListings([token],async path=>{
  if(path.includes('/tokens/')){now+=61000;return {data:[pool()],_sourceObservedAt:now}}
  return {data:[],_sourceObservedAt:now};
 },()=>{},()=>true,()=>{},async()=>{calls++;return {value:210000,price:2,tokenKey:'solana:'+address,fetchedAt:now}});
 assert.equal(calls,1);
 assert.equal(result.listings[0].marketCap.value,210000);
 assert.equal(result.listings[0].marketCap.fetchedAt,now);
});
