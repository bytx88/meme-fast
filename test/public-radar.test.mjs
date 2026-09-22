import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePools,parseNews,FEEDS,NETWORKS,buildPublicView,addressMatches,mergeArticles,compareSnapshots,fetchPublicSource} from '../dist/public-radar.mjs';
import {axiomLink} from '../dist/contract-copy.mjs';
const now=Date.parse('2026-09-22T12:00:00Z'),ca='Ab'.repeat(20),poolAddress='Cd'.repeat(20);
const token={id:'solana_'+ca,type:'token',attributes:{address:ca,symbol:'TEST',name:'Test token'}};
const pool=(id,liquidity,buyers)=>({id,attributes:{address:poolAddress,reserve_in_usd:String(liquidity),market_cap_usd:null,fdv_usd:'123',volume_usd:{h24:'456'},transactions:{h24:{buyers,buys:8,sells:4}},pool_created_at:'2026-09-21T12:00:00Z'},relationships:{base_token:{data:{id:token.id}}}});
const post=(id,publisher,time,title='Prediction market expands settlement options')=>({id:'https://decrypt.co/'+id,url:'https://decrypt.co/'+id,title,summary:'Reported development.',publisher,feed:'decrypt',time});
test('Public pool normalization preserves unknown cap and avoids double-counting buyers',()=>{
 const coins=parsePools({data:[pool('one',100,3),pool('two',200,5)],included:[token]},NETWORKS[0],now);
 assert.equal(coins.length,1);assert.equal(coins[0].buyers,5);assert.equal(coins[0].mc,null);assert.equal(coins[0].fdv,123);assert.equal(coins[0].contract_address,ca);assert.equal(coins[0].poolCreated,now-86400000);
});
test('News dates are parsed as UTC and evidence URLs stay on the source publisher',()=>{
 const data={status:'ok',items:[{title:'An &amp; update',link:'https://decrypt.co/news/one?utm_source=rss',pubDate:'2026-09-22 10:00:00',description:'<b>hello</b>'},{title:'bad',link:'javascript:alert(1)',pubDate:'2026-09-22 10:00:00'},{title:'offsite',link:'https://example.com',pubDate:'2026-09-22 10:00:00'}]};
 const items=parseNews(data,FEEDS[0],now);assert.equal(items.length,1);assert.equal(items[0].time,now-7200000);assert.equal(items[0].title,'An & update');assert.equal(items[0].id,'https://decrypt.co/news/one');
});
test('News clusters use publisher breadth and window metrics, never imaginary social counts',()=>{
 const dataset={articles:[post('a','Decrypt',now-1800000),post('b','Cointelegraph',now-7200000),post('c','Decrypt',now-10800000,'Unrelated mining hardware advances')],coins:[]};
 const four=buildPublicView(dataset,{hours:4},now),one=buildPublicView(dataset,{hours:1},now);
 assert.equal(four.trends[0].sources,2);assert.equal(four.trends[0].mentions,2);assert.equal(four.trends[0].stage,1);
 assert.equal(one.trends[0].sources,1);assert.equal(one.trends[0].mentions,1);assert.equal(one.trends[0].stage,0);
});
test('Crossovers require an exact address, not a ticker, token name, or address prefix',()=>{
 const coins=parsePools({data:[pool('one',100,3)],included:[token]},NETWORKS[0],now);
 assert.equal(addressMatches({posts:[{title:'TEST is popular',summary:'Test token',url:''}]},coins).length,0);
 assert.equal(addressMatches({posts:[{title:'Token',summary:ca,url:''}]},coins).length,1);
 assert.equal(addressMatches({posts:[{title:'Token',summary:ca+'A'.repeat(10),url:''}]},coins).length,0);
 const v=buildPublicView({coins,articles:[]},{query:'TEST'},now);assert.equal(v.coins.length,1);assert.equal(v.trends.length,0);
});
test('Axiom URLs use the exact CA, chain, and no referral; unknown chains have no link',()=>{
 const c={chain:'Solana',contract_address:ca,contract_verified:true};assert.equal(axiomLink(c),'https://axiom.trade/t/'+ca+'?chain=sol');
 assert.equal(axiomLink({...c,contract_verified:false}),null);assert.equal(axiomLink({...c,chain:'Unknown'}),null);
 const base={chain:'Base',contract_address:'0x'+'aB'.repeat(20),contract_verified:true};assert.equal(new URL(axiomLink(base)).search,'?chain=base');assert(new URL(axiomLink(base)).pathname.includes(base.contract_address));
});
test('News history deduplicates articles and expires observations after 3 days',()=>{
 const old=post('a','Decrypt',now-3600000),updated={...old,summary:'updated'};assert.equal(mergeArticles([old,post('old','Decrypt',now-4*86400000)],[updated],now).length,1);assert.equal(mergeArticles([old],[updated],now)[0].summary,'updated');
});
test('Snapshot comparison reports removals and additions; feed errors are explicit',async()=>{
 assert(compareSnapshots({trends:[{id:'a',title:'Old',rank:1}],coins:[],crossovers:[]},{trends:[],coins:[{id:'b',title:'New',rank:1}],crossovers:[]}).some(x=>x.includes('Old left')));
 await assert.rejects(fetchPublicSource(FEEDS[0],async()=>({ok:false,status:429})),/Rate limited/);
 await assert.rejects(fetchPublicSource(FEEDS[0],async()=>({ok:true,json:async()=>({status:'error'})})),/invalid response/);
});
