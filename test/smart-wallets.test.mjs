import test from 'node:test';
import assert from 'node:assert/strict';
import {SMART_TEST_TOKEN,SMART_WALLETS,hasSmartGroup,smartWalletTrades} from '../dist/smart-wallets.mjs';
import {normalizeTrade,summarize} from '../dist/core.mjs';
import {mergeFlowHistory} from '../dist/flow-history.mjs';
import {isSolanaAddress} from '../dist/lookup.mjs';

const now=1800000000000;
const token={network:'solana',address:SMART_TEST_TOKEN};
function swap(id,wallet,side='buy',usd=100,time=now-1000){
  return normalizeTrade({id,attributes:{tx_from_address:wallet,from_token_address:side==='buy'?'quote':SMART_TEST_TOKEN,to_token_address:side==='buy'?SMART_TEST_TOKEN:'quote',volume_in_usd:usd,block_timestamp:new Date(time).toISOString(),to_token_amount:10,from_token_amount:10}},SMART_TEST_TOKEN,{network:'solana',name:'test'});
}

test('Smart cohort is scoped to the exact HOOKED Solana listing',()=>{
  assert.equal(SMART_WALLETS.length,9);
  assert.equal(new Set(SMART_WALLETS).size,9);
  assert.ok(SMART_WALLETS.every(isSolanaAddress));
  assert.equal(hasSmartGroup([token]),true);
  for(const tokens of [[],[{...token,network:'eth'}],[{...token,address:SMART_TEST_TOKEN.toLowerCase()}],[token,{network:'solana',address:'other'}]])assert.equal(hasSmartGroup(tokens),false);
});

test('cohort filtering keeps every supplied sender and rejects substrings, wrong case, other tokens and chains',()=>{
  const matching=SMART_WALLETS.map((wallet,i)=>swap(String(i),wallet));
  const rejected=[swap('other','other'),swap('prefix',SMART_WALLETS[0].slice(0,8)),swap('case',SMART_WALLETS[0].toLowerCase()),swap('missing',''),{...matching[0],network:'eth'},{...matching[0],tokenKey:'solana:other'}];
  const all=[...matching,...rejected];
  assert.deepEqual(smartWalletTrades(all),matching);
  assert.equal(all.length,15);
});

test('Smart flow totals include only matched swaps in the chosen window; no match stays empty',()=>{
  const rows=[swap('buy',SMART_WALLETS[0],'buy',150),swap('sell',SMART_WALLETS[1],'sell',60),swap('old',SMART_WALLETS[2],'buy',500,now-120*60000),swap('untracked','other','sell',900)];
  const smart=smartWalletTrades(rows),summary=summarize(smart,60,now);
  assert.equal(summary.buy,150);assert.equal(summary.sell,60);assert.equal(summary.net,90);
  assert.equal(summary.rows.length,2);
  assert.equal(summarize(smart,1440,now).rows.length,3);
  assert.equal(smartWalletTrades([rows[3]]).length,0);
  assert.equal(summarize(rows,60,now).sell,960);
});

test('5D Smart mode filters retained observations and deduplicates live overlap',()=>{
  const recent=swap('recent',SMART_WALLETS[0]),old=swap('old',SMART_WALLETS[1],'sell',50,now-3*1440*60000);
  const merged=mergeFlowHistory([recent],[recent,old,swap('untracked','other')],now);
  const summary=summarize(smartWalletTrades(merged),7200,now);
  assert.equal(summary.rows.length,2);assert.equal(summary.net,50);
});
