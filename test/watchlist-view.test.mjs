import test from 'node:test';
import assert from 'node:assert/strict';
import {watchlistView} from '../worker/watchlist-view.mjs';

test('saved-token view returns only requested snapshot stats without histories',()=>{
 const now=1800000000000,id='robinhood:0x'+'a'.repeat(40);
 const coin={id,name:'CASHED',network:'robinhood',priceUsd:0.005,liquidity:200000,volume:5000000,lastSeenRadarAt:now,marketHistory:[{at:now}],savedContext:{story:'Long narrative'}};
 const snapshot={lastRun:now,radarCoins:[coin,{...coin,id:'robinhood:other'}],coins:[]};
 const result=watchlistView(snapshot,[id.toUpperCase()],now);
 assert.equal(result.coins.length,1);
 assert.equal(result.coins[0].priceUsd,0.005);
 assert.equal(result.coins[0].volume,5000000);
 assert.equal('marketHistory' in result.coins[0],false);
 assert.equal('savedContext' in result.coins[0],false);
 assert.equal(result.lastRun,now);
});

test('saved-token view keeps Solana contract case and bounds the request',()=>{
 const now=1800000000000,id='solana:AbCd';
 const snapshot={lastRun:now,radarCoins:[{id,lastSeenRadarAt:now}],coins:[]};
 assert.equal(watchlistView(snapshot,['solana:abcd'],now).coins.length,0);
 assert.throws(()=>watchlistView(snapshot,[],now),RangeError);
 assert.throws(()=>watchlistView(snapshot,Array(31).fill(id),now),RangeError);
});
