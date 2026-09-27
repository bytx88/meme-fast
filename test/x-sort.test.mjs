import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {collectXSort,summarizeTheme,postTime,FRESH_MS,STALE_MS} from '../worker/x-sort.mjs';
import {renderXSort} from '../dist/x-sort.mjs';

const now=Date.parse('2026-09-27T12:00:00Z');
const idFor=(time,sequence)=>String((BigInt(time-1288834974657)<<22n)+BigInt(sequence));
const post=(sequence,text,time=now-60_000)=>({id:idFor(time,sequence),text,created_at:new Date(now).toISOString()});

test('X Sort counts only recent matching posts and escapes rendered evidence',()=>{
 const theme={id:'x-money',name:'X payments',query:'xMoney',terms:['xmoney']};
 const report=summarizeTheme(theme,{data:[post(123,'xMoney <script>'),post(123,'xMoney duplicate'),post(124,'unrelated'),post(125,'xMoney old',now-5*24*60*60_000)]},now);
 assert.equal(report.posts24h,1);
 assert.equal(postTime(post(123,'xMoney').id),now-60_000);
 assert.match(renderXSort({status:'connected',themes:[report],sampledAt:now}),/&lt;script&gt;/);
 assert.doesNotMatch(renderXSort({status:'connected',themes:[report],sampledAt:now}),/<script>/);
});

test('X Sort reuses the four-hour server cache and serves stale after a failed refresh',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'x-sort-'));
 try{
  const filename=path.join(dir,'report.json');let calls=0,fail=false;
  const fetcher=async()=>{calls++;return fail?{ok:false,status:429}:{ok:true,json:async()=>({data:[post(calls,'xMoney e/acc stock pairing tokenized stocks')]})}};
  const first=await collectXSort({filename,key:'test',fetcher,now});
  assert.equal(first.cacheStatus,'fresh');assert.equal(calls,4);
  const cached=await collectXSort({filename,key:'test',fetcher,now:now+FRESH_MS-1});
  assert.equal(cached.cacheStatus,'fresh');assert.equal(calls,4);
  fail=true;
  const stale=await collectXSort({filename,key:'test',fetcher,now:now+FRESH_MS+1});
  assert.equal(stale.cacheStatus,'stale');assert.equal(calls,5);
  const cooled=await collectXSort({filename,key:'test',fetcher,now:now+FRESH_MS+60_000});
  assert.equal(cooled.cacheStatus,'stale');assert.equal(calls,5);
  const expired=await collectXSort({filename,key:'test',fetcher,now:now+STALE_MS+1});
  assert.equal(expired.status,'error');
 }finally{await rm(dir,{recursive:true,force:true})}
});
