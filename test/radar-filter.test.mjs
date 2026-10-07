import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesChainFilter,matchesTrackedWalletFilter,toggleChainFilter} from '../dist/radar-filter.mjs';

test('icon filters combine chains, keep Base exact, and reset to All',()=>{
 let selected=toggleChainFilter([],'base');
 assert.equal(matchesChainFilter({network:'base'},selected),true);
 assert.equal(matchesChainFilter({network:'ethereum'},selected),false);
 assert.equal(matchesChainFilter({network:'solana'},selected),false);
 selected=toggleChainFilter(selected,'solana');
 assert.equal(matchesChainFilter({network:'solana'},selected),true);
 assert.equal(matchesChainFilter({network:'robinhood'},selected),false);
 selected=toggleChainFilter(selected,'base');
 assert.deepEqual(selected,['solana']);
 assert.deepEqual(toggleChainFilter(selected,'all'),[]);
 assert.deepEqual(toggleChainFilter(selected,'solana'),[]);
 assert.equal(matchesChainFilter({network:'robinhood'},[]),true);
});

test('Swing chain filters keep All broad and Other exclusive of Solana and Robinhood',()=>{
 const solana={network:'solana'},robinhood={network:'robinhood'},base={network:'base'};
 for(const coin of [solana,robinhood,base])assert.equal(matchesChainFilter(coin,'all'),true);
 assert.equal(matchesChainFilter(solana,'solana'),true);
 assert.equal(matchesChainFilter(robinhood,'robinhood'),true);
 assert.equal(matchesChainFilter(base,'other'),true);
 assert.equal(matchesChainFilter(solana,'other'),false);
 assert.equal(matchesChainFilter(robinhood,'other'),false);
 assert.equal(matchesChainFilter({network:'future-chain'},'other'),true);
});

test('Tracked Wallet filters exact observed holdings and composes with chain filters',()=>{
 const now=1700000000000,coin={network:'solana',contract_address:'MintA'};
 const wallet={code:'F1',checkedAt:now,status:'ok',mints:['MintA']};
 const report={wallets:[wallet]};
 assert.equal(matchesTrackedWalletFilter(coin,false,null,now),true);
 assert.equal(matchesTrackedWalletFilter(coin,true,report,now),true);
 assert.equal(matchesTrackedWalletFilter(coin,true,null,now),false);
 assert.equal(matchesTrackedWalletFilter({...coin,contract_address:'MintB'},true,report,now),false);
 assert.equal(matchesTrackedWalletFilter({...coin,network:'base'},true,report,now),false);
 assert.equal(matchesTrackedWalletFilter(coin,true,{wallets:[{...wallet,checkedAt:null}]},now),false);
 assert.equal(matchesTrackedWalletFilter(coin,true,{wallets:[{...wallet,status:'unavailable'}]},now),true);
 const coins=[coin,{...coin,contract_address:'MintB'},{...coin,network:'base'}];
 assert.deepEqual(coins.filter(c=>matchesChainFilter(c,'solana')&&matchesTrackedWalletFilter(c,true,report,now)),[coin]);
 assert.equal(coins.filter(c=>matchesChainFilter(c,'other')&&matchesTrackedWalletFilter(c,true,report,now)).length,0);
});
