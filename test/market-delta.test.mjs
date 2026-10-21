import test from 'node:test';
import assert from 'node:assert/strict';
import {chart} from '../dist/market-delta.mjs';
test('A single complete 1h reading renders immediately on a zero-centered chart',()=>{
 assert.match(chart([{at:2000000000000,meme:2.5,altDelta:-1.25}]),/Meme \+2\.50%/);
 assert.match(chart([{at:2000000000000,meme:2.5,altDelta:-1.25}]),/Alt -1\.25%/);
 assert.match(chart([{at:2000000000000,meme:2.5,altDelta:-1.25}]),/y1="100" y2="100"/);
});
test('Missing or invalid readings do not invent a direction',()=>{
 assert.match(chart([]),/Awaiting a 1H reading/);
 assert.match(chart([{at:2000000000000,meme:null,altDelta:2}]),/Awaiting a 1H reading/);
});

test('BTC line uses its own scale and does not connect gaps or invent old history',()=>{
 const at=2000000000000;
 const svg=chart([{at,meme:2,altDelta:1},{at:at+300000,meme:2,altDelta:1,btcDelta:-5},
  {at:at+600000,meme:2,altDelta:1,btcDelta:null},{at:at+900000,meme:2,altDelta:1,btcDelta:0}]);
 assert.match(svg,/BTC -5\.00%/);
 assert.match(svg,/BTC \+0\.00%/);
 assert.match(svg,/BTC —/);
 assert.match(svg,/-5\.00%/);
 const path=svg.match(/<path d="([^"]*)"[^>]*stroke="#f6b85a"/)[1];
 assert.equal((path.match(/M/g)||[]).length,2);
 assert.doesNotMatch(path,/NaN|L/);
});
