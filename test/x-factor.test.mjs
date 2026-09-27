import test from 'node:test';
import assert from 'node:assert/strict';
import {xFactorReading,xFactorBadge,xFactorDetail} from '../dist/x-factor.mjs';

const now=1_800_000_000_000;
const id='solana:Contract123';
const report={version:1,status:'connected',coins:{[id]:{
 score:72,delta6h:16,uniqueAccounts6h:43,posts6h:58,keyInteractions6h:2,sampledAt:now-8*60_000,
 posts:[{url:'https://x.com/account/status/12345',author:'@account',reason:'Exact contract mention'}],
}}};

test('X Factor shows a fresh measured score and its evidence',()=>{
 assert.equal(xFactorReading(report,id,now).status,'ready');
 assert.match(xFactorBadge(report,id,now),/X Factor <strong>72<\/strong>/);
 assert.match(xFactorDetail(report,id,now),/43/);
 assert.match(xFactorDetail(report,id,now),/https:\/\/x.com\/account\/status\/12345/);
});

test('X Factor withholds stale and disconnected numbers',()=>{
 assert.equal(xFactorReading(report,id,now+31*60_000).status,'stale');
 assert.doesNotMatch(xFactorBadge(report,id,now+31*60_000),/>72</);
 assert.equal(xFactorReading({version:1,status:'disconnected',coins:report.coins},id,now).status,'disconnected');
});

test('X Factor rejects unsafe post links and escapes supplied text',()=>{
 const malicious={...report,coins:{[id]:{...report.coins[id],posts:[
  {url:'javascript:alert(1)',author:'bad'},
  {url:'https://x.com/account/status/12345',author:'<script>alert(1)</script>'},
 ]}}};
 const html=xFactorDetail(malicious,id,now);
 assert.doesNotMatch(html,/javascript:/);
 assert.doesNotMatch(html,/<script>/);
 assert.match(html,/&lt;script&gt;/);
});
