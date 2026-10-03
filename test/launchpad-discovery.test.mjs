import test from 'node:test';
import assert from 'node:assert/strict';
import {collectLaunchpad,mergeCoins,refreshLaunchpad,refreshMarket} from '../worker/coin-collector.mjs';
import {discoverLaunchpads} from '../worker/pool-discovery.mjs';
import {stageFor} from '../dist/coin-stages.mjs';
const now=1800000000000,address='A'.repeat(32),other='C'.repeat(32),pool='B'.repeat(32);
const token={id:`solana_${address}`,type:'token',attributes:{address,symbol:'CURVE',name:'Curve',launchpad_details:{graduation_percentage:94,completed:false}}};
const poolRow={id:`solana_${pool}`,type:'pool',attributes:{address:pool,pool_created_at:new Date(now-4*86400000).toISOString(),reserve_in_usd:'9500',volume_usd:{h24:'92000',m5:'400'},transactions:{h24:{buys:200,sells:100},m5:{buys:3,sells:2}}},relationships:{base_token:{data:{id:token.id}}}};
test('scheduled launchpad discovery sweeps older pools and rotates pages without a browser',async()=>{
 const runs=[];
 for(const time of [now,now+300000]){
  const calls=[],feeds={};
  const rows=await discoverLaunchpads(async url=>{calls.push(new URL(url));return Response.json({data:[poolRow],included:[token]})},time,feeds);
  assert.equal(calls.length,6);assert.equal(feeds.launchpad_pools.status,'ok');
  assert.equal(mergeCoins([],rows,time).length,1);
  runs.push(calls.filter(u=>u.pathname.includes('pump-fun')).map(u=>Number(u.searchParams.get('page'))));
 }
 assert(runs.every(p=>p.includes(1)));
 assert.deepEqual([...new Set(runs.flat())].sort((a,b)=>a-b),[1,2,3,4,5,6,7,8,9]);
});
test('active older curves receive extra checks and exact pool liquidity after missing Dex liquidity',async()=>{
 const newest=Array.from({length:120},(_,i)=>({id:`solana:new${i}`,network:'solana',contract_address:`new${i}`,firstSeen:now-i}));
 const old={id:`solana:${address}`,network:'solana',contract_address:address,firstSeen:now-86400000,poolCreated:now-4*86400000,pool,liquidity:null,volume:92000};
 const launchPool={...old,liquidity:9500,launchpadSource:'pump-fun'},calls=[];
 const launch=await collectLaunchpad([...newest,old],async url=>{
  calls.push(url);return Response.json({data:url.includes(address)?[token]:[],included:[poolRow]});
 },now,{}, {launchPools:[launchPool]});
 assert(calls[0].includes(address));assert(launch.checked.has(old.id));assert(calls.every(u=>u.endsWith('?include=top_pools')));
 assert.equal(launch.pools.length,1);assert.equal(launch.pools[0].contract_address,address);
 let coins=refreshMarket([old], [{chainId:'solana',baseToken:{address},pairAddress:pool,volume:{h24:92000,m5:400}}],now);
 coins=mergeCoins(coins,launch.pools,now);
 coins=refreshLaunchpad(coins,launch.tokens,now);
 assert.equal(coins[0].liquidity,9500);assert.equal(coins[0].volume5m,400);assert.equal(stageFor(coins[0]),'stretch');
 assert.equal(coins[0].firstSeen,old.firstSeen);
 const impostor={...old,id:`solana:${other}`,contract_address:other};
 assert.equal(refreshLaunchpad([impostor],launch.tokens,now)[0].launchpad,undefined);
});
test('unavailable dedicated feeds report failure rather than claiming zero curves',async()=>{
 const feeds={};assert.deepEqual(await discoverLaunchpads(async()=>{throw Error('offline')},now,feeds),[]);
 assert.equal(feeds.launchpad_pools.error,'offline');
});
