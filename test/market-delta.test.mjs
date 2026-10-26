import test from 'node:test';
import assert from 'node:assert/strict';
import {chart,compareReading,hourlyComparisons,memeComparisons,componentComparison,runnerMode,runnerDetails,mountMarket,inputQualityNote} from '../dist/market-delta.mjs';
import {readFile} from 'node:fs/promises';
import {RUNNER_CONFIG} from '../dist/runner-policy.mjs';

const METHOD='fixed-preset-11-1h-v1-0123456789ab';
const COMPLETE={totalTokens:11,includedTokens:11,excludedTokens:0,exclusions:{}};
const SYMBOLS=['BP','STONK','PONS','CATE','SI','ANSEM','ZCAT','PURR','CASHCAT','NEARKAT','RAYCAT'];
const presetBasket=at=>SYMBOLS.map((symbol,index)=>({symbol,chain:'solana',address:'contract-'+symbol,pool:'pool-'+symbol,poolCreatedAt:at-7200000,priceChange1h:2,eligible:true,weight:1/11,rank:index+1,priceSource:'DexScreener'}));
const methodForSize=size=>`fixed-preset-${size}-1h-v1-0123456789ab`;
const coverageForSize=size=>({totalTokens:size,includedTokens:size,excludedTokens:0,exclusions:{}});
const basketForSize=(at,size)=>Array.from({length:size},(_,index)=>({symbol:SYMBOLS[index]||`ADDED${index+1}`,chain:'solana',address:`contract-${index}`,pool:`pool-${index}`,poolCreatedAt:at-7200000,priceChange1h:2,eligible:true,weight:1/size,rank:index+1,priceSource:'DexScreener'}));

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

