import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {collect,contextArticleIndex} from '../worker/coin-collector.mjs';
import {addressMatches} from '../dist/public-radar.mjs';

const solana='Ab'.repeat(20),evm='0x'+'aB'.repeat(20);
const article=(id,fields={})=>({id,title:'Token news',summary:'Reported development',url:`https://example.com/${id}`,...fields});

test('prepared context preserves exact address matching, article order and duplicate occurrences',()=>{
 const repeated=article('repeated',{title:`${solana} ${solana}`,summary:`${evm} ${evm.toLowerCase()}`});
 const articles=[
  article('url',{url:`https://example.com/token/${solana}`}),
  repeated,
  article('case',{title:solana.toLowerCase(),summary:evm.toLowerCase()}),
  article('boundary',{title:`${solana}AAAAAA`,summary:`prefix${evm} ${evm}f ${evm}_`}),
  article('title',{title:evm,summary:solana}),
  repeated,
 ];
 const index=contextArticleIndex(articles);
 const solCoin={chain:'Solana',contract_address:solana};
 const evmCoin={chain:'Base',contract_address:evm};
 for(const coin of [solCoin,{...solCoin,contract_address:solana.toLowerCase()},evmCoin,
  {...evmCoin,chain:'Robinhood Chain',contract_address:evm.toLowerCase()}]){
  assert.deepEqual(index.exact(coin),articles.filter(row=>addressMatches({posts:[row]},[coin]).length));
 }
 assert.deepEqual(index.exact(solCoin).map(row=>row.id),['url','repeated','title','repeated']);
 assert.deepEqual(index.exact(evmCoin).map(row=>row.id),['repeated','case','title','repeated']);
 assert.equal(index.exact(solCoin)[0],articles[0],'the selected source article is retained');
 assert.deepEqual(index.exact({chain:'Solana',contract_address:'Cd'.repeat(20)}),[]);
});

test('prepared related context retains full-name substring and whole-ticker rules without URL matches',()=>{
 const articles=[
  article('name',{title:'Super Inuyasha returns'}),
  article('ticker',{summary:'The SUPER-meme community grows'}),
  article('embedded',{summary:'superstar is unrelated'}),
  article('url',{url:'https://example.com/super-inu/SUPER'}),
  article('short',{title:'SI and Inu'}),
 ];
 const index=contextArticleIndex(articles);
 for(const coin of [{name:'Super Inu',symbol:'SUPER'},{name:'SI',symbol:'INU'},
  {name:'STAR',symbol:'SUPER-MEME'},{name:'unmatched',symbol:'super'}]){
  const name=coin.name.toLowerCase(),symbol=coin.symbol.toLowerCase();
  const expected=articles.filter(row=>{
   const text=(row.title+' '+row.summary).toLowerCase();
   return name.length>=4&&text.includes(name)||symbol.length>=4&&text.split(/[^a-z0-9]+/).includes(symbol);
  });
  assert.deepEqual(index.related(coin),expected);
 }
 assert.deepEqual(index.related({name:'Super Inu',symbol:'SUPER'}).map(row=>row.id),['name','ticker']);
 assert.deepEqual(index.related({name:'SI',symbol:'INU'}),[]);
});

test('collector retains context precedence, first two source articles and lookup timestamps',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'meme-context-')),filename=path.join(directory,'coins.json');
 const now=Date.now(),checked=now-7*3600000,saved={kind:'web',web:{snippet:'Saved source'}};
 const coin=(network,address,name,symbol,extra={})=>({id:`${network}:${address}`,network,
  chain:network==='solana'?'Solana':'Base',contract_address:address,name,symbol,firstSeen:now-3600000,...extra});
 const exact=coin('solana',solana,'Exact','EXACT',{savedContext:saved,contextCheckedAt:checked});
 const profile=coin('base',evm,'Profile','PROF',{contextCheckedAt:checked});
 const related=coin('solana','Cd'.repeat(20),'Related mascot','RLT',{contextCheckedAt:checked});
 const preserved=coin('solana','Ef'.repeat(20),'Saved mascot','SAVED',{savedContext:saved,contextCheckedAt:checked});
 const unresolved=coin('solana','Gh'.repeat(20),'Unknown mascot','UNKN',{contextCheckedAt:checked});
 const items=[
  {title:`${solana} exact first`,link:'https://decrypt.co/first'},
  {title:'Exact second',description:solana,link:'https://decrypt.co/second'},
  {title:'Exact third',description:solana,link:'https://decrypt.co/third'},
  {title:'Related mascot and Profile',link:'https://decrypt.co/related'},
  {title:'Saved mascot',link:'https://decrypt.co/saved'},
 ].map(row=>({...row,pubDate:new Date(now-1000).toISOString()}));
 const tokenProfile={chainId:'base',tokenAddress:evm.toLowerCase(),description:'Exact-contract profile',icon:'https://cdn.example.com/profile.png'};
 const json=value=>({ok:true,json:async()=>value});
 try{
  await writeFile(filename,JSON.stringify({coins:[exact,profile,related,preserved,unresolved],
   radarCoins:[{...exact,lastSeenRadarAt:now-1000,liquidity:4000}],feeds:{}}));
  const snapshot=await collect(filename,{now,fetcher:async url=>{
   if(url.includes('token-profiles/latest/v1'))return json([tokenProfile]);
   if(url.includes('rss2json.com'))return json({status:'ok',items:url.includes('decrypt.co')?items:[]});
   if(url.includes('/networks/'))return json({data:[],included:[]});
   if(url.includes('dexscreener.com/tokens/v1/'))return json([]);
   return {ok:false,status:404};
  }});
  const rows=new Map(snapshot.coins.map(row=>[row.id,row]));
  assert.deepEqual(rows.get(exact.id).savedContext.articles.map(row=>row.url),['https://decrypt.co/first','https://decrypt.co/second']);
  assert.equal(rows.get(exact.id).savedContext.kind,'verified');
  assert.deepEqual(rows.get(profile.id).savedContext,{kind:'verified',profile:tokenProfile});
  assert.equal(rows.get(profile.id).image_url,tokenProfile.icon);
  assert.equal(rows.get(related.id).savedContext.kind,'rss');
  assert.equal(rows.get(related.id).savedContext.articles[0].url,'https://decrypt.co/related');
  assert.deepEqual(rows.get(preserved.id).savedContext,saved);
  for(const row of [exact,profile,related,preserved])assert.equal(rows.get(row.id).contextCheckedAt,checked);
  assert.equal(rows.get(unresolved.id).contextCheckedAt,now);
  assert.equal(rows.get(unresolved.id).contextError,'Context source unavailable');
  assert.deepEqual(snapshot.radarCoins[0].savedContext,rows.get(exact.id).savedContext);
  assert.equal(snapshot.radarCoins[0].contextCheckedAt,checked);
 }finally{await rm(directory,{recursive:true,force:true})}
});
