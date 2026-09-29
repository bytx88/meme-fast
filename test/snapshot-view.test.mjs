import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotView,snapshotVersion,readSnapshotVersion,versionFile} from '../worker/snapshot-view.mjs';
import {feedStatus,coverageFor,validateSnapshot} from '../worker/snapshot-contract.mjs';
import {sourceCoverageNote} from '../dist/source-coverage.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const now=1800000000000;
const coin={id:'solana:ABC',network:'solana',contract_address:'ABC',firstSeen:now-1000,marketHistory:[{at:now}],marketHistoryHourly:[],priceHistory5m:[]};
const radar={...coin,lastSeenRadarAt:now};
const snapshot={version:2,revision:`${now}:2`,lastRun:now,coins:[coin,{...coin,id:'solana:old',contract_address:'old',firstSeen:now-6*86400000}],radarCoins:[radar],feeds:{}};

test('Snapshot views have bounded, matching shapes and expose a lightweight revision',()=>{
 assert.deepEqual(snapshotVersion(snapshot),{revision:`${now}:2`,lastRun:now});
 const snipe=snapshotView(snapshot,'coin',[],now);
 assert.equal(snipe.coins.length,1);assert.equal('marketHistory' in snipe.coins[0],false);assert.equal('radarCoins' in snipe,false);
 assert.deepEqual(snipe.coins[0].flowSamples,[{at:now,volume5m:null,buys5m:null,sells5m:null,liquidity:null}]);
 const hodl=snapshotView(snapshot,'radar',[],now);
 assert.equal(hodl.coins.length,0);assert.equal(hodl.radarCoins.length,1);
 assert.equal(snapshot.coins[0].marketHistory.length,1);
});

test('Snipe competition projection includes retained Swing identities without histories or expired records',()=>{
 const fresh={...radar,id:'base:shared',name:'Shared',symbol:'SH',liquidity:123,marketUpdatedAt:now,firstSeenRadarAt:now-2000};
 const projected=snapshotView({...snapshot,coins:[{...coin,name:'Shared',symbol:'SH'}],radarCoins:[fresh,{...fresh,id:'base:old',lastSeenRadarAt:now-6*86400000}]},'coin',[],now);
 assert.equal(projected.competitionCoins.length,1);
 assert.equal(projected.competitionCoins[0].name,'Shared');
 assert.equal(projected.competitionCoins[0].firstSeenRadarAt,now-2000);
 assert.equal(projected.competitionCoins[0].liquidity,123);
 assert.equal('marketHistory' in projected.competitionCoins[0],false);
 assert.equal('flowSamples' in projected.competitionCoins[0],false);
});

test('Snipe returns only the selected window while preserving five-day totals',()=>{
 const earlier={...coin,id:'solana:earlier',firstSeen:now-2*3600000,name:'Shared',symbol:'SH'};
 const recent={...coin,name:'Shared',symbol:'SH'};
 const oneHour=snapshotView({...snapshot,coins:[recent,earlier]},'coin',[],now,'',1);
 assert.deepEqual(oneHour.coins.map(c=>c.id),[recent.id]);
 assert.equal(oneHour.retainedTotal,2);
 assert.deepEqual(oneHour.competitionCoins.map(c=>c.id),[earlier.id]);
 assert.equal(snapshotView({...snapshot,coins:[recent,earlier]},'coin',[],now,'',120).coins.length,2);
 assert.throws(()=>snapshotView(snapshot,'coin',[],now,'',2),/supported Snipe/);
 assert.deepEqual(snapshotView(snapshot,'health',[],now),{revision:snapshot.revision,lastRun:now,feeds:{}});
});

test('Name projection returns only retained same-name contracts from both feeds',()=>{
 const snipe={...coin,name:' Yee ',symbol:'YEE',liquidity:123},swing={...radar,id:'base:B',network:'base',contract_address:'B',name:'Yee',symbol:'OTHER',lastSeenRadarAt:now,image_url:'https://example.test/b.png'};
 const other={...coin,id:'solana:other',name:'Yee Too'};
 const projected=snapshotView({...snapshot,coins:[snipe,other,{...snipe,id:'solana:expired',firstSeen:now-6*86400000}],radarCoins:[swing,{...swing,id:'base:expired',lastSeenRadarAt:now-6*86400000}]},'name',[],now,' yee ');
 assert.equal(projected.coins.length,1);assert.equal(projected.coins[0].id,snipe.id);
 assert.equal(projected.competitionCoins.length,1);assert.equal(projected.competitionCoins[0].id,swing.id);
 assert.equal(projected.competitionCoins[0].image_url,swing.image_url);
 assert.equal('radarCoins' in projected,false);assert.equal('marketHistory' in projected.coins[0],false);
 assert.throws(()=>snapshotView(snapshot,'name',[],now,''),/token name/);
});

test('Source status retains the last successful sample and reports current failures',()=>{
 const old=feedStatus({},now-1000,{records:7});
 const failed=feedStatus(old,now,{error:'offline'});
 assert.equal(failed.lastAttempt,now);assert.equal(failed.lastSuccess,now-1000);assert.equal(failed.records,7);
 assert.equal(coverageFor({market:failed}).sources.market.error,'offline');
 assert.equal(coverageFor({market:failed}).sampling.swapTradesPerPool,300);
 assert.match(sourceCoverageNote({coverage:coverageFor({dex_market:failed})}),/dex market.*coverage may be incomplete/);
 assert.equal(validateSnapshot(snapshot),snapshot);
 assert.throws(()=>validateSnapshot({...snapshot,coins:[{...coin,id:'base:ABC'}]}),/identity/);
});

test('A damaged revision sidecar falls back to the snapshot',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'meme-version-')),file=path.join(dir,'coins.json');
 try{
  await writeFile(file,JSON.stringify(snapshot));
  await writeFile(versionFile(file),'bad json');
  assert.deepEqual(await readSnapshotVersion(file,async()=>snapshot),snapshotVersion(snapshot));
 }finally{await rm(dir,{recursive:true,force:true})}
});
