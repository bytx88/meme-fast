import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesChainFilter} from '../dist/radar-filter.mjs';

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