test('the header stays a 24H comparison when a legacy fixed preset lacks a baseline',async()=>{
 const at=Date.now(),day=24*3600000,method=METHOD;
 const current={at,meme:4.25,altDelta:1.58,btcDelta:.62,method,coverage:COMPLETE};
 const prior={at:at-day,meme:8,altDelta:2,btcDelta:1,method,coverage:COMPLETE};
 for(const baseline of [null,{...prior,method:'fomo-most-held-v1'},{...prior,meme:null}]){
  const report={method,basket:[],readings:[...(baseline?[baseline]:[]),current]};
  await withMountedMarket(report,async({market,body,attributes})=>{
   const header=marketText(market.innerHTML),details=marketText(body.innerHTML);
   const title=marketText(market.innerHTML.match(/class="market-overview-title"[^>]*>([\s\S]*?)<\/span>/)[1]);
   assert.match(header,/Meme/);
   assert.match(header,/Meme\s+—/);
   assert.doesNotMatch(header,/current 1H|\+4\.25%/i);
   assert.doesNotMatch(title,/current 1H/i);
   assert.match(title,/24H/i);
   assert.match(details,/Current 1H:.*?Meme\s+\+4\.25%/i);
   assert.match(details,/(?:Meme\s+24H comparison|24H comparison.*?Meme).*?—/i);
   assert.match(attributes.get('aria-label'),/versus 24 hours ago/);
   assert.doesNotMatch(attributes.get('aria-label'),/current 1H|\+4\.25%/i);
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
  assert.match(marketText(market.innerHTML),/Meme\s+—/);
  const comparable={...report,readings:[{...prior,method,coverage:COMPLETE},current]};
  await refresh(comparable);
  const header=marketText(market.innerHTML);
  assert.match(header,/Meme\s+-3\.75 pp/);
  assert.doesNotMatch(header,/current 1H/i);
  assert.match(header,/Alt\s+-0\.42 pp/);
  assert.match(header,/Btc\s+-0\.38 pp/i);
  assert.match(marketText(body.innerHTML),/Current 1H:.*?Meme\s+\+4\.25%/i);
  await refresh(report);
  assert.match(marketText(market.innerHTML),/Meme\s+—/);
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
  ...[0,31,'01','1.5'].map(size=>({method:methodForSize(size),coverage:coverageForSize(Number(size))})),
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

test('manually edited presets render their actual member count, symbols, and equal weights',async()=>{
 const at=Date.now(),day=24*3600000;
 for(const size of [1,10,12,30]){
  const method=methodForSize(size),coverage=coverageForSize(size),basket=basketForSize(at,size);
  await withMountedMarket({method,basket,coverage,readings:[
   {at:at-day,meme:1,altDelta:2,btcDelta:1,method,coverage},
   {at,meme:4.25,altDelta:1,btcDelta:0,method,coverage}]},async({market,body})=>{
   const details=marketText(body.innerHTML);
   assert.match(marketText(market.innerHTML),/Meme\s+\+3\.25 pp/);
   assert.ok(details.includes(`Fixed ${size}-coin preset · equal weight · hourly`));
   assert.ok(details.includes(`${size}/${size} fresh qualified; 0 unavailable`));
   assert.ok(details.includes(`Each member carries 1/${size} weight (${(100/size).toFixed(2)}%)`));
   assert.ok(details.includes(`the arithmetic average of all ${size} one-hour USD price changes`));
   assert.ok(details.includes(`the manually managed fixed preset is ${basket.map(row=>row.symbol).join(', ')}`));
   const members=[...body.innerHTML.matchAll(/<li><strong>([^<]+)<\/strong>(.*?)<\/li>/g)];
   assert.deepEqual(members.map(match=>match[1]),basket.map(row=>row.symbol));
   assert.ok(members.every(match=>match[2].includes(`${(100/size).toFixed(2)}% weight`)));
   assert.match(details,/changes only through Admin/);
  });
 }
});

test('incomplete edited presets keep every member at 1/N and reject subset or mismatched coverage',async()=>{
 const at=Date.now(),day=24*3600000;
 for(const size of [10,12]){
  const method=methodForSize(size),basket=basketForSize(at,size);
  Object.assign(basket.at(-1),{priceChange1h:null,eligible:false,exclusionReason:'missing_quote'});
  const complete=coverageForSize(size);
  for(const coverage of [
   {...complete,includedTokens:size-1,excludedTokens:1,exclusions:{missing_quote:1}},
   coverageForSize(11)
  ]){
   await withMountedMarket({method,basket,coverage,readings:[
    {at:at-day,meme:1,altDelta:2,btcDelta:1,method,coverage:complete},
    {at,meme:4.25,altDelta:1,btcDelta:0,method,coverage}]},async({market,body})=>{
    assert.match(marketText(market.innerHTML),/Meme\s+—/);
    assert.match(marketText(market.innerHTML),/Alt\s+-1\.00 pp/);
    assert.match(marketText(body.innerHTML),/Incomplete preset data/);
    const members=[...body.innerHTML.matchAll(/<li><strong>([^<]+)<\/strong>(.*?)<\/li>/g)];
    assert.equal(members.length,size);
    assert.ok(members.every(match=>match[2].includes(`${(100/size).toFixed(2)}% weight`)));
    assert.match(members.at(-1)[2],/Unavailable: Quote unavailable/);
    if(coverage.totalTokens===size)assert.ok(marketText(body.innerHTML).includes(`${size-1}/${size} fresh qualified; 1 unavailable; complete Meme reading withheld`));
   });
  }
 }
});

test('adding or removing a member starts a new Meme baseline while benchmarks remain comparable',async()=>{
 const at=Date.now(),day=24*3600000;
 for(const size of [10,12]){
  const method=methodForSize(size),coverage=coverageForSize(size);
  const current={at,meme:4.25,altDelta:1.58,btcDelta:.62,method,coverage};
  const prior={at:at-day,meme:8,altDelta:2,btcDelta:1,method:METHOD,coverage:COMPLETE};
  assert.equal(compareReading([prior,current]).meme,null);
  await withMountedMarket({method,basket:basketForSize(at,size),readings:[prior,current]},async({market,body})=>{
   assert.match(marketText(market.innerHTML),/Meme\s+—/);
   assert.match(marketText(body.innerHTML),/Current 1H: Meme \+4\.25%/);
   assert.match(marketText(market.innerHTML),/Alt\s+-0\.42 pp/);
   assert.match(marketText(market.innerHTML),/Btc\s+-0\.38 pp/i);
   assert.match(marketText(body.innerHTML),/Awaiting fixed preset 24H baseline/);
   assert.match(marketText(body.innerHTML),/Only identical membership can share a 24H baseline/);
  });
 }
});

test('a saved preset awaiting its first collection keeps fresh real Alt/BTC comparisons',async()=>{
 const at=Date.now(),day=24*3600000,method=methodForSize(12);
 const readings=[
  {at:at-day,meme:8,altDelta:2,btcDelta:1,method:METHOD,coverage:COMPLETE},
  {at,meme:4.25,altDelta:1.58,btcDelta:.62,method:METHOD,coverage:COMPLETE}
 ];
 const basket=basketForSize(at,12).map(row=>({...row,priceChange1h:null,eligible:false,exclusionReason:'awaiting_collection'}));
 const report={method,basket,readings,coverage:{totalTokens:12,includedTokens:0,excludedTokens:12,exclusions:{awaiting_collection:12}}};
 await withMountedMarket(report,async({market,body,refresh})=>{
  const header=marketText(market.innerHTML),details=marketText(body.innerHTML);
  assert.match(header,/Meme\s+—/);
  assert.doesNotMatch(header,/\+4\.25%|-3\.75 pp|current 1H/i);
  assert.match(header,/Alt\s+-0\.42 pp/);
  assert.match(header,/Btc\s+-0\.38 pp/i);
  assert.match(details,/Fixed 12-coin preset/);
  assert.match(details,/0\/12 fresh qualified; 12 unavailable; complete Meme reading withheld/);
  assert.match(details,/Awaiting collection: 12/);
  assert.match(details,/Unavailable: Awaiting collection/);
  assert.match(details,/Current 1H: Meme — · Alt \+1\.58% · BTC \+0\.62%/);
  assert.match(details,/Alt\/BTC comparison: observed .*?baseline/);
  assert.doesNotMatch(body.innerHTML,/Meme histogram, Alt and BTC/);
  await refresh(report,true);
  assert.match(marketText(market.innerHTML),/Alt\s+—/);
  assert.match(marketText(market.innerHTML),/Btc\s+—/i);
  const stale=readings.map(row=>({...row,at:row.at-76*60000}));
  await refresh({...report,readings:stale});
  assert.match(marketText(market.innerHTML),/Alt\s+—/);
  assert.match(marketText(market.innerHTML),/Btc\s+—/i);
 });
});

test('changing the preset hash withholds Meme comparison and preserves the current full-preset reading',async()=>{
 const at=Date.now(),day=24*3600000,method=METHOD;
 const current={at,meme:4.25,altDelta:1.58,btcDelta:.62,method,coverage:COMPLETE};
 const prior={at:at-day,meme:8,altDelta:2,btcDelta:1,method:'fixed-preset-11-1h-v1-abcdef012345',coverage:COMPLETE};
 assert.equal(compareReading([prior,current]).meme,null);
 await withMountedMarket({method,basket:presetBasket(at),readings:[prior,current]},async({market,body})=>{
  const header=marketText(market.innerHTML),details=marketText(body.innerHTML);
  assert.match(header,/Meme\s+—/);
  assert.match(details,/Current 1H: Meme \+4\.25%/);
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
  assert.match(marketText(market.innerHTML),/Meme\s+—/);
  assert.match(marketText(body.innerHTML),/Current 1H: Meme \+91\.02%/);
  assert.match(marketText(market.innerHTML),/Alt\s+-0\.42 pp/);
  assert.match(marketText(market.innerHTML),/Btc\s+-0\.38 pp/);
  assert.match(marketText(body.innerHTML),/Alt\/BTC comparison: observed .*?baseline/);
  await refresh({method,basket:[],readings:[{...rows[0],at:at-day-76*60000},{...rows[1],at:at-76*60000},rows[2]]});
  assert.match(marketText(market.innerHTML),/Alt\s+—/);
  assert.match(marketText(market.innerHTML),/Btc\s+—/);
 });
});


function componentReport(at,size=2,warmingIndices=[]){
 const method=methodForSize(size),coverage=coverageForSize(size),basket=basketForSize(at,size),denominator=size-warmingIndices.length;
 const components=basket.map((member,index)=>{
  const currentObservedAt=at-60000,baselineObservedAt=currentObservedAt-24*3600000;
  const warming=warmingIndices.includes(index),firstAt=at-3600000,firstObservedAt=firstAt-60000;
  const comparison={id:`${member.chain}:${member.address}`,weight:warming?0:1/denominator,status:warming?'warming':'active',kind:warming?'added':'existing',addedAt:warming?firstAt:null,
   delta:warming?0:3,currentEligible:true,currentReturn:4,currentObservedAt,baselineReturn:warming?2:1,
   baselineObservedAt:warming?firstObservedAt:baselineObservedAt,baselineSource:warming?'initial-reference':'saved-h1',
   baselineWindowStartAt:warming?null:baselineObservedAt-3600000,baselineWindowEndAt:warming?null:baselineObservedAt,
   initialReturn:2,firstAt,firstObservedAt,warmUntil:warming?firstAt+24*3600000:null,reason:warming?'neutral_until_24h':null};
  Object.assign(member,{id:comparison.id,priceChange1h:4,observedAt:currentObservedAt,comparison});
  return comparison;
 });
 const memeComparison={method:'component-1h-vs24h-v3',at,denominator,value:denominator?components.reduce((sum,row)=>sum+row.delta,0)/denominator:null,
  matchedMembers:size-warmingIndices.length,warmingMembers:warmingIndices.length,awaitingHistoryMembers:0,unavailableMembers:0,components};
 const current={at,meme:4,altDelta:1,btcDelta:0,method,coverage,memeComparison};
 return {method,basket,coverage,readings:[current]};
}

function incumbentReport(at,size=11,warmingIndices=[],awaitingIndices){
 const report=componentReport(at,size,warmingIndices),row=report.readings[0],engine=row.memeComparison;
 const awaiting=new Set(awaitingIndices??engine.components.flatMap((component,index)=>component.status==='warming'?[]:[index]));
 for(const [index,component] of engine.components.entries())if(awaiting.has(index))Object.assign(component,{
  status:'awaiting_history',kind:'existing',addedAt:null,reason:'missing_24h_baseline',delta:null,
  baselineReturn:null,baselineObservedAt:null,baselineSource:null,baselineWindowStartAt:null,baselineWindowEndAt:null,warmUntil:null
 });
 Object.assign(engine,{value:null,matchedMembers:size-warmingIndices.length-awaiting.size,awaitingHistoryMembers:awaiting.size});
 const members=engine.components.filter(component=>component.status!=='warming');
 row.memeFallback={method:'incumbent-current-1h-v1',value:members.reduce((sum,component)=>sum+component.currentReturn,0)/size,
  memberIds:members.map(component=>component.id),denominator:size,excludedWarming:warmingIndices.length};
 return report;
}

test('existing members without genuine baselines never turn the header into a current 1H reading',async()=>{
 const at=Date.now(),report=incumbentReport(at),row=report.readings[0];
 report.readings.unshift({at:at-24*3600000,meme:50,altDelta:2,btcDelta:1,method:METHOD,coverage:COMPLETE});
 assert.equal(componentComparison(row,report.basket),null);
 await withMountedMarket(report,async({market,body,attributes})=>{
  const header=marketText(market.innerHTML),details=marketText(body.innerHTML);
  assert.match(header,/Meme\s+—/);
  assert.match(header,/1H DELTA · VS 24H AGO/);
  assert.doesNotMatch(header,/current 1H|\+4\.00%|\+0\.00 pp/i);
  assert.match(header,/Alt\s+-1\.00 pp/);
  assert.match(header,/Btc\s+-1\.00 pp/i);
  assert.match(details,/0\/11 matched historical baselines · 0 warming · 11 existing awaiting history/);
  assert.match(details,/Recovering 24H history/);
  assert.match(details,/Current 1H: Meme \+4\.00%/);
  assert.doesNotMatch(details,/Current 1H active|Initial reference copied|Neutral until|Warming members:/i);
  assert.match(attributes.get('aria-label'),/versus 24 hours ago/);
  assert.doesNotMatch(attributes.get('aria-label'),/current 1H|\+4\.00%/i);
  assert.deepEqual(memeComparisons([row],report.method,report.basket),[]);
 });
});

test('a warming addition cannot promote any current 1H fallback while existing history is missing',async()=>{
 const at=Date.now(),report=incumbentReport(at,12,[11]),row=report.readings[0],engine=row.memeComparison;
 for(const change of [-99,9000]){
  engine.components[11].currentReturn=change;
  row.meme=(11*4+change)/12;
  report.basket[11].priceChange1h=change;
  await withMountedMarket(report,async({market,body})=>{
   const header=marketText(market.innerHTML),details=marketText(body.innerHTML);
   assert.match(header,/Meme\s+—/);
   assert.doesNotMatch(header,/Meme · 1H|\+3\.67%|current 1H/i);
   assert.match(details,/11 existing awaiting history/);
   assert.match(details,/only newly added contracts copy their first observed 1H return/i);
  });
 }
});

test('obsolete fallback payloads are ignored for valid comparisons and unavailable historical evidence',async()=>{
 const at=Date.now();
 for(const fallback of [undefined,null,{method:'incumbent-current-1h-v1',value:4},
  {method:'incumbent-current-1h-v1',value:413378817666.74}, {method:'unknown',value:0}]){
  for(const report of [componentReport(at,11),incumbentReport(at)]){
   report.readings[0].memeFallback=fallback;
   await withMountedMarket(report,async({market})=>{
    const header=marketText(market.innerHTML);
    assert.match(header,report.readings[0].memeComparison.awaitingHistoryMembers?/Meme\s+—/:/Meme\s+\+3\.00 pp/);
    assert.doesNotMatch(header,/Meme · 1H|\+4\.00%|413\.38B|current 1H/i);
   });
  }
 }
});

test('invalid incumbent comparison evidence never falls back to the raw 1H mean',async()=>{
 const at=Date.now(),changes=[
  row=>{row.memeComparison.awaitingHistoryMembers--},
  row=>{row.memeComparison.components[0].delta=0},
  row=>{row.memeComparison.components[0].baselineReturn=4},
  row=>{row.memeComparison.components[0].warmUntil=at+24*3600000},
  row=>{row.memeComparison.components[0].kind='added';row.memeComparison.components[0].addedAt=at},
  row=>{row.memeComparison.components[0].currentObservedAt=at-15*60000},
  row=>{row.memeComparison.components[0].currentReturn=null},
  row=>{row.coverage={...row.coverage,includedTokens:10,excludedTokens:1}},
  row=>{row.memeComparison.value=0},
  row=>{row.memeComparison.method='component-1h-vs24h-v2'},
  row=>{row.memeComparison.denominator=10}
 ];
 for(const change of changes){
  const report=incumbentReport(at),row=report.readings[0];change(row);
  assert.equal(componentComparison(row,report.basket),null);
  report.readings.unshift({at:at-24*3600000,meme:1,altDelta:2,btcDelta:1,method:METHOD,coverage:COMPLETE});
  await withMountedMarket(report,async({market,body})=>{
   const header=marketText(market.innerHTML);
   assert.match(header,/Meme\s+—/);
   assert.doesNotMatch(header,/Meme · 1H|\+4\.00%|\+0\.00 pp/);
   assert.match(header,/Alt\s+-1\.00 pp/);
   assert.doesNotMatch(body.innerHTML,/Meme histogram, Alt and BTC/);
  });
 }
});

test('the former engine cannot neutralize the existing basket during rollout',async()=>{
 const at=Date.now(),report=componentReport(at,11,Array.from({length:11},(_,index)=>index));
 report.readings[0].memeComparison.method='component-1h-vs24h-v1';
 await withMountedMarket(report,async({market})=>{
  assert.match(marketText(market.innerHTML),/Meme\s+—/);
  assert.doesNotMatch(marketText(market.innerHTML),/\+0\.00 pp/);
 });
 const spoofed=componentReport(at,1,[0]);
 Object.assign(spoofed.readings[0].memeComparison.components[0],{kind:'existing',addedAt:null});
 assert.equal(componentComparison(spoofed.readings[0],spoofed.basket),null);
});

test('incumbents automatically return to percentage-point comparisons when actual baselines exist',async()=>{
 const at=Date.now(),report=incumbentReport(at,11);
 await withMountedMarket(report,async({market,refresh})=>{
  assert.match(marketText(market.innerHTML),/Meme\s+—/);
  await refresh(componentReport(at,11));
  assert.match(marketText(market.innerHTML),/Meme\s+\+3\.00 pp/);
  assert.doesNotMatch(marketText(market.innerHTML),/current 1H/i);
 });
});

test('component comparisons retain existing contracts across an addition and give a new warming member zero pp',async()=>{
 const at=Date.now(),day=24*3600000,report=componentReport(at,12,[11]);
 report.readings.unshift({at:at-day,meme:50,altDelta:2,btcDelta:1,method:METHOD,coverage:COMPLETE});
 await withMountedMarket(report,async({market,body,attributes})=>{
  const header=marketText(market.innerHTML),details=marketText(body.innerHTML);
  assert.match(header,/Meme\s+\+3\.00 pp/);
  assert.doesNotMatch(header,/current 1H/i);
  assert.match(header,/Alt\s+-1\.00 pp/);
  assert.match(details,/11\/12 matched historical baselines · 1 warming · 0 unavailable/);
  assert.match(details,/only newly added contracts copy their first observed 1H return and stay neutral until 24H/i);
  assert.match(details,/Initial reference copied from the first observed 1H return \+2\.00%/);
  assert.match(details,/this is not a historical baseline/i);
  assert.match(details,/24H warmup/);
  assert.match(details,/source: saved 1H observation/);
  assert.match(details,/Historical 1H window/);
  assert.doesNotMatch(details,/Only identical membership can share a 24H baseline/);
  assert.match(attributes.get('aria-label'),/Meme \+3\.00 pp/);
  const members=[...body.innerHTML.matchAll(/<li><strong>([^<]+)<\/strong>(.*?)<\/li>/g)];
  assert.equal(members.length,12);
  assert.ok(members.every(row=>row[2].includes('8.33% weight')));
  assert.match(members.at(-1)[2],/warming · neutral \+0\.00 pp/);
 });
 const removed=componentReport(at,10);
 removed.readings.unshift({at:at-day,meme:50,altDelta:2,btcDelta:1,method:METHOD,coverage:COMPLETE});
 await withMountedMarket(removed,async({market})=>assert.match(marketText(market.innerHTML),/Meme\s+\+3\.00 pp/));
});

test('an actual historical backfill activates immediately and a copied reference activates only after 24H',async()=>{
 const at=Date.now(),day=24*3600000;
 const recovered=componentReport(at,1),comparison=recovered.readings[0].memeComparison.components[0];
 Object.assign(comparison,{baselineSource:'gecko-5m-close',firstAt:at,firstObservedAt:at-60000,warmUntil:at+day});
 await withMountedMarket(recovered,async({market,body})=>{
  assert.match(marketText(market.innerHTML),/Meme\s+\+3\.00 pp/);
  assert.match(marketText(body.innerHTML),/1\/1 matched historical baselines · 0 warming/);
  assert.match(marketText(body.innerHTML),/source: Gecko 5-minute closes/);
 });
 const warming=componentReport(at-3600000,1,[0]);
 const firstAt=at-day,firstObservedAt=firstAt-60000;
 Object.assign(warming.readings[0].memeComparison.components[0],{firstAt,firstObservedAt,addedAt:firstAt,baselineObservedAt:firstObservedAt,warmUntil:at});
 await withMountedMarket(warming,async({market,body,refresh})=>{
  assert.match(marketText(market.innerHTML),/Meme\s+—/);
  assert.match(marketText(body.innerHTML),/1 warming/);
  const active=componentReport(at,1),item=active.readings[0].memeComparison.components[0];
  Object.assign(item,{firstAt,firstObservedAt,warmUntil:at,initialReturn:2,currentReturn:5,baselineReturn:2,delta:3});
  active.readings[0].meme=5;
  await refresh(active);
  assert.match(marketText(market.innerHTML),/Meme\s+\+3\.00 pp/);
  assert.match(marketText(body.innerHTML),/1\/1 matched historical baselines · 0 warming/);
  assert.doesNotMatch(marketText(body.innerHTML),/Warming members:/);
 });
});

test('malformed component arithmetic, identity, timing or provenance withholds Meme without a raw 1H fallback',async()=>{
 const at=Date.now(),day=24*3600000;
 const changes=[
  engine=>{engine.value=99},engine=>{engine.method='unknown'},engine=>{engine.at--},
  engine=>{engine.matchedMembers--},engine=>{engine.components.pop()},
  engine=>{engine.components[0].weight=.25},
  engine=>{engine.components[0].id=engine.components[1].id},
  engine=>{engine.components[0].id='solana:unrelated-contract'},
  engine=>{engine.components[0].baselineSource='initial-reference'},
  engine=>{engine.components[0].baselineWindowStartAt+=60000},
  engine=>{engine.components[0].baselineObservedAt-=11*60000;engine.components[0].baselineWindowEndAt-=11*60000;engine.components[0].baselineWindowStartAt-=11*60000},
  engine=>{engine.components[0].currentObservedAt=at-15*60000},
  engine=>{engine.components[0].currentReturn=10001},
  engine=>{engine.components={}},engine=>{engine.value=null}
 ];
 for(const change of changes){
  const report=componentReport(at),row=report.readings[0];change(row.memeComparison);
  report.readings.unshift({at:at-day,meme:1,altDelta:2,btcDelta:1,method:report.method,coverage:report.coverage});
  await withMountedMarket(report,async({market,body})=>{
   const header=marketText(market.innerHTML);
   assert.match(header,/Meme\s+—/);
   assert.doesNotMatch(header,/Meme · 1H|\+4\.00%|\+3\.00 pp/);
   assert.match(header,/Alt\s+-1\.00 pp/);
   assert.match(marketText(body.innerHTML),/Component comparison unavailable/);
   assert.doesNotMatch(body.innerHTML,/Meme histogram, Alt and BTC/);
  });
 }
 const nullEngine=componentReport(at);nullEngine.readings[0].memeComparison=null;
 await withMountedMarket(nullEngine,async({market})=>assert.match(marketText(market.innerHTML),/Meme\s+—/));
});

test('warming proof cannot invent zero from missing quotes or continue past its first collection plus 24H',()=>{
 const at=Date.now(),report=componentReport(at,2,[1]);
 assert.ok(componentComparison(report.readings[0],report.basket));
 for(const edit of [
  item=>{item.initialReturn=null},item=>{item.delta=1},item=>{item.baselineReturn=7},
  item=>{item.currentReturn=null},item=>{item.baselineWindowEndAt=item.firstObservedAt},
  item=>{item.firstAt=at-24*3600000;item.firstObservedAt=item.firstAt-60000;item.baselineObservedAt=item.firstObservedAt;item.warmUntil=at}
 ]){
  const invalid=structuredClone(report);edit(invalid.readings[0].memeComparison.components[1]);
  assert.equal(componentComparison(invalid.readings[0],invalid.basket),null);
 }
});

test('a mature baseline gap or current source gap withholds the comparison and never becomes a chart zero',async()=>{
 const at=Date.now(),day=24*3600000;
 for(const currentMissing of [false,true]){
  const report=componentReport(at,1),row=report.readings[0],engine=row.memeComparison,item=engine.components[0];
  Object.assign(item,{status:'unavailable',delta:null,reason:currentMissing?'source_unavailable':'actual_24h_baseline_unavailable',
   baselineReturn:null,baselineObservedAt:null,baselineSource:null,baselineWindowStartAt:null,baselineWindowEndAt:null});
  Object.assign(engine,{value:null,matchedMembers:0,warmingMembers:0,unavailableMembers:1});
  if(currentMissing){item.currentReturn=null;row.meme=null;row.coverage={totalTokens:1,includedTokens:0,excludedTokens:1,exclusions:{source_unavailable:1}}}
  report.readings.unshift({at:at-day,meme:1,altDelta:2,btcDelta:1,method:METHOD,coverage:COMPLETE});
  await withMountedMarket(report,async({market,body})=>{
   assert.match(marketText(market.innerHTML),/Meme\s+—/);
   assert.match(marketText(market.innerHTML),/Alt\s+-1\.00 pp/);
   assert.match(marketText(body.innerHTML),/24H comparison unavailable:/);
   assert.doesNotMatch(body.innerHTML,/Meme histogram, Alt and BTC/);
  });
  assert.deepEqual(memeComparisons([row],report.method,report.basket),[]);
 }
});

test('chart uses actual component comparisons without requiring a whole-basket baseline or Alt data',()=>{
 const at=Date.now(),report=componentReport(at,2,[1]),row=report.readings[0];
 const points=memeComparisons([row],report.method,report.basket);
 assert.deepEqual(points,[{at,meme:3,altDelta:null,btcDelta:null}]);
 const svg=chart(points,' pp');
 assert.match(svg,/Meme \+3\.00 pp/);
 assert.match(svg,/Alt —/);
 assert.doesNotMatch(svg,/NaN|undefined/);
 const old={at:at-25*3600000,meme:1,altDelta:2,btcDelta:1,method:report.method,coverage:report.coverage};
 const legacy={at:at-3600000,meme:3,altDelta:3,btcDelta:2,method:report.method,coverage:report.coverage};
 const mixed=memeComparisons([old,legacy,row],report.method,report.basket);
 assert.deepEqual(mixed.map(point=>point.meme),[2,3]);
 assert.deepEqual(mixed.map(point=>point.altDelta),[1,null]);
 assert.doesNotMatch(chart(mixed,' pp'),/NaN|undefined/);
});


test('a new warming member leaves all eleven incumbent deltas and weights unchanged',async()=>{
 const at=Date.now(),original=componentReport(at,11),edited=componentReport(at,12,[11]);
 const before=componentComparison(original.readings[0],original.basket),after=edited.readings[0].memeComparison;
 assert.equal(before.value,3);
 assert.equal(after.denominator,11);
 assert.deepEqual(after.components.slice(0,11).map(({id,delta,weight})=>({id,delta,weight})),
  before.components.map(({id,delta,weight})=>({id,delta,weight})));
 assert.equal(after.components[11].weight,0);
 for(const change of [-99,9000]){
  after.components[11].currentReturn=change;
  edited.basket[11].priceChange1h=change;
  edited.readings[0].meme=(11*4+change)/12;
  assert.equal(componentComparison(edited.readings[0],edited.basket)?.value,before.value);
  await withMountedMarket(edited,async({market})=>assert.match(marketText(market.innerHTML),/Meme\s+\+3\.00 pp/));
 }
});

test('an all-warming basket has no comparison rather than a manufactured zero',async()=>{
 const at=Date.now(),report=componentReport(at,2,[0,1]),row=report.readings[0];
 assert.equal(row.memeComparison.denominator,0);
 assert.equal(row.memeComparison.value,null);
 assert.ok(row.memeComparison.components.every(component=>component.weight===0));
 assert.equal(componentComparison(row,report.basket),null);
 assert.deepEqual(memeComparisons([row],report.method,report.basket),[]);
 await withMountedMarket(report,async({market,body})=>{
  assert.match(marketText(market.innerHTML),/Meme\s+—/);
  assert.doesNotMatch(marketText(market.innerHTML),/\+0\.00 pp|current 1H/i);
  assert.match(marketText(body.innerHTML),/2 new members warming/);
 });
});

test('real all-active v2 history remains chartable while old warming and current v2 rows stay withheld',async()=>{
 const at=Date.now(),report=componentReport(at,11),row=report.readings[0];
 row.memeComparison.method='component-1h-vs24h-v2';
 delete row.memeComparison.denominator;
 assert.equal(componentComparison(row,report.basket),null);
 assert.deepEqual(memeComparisons([row],report.method,report.basket),[{at,meme:3,altDelta:null,btcDelta:null}]);
 await withMountedMarket(report,async({market})=>assert.match(marketText(market.innerHTML),/Meme\s+—/));
 const warming=componentReport(at,12,[11]),old=warming.readings[0];
 old.memeComparison.method='component-1h-vs24h-v2';
 delete old.memeComparison.denominator;
 old.memeComparison.value=11*3/12;
 for(const component of old.memeComparison.components)component.weight=1/12;
 assert.deepEqual(memeComparisons([old],warming.method,warming.basket),[]);
});


test('a warming addition losing its current quote cannot interrupt eleven existing comparisons',async()=>{
 const at=Date.now(),report=componentReport(at,12,[11]),row=report.readings[0],item=row.memeComparison.components[11];
 Object.assign(item,{currentEligible:false,currentReturn:null,currentObservedAt:null});
 Object.assign(report.basket[11],{eligible:false,priceChange1h:null,observedAt:null,exclusionReason:'missing_quote'});
 row.meme=null;
 row.coverage=report.coverage={totalTokens:12,includedTokens:11,excludedTokens:1,exclusions:{missing_quote:1}};
 assert.equal(componentComparison(row,report.basket)?.value,3);
 assert.deepEqual(memeComparisons([row],report.method,report.basket),[{at,meme:3,altDelta:null,btcDelta:null}]);
 await withMountedMarket(report,async({market,body})=>{
  assert.match(marketText(market.innerHTML),/Meme\s+\+3\.00 pp/);
  assert.match(marketText(body.innerHTML),/1 new member warming/);
  assert.match(marketText(body.innerHTML),/11\/12 fresh qualified; 1 unavailable; complete raw 1H average withheld/);
  assert.match(marketText(body.innerHTML),/Current 1H: Meme —/);
 });
 for(const [currentReturn,currentObservedAt] of [[9000000,at-60000],[4,at-20*60000]]){
  Object.assign(item,{currentReturn,currentObservedAt});
  assert.equal(componentComparison(row,report.basket)?.value,3);
 }
 const invalid=structuredClone(report);
 invalid.readings[0].memeComparison.components[0].currentEligible=false;
 assert.equal(componentComparison(invalid.readings[0],invalid.basket),null);
});

test('a newly added token awaiting its first quote has zero weight without an invented initial reference',async()=>{
 const at=Date.now(),report=componentReport(at,12,[11]),row=report.readings[0],item=row.memeComparison.components[11];
 Object.assign(item,{status:'pending',reason:'awaiting_initial_quote',currentEligible:false,currentReturn:null,currentObservedAt:null,
  initialReturn:null,firstAt:null,firstObservedAt:null,warmUntil:null,baselineReturn:null,baselineObservedAt:null,
  baselineSource:null,baselineWindowStartAt:null,baselineWindowEndAt:null});
 Object.assign(report.basket[11],{eligible:false,priceChange1h:null,observedAt:null,exclusionReason:'missing_quote'});
 row.meme=null;
 row.coverage=report.coverage={totalTokens:12,includedTokens:11,excludedTokens:1,exclusions:{missing_quote:1}};
 assert.equal(componentComparison(row,report.basket)?.value,3);
 await withMountedMarket(report,async({market,body,refresh})=>{
  assert.match(marketText(market.innerHTML),/Meme\s+\+3\.00 pp/);
  assert.match(marketText(body.innerHTML),/1 new member awaiting initial quote/);
  assert.match(marketText(body.innerHTML),/Awaiting initial qualified quote · zero comparison weight/);
  assert.doesNotMatch(marketText(body.innerHTML),/Neutral until|Initial reference copied/);
  await refresh(componentReport(at,12,[11]));
  assert.match(marketText(market.innerHTML),/Meme\s+\+3\.00 pp/);
  assert.match(marketText(body.innerHTML),/1 new member warming/);
 });
 for(const edit of [
  item=>{item.initialReturn=4},item=>{item.firstAt=at},item=>{item.warmUntil=at+24*3600000},
  item=>{item.baselineReturn=0},item=>{item.currentEligible=true},item=>{item.kind='existing';item.addedAt=null},
  item=>{item.weight=1/12},item=>{item.delta=1}
 ]){
  const invalid=structuredClone(report);edit(invalid.readings[0].memeComparison.components[11]);
  assert.equal(componentComparison(invalid.readings[0],invalid.basket),null);
 }
});

test('component quote qualification and raw coverage remain independently truthful',()=>{
 const at=Date.now();
 for(const edit of [
  row=>{row.memeComparison.components[0].currentEligible=false},
  row=>{delete row.memeComparison.components[0].currentEligible},
  row=>{row.coverage.includedTokens=1;row.coverage.excludedTokens=1},
  row=>{row.meme=null},row=>{row.meme=99}
 ]){
  const report=componentReport(at,2),row=report.readings[0];edit(row);
  assert.equal(componentComparison(row,report.basket),null);
 }
});

function projectedMembership(sourceReport,selection,{configuredAt=sourceReport.readings.at(-1).at+1000,sameMethod=false}={}){
 const report=structuredClone(sourceReport),source=report.readings.at(-1),size=selection.length;
 const components=[],basket=[];
 for(const selected of selection){
  const index=typeof selected==='number'?selected:selected.index;
  const original=Number.isInteger(index)?report.basket[index]:null;
  const added=typeof selected==='object';
  const member=original?structuredClone(original):basketForSize(source.at,1)[0];
  if(!original)Object.assign(member,{id:'solana:contract-new',symbol:'NEW',address:'contract-new',pool:null,poolCreatedAt:null});
  const component=added?{
   id:basketIdForTest(member),weight:0,status:'pending',delta:0,kind:'added',addedAt:selected.addedAt??configuredAt,
   currentReturn:null,currentObservedAt:null,currentEligible:false,baselineReturn:null,baselineObservedAt:null,
   baselineSource:null,baselineWindowStartAt:null,baselineWindowEndAt:null,initialReturn:null,firstAt:null,
   firstObservedAt:null,warmUntil:null,reason:'awaiting_initial_quote'
  }:structuredClone(source.memeComparison.components[index]);
  if(added)Object.assign(member,{priceChange1h:null,observedAt:null,priceSource:null,pool:null,poolCreatedAt:null,eligible:false,exclusionReason:'awaiting_collection'});
  components.push(component);basket.push(member);
 }
 const denominator=components.filter(component=>!['pending','warming'].includes(component.status)).length;
 for(const [index,component] of components.entries()){
  component.weight=['pending','warming'].includes(component.status)||!denominator?0:1/denominator;
  Object.assign(basket[index],{rank:index+1,weight:1/size,comparison:structuredClone(component)});
 }
 const included=components.filter(component=>component.currentEligible).length;
 const coverage={totalTokens:size,includedTokens:included,excludedTokens:size-included,exclusions:included===size?{}:{awaiting_collection:size-included}};
 const engine={...structuredClone(source.memeComparison),components,denominator,
  matchedMembers:components.filter(component=>component.status==='active').length,
  warmingMembers:components.filter(component=>['warming','pending'].includes(component.status)).length,
  awaitingHistoryMembers:components.filter(component=>component.status==='awaiting_history').length,unavailableMembers:0};
 engine.value=engine.awaitingHistoryMembers||!denominator?null:components.reduce((sum,component)=>sum+(component.delta||0),0)/denominator;
 report.method=sameMethod?source.method:`fixed-preset-${size}-1h-v1-fedcba987654`;
 report.basket=basket;report.coverage=coverage;
 report.presetRevision='membership-revision-after-save';report.presetUpdatedAt=configuredAt;
 report.presetAdmissions=Object.fromEntries(components.map(component=>[component.id,{kind:component.kind,addedAt:component.addedAt}]));
 report.membershipProjection={sourceMethod:source.method,sourceAt:source.at,configuredAt,revision:report.presetRevision};
 report.membershipReading={...structuredClone(source),method:report.method,constituents:size,coverage,memeComparison:engine,
  meme:included===size?components.reduce((sum,component)=>sum+component.currentReturn,0)/size:null,
  membershipProjection:structuredClone(report.membershipProjection)};
 return report;
}
const basketIdForTest=member=>member.id||`${member.chain}:${member.address}`;
const projectedProof=report=>componentComparison(report.membershipReading,report.basket,false,report);

test('saving additions immediately preserves incumbent comparisons before the next collector finishes',async()=>{
 const at=Date.now()-60000,source=componentReport(at,11),before=structuredClone(source.readings);
 const report=projectedMembership(source,[...Array.from({length:11},(_,index)=>index),{}]);
 const proof=projectedProof(report);
 assert.equal(proof?.value,3);
 assert.equal(proof.denominator,11);
 assert.equal(proof.warmingMembers,1);
 assert.deepEqual(proof.components.slice(0,11),source.readings[0].memeComparison.components);
 assert.deepEqual(report.readings,before);
 assert.equal(componentComparison(report.membershipReading,report.basket),null,'a derived row requires its report proof');
 assert.deepEqual(memeComparisons(report.readings,report.method,report.basket),[{at,meme:3,altDelta:null,btcDelta:null}]);
 await withMountedMarket(report,async({market,body})=>{
  assert.match(marketText(market.innerHTML),/Meme\s+\+3\.00 pp/);
  assert.match(marketText(body.innerHTML),/11\/12 matched historical baselines · 0 warming · 1 awaiting initial quote/);
  assert.match(marketText(body.innerHTML),/Awaiting initial qualified quote · zero comparison weight/);
  assert.doesNotMatch(marketText(body.innerHTML),/Initial reference copied|Neutral until/);
 });
});

test('removal and reordering retain each contract baseline and only recompute contributing weights',async()=>{
 const at=Date.now()-60000,source=componentReport(at,3),engine=source.readings[0].memeComparison;
 for(const [index,component] of engine.components.entries()){
  component.baselineReturn=index;component.delta=4-index;
 }
 engine.value=3;
 const original=structuredClone(source.readings);
 for(const selection of [[0,2],[2,0,1]]){
  const report=projectedMembership(source,selection),proof=projectedProof(report);
  assert.ok(proof);
  assert.equal(proof.warmingMembers,0);
  assert.deepEqual(report.readings,original);
  for(const [index,sourceIndex] of selection.entries()){
   const {weight,...actual}=proof.components[index],{weight:oldWeight,...expected}=engine.components[sourceIndex];
   assert.deepEqual(actual,expected);
   assert.equal(weight,1/selection.length);
  }
  await withMountedMarket(report,async({market,body})=>{
   assert.match(marketText(market.innerHTML),/Meme\s+\+3\.00 pp/);
   assert.doesNotMatch(marketText(body.innerHTML),/new member.*?warming|Neutral until|Initial reference copied/);
  });
 }
 const different=projectedMembership(source,[0]);
 assert.equal(projectedProof(different)?.value,4);
 assert.deepEqual(memeComparisons(different.readings,different.method,different.basket),[{at,meme:3,altDelta:null,btcDelta:null}], 'the saved chart keeps its genuine original calculation');
});

test('a removed and re-added contract starts a new pending generation even when the roster method returns to the same hash',async()=>{
 const at=Date.now()-60000,source=componentReport(at,2),report=projectedMembership(source,[0,{index:1}],{sameMethod:true});
 assert.equal(report.method,source.method);
 assert.equal(report.membershipReading.at,at);
 const proof=projectedProof(report);
 assert.equal(proof?.value,3);
 assert.equal(proof.denominator,1);
 assert.equal(proof.components[0].baselineObservedAt,source.readings[0].memeComparison.components[0].baselineObservedAt);
 assert.equal(proof.components[1].status,'pending');
 assert.equal(proof.components[1].addedAt,report.presetUpdatedAt);
 assert.equal(proof.components[1].firstAt,null);
 assert.equal(proof.components[1].warmUntil,null);
 await withMountedMarket(report,async({market,body})=>{
  assert.match(marketText(market.innerHTML),/Meme\s+\+3\.00 pp/);
  const members=[...body.innerHTML.matchAll(/<li><strong>([^<]+)<\/strong>(.*?)<\/li>/g)];
  assert.match(members[0][2],/source: saved 1H observation/);
  assert.match(members[1][2],/Awaiting initial qualified quote/);
  assert.doesNotMatch(members[1][2],/source: saved 1H observation/);
 });
});

test('membership projection preserves an existing addition warmup clock and its recorded reference',()=>{
 const at=Date.now()-60000,source=componentReport(at,3,[2]);
 const report=projectedMembership(source,[2,0,{}]),proof=projectedProof(report);
 assert.ok(proof);
 const original=source.readings[0].memeComparison.components[2],retained=proof.components[0];
 assert.equal(retained.firstAt,original.firstAt);
 assert.equal(retained.firstObservedAt,original.firstObservedAt);
 assert.equal(retained.initialReturn,original.initialReturn);
 assert.equal(retained.warmUntil,original.warmUntil);
 assert.equal(proof.components[2].firstAt,null);
 assert.equal(proof.components[2].initialReturn,null);
 assert.equal(proof.components[2].warmUntil,null);
});

test('membership save time never refreshes an old comparison or adds a fabricated historical chart point',async()=>{
 const at=Date.now()-76*60000,source=componentReport(at,2),report=projectedMembership(source,[0,{}],{configuredAt:Date.now()-1000});
 assert.equal(projectedProof(report)?.value,3,'source proof remains valid at its actual observation time');
 assert.equal(report.membershipReading.at,at);
 assert.equal(report.membershipReading.memeComparison.at,at);
 assert.equal(report.readings.length,1);
 await withMountedMarket(report,async({market,body})=>{
  assert.match(marketText(market.innerHTML),/Meme\s+—/);
  assert.match(marketText(body.innerHTML),/Stale data/);
 });
});

test('invalid membership projection metadata, admission generations or altered evidence fail closed',async()=>{
 const at=Date.now()-60000,edits=[
  report=>{delete report.membershipProjection},
  report=>{delete report.membershipReading.membershipProjection},
  report=>{report.membershipProjection.revision='different'},
  report=>{report.presetRevision='different'},
  report=>{report.presetUpdatedAt++},
  report=>{report.membershipProjection.sourceAt++;report.membershipReading.membershipProjection.sourceAt++},
  report=>{report.membershipProjection.sourceMethod='fomo-most-held-v1';report.membershipReading.membershipProjection.sourceMethod='fomo-most-held-v1'},
  report=>{report.readings=[]},
  report=>{report.readings.push(structuredClone(report.readings[0]))},
  report=>{report.readings[0].memeComparison.method='component-1h-vs24h-v2'},
  report=>{report.readings[0].memeComparison.value=999},
  report=>{report.membershipReading.at++},
  report=>{report.membershipReading.memeComparison.at++},
  report=>{delete report.presetAdmissions},
  report=>{report.presetAdmissions[report.basket[0].id].kind='added'},
  report=>{report.membershipReading.memeComparison.components[0].baselineReturn=0;report.membershipReading.memeComparison.components[0].delta=4;report.membershipReading.memeComparison.value=4},
  report=>{report.membershipReading.memeComparison.components[0].currentObservedAt--},
  report=>{report.membershipReading.memeComparison.components[0].firstAt++},
  report=>{report.membershipReading.memeComparison.components[1].addedAt++;report.presetAdmissions[report.basket[1].id].addedAt++},
  report=>{report.membershipReading.memeComparison.components[1].currentReturn=4},
  report=>{report.membershipReading.memeComparison.components[1].initialReturn=4},
  report=>{report.membershipReading.memeComparison.components[1].firstAt=at},
  report=>{report.membershipReading.memeComparison.components[1].warmUntil=at+24*3600000},
  report=>{report.membershipReading.memeComparison.components[0].weight=.5},
  report=>{report.basket.reverse()},
  report=>{delete report.membershipReading.memeComparison}
 ];
 for(const edit of edits){
  const report=projectedMembership(componentReport(at,2),[0,{}]);edit(report);
  assert.equal(projectedProof(report),null);
  await withMountedMarket(report,async({market})=>assert.match(marketText(market.innerHTML),/Meme\s+—/));
 }
 const source=componentReport(at,2),report=projectedMembership(source,[0,{index:1}],{sameMethod:true});
 const pending=report.membershipReading.memeComparison.components[1],old=source.readings[0].memeComparison.components[1];
 Object.assign(pending,old,{weight:1/2});
 report.membershipReading.memeComparison.components[0].weight=1/2;
 report.membershipReading.memeComparison.matchedMembers=2;report.membershipReading.memeComparison.warmingMembers=0;
 report.membershipReading.memeComparison.denominator=2;report.membershipReading.meme=4;
 report.membershipReading.coverage=coverageForSize(2);
 assert.equal(projectedProof(report),null,'an old generation cannot reactivate after same-method remove and re-add');
});

test('a same-method masked report cannot reuse an old generation when source projection evidence is unavailable',async()=>{
 const at=Date.now()-60000,report=componentReport(at,2),row=report.readings[0];
 report.presetAdmissions=Object.fromEntries(row.memeComparison.components.map(component=>[component.id,{kind:component.kind,addedAt:component.addedAt}]));
 assert.equal(componentComparison(row,report.basket,false,report)?.value,3);
 await withMountedMarket(report,async({market,body,refresh})=>{
  assert.match(marketText(market.innerHTML),/Meme\s+\+3\.00 pp/);
  const masked=structuredClone(report),readded=masked.basket[1];
  masked.presetAdmissions[readded.id]={kind:'added',addedAt:at+1000};
  Object.assign(readded,{eligible:false,priceChange1h:null,observedAt:null,comparison:null,exclusionReason:'awaiting_collection'});
  assert.equal(componentComparison(masked.readings[0],masked.basket,false,masked),null);
  await refresh(masked);
  assert.match(marketText(market.innerHTML),/Meme\s+—/);
  assert.match(marketText(body.innerHTML),/Current 1H: Meme —/);
  assert.deepEqual(memeComparisons(masked.readings,masked.method,masked.basket),[{at,meme:3,altDelta:null,btcDelta:null}], 'genuine historical readings remain chartable');
  const legacy=structuredClone(masked);
  delete legacy.readings[0].memeComparison;
  legacy.readings.unshift({...legacy.readings[0],at:at-24*3600000,meme:1});
  await refresh(legacy);
  assert.match(marketText(market.innerHTML),/Meme\s+—/);
  assert.match(marketText(body.innerHTML),/Current 1H: Meme —/);
 });
});

test('removing an unavailable member restores surviving comparisons using genuine saved evidence',async()=>{
 const at=Date.now()-60000,source=componentReport(at,2),row=source.readings[0],unavailable=row.memeComparison.components[1];
 Object.assign(unavailable,{status:'unavailable',delta:null,currentEligible:false,currentReturn:null,currentObservedAt:null,
  baselineReturn:null,baselineObservedAt:null,baselineSource:null,baselineWindowStartAt:null,baselineWindowEndAt:null,
  reason:'source_unavailable'});
 Object.assign(source.basket[1],{eligible:false,priceChange1h:null,observedAt:null,comparison:structuredClone(unavailable),exclusionReason:'source_unavailable'});
 Object.assign(row.memeComparison,{value:null,matchedMembers:1,unavailableMembers:1});
 row.meme=null;row.coverage=source.coverage={totalTokens:2,includedTokens:1,excludedTokens:1,exclusions:{source_unavailable:1}};
 const report=projectedMembership(source,[0]);
 assert.equal(componentComparison(row,source.basket),null,'the incomplete original comparison remains unavailable');
 assert.equal(projectedProof(report)?.value,3);
 assert.equal(projectedProof(report).matchedMembers,1);
 await withMountedMarket(report,async({market,body})=>{
  assert.match(marketText(market.innerHTML),/Meme\s+\+3\.00 pp/);
  assert.match(marketText(body.innerHTML),/1\/1 matched historical baselines · 0 warming · 0 unavailable/);
  assert.doesNotMatch(body.innerHTML,/Meme histogram, Alt and BTC/, 'an unavailable original reading does not become a fabricated historical chart point');
 });
 for(const edit of [
  invalid=>{invalid.readings[0].memeComparison.components[1].delta=0},
  invalid=>{invalid.readings[0].memeComparison.components[1].baselineReturn=1},
  invalid=>{invalid.readings[0].memeComparison.value=3},
  invalid=>{invalid.readings[0].memeComparison.unavailableMembers=0}
 ]){
  const invalid=structuredClone(report);edit(invalid);assert.equal(projectedProof(invalid),null);
 }
});
