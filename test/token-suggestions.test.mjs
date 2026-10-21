import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeKnownTokens,matchKnownTokens,setupTokenSuggestions} from '../dist/token-suggestions.mjs';
const address='0x'+'a'.repeat(40),other='0x'+'b'.repeat(40);
const rows=[{network:'base',address,symbol:'XL',name:'Extra Large'},{network:'eth',address,symbol:'XL',name:'Another XL'},{network:'base',address:other,symbol:'XLM',name:'XL Moon'}];
test('known tokens deduplicate by chain and contract and reject unverified identities',()=>{
 const known=mergeKnownTokens(rows,[{...rows[0],name:'Updated'}, {...rows[0],address:'bad'},{...rows[0],address:other,unverified:true}]);
 assert.equal(known.length,3);assert.equal(known[0].name,'Updated');
 assert.deepEqual(matchKnownTokens(known,'$xl').map(t=>t.symbol),['XL','XL','XLM']);
 assert.equal(matchKnownTokens(known,'another')[0].network,'eth');
 assert.deepEqual(matchKnownTokens(known,'missing'),[]);
});
test('large collected catalogs retain early and late matches without a display-cap truncation',()=>{
 const catalog=Array.from({length:22000},(_,i)=>({network:'base',address:'0x'+i.toString(16).padStart(40,'0'),symbol:`T${i}`,name:`Token ${i}`}));
 const known=mergeKnownTokens(catalog);
 assert.equal(known.length,22000);assert.equal(matchKnownTokens(known,'T0')[0].address,catalog[0].address);
 assert.equal(matchKnownTokens(known,'T21999')[0].address,catalog.at(-1).address);
});
test('same-name matches rank by holders, then 24h volume, then market cap before limiting',()=>{
 const candidates=Array.from({length:20},(_,i)=>({...rows[0],address:'0x'+i.toString(16).padStart(40,'0'),volume:i*100,mc:i*1000}));
 candidates[0].holders={count:50};candidates[1].holderCount=50;candidates[1].volume=500;
 const known=mergeKnownTokens(candidates);
 assert.deepEqual(matchKnownTokens(known,'XL',3).map(t=>t.address),[candidates[1].address,candidates[0].address,candidates[19].address]);
 const tied=mergeKnownTokens([{...rows[0],volume:10,mc:1},{...rows[1],volume:10,mc:20}]);
 assert.equal(matchKnownTokens(tied,'XL')[0].network,'eth');
 const richerPrefix={...rows[2],holderCount:1000000,volume:1e12};
 assert.equal(matchKnownTokens(mergeKnownTokens(tied,[richerPrefix]),'XL')[0].symbol,'XL');
});
test('missing or invalid metrics stay unknown and metadata-only updates retain collected metrics',()=>{
 const known=mergeKnownTokens([{...rows[0],volume:123,mc:400,holderCount:0}],[{...rows[0],volume:'NaN',mc:-1}]);
 assert.equal(known[0].volume,123);assert.equal(known[0].mc,400);assert.equal(known[0].holderCount,0);
 assert.equal(mergeKnownTokens([{...rows[1],volume:Infinity}])[0].volume,null);
});
class Element{
 constructor(){this.events={};this.attributes={};this.children=[];this.hidden=true;this.value=''}
 addEventListener(name,fn){(this.events[name]??=[]).push(fn)}
 emit(name,event={}){for(const fn of this.events[name]||[])fn(event)}
 setAttribute(k,v){this.attributes[k]=v}removeAttribute(k){delete this.attributes[k]}
 replaceChildren(){this.children=[]}append(...items){this.children.push(...items)}contains(item){return this.children.includes(item)}
}
function fixture(fetcher){
 const input=new Element(),panel=new Element(),list=new Element(),status=new Element(),selected=[];list.id='known';
 const doc=new Element();doc.activeElement=input;doc.createElement=()=>new Element();
 const storage={getItem:()=>JSON.stringify(rows),setItem:()=>{}};
 setupTokenSuggestions({input,panel,list,status,doc,fetcher,storage:()=>storage,onSelect:token=>selected.push(token)});
 return {input,panel,list,status,selected};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('typing filters the downloaded list without per-keystroke requests; keyboard selects exact chain',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return {ok:true,json:async()=>({coins:rows})}});
 f.input.value='xl';f.input.emit('focus');await tick();
 for(const value of ['x','xl','moon']){f.input.value=value;f.input.emit('input')}
 assert.equal(calls,1);assert.equal(f.list.children.length,1);
 f.input.emit('keydown',{key:'ArrowUp',preventDefault(){}});
 assert.equal(f.input.attributes['aria-activedescendant'],'known-token-0');
 f.input.emit('keydown',{key:'Enter',preventDefault(){}});
 assert.equal(f.selected[0].address,other);assert.equal(f.panel.hidden,true);
 f.input.emit('focus');await tick();assert.equal(calls,1);
});
test('failed catalog load preserves cached matches and leaves unmatched Enter available for lookup',async()=>{
 const f=fixture(async()=>{throw Error('offline')});f.input.value='extra';f.input.emit('focus');await tick();
 assert.equal(f.list.children.length,1);f.list.children[0].emit('click');assert.equal(f.selected[0].network,'base');
 f.input.value='unknown';f.input.emit('input');let prevented=false;
 f.input.emit('keydown',{key:'Enter',preventDefault(){prevented=true}});assert.equal(prevented,false);
 f.input.emit('keydown',{key:'Escape'});assert.equal(f.panel.hidden,true);
});
test('a background catalog response does not reopen a dismissed dropdown',async()=>{
 let finish;const f=fixture(()=>new Promise(resolve=>finish=resolve));
 f.input.value='XL';f.input.emit('focus');await tick();
 f.input.emit('keydown',{key:'Escape'});finish({ok:true,json:async()=>({coins:rows})});await tick();
 assert.equal(f.panel.hidden,true);
 f.input.emit('input');assert.equal(f.list.children.length,3);
});
