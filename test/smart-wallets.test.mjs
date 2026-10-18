import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SMART_TEST_TOKEN,SMART_WALLETS,hasSmartGroup,smartWalletTrades} from '../dist/smart-wallets.mjs';
import {isSolanaAddress} from '../dist/lookup.mjs';
const token={network:'solana',address:SMART_TEST_TOKEN};

test('Smart cohort is scoped to the exact HOOKED Solana listing',()=>{
  assert.equal(SMART_WALLETS.length,9);
  assert.equal(new Set(SMART_WALLETS).size,9);
  assert.ok(SMART_WALLETS.every(isSolanaAddress));
  assert.equal(hasSmartGroup([token]),true);
  for(const tokens of [[],[{...token,network:'eth'}],[{...token,address:SMART_TEST_TOKEN.toLowerCase()}],[token,{network:'solana',address:'other'}]])assert.equal(hasSmartGroup(tokens),false);
});

test('frontend wallet disclosure matches the backend fixed membership and order',()=>{
 const group=JSON.parse(readFileSync(new URL('../worker/smart-wallets.json',import.meta.url),'utf8'));
 assert.equal(group.token,SMART_TEST_TOKEN);
 assert.deepEqual(group.wallets.map(row=>row.address),SMART_WALLETS);
});

test('Smart flow uses exact sender membership, preserving buy/sell records and unknown coverage',()=>{
 const buy={wallet:SMART_WALLETS[0],side:'buy',usd:20},sell={wallet:SMART_WALLETS[1],side:'sell',usd:10};
 const input=[buy,{wallet:SMART_WALLETS[0].toLowerCase(),usd:99},{wallet:'other'},{},sell];
 assert.deepEqual(smartWalletTrades(input),[buy,sell]);
 assert.equal(input.length,5);
});

test('Smart Flow can use the shared universe independently of the fixed balance cohort',()=>{
 const outside={wallet:'InterestedParty',side:'buy'},original={wallet:SMART_WALLETS[0],side:'sell'};
 assert.deepEqual(smartWalletTrades([outside,original],['InterestedParty']),[outside]);
 assert.deepEqual(smartWalletTrades([outside,original],[]),[]);
});
