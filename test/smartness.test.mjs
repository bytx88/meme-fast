import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeSmartness} from '../dist/smartness.mjs';
const now=1792310000000;
const registry=[{address:'a',name:'A',source:'Nansen',interested:true},{address:'b',name:'B',source:'Manual',interested:false},{address:'c',name:'C',source:'Manual',interested:true}];
const event=(id,address,mint,side,quoteAmount,extra={})=>({id,address,mint,side,quoteAmount:String(quoteAmount),quantity:'5',quote:'USDC',time:now-1000,...extra});
const events=[event('1','a','X','buy',20),event('2','a','X','sell',5),event('3','b','X','sell',30),event('4','b','Y','buy',10),event('sol','a','X','buy',99,{quote:'SOL'}),event('old','a','X','buy',999,{time:now-2*86400000})];
test('wallet/token totals reconcile in one quote and window; duplicates do not inflate flow',()=>{
 const result=summarizeSmartness({events:[...events,events[0]]},registry,{quote:'USDC'},now);
 assert.deepEqual(result.total,{buy:30,sell:35,net:-5,buyCount:2,sellCount:2});
 assert.equal(result.wallets.find(r=>r.address==='a').net,15);
 assert.equal(result.tokens.find(r=>r.mint==='X').buyers.size,1);
 assert.equal(result.tokens.find(r=>r.mint==='X').sellers.size,2);
 assert.equal(result.wallets.reduce((n,r)=>n+r.buy,0),result.tokens.reduce((n,r)=>n+r.buy,0));
});
test('cohort and cross-drill filters consistently apply to wallet and token views',()=>{
 const result=summarizeSmartness({events},registry,{quote:'USDC',interested:'yes',source:'Nansen',wallet:'a',token:'X'},now);
 assert.equal(result.total.buy,20);assert.equal(result.total.sell,5);assert.equal(result.tokens.length,1);assert.equal(result.wallets.length,1);
});
test('net selling ranks negative flow first and longer windows include retained history',()=>{
 const result=summarizeSmartness({events},registry,{quote:'USDC',rank:'out',minutes:10080},now);
 assert.equal(result.wallets[0].address,'b');assert.equal(result.total.buy,1029);
});
test('future, unregistered, invalid and zero flows never enter rankings',()=>{
 const bad=[event('future','a','X','buy',10,{time:now+1}),event('unknown','z','X','buy',10),event('bad','a','X','buy','NaN'),event('zero','a','X','buy',0)];
 const result=summarizeSmartness({events:bad},registry,{quote:'USDC'},now);
 assert.equal(result.events.length,0);assert.equal(result.tokens.length,0);assert.equal(result.wallets.length,3);
});

test('token drill-down shows participating wallets, and unscanned members do not outrank trades',()=>{
 const token=summarizeSmartness({events},registry,{quote:'USDC',token:'X'},now);
 assert.deepEqual(new Set(token.wallets.map(row=>row.address)),new Set(['a','b']));
 const one=summarizeSmartness({events:[events[0]]},registry,{quote:'USDC',rank:'out'},now);
 assert.equal(one.wallets[0].address,'a');
});
