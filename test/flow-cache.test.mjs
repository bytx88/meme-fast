import test from 'node:test';
import assert from 'node:assert/strict';
import {createFlowCache} from '../dist/flow-cache.mjs';
const address='0x6249519883b8d7ccf915dfcd6c0442984dae9d24',now=1800000000000;
function fixture(ca=address){const token={network:'robinhood',address:ca,symbol:'CASHED',name:'Cashed Money'},key=`robinhood:${ca}`;return {tokens:[token],matches:[token],searchedQuery:ca,fetched:now,trades:[{id:'swap',tokenKey:key,side:'buy',usd:10,time:now-1000}],pools:[{address:'pool',status:'loaded',targets:[token]}],listings:[{key,status:'loaded'}]}}
function setup(){let value=null;const storage={getItem:()=>value,setItem:(_,v)=>{value=v}};return {storage,cache:createFlowCache(()=>storage,()=>now)}}
test('restores the exact contract sample and original timestamp across page instances',()=>{
 const {cache,storage}=setup(),state=fixture();assert.equal(cache.write(state),true);
 const restored=createFlowCache(()=>storage,()=>now+60000).read(address.toUpperCase());
 assert.equal(restored.fetched,now);assert.equal(restored.trades[0].usd,10);assert.equal(cache.read('0x'+'a'.repeat(40)),null);
});
test('failed, unverified and ambiguous lookups cannot replace a usable sample',()=>{
 const {cache}=setup(),state=fixture();cache.write(state);
 assert.equal(cache.write({...state,loadError:true,trades:[]}),false);
 assert.equal(cache.write({...state,matches:[...state.matches,...state.matches]}),false);
 assert.equal(cache.write({...state,searchedQuery:'CASHED'}),false);
 assert.equal(cache.write({...state,tokens:[{...state.tokens[0],unverified:true}]}),false);
 assert.equal(cache.read(address).trades.length,1);
});
test('expired, future, damaged or blocked storage falls back to a normal load',()=>{
 const {cache,storage}=setup();cache.write(fixture());
 assert.equal(createFlowCache(()=>storage,()=>now+86400001).read(address),null);
 assert.equal(createFlowCache(()=>storage,()=>now-1).read(address),null);
 storage.setItem('',JSON.stringify([{version:1,fetched:now,tokens:[{}]}]));assert.equal(cache.read(address),null);
 const blocked=createFlowCache(()=>{throw new Error('denied')},()=>now);assert.equal(blocked.read(address),null);assert.equal(blocked.write(fixture()),false);
});
test('keeps only three recent contracts and handles storage quota failures',()=>{
 const {cache,storage}=setup();for(let i=1;i<=4;i++)assert.equal(cache.write(fixture('0x'+String(i).repeat(40))),true);
 assert.equal(cache.read('0x'+'1'.repeat(40)),null);assert.ok(cache.read('0x'+'4'.repeat(40)));
 storage.setItem=()=>{throw new Error('quota')};assert.equal(cache.write(fixture()),false);assert.ok(cache.read('0x'+'4'.repeat(40)));
});
