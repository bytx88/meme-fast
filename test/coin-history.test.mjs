import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeCoins,RETENTION_MS,collect,refreshMarket} from '../worker/coin-collector.mjs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('five-day history survives missing pools; repeat sightings do not reset expiry',()=>{
 const now=1800000000000;
 const coin={id:'solana:one',poolCreated:now,liquidity:4000,buys:5,sells:0};
 const first=mergeCoins([],[coin],now);
 first[0].savedContext={kind:'web',web:{snippet:'Story'}};
 assert.deepEqual(mergeCoins(first,[],now+1000),first);
 const updated=mergeCoins(first,[{...coin,liquidity:100}],now+2000);
 assert.equal(updated[0].firstSeen,now);
 assert.equal(updated[0].liquidity,100);
 assert.deepEqual(updated[0].savedContext,first[0].savedContext);
 assert.equal(mergeCoins(updated,[],now+RETENTION_MS).length,0);
 assert.equal(mergeCoins(updated,[coin],now+RETENTION_MS).length,0);
});
test('collector persists failures without erasing saved coins and prunes expired ones',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'meme-history-')),file=path.join(dir,'coins.json');
 try{
  const now=Date.now();
  const {writeFile}=await import('node:fs/promises');
  await writeFile(file,JSON.stringify({coins:[{id:'kept',firstSeen:now-1000,savedContext:{kind:'web'}},{id:'expired',firstSeen:now-RETENTION_MS}],feeds:{solana:{lastSuccess:now-1000}}}));
  const snapshot=await collect(file,{now,fetcher:async()=>{throw new Error('offline')}});
  assert.deepEqual(snapshot.coins.map(c=>c.id),['kept']);
  assert.equal(snapshot.feeds.solana.lastSuccess,now-1000);
  assert.equal(snapshot.feeds.solana.error,'offline');
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')),snapshot);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('market refresh updates retained contracts with short-window activity and a real timestamp',()=>{
 const coin={id:'solana:ABC',network:'solana',contract_address:'ABC',liquidity:4000,fetchedAt:1};
 const [updated]=refreshMarket([coin],[{chainId:'solana',pairAddress:'pool',baseToken:{address:'ABC'},liquidity:{usd:9000},volume:{m5:700,h24:12000},txns:{m5:{buys:8,sells:3},h24:{buys:90,sells:70}},priceChange:{h24:12}}],5000);
 assert.equal(updated.liquidity,9000);assert.equal(updated.volume5m,700);assert.equal(updated.buys5m,8);assert.equal(updated.sells5m,3);assert.equal(updated.marketUpdatedAt,5000);
});
test('market refresh keeps the last known metric when the live pair omits it',()=>{
 const coin={id:'solana:ABC',network:'solana',contract_address:'ABC',liquidity:4000,volume:8000};
 const [updated]=refreshMarket([coin],[{chainId:'solana',baseToken:{address:'ABC'},liquidity:{usd:null},volume:{m5:0},txns:{m5:{buys:0,sells:0}}}],5000);
 assert.equal(updated.liquidity,4000);assert.equal(updated.volume,8000);assert.equal(updated.volume5m,0);
});
