import test from 'node:test';
import assert from 'node:assert/strict';
import {loadListings} from '../dist/data.mjs';
const address='pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn';
const token={network:'solana',address,symbol:'PUMP',name:'Pump'};
const key=`solana:${address}`;
function pool(price,cap,liquidity=27000000){return {attributes:{address:'pump-usdc',reserve_in_usd:liquidity,base_token_price_usd:price,market_cap_usd:cap},relationships:{base_token:{data:{id:`solana_${address}`}}}}}
const load=(selected,pools,valuation)=>loadListings([selected],async path=>({data:path.includes('/tokens/')?pools:[]}),()=>{},()=>true,()=>{},valuation);
test('PUMP refresh cannot use cached $26.31 / $12.2T hints over fresh pool values',async()=>{
 const selected={...token,poolHints:[pool(26.31,12.2e12,28000000)]};
 const result=await load(selected,[pool(.006,2.77e9)]);
 assert.equal(result.listings[0].price.value,.006);
 assert.equal(result.listings[0].marketCap.value,2.77e9);
});
test('Fresh exact-contract valuation replaces provider supply differences even when Gecko has MC',async()=>{
 let calls=0;
 const result=await load(token,[pool(.006,2.77e9)],async()=>{calls++;return {value:4.97e9,price:.006001,tokenKey:key,fetchedAt:123}});
 assert.equal(calls,1);assert.equal(result.listings[0].marketCap.value,4.97e9);
 assert.equal(result.listings[0].price.value,.006001);
});
test('A fresh anomalous valuation cannot replace independently verified price and cap',async()=>{
 const result=await load(token,[pool(.006,2.77e9)],async()=>({value:12.2e12,price:26.31,tokenKey:key}));
 assert.equal(result.listings[0].price.value,.006);assert.equal(result.listings[0].marketCap.value,2.77e9);
});
test('Discovery failure retains pool addresses without trusting stale valuation hints',async()=>{
 const selected={...token,poolHints:[pool(26.31,12.2e12)]};
 const result=await load(selected,[],async()=>({value:4.97e9,price:.006,tokenKey:key,fetchedAt:123}));
 assert.equal(result.pools.length,1);assert.equal(result.listings[0].price.value,.006);
 assert.equal(result.listings[0].marketCap.value,4.97e9);
 const missing=await load(selected,[]);assert.equal(missing.listings[0].price,null);assert.equal(missing.listings[0].marketCap,null);
});
