import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecentContracts,RECENT_CONTRACTS_KEY,tokenQueryFromSearch} from '../dist/recent-contracts.mjs';
const ca=i=>'0x'+i.toString(16).padStart(40,'0');
function memory(){const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}}
test('Only the four newest labeled contracts persist, with symbols only',()=>{
  const storage=memory(),history=createRecentContracts(()=>storage);
  assert.equal(history.remember(ca(1)),false);
  for(let i=1;i<=6;i++)history.label(ca(i),`T${i}`,'Unused name');
  assert.deepEqual(history.entries.map(item=>item.symbol),['T6','T5','T4','T3']);
  history.remember(ca(4));
  const restored=createRecentContracts(()=>storage);assert.equal(restored.entries[0].address,ca(4));assert.deepEqual(restored.entries[0],{address:ca(4),symbol:'T4'});assert.equal(restored.entries.length,4);
  restored.clear();assert.equal(storage.getItem(RECENT_CONTRACTS_KEY),null);
});
test('Unlabeled old entries are removed; addresses deduplicate case-insensitively',()=>{
  const storage=memory(),evm='0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
  storage.setItem(RECENT_CONTRACTS_KEY,JSON.stringify([{address:ca(1)},{address:evm,symbol:'ABC',name:'Old full name'}]));
  const history=createRecentContracts(()=>storage);
  assert.deepEqual(history.entries,[{address:evm,symbol:'ABC'}]);
  assert.deepEqual(JSON.parse(storage.getItem(RECENT_CONTRACTS_KEY)),history.entries);
  history.label(evm.toUpperCase(),'NEW');assert.equal(history.entries.length,1);assert.equal(history.entries[0].symbol,'NEW');
  assert.equal(history.label(ca(2),''),false);assert.equal(history.label('BONK','BONK'),false);
});
test('Blocked or corrupt storage does not break search history',()=>{
  const unavailable=createRecentContracts(()=>{throw Error('blocked')});assert.equal(unavailable.label(ca(1),'ONE'),true);assert.equal(unavailable.persistent,false);assert.equal(unavailable.entries[0].address,ca(1));
  const storage=memory();storage.setItem(RECENT_CONTRACTS_KEY,'not json');const recovered=createRecentContracts(()=>storage);assert.deepEqual(recovered.entries,[]);recovered.label(ca(2),'TWO');assert.equal(recovered.persistent,true);
});
test('Explicit token links take precedence over automatic clipboard search',()=>{
  const address=ca(42);
  assert.equal(tokenQueryFromSearch(`?${address}`),address);
  assert.equal(tokenQueryFromSearch(`?query=${address}`),address);
  assert.equal(tokenQueryFromSearch('?query=CASHED'),'CASHED');
  assert.equal(tokenQueryFromSearch(''),'');
  assert.equal(tokenQueryFromSearch('?view=coin'),'');
});
