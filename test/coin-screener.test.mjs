import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SCREENER,normalizeScreener,passesScreener} from '../dist/coin-screener.mjs';

test('24h volume starts at $15,000 and unavailable volume does not pass',()=>{
 const settings=normalizeScreener();
 assert.deepEqual(settings,DEFAULT_SCREENER);
 assert.equal(passesScreener({volume:14999},settings),false);
 assert.equal(passesScreener({volume:15000},settings),true);
 assert.equal(passesScreener({volume:null},settings),false);
});

test('other minimums and chain filter apply together; zero disables minimums',()=>{
 const settings=normalizeScreener({volume24h:0,liquidity:3000,volume5m:500,transactions5m:10,chain:'base'});
 const coin={network:'base',volume:null,liquidity:3000,volume5m:500,buys5m:6,sells5m:4};
 assert.equal(passesScreener(coin,settings),true);
 assert.equal(passesScreener({...coin,sells5m:3},settings),false);
 assert.equal(passesScreener({...coin,network:'solana'},settings),false);
 assert.equal(passesScreener({...coin,volume5m:null},settings),false);
});

test('invalid saved settings fall back to safe defaults',()=>{
 assert.deepEqual(normalizeScreener({volume24h:-1,liquidity:'oops',chain:'other'}),DEFAULT_SCREENER);
});
test('Robinhood Chain is available in Coin filters',()=>{
 const settings=normalizeScreener({chain:'robinhood',volume24h:0});
 assert.equal(settings.chain,'robinhood');
 assert.equal(passesScreener({network:'robinhood'},settings),true);
 assert.equal(passesScreener({network:'solana'},settings),false);
});
