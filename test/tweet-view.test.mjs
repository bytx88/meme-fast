import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTweetView,tweetSocialBadge,newsExcerpt,tweetCoinMetrics,tweetCoinOneLiner} from '../dist/tweet-view.mjs';
const now=1800000000000;
test('coin one-liners use source text only and distinguish project descriptions from related leads',()=>{
  assert.equal(tweetCoinOneLiner(null),null);
  assert.equal(tweetCoinOneLiner({profile:{description:'  '}}),null);
  assert.deepEqual(tweetCoinOneLiner({profile:{description:'<p>A character inspired by a viral meme.</p>'}}),{text:'A character inspired by a viral meme.',label:'Project description'});
  assert.deepEqual(tweetCoinOneLiner({kind:'verified',articles:[{title:'Origin of the meme'}]}),{text:'Origin of the meme',label:'Exact contract source'});
  assert.equal(tweetCoinOneLiner({kind:'web',web:{snippet:'A community meme character.'}}).label,'Related lead');
});
const article=(id,title,publisher='Decrypt',age=1000)=>({id,url:`https://decrypt.co/${id}`,title,summary:'Reported development',publisher,time:now-age});
const coins=[{id:'solana:a',chain:'Solana',symbol:'AAA',name:'Alpha',buyers:10,contract_address:'Ab'.repeat(20)},
  {id:'base:b',chain:'Base',symbol:'BBB',name:'Beta',buyers:20,contract_address:'0x'+'b'.repeat(40)},
  {id:'robinhood:c',chain:'Robinhood Chain',symbol:'CCC',name:'Gamma',buyers:5,contract_address:'0x'+'c'.repeat(40)}];
const dataset={coins,articles:[article('one','Artificial intelligence agent launches research'),
  article('two','Artificial intelligence agent launches research','Cointelegraph',7200000),
  article('three','Mining hardware improves efficiency','Decrypt',10800000)]};

test('news topics, coverage and time windows do not filter 24H coin rankings',()=>{
  const baseline=buildTweetView(dataset,{},now);
  for(const filters of [{topic:'AI'},{stage:'single'},{stage:'multiple'},{hours:1},{topic:'AI',stage:'multiple',hours:1}]){
    assert.deepEqual(buildTweetView(dataset,filters,now).coins,baseline.coins);
  }
  assert.equal(buildTweetView(dataset,{topic:'AI'},now).trends.length,1);
  assert.equal(buildTweetView(dataset,{stage:'multiple'},now).trends[0].sources,2);
  assert.equal(buildTweetView(dataset,{stage:'single'},now).trends[0].sources,1);
  assert.equal(buildTweetView(dataset,{hours:1},now).trends[0].sources,1);
});
test('coin-chain filters including Robinhood leave publisher news unchanged',()=>{
  const baseline=buildTweetView(dataset,{},now);
  for(const chain of ['Solana','Base','Robinhood Chain']){
    const view=buildTweetView(dataset,{chain},now);
    assert.equal(view.coins.length,1);assert.equal(view.coins[0].chain,chain);
    assert.deepEqual(view.trends,baseline.trends);
  }
});
test('search still filters both streams and evidence uses only visible coins',()=>{
  const linked={coins,articles:[article('linked',`Artificial intelligence agent ${coins[0].contract_address}`)]};
  assert.equal(buildTweetView(linked,{},now).crossovers.length,1);
  assert.equal(buildTweetView(linked,{chain:'Base'},now).crossovers.length,0);
  assert.equal(buildTweetView(linked,{query:'AAA'},now).trends.length,1);
  assert.equal(buildTweetView(dataset,{query:'BBB'},now).coins[0].id,'base:b');
});
test('unobserved X counts stay distinct from a measured zero and stale data',()=>{
  const id='solana:a',report={version:1,status:'connected',source:'google-news-rss',coins:{}};
  assert.match(tweetSocialBadge(report,id,null,now),/not sampled/);
  report.coins[id]={posts6h:0,previousPosts6h:0,sampledAt:now};
  assert.match(tweetSocialBadge(report,id,null,now),/<strong>0<\/strong>/);
  assert.match(tweetSocialBadge(report,id,null,now+46*60000),/stale/);
  assert.match(tweetSocialBadge({...report,status:'error'},id,null,now),/unavailable/);
});
test('on-demand cache expiry never leaves an old count displayed as fresh',()=>{
  const cache={until:now+1000,value:{posts6h:7,status:'ok'}};
  assert.match(tweetSocialBadge({},'coin"bad',cache,now),/data-coin-evidence="coin&quot;bad"/);
  assert.match(tweetSocialBadge({},'coin',cache,now),/<strong>7<\/strong>/);
  assert.match(tweetSocialBadge({},'coin',cache,now+1001),/not sampled/);
  assert.match(tweetSocialBadge({},'coin',{...cache,value:{...cache.value,cacheStatus:'stale'}},now),/stale/);
});

test('multi-publisher news retains actual excerpts instead of article-count boilerplate',()=>{
  const narrative={summary:'2 articles from 2 publishers cover this developing story.',posts:[
    {publisher:'Decrypt',title:'Venue challenge',summary:'Prosecutors cite a previous ruling to contest where the case can be heard.'},
    {publisher:'Cointelegraph',title:'Venue challenge',summary:'The defense argues that the alleged conduct did not occur in this jurisdiction.'}]};
  const excerpt=newsExcerpt(narrative);
  assert.match(excerpt.text,/Prosecutors cite/);assert.match(excerpt.text,/defense argues/);
  assert.doesNotMatch(excerpt.text,/2 articles from/);assert.equal(excerpt.sources.length,2);
  assert.equal(newsExcerpt({posts:[]}).text,'');
});
test('news excerpts deduplicate syndicated descriptions without hiding distinct context',()=>{
  const posts=[{title:'Headline',summary:'The regulator published a detailed report explaining the risks to public blockchains.'},
    {title:'Headline',summary:'The regulator published a detailed report explaining the risks to public blockchains.'},
    {title:'Headline',summary:'Researchers say wallet migration needs preparation before encryption methods change.'}];
  const excerpt=newsExcerpt({posts});assert.equal(excerpt.sources.length,2);
  assert.equal(excerpt.text.split('The regulator').length,2);assert.match(excerpt.text,/Researchers say/);
});
test('compact coin metrics distinguish unknown fields from measured zero and preserve price direction',()=>{
  const metrics=tweetCoinMetrics({mc:null,liquidity:NaN,volume:1000,buyers:23,volume5m:0,buys5m:0,sells5m:null,priceChange:-12.5});
  assert.equal(metrics.mc,null);assert.equal(metrics.liquidity,null);assert.equal(metrics.buys24h,null);
  assert.equal(metrics.volume5m,0);assert.equal(metrics.buys5m,0);assert.equal(metrics.sells5m,null);
  assert.equal(metrics.change24h,-12.5);assert.equal(metrics.buyers24h,23);assert.equal(metrics.volume24h,1000);
});
