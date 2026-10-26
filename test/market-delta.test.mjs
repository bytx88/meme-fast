import test from 'node:test';
import assert from 'node:assert/strict';
import {chart,compareReading,hourlyComparisons,runnerMode,runnerDetails,mountMarket,inputQualityNote} from '../dist/market-delta.mjs';
import {readFile} from 'node:fs/promises';
import {RUNNER_CONFIG} from '../dist/runner-policy.mjs';

const METHOD='fixed-preset-11-1h-v1-0123456789ab';
const COMPLETE={totalTokens:11,includedTokens:11,excludedTokens:0,exclusions:{}};
const SYMBOLS=['BP','STONK','PONS','CATE','SI','ANSEM','ZCAT','PURR','CASHCAT','NEARKAT','RAYCAT'];
const presetBasket=at=>SYMBOLS.map((symbol,index)=>({symbol,chain:'solana',address:'contract-'+symbol,pool:'pool-'+symbol,poolCreatedAt:at-7200000,priceChange1h:2,eligible:true,weight:1/11,rank:index+1,priceSource:'DexScreener'}));

test('browser safety rules match the authoritative runner policy',async()=>{
 const source=JSON.parse(await readFile(new URL('../worker/runner_policy.json',import.meta.url),'utf8'));
 assert.deepEqual(RUNNER_CONFIG,source);
 const now=2000000000000;
 const weakened={ready:true,score:1,updatedAt:now,
  coverage:{reliable:true,reservedPass:true},
  policy:{version:7,minimumPopulation:1,provisionalBaselinePeriods:0},
  history:{usable:true,provisional:true,periodHours:1,comparablePeriods:1,baselinePeriods:0,matchedTokens:1}};
 assert.equal(runnerMode(weakened,now),'—');
});

