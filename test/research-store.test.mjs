import test from 'node:test';
import assert from 'node:assert/strict';
import {addSaved,isSaved,removeSaved,toggleSaved,watchlist} from '../dist/research-store.mjs';

test('token saved on one surface is shared across Snipe, Swing, and Order Flow',()=>{
 const entries=new Map();
 globalThis.localStorage={getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value)};
 const id='solana:So11111111111111111111111111111111111111112';
 assert.equal(addSaved({type:'radar',id,title:'SOL'}),true);
 assert.equal(isSaved('coin',id),true);
 assert.equal(isSaved('token',id),true);
 assert.equal(addSaved({type:'coin',id,title:'SOL'}),false);
 assert.equal(toggleSaved({type:'token',id,title:'SOL'}),false);
 assert.equal(watchlist().length,0);
 assert.equal(addSaved({type:'coin',id,title:'SOL'}),true);
 removeSaved('radar',id);
 assert.equal(watchlist().length,0);
 delete globalThis.localStorage;
});
