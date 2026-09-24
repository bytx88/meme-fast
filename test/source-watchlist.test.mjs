import test from 'node:test';
import assert from 'node:assert/strict';
import {SOURCE_KEY,STARTER_SOURCES,loadSources} from '../dist/source-watchlist.mjs';

test('Starter X accounts seed once, preserve saved accounts, and stay removed',()=>{
 const storage=new Map();
 globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
 const custom={handle:'@mytrader',category:'Trader',group:'Solana',weight:5};
 storage.set(SOURCE_KEY,JSON.stringify([custom,{...STARTER_SOURCES[0],handle:'@PUMPDOTFUN',weight:4}]));
 const first=loadSources();
 assert.equal(first.length,STARTER_SOURCES.length+1);
 assert.deepEqual(first[0],custom);
 assert.equal(first.filter(source=>source.handle.toLowerCase()==='@pumpdotfun').length,1);
 assert.equal(first[1].weight,4);
 storage.set(SOURCE_KEY,JSON.stringify(first.filter(source=>source.handle.toLowerCase()!=='@base')));
 assert.equal(loadSources().some(source=>source.handle==='@base'),false);
 delete globalThis.localStorage;
});
