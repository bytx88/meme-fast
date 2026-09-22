import test from 'node:test';
import assert from 'node:assert/strict';
import {groupCoins} from '../dist/coin-groups.mjs';
const a={id:'a',network:'solana',name:'Super gooner intelligence',symbol:'SGI',contract_address:'A',liquidity:4700,volume:2700};
const b={...a,id:'b',contract_address:'B',liquidity:4420,volume:2300};
test('Matching names group without adding metrics or dropping contracts',()=>{
 const [group]=groupCoins([a,b]);assert.equal(groupCoins([a,b]).length,1);assert.equal(group.variants.length,2);assert.equal(group.liquidity,4700);assert.equal(group.volume,2700);assert.equal(group.contract_address,'A');
});
test('Ticker alone and different networks do not merge',()=>{
 assert.equal(groupCoins([a,{...b,name:'Something else'},{...b,network:'base'}]).length,3);
});
test('Displayed evidence stays attached to the selected contract',()=>{
 const [group]=groupCoins([a,b],c=>c.id==='b'?{kind:'verified'}:null);assert.equal(group.id,'b');assert.equal(group.contract_address,'B');assert.equal(group.liquidity,4420);
});
test('Whitespace and case variants group; filtering can expose one exact contract',()=>{
 assert.equal(groupCoins([a,{...b,name:' SUPER  GOONER intelligence ',symbol:'sgi'}]).length,1);
 assert.equal(groupCoins([b])[0].contract_address,'B');
});
