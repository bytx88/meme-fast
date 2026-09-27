import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompetitionIndex,competitionKey} from '../dist/coin-competition.mjs';

const coin=(network,address,extra={})=>({id:`${network}:${address}`,network,contract_address:address,name:'Effective Accelerationism',symbol:'e/acc',...extra});
test('Counts distinct contracts across chains, including a reused EVM address on another chain',()=>{
 const a=coin('solana','AAA'),b=coin('base','0xAB'),c=coin('robinhood','0xAB');
 const index=createCompetitionIndex([a,b,c,{...b,id:'pool:second',contract_address:'0xab'}]);
 assert.equal(index.matches(a).length,2);
 assert.equal(index.matches(b).length,2);
 assert.equal(competitionKey(b),competitionKey({...b,contract_address:'0xab'}));
 assert.notEqual(competitionKey(a),competitionKey({...a,contract_address:'aaa'}));
});
test('Name or ticker matching is case/space normalized, direct, and excludes unknown labels',()=>{
 const a=coin('solana','A'),b=coin('base','B',{name:' effective   accelerationism ',symbol:'other'});
 const c=coin('base','C',{name:'Unrelated',symbol:'$E/ACC'}),d=coin('base','D',{name:'Unrelated',symbol:'other'});
 const index=createCompetitionIndex([a,b,c,d]);
 assert.deepEqual(index.matches(a).map(row=>[row.coin.id,row.match]),[['base:B','Same name'],['base:C','Same ticker']]);
 assert.equal(createCompetitionIndex([coin('solana','A',{name:'Unknown',symbol:'?'}),coin('base','B',{name:'unknown',symbol:'?'})]).matches({name:'unknown',symbol:'?'}).length,0);
 assert.equal(createCompetitionIndex([a]).matches({...a,name:'Effective',symbol:'EACC',id:'base:X',network:'base',contract_address:'X'}).length,0);
});
test('Saved tokens outlive the screen window; legacy saves carry identity without invented market dates',()=>{
 const a=coin('solana','A'),b=coin('base','0xAB',{firstSeen:123,marketUpdatedAt:200,liquidity:42});
 const saved=[{type:'radar',id:b.id,marketSnapshot:b},{type:'coin',id:'base:0xab',marketSnapshot:{...b,id:'base:0xab'}},
  {type:'token',id:'robinhood:0xCD',title:'$e/acc · Effective Accelerationism',savedAt:999},
  {type:'article',id:'base:X',title:'$e/acc · Effective Accelerationism'}];
 const index=createCompetitionIndex([a],saved),matches=index.matches(a);
 assert.equal(matches.length,2);assert.ok(matches.every(row=>row.saved));
 assert.equal(matches[1].firstSeen,null);assert.equal(matches[1].coin.liquidity,undefined);
 assert.equal(matches[1].coin.contract_address,'0xcd');assert.equal(matches[1].coin.chain,'Robinhood Chain');
 assert.equal(index.matches({...a,firstSeen:Date.now()}).length,2);
});
test('Keeps earliest detection, saved status and one freshest market snapshot per contract',()=>{
 const a=coin('solana','A'),old=coin('base','B',{firstSeen:10,marketUpdatedAt:100,liquidity:900,volume5m:500});
 const fresh={...old,firstSeen:20,firstSeenRadarAt:5,marketUpdatedAt:200,liquidity:null,volume5m:null};
 const index=createCompetitionIndex([a,old,fresh],[{type:'coin',id:old.id,marketSnapshot:old}]);
 const match=index.matches(a)[0];
 assert.equal(match.firstSeen,5);assert.equal(match.coin.liquidity,null);assert.equal(match.coin.volume5m,null);
 assert.equal(match.coin.marketUpdatedAt,200);assert.equal(match.saved,true);
 assert.equal(index.matches(a).length,1);
});
