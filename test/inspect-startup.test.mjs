import test from 'node:test';
import assert from 'node:assert/strict';
import {initialInspectQuery} from '../dist/inspect-startup.mjs';
import {createRecentContracts,LAST_CONTRACT_KEY,RECENT_CONTRACTS_KEY} from '../dist/recent-contracts.mjs';
const ca=i=>'0x'+i.toString(16).padStart(40,'0');
const saved=(i,time)=>({type:'coin',id:`base:${ca(i)}`,savedAt:time});
function memory(){const data=new Map();return {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)}}

test('Inspect restores the last CA before watchlist and preserves explicit links',()=>{
  assert.equal(initialInspectQuery('',ca(1),[saved(2,10)]),ca(1));
  assert.equal(initialInspectQuery(`?query=${ca(3)}`,ca(1),[saved(2,10)]),ca(3));
  assert.equal(initialInspectQuery(`?${ca(3)}`,ca(1)),ca(3));
  assert.equal(initialInspectQuery('?query=BTCUSD',ca(1)),'BTCUSD');
});
test('Newest valid watchlist token is used when there is no saved CA',()=>{
  assert.equal(initialInspectQuery('',null,[saved(1,10),saved(2,50),{type:'narrative',id:'story',savedAt:99}]),ca(2));
  for(const item of [
    {type:'token',href:`./order-flow.html?query=${ca(3)}`},
    {type:'radar',href:`./radar.html?contract=${ca(3)}`},
    {type:'coin',marketSnapshot:{contract_address:ca(3)}}
  ])assert.equal(initialInspectQuery('','',[item]),ca(3));
  assert.equal(initialInspectQuery('','',[saved(4,0),saved(3,0)]),ca(4));
});
test('Empty or invalid saved data falls back to BTCUSD',()=>{
  assert.equal(initialInspectQuery('',''),'BTCUSD');
  assert.equal(initialInspectQuery('','not a CA',[{type:'token',id:'broken'}]),'BTCUSD');
  assert.equal(initialInspectQuery('','',null),'BTCUSD');
});
test('Last pasted CA persists without a resolved symbol and clearing removes it',()=>{
  const storage=memory(),history=createRecentContracts(()=>storage);
  history.label(ca(1),'ONE');history.remember(ca(2));
  assert.equal(createRecentContracts(()=>storage).lastAddress,ca(2));
  assert.deepEqual(history.entries,[{address:ca(1),symbol:'ONE'}]);
  history.remember('invalid');assert.equal(history.lastAddress,ca(2));
  history.clear();assert.equal(storage.getItem(LAST_CONTRACT_KEY),null);
  assert.equal(createRecentContracts(()=>storage).lastAddress,'');
});
test('Existing history migrates, corrupt or blocked storage remains usable',()=>{
  const storage=memory();storage.setItem(RECENT_CONTRACTS_KEY,JSON.stringify([{address:ca(5),symbol:'FIVE'}]));
  storage.setItem(LAST_CONTRACT_KEY,'invalid');assert.equal(createRecentContracts(()=>storage).lastAddress,ca(5));
  const blocked=createRecentContracts(()=>{throw Error('blocked')});blocked.remember(ca(6));
  assert.equal(blocked.lastAddress,ca(6));assert.equal(blocked.persistent,false);
});
