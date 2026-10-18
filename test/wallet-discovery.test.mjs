import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAddressList} from '../dist/wallet-discovery.mjs';
import {SMART_WALLETS} from '../dist/smart-wallets.mjs';
import {createSmartHoldings} from '../dist/smart-holdings.mjs';

test('bulk input validates every exact address and deduplicates before any write',()=>{
 assert.deepEqual(parseAddressList(SMART_WALLETS[0]+'\n'+SMART_WALLETS[1]+', '+SMART_WALLETS[0]),SMART_WALLETS.slice(0,2));
 for(const text of ['',SMART_WALLETS[0]+'\ninvalid'])assert.throws(()=>parseAddressList(text));
 assert.throws(()=>parseAddressList(SMART_WALLETS.join('\n'),2));
});

test('switching balance token or group cannot display a delayed response for the previous selection',async()=>{
 const pending=[];
 const holdings=createSmartHoldings({request:path=>new Promise(resolve=>pending.push({path,resolve}))});
 holdings.configure('first','universe',['one']);const first=holdings.refresh();
 holdings.configure('second','interested',['two']);const second=holdings.refresh();
 pending[1].resolve({ok:true,json:async()=>({token:'second',network:'solana',wallets:[],samples:[],status:'ok'})});await second;
 pending[0].resolve({ok:true,json:async()=>({token:'first',network:'solana',wallets:[],samples:[],status:'ok'})});await first;
 assert.match(pending[1].path,/token=second&scope=interested/);
 assert.equal(holdings.summary().token,'second');
 holdings.configure('second','interested',['two','three']);
 assert.equal(holdings.summary().snapshotCount,0);
 assert.equal(holdings.summary().token,undefined);
});
