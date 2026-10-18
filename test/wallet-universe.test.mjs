import test from 'node:test';
import assert from 'node:assert/strict';
import {filterUniverse,rankActivity} from '../dist/wallet-universe.mjs';
import {holdingsFor,walletBadges} from '../dist/followed-wallets.mjs';
const now=1700000000000;
const rows=[{name:'B',address:'b',source:'Nansen',code:'',interested:true,notes:'early',mints:['mint'],status:'ok',checkedAt:now},{name:'A',address:'a',source:'Manual',code:'F1',interested:false,mints:['a','b'],checkedAt:now-700000,status:'ok'}];
test('universe filters combine flags, provenance, class and freshness without mutating registry',()=>{
 assert.deepEqual(filterUniverse(rows,{interested:'yes',source:'Nansen',code:'none',status:'fresh'},now),[rows[0]]);
 assert.deepEqual(filterUniverse(rows,{query:'early'},now),[rows[0]]);
 assert.deepEqual(filterUniverse(rows,{sort:'tokens'},now),[rows[1],rows[0]]);
 assert.equal(rows[0].name,'B');
});
test('Interested drives tags independently of trader class',()=>{
 const coin={network:'solana',contract_address:'mint'};
 assert.equal(holdingsFor(coin,{wallets:rows},now).length,1);
 assert.match(walletBadges(coin,{wallets:rows},now),/Interested Party/);
 assert.equal(holdingsFor(coin,{wallets:[{...rows[0],code:'F1',interested:false}]},now).length,0);
});
test('activity ranking counts only swap associated receipts, not transfer receipts',()=>{
 const reports=[{address:'a',checked:2,events:[{kind:'Received / unclassified'},{kind:'Received / unclassified'}]},{address:'b',checked:1,events:[{kind:'Swap-associated receipt'}]}];
 const ranked=rankActivity(reports);assert.equal(ranked[0].address,'b');assert.equal(ranked[1].swaps,0);assert.equal(ranked[1].other,2);
});
