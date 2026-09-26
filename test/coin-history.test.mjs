import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeCoins,mergeRadarCoins,RETENTION_MS,collect,refreshMarket,recordMarketHistory} from '../worker/coin-collector.mjs';
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
 assert.equal(mergeCoins(first,[{...coin,poolCreated:now+60000}],now+2000)[0].poolCreated,now);
 assert.equal(updated[0].liquidity,100);
 assert.equal(mergeCoins([{...first[0],image_url:'https://cdn.example/coin.png'}],[{...coin,image_url:null}],now+2000)[0].image_url,'https://cdn.example/coin.png');
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
 const [updated]=refreshMarket([coin],[{chainId:'solana',pairAddress:'pool',baseToken:{address:'ABC'},info:{imageUrl:'https://cdn.example/coin.png'},priceUsd:'0.004',liquidity:{usd:9000},volume:{m5:700,h24:12000},txns:{m5:{buys:8,sells:3},h24:{buys:90,sells:70}},priceChange:{h24:12}}],5000);
 assert.equal(updated.liquidity,9000);assert.equal(updated.volume5m,700);assert.equal(updated.buys5m,8);assert.equal(updated.sells5m,3);assert.equal(updated.marketUpdatedAt,5000);assert.equal(updated.image_url,'https://cdn.example/coin.png');
 assert.equal(updated.priceUsd,0.004);
});
test('market refresh keeps the last known metric when the live pair omits it',()=>{
 const coin={id:'solana:ABC',network:'solana',contract_address:'ABC',liquidity:4000,volume:8000,priceUsd:0.004,priceUpdatedAt:4000};
 const [updated]=refreshMarket([coin],[{chainId:'solana',baseToken:{address:'ABC'},liquidity:{usd:null},volume:{m5:0},txns:{m5:{buys:0,sells:0}}}],5000);
 assert.equal(updated.liquidity,4000);assert.equal(updated.volume,8000);assert.equal(updated.volume5m,0);
 assert.equal(updated.priceUsd,0.004);
 assert.equal(recordMarketHistory([updated],5000)[0].marketHistory[0].priceUsd,null);
});
test('market samples include only successful refreshes and remain bounded',()=>{
 const now=1800000000000;
 const fresh={id:'solana:ABC',marketUpdatedAt:now,priceUpdatedAt:now,priceUsd:0.004,liquidity:9000,volume5m:700,buys5m:8,sells5m:3,volume:12000,
  marketHistory:[{at:now-5*3600000,volume5m:10},{at:now-5*60000,volume5m:400}],marketHistoryHourly:[{at:now-RETENTION_MS-1},{at:now-2*3600000}]};
 const [updated]=recordMarketHistory([fresh],now);
 assert.deepEqual(updated.marketHistory.map(row=>row.volume5m),[400,700]);
 assert.equal(updated.recentVolume1h,1100);
 assert.equal(updated.marketHistory.at(-1).priceUsd,0.004);
 assert.equal(updated.marketHistoryHourly.length,2);
 assert.equal(updated.marketHistoryHourly.at(-1).at,now);
 const [unchanged]=recordMarketHistory([{...updated,marketUpdatedAt:now-60000}],now);
 assert.deepEqual(unchanged.marketHistory,updated.marketHistory);
 assert.deepEqual(unchanged.marketHistoryHourly,updated.marketHistoryHourly);
 assert.equal(unchanged.recentVolume1h,1100);
 assert.equal(recordMarketHistory([{...unchanged,marketHistory:[{at:now-61*60000,volume5m:400}]}],now)[0].recentVolume1h,0);
});
test('Radar accepts older trending pools without changing Coin intake and retains observed history',()=>{
 const now=1800000000000;
 const older={id:'solana:old',network:'solana',contract_address:'old',poolCreated:now-30*86400000,liquidity:40000,volume:200000};
 assert.equal(mergeCoins([],[older],now).length,0);
 const [first]=mergeRadarCoins([],[older],[],now);
 first.marketHistory=[{at:now,volume5m:1000}];
 const [again]=mergeRadarCoins([first],[],[],now+3600000);
 assert.deepEqual(again.marketHistory,first.marketHistory);
 assert.equal(again.firstSeenRadarAt,now);
 assert.equal(mergeRadarCoins([again],[],[],now+RETENTION_MS+1).length,0);
});
test('tracked CASHED remains in a full Radar universe',()=>{
 const now=1800000000000;
 const previous=Array.from({length:200},(_,i)=>({id:`base:0x${i.toString(16).padStart(40,'0')}`,network:'base',contract_address:`0x${i.toString(16).padStart(40,'0')}`,liquidity:4000,lastSeenRadarAt:now-1000}));
 const cash={id:'robinhood:0x6249519883b8d7ccf915dfcd6c0442984dae9d24',network:'robinhood',contract_address:'0x6249519883b8d7ccf915dfcd6c0442984dae9d24',liquidity:201900,volume:5500000};
 const result=mergeRadarCoins(previous,[cash],[],now);
 assert.equal(result.length,200);
 assert.equal(result[0].id,cash.id);
});
test('collector fetches tracked Robinhood CASHED into Radar only',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'meme-robinhood-')),file=path.join(dir,'coins.json');
 const contract='0x6249519883b8d7ccf915dfcd6c0442984dae9d24',now=1800000000000;
 const payload={data:[{attributes:{address:'0x'+'a'.repeat(64),pool_created_at:new Date(now-7*86400000).toISOString(),reserve_in_usd:'201900',volume_usd:{h24:'5500000',m5:'2270'},transactions:{h24:{buys:100,sells:80},m5:{buys:8,sells:3}}},relationships:{base_token:{data:{id:'robinhood_cashed'}}}}],included:[{id:'robinhood_cashed',type:'token',attributes:{address:contract,name:'Cashed Money',symbol:'CASHED'}}]};
 const json=data=>({ok:true,json:async()=>data});
 const fetcher=async url=>{
  if(url.includes(`/networks/robinhood/tokens/${contract}/pools`))return json(payload);
  if(url.includes('/networks/')&&(url.includes('/new_pools')||url.includes('/trending_pools')))return json({data:[],included:[]});
  if(url.includes('dexscreener.com/tokens/v1/'))return json([]);
  if(url.includes('token-profiles/latest/v1'))return json([]);
  return {ok:false,status:404};
 };
 try{
  const snapshot=await collect(file,{now,fetcher});
  const coin=snapshot.radarCoins.find(coin=>coin.contract_address===contract);
  assert.equal(snapshot.coins.length,0);
  assert.equal(coin.chain,'Robinhood Chain');
  assert.equal(coin.marketHistory.length,1);
  assert.equal(snapshot.feeds.robinhood_tracked.error,null);
 }finally{await rm(dir,{recursive:true,force:true})}
});
