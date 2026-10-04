import test from 'node:test';
import assert from 'node:assert/strict';
import {walletBadges,holdingsFor,walletState,CLASSES} from '../dist/followed-wallets.mjs';
const now=1700000000000;
const coin={id:'solana:MintA',network:'solana',contract_address:'MintA'};
const row={name:'Best 1',address:'WalletA',code:'F1',mints:['MintA'],checkedAt:now,status:'ok'};
test('exact mint and chain matches; same class has one badge with both names',()=>{
 const report={wallets:[row,{...row,name:'Best 2',address:'WalletB'}]};
 const html=walletBadges(coin,report,now);
 assert.equal((html.match(/<summary/g)||[]).length,1);
 assert.match(html,/Best 1/);assert.match(html,/Best 2/);
 assert.equal(holdingsFor({...coin,contract_address:'minta'},report,now).length,0);
 assert.equal(holdingsFor({id:'base:MintA',network:'base',contract_address:'MintA'},report,now).length,0);
});
test('old or failed samples retain explicitly stale badges, no sample earns none',()=>{
 assert.equal(walletState({...row,checkedAt:now-600001},now),'stale');
 assert.equal(walletState({...row,status:'unavailable'},now),'stale');
 assert.match(walletBadges(coin,{wallets:[{...row,status:'unavailable'}]},now),/Stale · last checked/);
 assert.equal(walletBadges(coin,{wallets:[{...row,checkedAt:null}]},now),'');
 assert.equal(walletState({...row,checkedAt:now+1},now),'stale');
});
test('wallet names are escaped and all assigned codes are available',()=>{
 assert.match(walletBadges(coin,{wallets:[{...row,name:'<img onerror="x">'}]},now),/&lt;img/);
 assert.deepEqual(Object.keys(CLASSES),['F1','F2','Dev','C1','C2','N1','N2','L1']);
});
