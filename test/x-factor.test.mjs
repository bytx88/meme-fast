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
 assert.equal(xFactorReading({version:1,status:'error',coins:{}},id,now).status,'error');
 assert.match(xFactorDetail({version:1,status:'error',coins:{}},id,now),/collection failed/);
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

test('RSS signal shows indexed mentions without claiming an X score',()=>{
 const rss={version:1,status:'connected',source:'google-news-rss',coins:{[id]:{
  posts6h:7,previousPosts6h:3,sampledAt:now-5*60_000,
  posts:[{url:'https://news.google.com/rss/articles/ABC123?oc=5',title:'UsePaid post'},
   {url:'javascript:alert(1)',title:'unsafe'}],
 }}};
 assert.equal(xFactorReading(rss,id,now).status,'rss');
 assert.match(xFactorBadge(rss,id,now),/X RSS <strong>7<\/strong>/);
 const detail=xFactorDetail(rss,id,now);
 assert.match(detail,/7 indexed X posts/);
 assert.match(detail,/no author, like, or repost measurement/);
 assert.match(detail,/news.google.com\/rss\/articles\/ABC123/);
 assert.doesNotMatch(detail,/javascript:/);
 assert.equal(xFactorReading(rss,id,now+31*60_000).status,'stale');
});
