import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {selectTargets,searchQuery,summarizePosts,searchTarget,searchTargetXFlux,collectXFactor} from '../worker/x-factor-collector.mjs';

const id='solana:So11111111111111111111111111111111111111112';
const now=1_800_000_000_000;
const HOUR=60*60_000;
const target={id,contract:id.split(':')[1],aliases:['e/acc'],keyHandles:['creator']};

test('target selection keeps configured contracts ahead of market volume',()=>{
 const other='base:0x1111111111111111111111111111111111111111';
 const targets=selectTargets({coins:[{id:other,buyers:900},{id,buyers:1}]},{targets:[target]},1);
 assert.equal(targets[0].id,id);
 assert.match(searchQuery(targets[0]),/"e\/acc"/);
});

test('measured score uses independent accounts, a prior six-hour window and creator posts',()=>{
 const payload={data:[
  {id:'101',author_id:'u1',created_at:new Date(now-HOUR).toISOString(),text:`${target.contract} hello`,public_metrics:{like_count:30,retweet_count:5,reply_count:2}},
  {id:'102',author_id:'u2',created_at:new Date(now-2*HOUR).toISOString(),text:'e/acc update',public_metrics:{like_count:5}},
  {id:'103',author_id:'u1',created_at:new Date(now-7*HOUR).toISOString(),text:`${target.contract} earlier`,public_metrics:{like_count:1}},
  {id:'104',author_id:'u3',created_at:new Date(now-HOUR).toISOString(),text:'unrelated',public_metrics:{like_count:100000}},
 ],includes:{users:[{id:'u1',username:'creator'},{id:'u2',username:'observer'},{id:'u3',username:'other'}]}};
 const row=summarizePosts(target,[payload],now);
 assert.equal(row.uniqueAccounts6h,2);
 assert.equal(row.posts6h,2);
 assert.equal(row.keyInteractions6h,1);
 assert.ok(row.score>0);
 assert.ok(row.delta6h<row.score);
 assert.match(row.posts[0].url,/^https:\/\/x\.com\/creator\/status\/101$/);
});

test('search withholds a score when its page cap leaves posts unobserved',async()=>{
 const fetcher=async url=>{
  assert.equal(url.searchParams.get('post.fields'),'created_at,public_metrics');
  return {ok:true,json:async()=>({data:[],meta:{next_token:'more',result_count:0}})};
 };
 await assert.rejects(searchTarget(target,'secret',fetcher,now),/page cap/);
});

test('XFlux sample measures identified authors and withholds missing identities',async()=>{
 const sample={data:[{id:'101',text:target.contract,author:{username:'creator'},created_at:new Date(now-HOUR).toISOString(),public_metrics:{like_count:5,retweet_count:2,reply_count:1}}]};
 const fetcher=async url=>{
  assert.equal(url.host,'www.xfluxapi.com');
  assert.match(url.searchParams.get('q'),/e\/acc/);
  return {ok:true,json:async()=>sample};
 };
 const row=await searchTargetXFlux(target,'key',fetcher,now);
 assert.equal(row.uniqueAccounts6h,1);
 assert.equal(row.source,'xflux');
 sample.data[0].created_at=new Date(now+30_000).toISOString();
 assert.equal((await searchTargetXFlux(target,'key',fetcher,now)).posts6h,1);
 sample.data[0].author={};
 await assert.rejects(searchTargetXFlux(target,'key',fetcher,now),/omitted post, author/);
 sample.data=[];
 await assert.rejects(searchTargetXFlux(target,'key',fetcher,now),/no search evidence/);
});

test('collector writes a contract-keyed report and disconnects without a token',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'meme-x-factor-'));
 try{
  const snapshotFile=path.join(directory,'coins.json'),outputFile=path.join(directory,'x-factor.json');
  const secondId='base:0x1111111111111111111111111111111111111111';
  await writeFile(snapshotFile,JSON.stringify({coins:[{id,buyers:10},{id:secondId,buyers:9}]}));
  const fetcher=async()=>({ok:true,json:async()=>({data:[],meta:{result_count:0}})});
  const connected=await collectXFactor({snapshotFile,outputFile,provider:'official',token:'test',fetcher,now});
  assert.equal(connected.status,'connected');
  assert.equal(connected.coverage.targeted,2);
  assert.equal(connected.coins[id].score,0);
  assert.equal(JSON.parse(await readFile(outputFile,'utf8')).coins[id].posts6h,0);
  const limited=await collectXFactor({snapshotFile,outputFile,provider:'official',token:'test',fetcher,now,targetLimit:1});
  assert.equal(limited.coverage.targeted,1);
  assert.deepEqual(Object.keys(limited.coins),[id]);
  const disconnected=await collectXFactor({snapshotFile,outputFile,token:'',fetcher,now});
  assert.equal(disconnected.status,'disconnected');
  assert.equal(JSON.parse(await readFile(outputFile,'utf8')).status,'disconnected');
 }finally{await rm(directory,{recursive:true,force:true})}
});
