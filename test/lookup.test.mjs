import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupTokens,dexMatches,geckoMatches,isSolanaAddress} from '../dist/lookup.mjs';
import {loadListings} from '../dist/data.mjs';
const address='Fr24qgw8MwbBmzcesxe4qGBrmFxEH98NjXjcJBW5vP3T';
const pair={chainId:'solana',pairAddress:'pool',dexId:'meteora',baseToken:{address,symbol:'ZODL',name:'Zodl'},quoteToken:{address:'quote',symbol:'SOL'},liquidity:{usd:100}};
const fail=async()=>{throw new Error('Feed unreachable')};
test('Solana contracts use direct lookup and preserve exact case',async()=>{
  assert.equal(isSolanaAddress(address),true);assert.equal(isSolanaAddress('XL'),false);
  const calls=[];const result=await lookupTokens(address,{gecko:fail,dex:async path=>{calls.push(path);return {data:[pair]}}});
  assert.equal(calls[0],`/token-pairs/v1/solana/${address}`);assert.equal(result[0].symbol,'ZODL');assert.equal(result[0].address,address);
  assert.deepEqual(dexMatches([pair],address.toLowerCase()),[]);
});
test('Ticker lookup falls back and combines exact symbols without fuzzy names',async()=>{
  const pairs=[{...pair,baseToken:{address:'one',symbol:'XL'}},{...pair,chainId:'base',baseToken:{address:'0xabc',symbol:'XL'}},{...pair,baseToken:{address:'other',symbol:'DOGEXL'}}];
  const result=await lookupTokens('XL',{gecko:fail,dex:async()=>({data:pairs})});assert.equal(result.length,2);assert.ok(result.every(t=>t.symbol==='XL'));
});
test('Both failed feeds retain only an explicitly unverified contract',async()=>{
  const result=await lookupTokens(address,{gecko:fail,dex:fail});assert.equal(result[0].unverified,true);assert.equal(result[0].address,address);assert.equal(result[0].poolHints,undefined);
  await assert.rejects(lookupTokens('XL',{gecko:fail,dex:fail}),/Feed unreachable/);
});
test('Cancellation does not trigger fallback or return an unverified result',async()=>{
  const controller=new AbortController();let geckoCalled=false;
  await assert.rejects(lookupTokens(address,{signal:controller.signal,dex:async()=>{controller.abort();throw controller.signal.reason},gecko:async()=>{geckoCalled=true}}),{name:'AbortError'});assert.equal(geckoCalled,false);
});
test('Verified pool hints survive discovery failure and reject unrelated pools',async()=>{
  const token=dexMatches([pair],address)[0];token.poolHints.push({...token.poolHints[0],attributes:{address:'wrong'},relationships:{base_token:{data:{id:'other_'+address}}}});
  const paths=[];const result=await loadListings([token],async path=>{paths.push(path);if(path.includes('/tokens/'))throw Error('Discovery down');return {data:[]}});
  assert.equal(result.pools.length,1);assert.equal(result.pools[0].address,'pool');assert.equal(result.listings[0].status,'loaded');assert.ok(paths.some(p=>p.endsWith('/pool/trades')));
});
test('Gecko matches EVM contract and pool relationship case consistently',()=>{
  const result=geckoMatches({included:[{id:'eth_0xAbC',type:'token',attributes:{address:'0xAbC',symbol:'XL'}}],data:[{attributes:{address:'pool',reserve_in_usd:10},relationships:{base_token:{data:{id:'eth_0xabc'}}}}]},'0xabc');assert.equal(result[0].poolHints.length,1);
});
