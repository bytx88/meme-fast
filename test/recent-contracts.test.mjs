import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecentContracts,RECENT_CONTRACTS_KEY} from '../dist/recent-contracts.mjs';
const ca=i=>'0x'+i.toString(16).padStart(40,'0');
function memory(){const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}}
test('Seven newest unique contracts persist in order; duplicate becomes default',()=>{
  const storage=memory(),history=createRecentContracts(()=>storage);
  for(let i=1;i<=9;i++)history.remember(ca(i));
  assert.equal(history.entries.length,7);assert.equal(history.entries[0].address,ca(9));assert.equal(history.entries[6].address,ca(3));
  history.remember(ca(4));history.label(ca(4),'FOUR');
  const restored=createRecentContracts(()=>storage);assert.equal(restored.entries[0].address,ca(4));assert.equal(restored.entries[0].symbol,'FOUR');assert.equal(restored.entries.length,7);
  restored.clear();assert.equal(storage.getItem(RECENT_CONTRACTS_KEY),null);
});
test('Only contracts are retained, with EVM case-insensitive deduplication',()=>{
  const history=createRecentContracts(()=>memory());assert.equal(history.remember('BONK'),false);assert.equal(history.remember('<script>'),false);
  const evm='0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';history.remember(evm);history.remember(evm.toUpperCase());assert.equal(history.entries.length,1);
  const sol='Fr24qgw8MwbBmzcesxe4qGBrmFxEH98NjXjcJBW5vP3T';history.remember(sol);assert.equal(history.entries[0].address,sol);
});
test('Blocked or corrupt storage does not break search history',()=>{
  const unavailable=createRecentContracts(()=>{throw Error('blocked')});assert.equal(unavailable.remember(ca(1)),true);assert.equal(unavailable.persistent,false);assert.equal(unavailable.entries[0].address,ca(1));
  const storage=memory();storage.setItem(RECENT_CONTRACTS_KEY,'not json');const recovered=createRecentContracts(()=>storage);assert.deepEqual(recovered.entries,[]);recovered.remember(ca(2));assert.equal(recovered.persistent,true);
});