test('independent report failures recover on visible refresh and pause while hidden',async()=>{
 const saved={fetch:globalThis.fetch,document:globalThis.document,setInterval:globalThis.setInterval};
 try{
  let timer,onVisible,calls=0;
  globalThis.document={hidden:false,addEventListener(name,callback){onVisible=callback}};
  globalThis.setInterval=(callback,interval)=>{assert.equal(interval,60000);timer=callback;return 0};
  for(const failedEndpoint of ['/api/meme-index','/api/runner-mode']){
   let failing=true;
   const now=Date.now(),day=24*3600000;
   const method=METHOD;
   const delta={method,basket:[],readings:[{at:now-day,meme:1,altDelta:2,btcDelta:3,method,coverage:COMPLETE},{at:now,meme:4,altDelta:6,btcDelta:8,method,coverage:COMPLETE}]};
   const runner={version:1,ready:true,score:1,updatedAt:now,policy:{version:7},counts24h:{},
    history:{usable:true,comparablePeriods:3,baselinePeriods:2},coverage:{reliable:true,reservedPass:true}};
   globalThis.fetch=async url=>{calls++;if(failing&&url===failedEndpoint)throw Error('test outage');
    return {ok:true,json:async()=>url==='/api/meme-index'?delta:runner}};
   const market={innerHTML:'',setAttribute(){}},body={innerHTML:''};
   mountMarket(market,{querySelector:()=>body});
   await new Promise(resolve=>setImmediate(resolve));
   if(failedEndpoint==='/api/meme-index')assert.match(market.innerHTML,/mode-1">1 \(Hard\)/);
   else{assert.match(market.innerHTML,/mode-unknown">—/);assert.match(market.innerHTML,/\+3\.00 pp/)}
   globalThis.document.hidden=true;
   const previous=calls;timer();assert.equal(calls,previous);
   failing=false;globalThis.document.hidden=false;onVisible();
   await new Promise(resolve=>setImmediate(resolve));
   assert.match(market.innerHTML,/mode-1">1 \(Hard\)/);
   assert.match(market.innerHTML,/\+3\.00 pp/);
  }
 }finally{Object.assign(globalThis,saved)}
});

test('Mode details distinguish real valuations from no-volume observations',()=>{
 const html=runnerDetails({coverage:{eligibleTokens:210,observedTokens:205,valuedTokens:143,nonqualifyingTokens:62}});
 assert.match(html,/205\/210 tracked tokens freshly observed/);
 assert.match(html,/143 valued/);
 assert.match(html,/62 independently observed with zero 24H volume/);
});

test('provisional Mode accepts two matched hours and rejects missing evidence',()=>{
 const now=Date.now(),report={updatedAt:now,ready:true,score:4,policy:{version:7},
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
 const report={updatedAt:now,ready:true,mode:'Easy',score:5,policy:{version:7},history:{usable:true,comparablePeriods:3,baselinePeriods:2},coverage:{reliable:true,reservedPass:true}};
 assert.equal(runnerMode(null,now),'—');
 for(let score=1;score<=5;score++)assert.equal(runnerMode({...report,score},now),String(score));
 for(const change of [{updatedAt:now-16*60000},{updatedAt:now+1},{ready:false},{history:{usable:false}},{coverage:{reliable:false}},{score:0},{score:6},{score:2.5},{score:null},{policy:{version:1}},{policy:{version:6}}])assert.equal(runnerMode({...report,...change},now),'—');
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
   const report={version:1,updatedAt:Date.now(),ready:score!==null,score,policy:{version:7},
    history:{usable:true,comparablePeriods:3,baselinePeriods:2},coverage:{reliable:true,reservedPass:true},counts24h:{}};
   globalThis.fetch=async url=>({ok:true,json:async()=>url==='/api/runner-mode'?report:{basket:[],readings:[]}});
   const market={innerHTML:'',setAttribute(){}},body={innerHTML:''};
   mountMarket(market,{querySelector:()=>body});
   assert.match(market.innerHTML,/Mode <b class="mode-unknown">—/);
   await new Promise(resolve=>setImmediate(resolve));
   const display=score?`${score} (${['','Hard','Cooling','Balanced','Improving','Easy'][score]})`:'—';
   assert.ok(market.innerHTML.includes(`Mode <b class="mode-${score||'unknown'}">${display}</b>`));
   assert.ok(body.innerHTML.includes(`Solana Mode <strong>${display}</strong>`));
   assert.match(body.innerHTML,/no fixed calendar waiting rule/);
  }
 }finally{Object.assign(globalThis,saved)}
});


test('shared-pool meme history never compares across methodologies; benchmarks remain comparable',()=>{
 const at=2000000000000,day=24*3600000;
 const current={at,meme:2,altDelta:1,btcDelta:0,method:'shared-trending-1h-v1'};
 const old={at:at-day,meme:8,altDelta:2,btcDelta:1,method:'fomo-most-held-v1'};
 assert.deepEqual(compareReading([old,current]),{at,baselineAt:at-day,meme:null,altDelta:-1,btcDelta:-1});
 assert.equal(compareReading([{...old,method:current.method},current]).meme,-6);
});

const marketText=html=>html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
async function withMountedMarket(initialReport,check){
 const saved={fetch:globalThis.fetch,document:globalThis.document,setInterval:globalThis.setInterval};
 try{
  let report=initialReport,failed=false,timer;
  globalThis.document={hidden:false,addEventListener(){}};
  globalThis.setInterval=callback=>{timer=callback;return 0};
  globalThis.fetch=async url=>{
   if(url==='/api/meme-index'&&failed)throw Error('test outage');
   return {ok:true,json:async()=>url==='/api/meme-index'?report:{version:1,counts24h:{}}};
  };
  const attributes=new Map(),market={innerHTML:'',setAttribute:(name,value)=>attributes.set(name,value)},body={innerHTML:''};
  mountMarket(market,{querySelector:()=>body});
  await new Promise(resolve=>setImmediate(resolve));
  await check({market,body,attributes,refresh:async(nextReport,nextFailed=false)=>{
   report=nextReport;failed=nextFailed;timer();
   await new Promise(resolve=>setImmediate(resolve));
  }});
 }finally{Object.assign(globalThis,saved)}
}

test('fresh Meme observations remain visible with a current 1H label while a comparable baseline is unavailable',async()=>{
 const at=Date.now(),day=24*3600000,method=METHOD;
 const current={at,meme:4.25,altDelta:1.58,btcDelta:.62,method,coverage:COMPLETE};
 const prior={at:at-day,meme:8,altDelta:2,btcDelta:1,method,coverage:COMPLETE};
 for(const baseline of [null,{...prior,method:'fomo-most-held-v1'},{...prior,meme:null}]){
  const report={method,basket:[],readings:[...(baseline?[baseline]:[]),current]};
  await withMountedMarket(report,async({market,body,attributes})=>{
   const header=marketText(market.innerHTML),details=marketText(body.innerHTML);
   const title=marketText(market.innerHTML.match(/class="market-overview-title"[^>]*>([\s\S]*?)<\/span>/)[1]);
   assert.match(header,/Meme/);
   assert.match(header,/current 1H/i);
   assert.match(header,/\+4\.25%(?! pp)/);
   assert.match(title,/current 1H/i);
   assert.match(title,/24H/i);
   assert.match(details,/Current 1H:.*?Meme\s+\+4\.25%/i);
   assert.match(details,/(?:Meme\s+24H comparison|24H comparison.*?Meme).*?—/i);
   assert.match(attributes.get('aria-label'),/current 1H/i);
   assert.match(attributes.get('aria-label'),/\+4\.25%/);
   if(baseline){
    assert.match(header,/Alt\s+-0\.42 pp/);
    assert.match(header,/Btc\s+-0\.38 pp/i);
   }else{
    assert.match(header,/Alt\s+—/);
    assert.match(header,/Btc\s+—/i);
   }
  });
 }
});

test('Meme automatically resumes its comparable pp reading and never falls back to stale or failed observations',async()=>{
 const at=Date.now(),day=24*3600000,method=METHOD;
 const current={at,meme:4.25,altDelta:1.58,btcDelta:.62,method,coverage:COMPLETE};
 const prior={at:at-day,meme:8,altDelta:2,btcDelta:1,method:'fomo-most-held-v1'};
 const report={method,basket:[],readings:[prior,current]};
 await withMountedMarket(report,async({market,body,refresh})=>{
  assert.match(marketText(market.innerHTML),/current 1H/i);
  const comparable={...report,readings:[{...prior,method,coverage:COMPLETE},current]};
  await refresh(comparable);
  const header=marketText(market.innerHTML);
  assert.match(header,/Meme\s+-3\.75 pp/);
  assert.doesNotMatch(header,/current 1H/i);
  assert.match(header,/Alt\s+-0\.42 pp/);
  assert.match(header,/Btc\s+-0\.38 pp/i);
  assert.match(marketText(body.innerHTML),/Current 1H:.*?Meme\s+\+4\.25%/i);
  await refresh(report);
  assert.match(marketText(market.innerHTML),/current 1H/i);
  await refresh(report,true);
  assert.doesNotMatch(marketText(market.innerHTML),/\+4\.25%|current 1H/i);
  assert.match(marketText(market.innerHTML),/Meme\s+—/);
 });
 for(const invalid of [{...current,at:at-76*60000},{...current,at:at+60000},{...current,meme:null}]){
  await withMountedMarket({...report,readings:[invalid]},async({market})=>{
   assert.match(marketText(market.innerHTML),/Meme\s+—/);
   assert.doesNotMatch(marketText(market.innerHTML),/\+4\.25%/);
  });
 }
});

test('legacy contaminated Meme is withheld while Alt and BTC remain available',async()=>{
 const at=Date.now(),day=24*3600000,method='shared-trending-1h-v1';
 const report={method,basket:[],readings:[
  {at:at-day,meme:10,altDelta:2,btcDelta:1,method,coverage:COMPLETE},
  {at,meme:413378817666.74445,altDelta:1.58,btcDelta:.62,method,inputQuality:{extremeReturnCount:3}}]};
 await withMountedMarket(report,async({market,body,attributes})=>{
  assert.match(marketText(market.innerHTML),/Meme\s+—/);
  assert.match(marketText(market.innerHTML),/Alt\s+-0\.42 pp/);
  assert.match(marketText(market.innerHTML),/Btc\s+-0\.38 pp/i);
  assert.doesNotMatch(market.innerHTML,/413\.38B|413378817666/);
  assert.doesNotMatch(attributes.get('aria-label'),/413378817666/);
  assert.match(marketText(body.innerHTML),/legacy Meme calculation is withheld/i);
  assert.match(marketText(body.innerHTML),/Current 1H: Meme —/);
 });
});

test('incomplete preset keeps all 11 members and fixed weights while withholding a finite subset average',async()=>{
 const at=Date.now(),method=METHOD;
 const coverage={totalTokens:11,includedTokens:8,excludedTokens:3,exclusions:{missing_quote:1,incomplete_1h_window:1,unverified_extreme_return:1}};
 const basket=presetBasket(at);
 Object.assign(basket[8],{priceChange1h:null,eligible:false,exclusionReason:'missing_quote',pool:null,poolCreatedAt:null});
 Object.assign(basket[9],{priceChange1h:17361910275994,poolCreatedAt:at-2400000,eligible:false,exclusionReason:'incomplete_1h_window'});
 Object.assign(basket[10],{priceChange1h:13770788521195,eligible:false,exclusionReason:'unverified_extreme_return'});
 const report={method,coverage,basket,
  readings:[{at,meme:2,altDelta:1,btcDelta:0,method,coverage,inputQuality:{extremeReturnCount:2}}]};
 await withMountedMarket(report,async({market,body})=>{
  assert.match(marketText(market.innerHTML),/Meme\s+—/);
  assert.doesNotMatch(marketText(market.innerHTML),/\+2\.00%/);
  assert.match(marketText(body.innerHTML),/8\/11 fresh qualified; 3 unavailable; complete Meme reading withheld/);
  assert.match(marketText(body.innerHTML),/Incomplete preset data/);
  assert.match(marketText(body.innerHTML),/Fixed 11-coin preset · equal weight · hourly/);
  const members=[...body.innerHTML.matchAll(/<li><strong>([^<]+)<\/strong>(.*?)<\/li>/g)];
  assert.deepEqual(members.map(match=>match[1]),SYMBOLS);
  assert.ok(members.every(match=>match[2].includes('9.09% weight')));
  assert.match(members[8][2],/Unavailable: Quote unavailable/);
  assert.match(members[8][2],/contract-CASHCAT/);
  assert.match(marketText(body.innerHTML),/Pool has less than one hour of history/);
  assert.match(marketText(body.innerHTML),/Unverified 1H return above 10,000%/);
  assert.match(body.innerHTML,/17361910275994/);
  assert.match(body.innerHTML,/13770788521195/);
  assert.match(body.innerHTML,/not capped or replaced with zero/);
 });
});

test('browser refuses invalid fixed-preset averages and preserves independent benchmarks',async()=>{
 const at=Date.now(),method=METHOD;
 for(const meme of [null,-101,10001,413378817666.74445]){
  const report={method,basket:[],readings:[{at:at-24*3600000,meme:0,altDelta:2,btcDelta:1,method,coverage:COMPLETE},{at,meme,altDelta:1,btcDelta:0,method,coverage:COMPLETE}]};
  await withMountedMarket(report,async({market,body})=>{
   assert.match(marketText(market.innerHTML),/Meme\s+—/);
   assert.match(marketText(market.innerHTML),/Alt\s+-1\.00 pp/);
   assert.doesNotMatch(marketText(body.innerHTML),/Current 1H: Meme [+-]/);
  });
 }
});

test('unavailable preset quotes explain source, observation time, missing return, and invalid return separately',async()=>{
 const at=Date.now(),method=METHOD;
 const reasons=[['source_unavailable','Market source unavailable'],
  ['missing_observation','Quote observation time unavailable'],
  ['missing_return','1H return unavailable'],['invalid_return','Invalid 1H return']];
 const coverage={totalTokens:11,includedTokens:7,excludedTokens:4,
  exclusions:Object.fromEntries(reasons.map(([reason])=>[reason,1]))};
 const basket=presetBasket(at);
 reasons.forEach(([exclusionReason],index)=>Object.assign(basket[index],{eligible:false,exclusionReason,priceChange1h:null}));
 await withMountedMarket({method,basket,coverage,readings:[{at,meme:null,altDelta:1,btcDelta:0,method,coverage}]},async({market,body})=>{
  assert.match(marketText(market.innerHTML),/Meme\s+—/);
  const members=[...body.innerHTML.matchAll(/<li><strong>([^<]+)<\/strong>(.*?)<\/li>/g)];
  reasons.forEach(([,label],index)=>{
   assert.ok(members[index][2].includes(`Unavailable: ${label}`));
   assert.ok(members[index][2].includes('9.09% weight'));
  });
  assert.match(marketText(body.innerHTML),/7\/11 fresh qualified; 4 unavailable; complete Meme reading withheld/);
 });
});

test('preset coverage and a valid roster hash are required even when a finite Meme value is saved',async()=>{
 const at=Date.now(),day=24*3600000;
 const cases=[
  {method:METHOD,coverage:undefined},
  {method:METHOD,coverage:{...COMPLETE,includedTokens:10,excludedTokens:1}},
  {method:METHOD,coverage:{...COMPLETE,totalTokens:10}},
  {method:METHOD,coverage:{...COMPLETE,excludedTokens:1}},
  {method:'fixed-preset-11-1h-v1',coverage:COMPLETE},
  {method:'fixed-preset-11-1h-v1-0123456789ag',coverage:COMPLETE},
  {method:'fixed-preset-11-1h-v1-0123456789abcd',coverage:COMPLETE},
  {method:'shared-trending-mature-1h-v2',coverage:COMPLETE}
 ];
 for(const {method,coverage} of cases){
  const report={method,basket:presetBasket(at),readings:[
   {at:at-day,meme:1,altDelta:2,btcDelta:1,method,coverage},
   {at,meme:4.25,altDelta:1,btcDelta:0,method,coverage}]};
  await withMountedMarket(report,async({market,body})=>{
   assert.match(marketText(market.innerHTML),/Meme\s+—/);
   assert.doesNotMatch(marketText(market.innerHTML),/\+4\.25%|\+3\.25 pp/);
   assert.match(marketText(market.innerHTML),/Alt\s+-1\.00 pp/);
   assert.match(marketText(market.innerHTML),/Btc\s+-1\.00 pp/i);
   assert.doesNotMatch(body.innerHTML,/Meme histogram, Alt and BTC/);
  });
 }
});

test('changing the preset hash withholds Meme comparison and preserves the current full-preset reading',async()=>{
 const at=Date.now(),day=24*3600000,method=METHOD;
 const current={at,meme:4.25,altDelta:1.58,btcDelta:.62,method,coverage:COMPLETE};
 const prior={at:at-day,meme:8,altDelta:2,btcDelta:1,method:'fixed-preset-11-1h-v1-abcdef012345',coverage:COMPLETE};
 assert.equal(compareReading([prior,current]).meme,null);
 await withMountedMarket({method,basket:presetBasket(at),readings:[prior,current]},async({market,body})=>{
  const header=marketText(market.innerHTML),details=marketText(body.innerHTML);
  assert.match(header,/Meme · 1H\s+\+4\.25%/);
  assert.doesNotMatch(header,/-3\.75 pp/);
  assert.match(header,/Alt\s+-0\.42 pp/);
  assert.match(header,/Btc\s+-0\.38 pp/i);
  assert.match(details,/Awaiting fixed preset 24H baseline/);
  assert.match(details,/Meme 1H reading 24H ago: Awaiting matching history/);
  assert.match(details,/11\/11 fresh qualified; 0 unavailable/);
 });
});

test('Meme selects the nearest complete same-preset baseline while benchmarks keep their own matching observations',async()=>{
 const at=Date.now(),day=24*3600000,method=METHOD;
 const current={at,meme:4.25,altDelta:1.58,btcDelta:.62,method,coverage:COMPLETE};
 const complete={at:at-day+60000,meme:2,altDelta:9,btcDelta:9,method,coverage:COMPLETE};
 const nearest={at:at-day,meme:100,altDelta:2,btcDelta:1,method,coverage:COMPLETE};
 for(const rejected of [
  {...nearest,meme:null,coverage:{...COMPLETE,includedTokens:10,excludedTokens:1}},
  {...nearest,method:'fixed-preset-11-1h-v1-abcdef012345'},
  {...nearest,method:'shared-trending-mature-1h-v2'}
 ]){
  await withMountedMarket({method,basket:presetBasket(at),readings:[rejected,complete,current]},async({market,body})=>{
   const header=marketText(market.innerHTML),details=marketText(body.innerHTML);
   assert.match(header,/Meme\s+\+2\.25 pp/);
   assert.doesNotMatch(header,/current 1H/i);
   assert.match(header,/Alt\s+-0\.42 pp/);
   assert.match(header,/Btc\s+-0\.38 pp/i);
   assert.match(details,/Meme 1H reading 24H ago:.*?\+2\.00%/);
   assert.match(body.innerHTML,/Meme \+2\.25 pp/);
  });
 }
});

test('extreme input disclosure explains exclusion and retains raw provenance',()=>{
 const method=METHOD;
 assert.match(inputQualityNote({method,readings:[{method,meme:20,inputQuality:{extremeReturnCount:2}}]}),/2 provider-reported 1H returns/);
 assert.match(inputQualityNote({method,readings:[{method,meme:20,inputQuality:{extremeReturnCount:2}}]}),/complete reading is withheld until all 11 preset members/);
 assert.match(inputQualityNote({method,readings:[{method,meme:20,inputQuality:{extremeReturnCount:2}}]}),/not capped or replaced with zero/);
 assert.equal(inputQualityNote({method,readings:[{method,meme:2,inputQuality:{extremeReturnCount:0}}]}),'');
 assert.equal(inputQualityNote({method,readings:[{method:'old',meme:1e12}]}),'');
});

test('off-hour Meme repairs preserve fresh matched benchmarks without extending freshness',async()=>{
 const at=Date.now(),hour=3600000,day=24*hour,method=METHOD;
 const rows=[{at:at-day-24*60000,meme:1,altDelta:2,btcDelta:1,method:'shared-trending-1h-v1'},
  {at:at-24*60000,meme:413378817666,altDelta:1.58,btcDelta:.62,method:'shared-trending-1h-v1'},
  {at,meme:91.02,altDelta:1,btcDelta:0,method,coverage:COMPLETE}];
 await withMountedMarket({method,basket:[],readings:rows},async({market,body,refresh})=>{
  assert.match(marketText(market.innerHTML),/Meme · 1H\s+\+91\.02%/);
  assert.match(marketText(market.innerHTML),/Alt\s+-0\.42 pp/);
  assert.match(marketText(market.innerHTML),/Btc\s+-0\.38 pp/);
  assert.match(marketText(body.innerHTML),/Alt\/BTC comparison: observed .*?baseline/);
  await refresh({method,basket:[],readings:[{...rows[0],at:at-day-76*60000},{...rows[1],at:at-76*60000},rows[2]]});
  assert.match(marketText(market.innerHTML),/Alt\s+—/);
  assert.match(marketText(market.innerHTML),/Btc\s+—/);
 });
});
