import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSharedFeed} from '../dist/shared-feed.mjs';
import {snapshotView} from '../worker/snapshot-view.mjs';

const now=1800000000000;
test('Tweet reads one shared snapshot with original source times, including failures',async()=>{
 const snapshot={lastRun:now,revision:'r',articles:[{time:now-1000,publisher:'Decrypt'}],
  tweetCoins:[{id:'solana:a',network:'solana',fetchedAt:now-2000,marketHistory:[{}]},
   {id:'solana:expired',network:'solana',fetchedAt:now-86400001}],
  feeds:{news_decrypt:{lastSuccess:now-1000},solana_trending:{lastSuccess:now-2000,error:'HTTP 429'}}};
 const calls=[];
 const report=await loadSharedFeed(async url=>{calls.push(url);return {ok:true,json:async()=>snapshotView(snapshot,'tweet',[],now)}},now);
 assert.deepEqual(calls,['/api/new-coins?view=tweet']);
 assert.equal(report.coins.length,1);assert.equal('marketHistory' in report.coins[0],false);
 assert.equal(report.coins[0].fetchedAt,now-2000);
 assert.equal(report.sources.get('decrypt').status,'loaded');
 assert.equal(report.sources.get('solana').status,'failed');
 assert.equal(report.sources.get('solana').at,now-2000);
 assert.equal(report.sources.get('base').status,'failed');
});
test('Shared feed treats old samples as stale even after a successful HTTP response',async()=>{
 const report=await loadSharedFeed(async()=>({ok:true,json:async()=>({articles:[],coins:[],feeds:{solana_trending:{lastSuccess:now-600001}}})}),now);
 assert.equal(report.sources.get('solana').status,'failed');
 await assert.rejects(loadSharedFeed(async()=>({ok:false,status:503})),/503/);
});
