import test from 'node:test';
import assert from 'node:assert/strict';
import {chart,compareReading,hourlyComparisons,runnerMode,runnerDetails} from '../dist/market-delta.mjs';
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

test('Hourly comparison subtracts the 1H reading from 24 hours ago in percentage points',()=>{
 const at=2000000000000,day=24*3600000;
 const rows=[{at:at-day,meme:1,altDelta:-2,btcDelta:0.4},{at,meme:3,altDelta:-1,btcDelta:-0.1}];
 assert.deepEqual(compareReading(rows),{at,baselineAt:at-day,meme:2,altDelta:1,btcDelta:-0.5});
 assert.match(chart([compareReading(rows)],' pp'),/Meme \+2\.00 pp/);
 assert.match(chart([compareReading(rows)],' pp'),/BTC -0\.50 pp/);
});

test('Comparison picks the closest historical reading and withholds missing history or BTC',()=>{
 const at=2000000000000,day=24*3600000;
 const current={at,meme:3,altDelta:2,btcDelta:1};
 assert.equal(compareReading([current]),null);
 assert.equal(compareReading([{at:at-day-11*60000,meme:1,altDelta:1},current]),null);
 const result=compareReading([{at:at-day-4*60000,meme:9,altDelta:9},
  {at:at-day+60000,meme:1,altDelta:1},current]);
 assert.equal(result.meme,2);
 assert.equal(result.btcDelta,null);
 assert.match(chart([result],' pp'),/BTC —/);
});

test('Legacy five-minute history produces at most one comparison per UTC hour',()=>{
 const hour=3600000,at=2000000000000-2000000000000%hour,day=24*hour;
 const rows=[{at:at-day,meme:1,altDelta:1},{at:at-day+5*60000,meme:2,altDelta:2},
  {at,meme:3,altDelta:3},{at:at+5*60000,meme:5,altDelta:5}];
 const comparisons=hourlyComparisons(rows);
 assert.equal(comparisons.length,1);
 assert.equal(comparisons[0].at,at+5*60000);
 assert.equal(comparisons[0].meme,3);
});

test('Mode requires fresh reliable history independently of the price delta',()=>{
 const now=2000000000000;
 const report={updatedAt:now,ready:true,mode:'Easy',reliableDays:14,coverage:{reliable:true}};
 assert.equal(runnerMode(null,now),'Unknown');
 assert.equal(runnerMode(report,now),'Easy');
 for(const change of [{updatedAt:now-16*60000},{updatedAt:now+1},{ready:false},{reliableDays:13},{coverage:{reliable:false}},{mode:'<script>'}])assert.equal(runnerMode({...report,...change},now),'Unknown');
 const html=runnerDetails({counts24h:{500000:2,1000000:0},reason:'<unsafe>'});
 assert.match(html,/Solana Mode/);assert.match(html,/Unknown/);assert.match(html,/&lt;unsafe&gt;/);
 assert.match(html,/>0<\/b>/);assert.match(html,/not all Solana memes/);
 assert.match(runnerDetails(report,true),/Runner data unavailable/);
});
