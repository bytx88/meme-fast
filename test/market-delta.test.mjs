import test from 'node:test';
import assert from 'node:assert/strict';
import {chart,compareReading,hourlyComparisons,runnerMode,runnerDetails,mountMarket} from '../dist/market-delta.mjs';

test('Mode details distinguish real valuations from no-volume observations',()=>{
 const html=runnerDetails({coverage:{eligibleTokens:210,observedTokens:205,valuedTokens:143,nonqualifyingTokens:62}});
 assert.match(html,/205\/210 tracked tokens freshly observed/);
 assert.match(html,/143 valued/);
 assert.match(html,/62 independently observed with zero 24H volume/);
});

test('provisional Mode accepts two matched hours and rejects missing evidence',()=>{
 const now=Date.now(),report={updatedAt:now,ready:true,score:4,policy:{version:5},
  coverage:{reliable:true,reservedPass:true},history:{usable:true,provisional:true,
   periodHours:1,comparablePeriods:2,baselinePeriods:1,matchedTokens:60}};
 assert.equal(runnerMode(report,now),'4');
 assert.match(runnerDetails(report),/Provisional/);
 assert.equal(runnerMode({...report,history:{...report.history,matchedTokens:49}},now),'—');
 assert.equal(runnerMode({...report,history:{...report.history,usable:false}},now),'—');
 assert.equal(runnerMode({...report,policy:{version:3}},now),'—');
});
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

test('Mode shows 1–5 only for sufficient fresh evidence and a dash otherwise',()=>{
 const now=2000000000000;
 const report={updatedAt:now,ready:true,mode:'Easy',score:5,policy:{version:5},history:{usable:true,comparablePeriods:3,baselinePeriods:2},coverage:{reliable:true,reservedPass:true}};
 assert.equal(runnerMode(null,now),'—');
 for(let score=1;score<=5;score++)assert.equal(runnerMode({...report,score},now),String(score));
 for(const change of [{updatedAt:now-16*60000},{updatedAt:now+1},{ready:false},{history:{usable:false}},{coverage:{reliable:false}},{score:0},{score:6},{score:2.5},{score:null},{policy:{version:1}}])assert.equal(runnerMode({...report,...change},now),'—');
 const html=runnerDetails({counts24h:{500000:2,1000000:0},reason:'<unsafe>'});
 assert.match(html,/Solana Mode/);assert.match(html,/&lt;unsafe&gt;/);
 assert.match(html,/>0<\/b>/);assert.match(html,/not all Solana memes/);
 assert.match(html,/no fixed calendar waiting rule/);
 assert.doesNotMatch(html,/14|<strong>Unknown/);
 assert.match(runnerDetails(report,true),/Runner data unavailable/);
});

test('the mounted widget renders every supported score independently of missing delta data',async()=>{
 const saved={fetch:globalThis.fetch,document:globalThis.document,setInterval:globalThis.setInterval};
 try{
  globalThis.document={hidden:false,addEventListener(){}};
  globalThis.setInterval=()=>0;
  for(const score of [1,2,3,4,5,null]){
   const report={version:1,updatedAt:Date.now(),ready:score!==null,score,policy:{version:5},
    history:{usable:true,comparablePeriods:3,baselinePeriods:2},coverage:{reliable:true,reservedPass:true},counts24h:{}};
   globalThis.fetch=async url=>({ok:true,json:async()=>url==='/api/runner-mode'?report:{basket:[],readings:[]}});
   const market={innerHTML:'',setAttribute(){}},body={innerHTML:''};
   mountMarket(market,{querySelector:()=>body});
   assert.match(market.innerHTML,/Mode <b class="mode-unknown">—/);
   await new Promise(resolve=>setImmediate(resolve));
   assert.ok(market.innerHTML.includes(`Mode <b class="mode-${score||'unknown'}">${score||'—'}</b>`));
   assert.match(body.innerHTML,/no fixed calendar waiting rule/);
  }
 }finally{Object.assign(globalThis,saved)}
});
