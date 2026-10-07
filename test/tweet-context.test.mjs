import test from 'node:test';
import assert from 'node:assert/strict';
import {tokenProfileContext,fetchTweetContext} from '../dist/tweet-context.mjs';
const coin={network:'solana',id:'solana:MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump',contract_address:'MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump'};
const payload={data:{id:'solana_'+coin.contract_address,attributes:{address:coin.contract_address,description:'A trading-desk themed community token.',websites:['https://otcdesks.cash','javascript:bad'],twitter_handle:'OTCDesks'}}};
const response=value=>({ok:true,json:async()=>value});
test('older tokens fetch an exact-contract description when recent saved context is empty',async()=>{
  const calls=[];
  const context=await fetchTweetContext(coin,async url=>{calls.push(url);return response(url.startsWith('/api/coin-context')?{context:null}:payload)});
  assert.equal(calls.length,2);assert.match(calls[1],/MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump\/info$/);
  assert.equal(context.profile.description,'A trading-desk themed community token.');
  assert.equal(context.profile.links.length,2);
});
test('token metadata never borrows descriptions from another chain or contract',()=>{
  assert.equal(tokenProfileContext(payload,{...coin,network:'base'}),null);
  assert.equal(tokenProfileContext(payload,{...coin,contract_address:'OtherContract'}),null);
  assert.equal(tokenProfileContext({data:{...payload.data,attributes:{...payload.data.attributes,description:''}}},coin),null);
});
test('saved exact-contract descriptions avoid extra provider calls and failures retain related context',async()=>{
  const saved={kind:'verified',profile:{description:'Existing source description.'}};let count=0;
  assert.equal(await fetchTweetContext(coin,async()=>{count++;return response({context:saved})}),saved);assert.equal(count,1);
  const related={kind:'rss',articles:[{title:'A related report'}]};
  assert.equal(await fetchTweetContext({...coin,savedContext:related},async()=>{throw new Error('Offline')}),related);
});
