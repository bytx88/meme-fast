import test from 'node:test';
import assert from 'node:assert/strict';
import {buildView,narrativeInWindow,coinContext,coins} from '../dist/narrative-data.mjs';
import {contractForCopy,copyContract} from '../dist/contract-copy.mjs';

test('Coin-name search preserves window metrics and includes the associated narrative',()=>{
 const normal=narrativeInWindow('treasury',4),view=buildView({hours:4,query:'Meme Vault'});
 assert.equal(normal.mentions,25);assert.equal(normal.sources,14);
 assert.deepEqual(view.trends.map(n=>[n.id,n.sources,n.mentions]),[['treasury',14,25]]);
 assert.equal(coinContext(view.coins[0],4).sources,14);
 assert.equal(coinContext(view.coins[0],4).narrative.mentions,25);
 assert.equal(view.crossovers.length,0);
 assert.equal(buildView({hours:12,query:'Meme Vault'}).crossovers.length,1);
});
test('Narrative details report zero in a quiet window rather than lifetime counts',()=>{
 assert.equal(narrativeInWindow('robot',4).mentions,0);
 assert.equal(narrativeInWindow('robot',4).sources,0);
 assert.equal(narrativeInWindow('missing',4),null);
 assert(narrativeInWindow('robot',72).mentions>0);
});
test('Standalone coins work in search, groups, lifecycle filters and details',()=>{
 const standalone=coins.find(c=>c.narrative===null),view=buildView({query:standalone.name});
 assert.equal(view.coins[0].id,standalone.id);assert.equal(view.trends.length,0);
 assert.equal(view.crossovers.length,0);
 assert.equal(coinContext(standalone).stage,null);assert.equal(coinContext(standalone).sources,null);
 assert(buildView({group:standalone.group}).coins.some(c=>c.id===standalone.id));
 assert(!buildView({group:'AI'}).coins.some(c=>c.id===standalone.id));
 assert(!buildView({stage:'early'}).coins.some(c=>c.id===standalone.id));
 assert(buildView({stage:'unclassified'}).coins.some(c=>c.id===standalone.id));
 assert.equal(buildView({hours:1}).coins.length,buildView({hours:72}).coins.length);
});
test('No example, unverified, malformed or unsupported-chain CA can be copied',async()=>{
 for(const c of coins)assert.equal(contractForCopy(c),null);
 let calls=0;
 for(const c of [{},{chain:'Base',contract_verified:false,contract_address:'0x'+'a'.repeat(40)},{chain:'Base',contract_verified:true,contract_address:'wrong'},{chain:'Unknown',contract_verified:true,contract_address:'0x'+'a'.repeat(40)}]){
  assert.equal((await copyContract(c,{writeText(){calls++}})).status,'unavailable');
 }
 assert.equal(calls,0);
});
test('CA copy preserves exact case and reports success only after clipboard resolves',async()=>{
 // Test-only addresses, never included in production fixtures.
 const c={chain:'Base',contract_verified:true,contract_address:'0x'+'aB'.repeat(20)};
 let copied;const result=await copyContract(c,{async writeText(value){copied=value}});
 assert.equal(copied,c.contract_address);assert.equal(result.status,'copied');
 const denied=await copyContract(c,{async writeText(){throw new Error('denied')}});
 assert.deepEqual(denied,{status:'manual',address:c.contract_address});
 assert.equal((await copyContract(c,null)).status,'manual');
 assert.equal(contractForCopy({...c,chain:'Solana',contract_address:'Ab'.repeat(20)}),'Ab'.repeat(20));
});
