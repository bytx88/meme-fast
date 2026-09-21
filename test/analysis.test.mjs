import test from 'node:test';
import assert from 'node:assert/strict';
import {groupTransactions,filterTrades,flowTimeline} from '../dist/analysis.mjs';
import {normalizeTrade,summarize} from '../dist/core.mjs';
import {loadListings} from '../dist/data.mjs';
const now=Date.parse('2026-09-21T12:00:00Z');
const row=(id,side,usd,time=now-1000,network='base',hash='0xABC')=>({id,side,usd,time,network,hash,wallet:'0xWallet'});

test('Grouping preserves opposite swap steps and separates chains and missing hashes',()=>{
  const rows=[row('a','buy',78),row('b','sell',82),row('c','sell',12,now,'eth'),row('d','buy',4,now,'base',''),row('e','buy',5,now,'base','')];
  const groups=groupTransactions(rows),mixed=groups.find(g=>g.network==='base'&&g.hash);
  assert.equal(groups.length,4);assert.equal(mixed.rows.length,2);assert.equal(mixed.buy,78);assert.equal(mixed.sell,82);
  assert.equal(groups.reduce((s,g)=>s+g.buy-g.sell,0),summarize(rows,60,now).net);
});
test('Filters match individual steps, retain EVM case-insensitivity and Solana case',()=>{
  const rows=[row('a','buy',78),row('b','sell',82),{...row('c','buy',100),wallet:'AbCsolWallet'}];
  assert.deepEqual(filterTrades(rows,{side:'buy',min:80}).map(t=>t.id),['c']);
  assert.equal(filterTrades(rows,{wallet:'0xWALLET'}).length,2);
  assert.equal(filterTrades(rows,{wallet:'abcsol'}).length,0);
  assert.equal(filterTrades(rows,{wallet:'AbCsol'}).length,1);
  assert.equal(rows.length,3);
});
test('Timeline includes window boundaries exactly once and reconciles to observed net',()=>{
  const rows=[row('a','buy',100,now-5*60000),row('b','sell',80,now-4*60000),row('c','sell',40,now),row('old','buy',999,now-5*60000-1),row('future','buy',999,now+1)];
  const result=flowTimeline(rows,5,now);
  assert.equal(result.bins.length,5);assert.equal(result.bins[0].buy,100);assert.equal(result.bins[1].sell,80);assert.equal(result.bins.at(-1).cumulative,-20);
  assert.equal(result.bins.reduce((s,b)=>s+b.count,0),3);assert.equal(result.bins.at(-1).cumulative,summarize(rows,5,now).net);
  assert.equal(flowTimeline(rows,1440,now).bins.length,24);
});
test('Quantity and implied execution price follow the selected token on either side',()=>{
  const attributes={from_token_address:'USD',to_token_address:'TOKEN',from_token_amount:'50',to_token_amount:'200',volume_in_usd:'50',block_timestamp:new Date(now).toISOString()};
  const buy=normalizeTrade({id:'a',attributes},'TOKEN',{}),sell=normalizeTrade({id:'a',attributes},'USD',{});
  assert.equal(buy.quantity,200);assert.equal(buy.price,.25);assert.equal(sell.quantity,50);assert.equal(sell.price,1);
  assert.equal(normalizeTrade({id:'a',attributes:{...attributes,to_token_amount:undefined}},'TOKEN',{}).quantity,null);
});
test('A completed pool is emitted before the next pool finishes, with immutable snapshots',async()=>{
  let release,started;const waiting=new Promise(r=>started=r),deferred=new Promise(r=>release=r),snapshots=[];
  const token={network:'base',address:'0xAAA'};
  const pools=['first','slow'].map(address=>({attributes:{address,name:'MEME / USD'},relationships:{base_token:{data:{id:'base_0xAAA'}}}}));
  const pending=loadListings([token],async path=>{
    if(path.includes('/tokens/'))return {data:pools};
    if(path.includes('/slow/')){started();await deferred}
    return {data:[{id:path,attributes:{from_token_address:'USD',to_token_address:'0xAAA',volume_in_usd:'30',block_timestamp:new Date(now).toISOString()}}]};
  },()=>{},()=>true,s=>snapshots.push(s));
  await waiting;
  const partial=snapshots.at(-1);assert.equal(partial.trades.length,1);assert.equal(partial.pools.filter(p=>p.status==='loaded').length,1);assert.equal(partial.pools[1].status,'pending');
  release();const result=await pending;assert.equal(result.trades.length,2);assert.equal(partial.pools[1].status,'pending');
});
test('A canceled load cannot publish a late pool result',async()=>{
  let active=true,release,started;const waiting=new Promise(r=>started=r),deferred=new Promise(r=>release=r),snapshots=[];
  const pending=loadListings([{network:'base',address:'0xAAA'}],async path=>{
    if(path.includes('/tokens/'))return {data:[{attributes:{address:'pool'},relationships:{base_token:{data:{id:'base_0xAAA'}}}}]};
    started();await deferred;return {data:[]};
  },()=>{},()=>active,s=>snapshots.push(s));
  await waiting;const count=snapshots.length;active=false;release();assert.equal(await pending,null);assert.equal(snapshots.length,count);
});
