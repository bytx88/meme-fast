import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {collect,contextProfileIndex} from '../worker/coin-collector.mjs';
import {safeURL} from '../dist/public-radar.mjs';

const solana='Ab'.repeat(20),evm='0x'+'aB'.repeat(20);
const originalMatch=(profiles,coin)=>profiles.find(profile=>profile.chainId===coin.network&&
 (coin.network==='solana'?profile.tokenAddress===coin.contract_address:
  String(profile.tokenAddress).toLowerCase()===coin.contract_address.toLowerCase()));

test('profile index keeps the first match and exact network and address case rules',()=>{
 const profiles=[
  {chainId:'solana',tokenAddress:solana,description:'First',icon:'https://CDN.example.com/first.png'},
  {chainId:'solana',tokenAddress:solana,description:'Duplicate',icon:'https://cdn.example.com/second.png'},
  {chainId:'solana',tokenAddress:solana.toLowerCase(),description:'Different Solana contract'},
  {chainId:'base',tokenAddress:evm.toLowerCase(),description:'Base',icon:'https://cdn.example.com/base.png'},
  {chainId:'base',tokenAddress:evm,description:'Duplicate Base'},
  {chainId:'robinhood',tokenAddress:evm,description:'Robinhood'},
  {chainId:'Solana',tokenAddress:solana,description:'Different network spelling'},
 ];
 const index=contextProfileIndex(profiles);
 for(const coin of [
  {network:'solana',contract_address:solana},
  {network:'solana',contract_address:solana.toLowerCase()},
  {network:'base',contract_address:evm},
  {network:'base',contract_address:evm.toLowerCase()},
  {network:'robinhood',contract_address:evm.toLowerCase()},
  {network:'bsc',contract_address:evm},
  {network:'Solana',contract_address:solana},
 ]){
  const original=originalMatch(profiles,coin),found=index.get(coin);
  assert.equal(found?.profile,original,'keep the original first source object');
  assert.equal(found?.icon??null,safeURL(original?.icon));
 }
 assert.equal(index.get({network:'solana',contract_address:solana}).icon,'https://cdn.example.com/first.png');
 assert.equal(index.get({network:'solana',contract_address:'Cd'.repeat(20)}),undefined);
 assert.equal(contextProfileIndex([]).get({}),undefined,'empty profiles also tolerate legacy identity fields');
});

test('profile icons preserve safe URL normalization and the existing image fallback',()=>{
 const icons=[undefined,null,'',false,0,'relative.png','http://cdn.example.com/a.png',
  'javascript:alert(1)','https://user:pass@cdn.example.com/a.png','https://CDN.example.com/a.png'];
 const profiles=icons.map((icon,index)=>({chainId:'base',tokenAddress:`0x${String(index).padStart(40,'0')}`,icon}));
 const index=contextProfileIndex(profiles);
 for(const profile of profiles)for(const image_url of [undefined,null,'','https://old.example.com/kept.png']){
  const coin={network:'base',contract_address:profile.tokenAddress,image_url};
  assert.equal(index.get(coin)?.icon||coin.image_url||null,safeURL(profile.icon)||coin.image_url||null);
 }
 const first={chainId:'base',tokenAddress:evm,icon:'javascript:alert(1)'};
 const duplicate={...first,icon:'https://cdn.example.com/later.png'};
 assert.deepEqual(contextProfileIndex([first,duplicate]).get({network:'base',contract_address:evm}),{profile:first,icon:null});
});

test('collector uses indexed profiles without changing context precedence, timestamps or profile requests',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'meme-profiles-')),filename=path.join(directory,'coins.json');
 const now=Date.now(),checked=now-3600000,saved={kind:'web',web:{snippet:'Saved context'}};
 const addresses=[solana,solana.toLowerCase(),'Cd'.repeat(20)];
 const coins=addresses.map((address,index)=>({id:`solana:${address}`,network:'solana',chain:'Solana',
  contract_address:address,name:`Profile token ${index}`,symbol:`PT${index}`,firstSeen:checked,
  contextCheckedAt:checked,image_url:'https://old.example.com/kept.png',...(index===2?{savedContext:saved}:{})}));
 const first={chainId:'solana',tokenAddress:solana,description:'First source',icon:'https://CDN.example.com/first.png'};
 const profiles=[first,{...first,description:'Duplicate',icon:'https://cdn.example.com/second.png'},
  {chainId:'solana',tokenAddress:addresses[1],description:'Distinct contract'},
  {chainId:'solana',tokenAddress:addresses[2],description:'Available profile',icon:'javascript:alert(1)'}];
 const calls=[],json=value=>({ok:true,json:async()=>value});
 try{
  await writeFile(filename,JSON.stringify({coins,radarCoins:[],feeds:{}}));
  const snapshot=await collect(filename,{now,fetcher:async url=>{
   calls.push(url);
   if(url.includes('token-profiles/latest/v1'))return json(profiles);
   if(url.includes('/networks/'))return json({data:[],included:[]});
   if(url.includes('dexscreener.com/tokens/v1/'))return json([]);
   return {ok:false,status:404};
  }});
  assert.equal(calls.filter(url=>url.includes('token-profiles/latest/v1')).length,1);
  assert.deepEqual(snapshot.coins[0].savedContext,{kind:'verified',profile:first});
  assert.equal(snapshot.coins[0].image_url,'https://cdn.example.com/first.png');
  assert.equal(snapshot.coins[1].savedContext.profile.description,'Distinct contract');
  assert.equal(snapshot.coins[1].image_url,'https://old.example.com/kept.png');
  assert.deepEqual(snapshot.coins[2].savedContext,saved);
  assert.equal(snapshot.coins[2].image_url,'https://old.example.com/kept.png');
  assert(snapshot.coins.every(coin=>coin.contextCheckedAt===checked));
 }finally{await rm(directory,{recursive:true,force:true})}
});
