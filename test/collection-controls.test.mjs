import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {localCollectionControls} from '../worker/collection-controls-local.mjs';
import {controlMarkup,mountCollectionControls} from '../dist/collection-controls.mjs';

test('local switches default off, persist across readers and retain independent concurrent updates',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'meme-controls-')),file=path.join(folder,'controls.json');
 try{
  const controls=localCollectionControls(file);
  assert.equal(await controls.enabled('mode'),false);
  await Promise.all(['wallets','mode'].map(feature=>controls.update({feature,enabled:true})));
  await controls.update({feature:'wallets',enabled:false});
  assert.equal(await localCollectionControls(file).enabled('wallets'),false);
  assert.equal(await localCollectionControls(file).enabled('mode'),true);
  assert.throws(()=>controls.update({feature:'mode',enabled:'true'}));
  await writeFile(file,'corrupt');
  assert.equal(await controls.enabled('mode'),false);
 }finally{await rm(folder,{recursive:true,force:true})}
});

test('controls show paused/on states and disable unknown or busy settings',()=>{
 assert.match(controlMarkup(null),/Loading/);
 assert.match(controlMarkup(null),/disabled/);
 const state={features:{wallets:{enabled:false},mode:{enabled:true}}};
 const html=controlMarkup(state);
 assert.match(html,/aria-label="Turn on Wallet analysis" aria-pressed="false"/);
 assert.match(html,/aria-label="Turn off Mode" aria-pressed="true"/);
 assert.match(controlMarkup(state,{busy:true}),/disabled/);
 assert.match(controlMarkup(state,{error:'<failed>'}),/&lt;failed&gt;/);
});

test('failed saves never display an unconfirmed state and require a reload',async()=>{
 let listener,calls=0;
 const root={innerHTML:'',addEventListener(type,fn){listener=fn}};
 const state={features:{wallets:{enabled:false},mode:{enabled:false}}};
 const fetcher=async(url,options)=>{
  calls++;
  if(options.method==='PATCH')return {ok:false,json:async()=>({detail:'Save failed'})};
  return {ok:true,json:async()=>state};
 };
 const control=mountCollectionControls(root,{fetcher});
 await control.reload();
 await listener({target:{closest:()=>({dataset:{collection:'mode'},hasAttribute:()=>false})}});
 assert.match(root.innerHTML,/Save failed/);
 assert.match(root.innerHTML,/disabled/);
 assert.doesNotMatch(root.innerHTML,/aria-pressed="true"/);
 assert(calls>=3);
});
