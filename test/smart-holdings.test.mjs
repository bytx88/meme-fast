import test from 'node:test';
import assert from 'node:assert/strict';
import {balanceChange,completeSamples,chartSeries,renderHoldingsChart} from '../dist/smart-holdings.mjs';
const now=1800000000000;
const report={decimals:6,samples:[{time:now-86400000,balance:10,walletBalances:['10000000']},{time:now,balance:12,walletBalances:['12000000'],priceUSD:.002}]};

test('historical change needs a genuine nearby baseline and fresh current data',()=>{
  assert.equal(balanceChange(report,1440,null,now),2);
  assert.equal(balanceChange(report,1440,0,now),2);
  assert.equal(balanceChange(report,10080,null,now),null);
  assert.equal(balanceChange(report,1440,null,now+660000),null);
  assert.equal(balanceChange({...report,samples:[{...report.samples[0],time:now-86400000-660000},report.samples[1]]},1440,null,now),null);
});

test('partial observations stay chart gaps and cannot produce false aggregate changes',()=>{
  const partial={...report,samples:[report.samples[0],{...report.samples[1],balance:null,walletBalances:[null]}]};
  assert.equal(balanceChange(partial,1440,null,now),null);
  assert.equal(balanceChange(partial,1440,0,now),null);
  assert.equal(completeSamples(partial,1440,now).length,1);
  assert.equal(chartSeries(partial,1440,now).length,2);
});

test('available raw balances yield an explicitly partial subset, including measured zero',()=>{
 const partial={decimals:6,wallets:[{},{}],samples:[{time:now,balance:null,walletBalances:['1200000',null]}]};
 const points=chartSeries(partial,1440,now);
 assert.equal(points[0].partialBalance,1.2);assert.equal(points[0].partialWallets,1);assert.equal(points[0].totalWallets,2);
 assert.equal(partial.samples[0].partialBalance,undefined);
 assert.equal(completeSamples(partial,1440,now).length,0);
 assert.equal(chartSeries({...partial,samples:[{...partial.samples[0],walletBalances:['0',null]}]},1440,now)[0].partialBalance,0);
});

function element(tag){return {tag,attributes:{},children:[],clientWidth:900,append(...items){this.children.push(...items)},replaceChildren(){this.children=[]},setAttribute(key,value){this.attributes[key]=String(value)}}}
function chart(samples){const old=globalThis.document;globalThis.document={createElementNS:(_,tag)=>element(tag)};try{const host=element('div');renderHoldingsChart(host,samples,1440,now);return host.children[0]}finally{globalThis.document=old}}

test('first holdings snapshot draws axes and real dots without inventing a past line',()=>{
  const svg=chart([report.samples[1]]);
  assert.equal(svg.children.filter(node=>node.tag==='circle').length,2);
  assert.equal(svg.children.filter(node=>node.tag==='path'&&node.attributes.stroke==='#ffc400').length,0);
  assert.ok(svg.children.some(node=>node.tag==='text'&&node.textContent==='Token balance'));
});

test('partial subsets draw hollow evidence marks without a misleading trend line',()=>{
 const points=[{time:now-300000,balance:null,partialBalance:3,partialWallets:1,totalWallets:3},{time:now,balance:null,partialBalance:7,partialWallets:2,totalWallets:3}];
 const svg=chart(points);
 assert.equal(svg.children.filter(n=>n.tag==='circle'&&n.attributes.stroke==='#ffc400'&&n.attributes.fill==='none').length,2);
 assert.equal(svg.children.filter(n=>n.tag==='path').length,0);
 assert.ok(svg.children.some(n=>n.tag==='text'&&n.textContent==='Observed subset · partial'));
});

test('completed rolling collections connect across progress checks but not expired cycles',()=>{
 const first={time:now-1200000,balance:10,source:'rolling-collection'};
 const partial={time:now-600000,balance:null,source:'rolling-collection'};
 const last={time:now,balance:11,source:'rolling-collection'};
 const gold=svg=>svg.children.filter(n=>n.tag==='path'&&n.attributes.stroke==='#ffc400');
 assert.equal(gold(chart([first,partial,last])).length,1);
 assert.equal(gold(chart([{...first,time:now-3000000},last])).length,0);
});

test('chart connects measured balances but breaks across failed checks and long gaps',()=>{
  const point={time:now-600000,balance:10,priceUSD:.002};
  const next={time:now-300000,balance:11,priceUSD:.003};
  const gold=svg=>svg.children.filter(node=>node.tag==='path'&&node.attributes.stroke==='#ffc400');
  assert.equal(gold(chart([point,next])).length,1);
  assert.equal(gold(chart([point,{time:now-450000,balance:null},next])).length,0);
  assert.equal(gold(chart([{...point,time:now-1200000},next])).length,0);
});

test('historical price line uses hourly closes without inventing five-minute prices',()=>{
  const samples=[{time:now-3600000,balance:10,priceUSD:.001,source:'rpc-reconstructed'},
    {time:now-3300000,balance:11,priceUSD:null,source:'rpc-reconstructed'},
    {time:now,balance:12,priceUSD:.002,source:'rpc-reconstructed'}];
  const grey=chart(samples).children.filter(node=>node.tag==='path'&&node.attributes.stroke==='#718695');
  assert.equal(grey.length,1);
});

test('a full thirty-day backfill renders paths without thousands of DOM nodes',()=>{
  const samples=Array.from({length:8640},(_,i)=>({time:now-(8639-i)*300000,balance:i,priceUSD:i%12===0?.001:null,source:'rpc-reconstructed'}));
  assert.ok(chart(samples).children.length<40);
});
