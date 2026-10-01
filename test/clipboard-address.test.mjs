import test from 'node:test';
import assert from 'node:assert/strict';
import {setupClipboardAddress} from '../dist/clipboard-address.mjs';
const ca='0x'+'a'.repeat(40);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function target(){const events={},attributes={};return {hidden:false,attributes,addEventListener:(name,fn)=>events[name]=fn,setAttribute:(name,value)=>attributes[name]=value,emit:(name,event)=>events[name]?.(event)}}
function fixture(readText,state='granted',nameForAddress){
  const button=target(),input=target(),win=target(),doc=target(),pasted=[];
  const control=setupClipboardAddress({button,input,win,doc,clipboard:{readText},permissions:{query:async()=>({state})},onPaste:value=>pasted.push(value),nameForAddress});
  return {button,input,win,doc,pasted,control};
}
test('Only a successfully read contract is shown; pressing the button uses it',async()=>{
  const f=fixture(async()=>` ${ca} `);assert.equal(f.button.hidden,true);
  await tick();assert.equal(f.button.hidden,false);assert.deepEqual(f.pasted,[]);
  f.button.emit('click');assert.deepEqual(f.pasted,[ca]);
  f.win.emit('blur');assert.equal(f.button.hidden,true);
});
test('Invalid or blocked clipboard stays hidden',async()=>{
  for(const read of [async()=>'',async()=>'hello',async()=>{throw Error('denied')}]){
    const f=fixture(read);await tick();assert.equal(f.button.hidden,true);
    f.button.emit('click');assert.deepEqual(f.pasted,[]);
  }
});
test('Background checks do not prompt; input focus can read clipboard',async()=>{
  let reads=0;const f=fixture(async()=>{reads++;return ca},'prompt');
  await tick();assert.equal(reads,0);assert.equal(f.button.hidden,true);
  f.input.emit('focus');await tick();assert.equal(reads,1);assert.equal(f.button.hidden,false);
});
test('A late read cannot reveal stale clipboard contents after blur',async()=>{
  let finish;const f=fixture(()=>new Promise(resolve=>finish=resolve));
  await tick();f.win.emit('blur');finish(ca);await tick();assert.equal(f.button.hidden,true);
});
test('Pasting updates the candidate, including hiding it for non-address text',async()=>{
  const f=fixture(async()=>'', 'denied');await tick();
  f.input.emit('paste',{clipboardData:{getData:()=>ca}});assert.equal(f.button.hidden,false);
  f.input.emit('paste',{clipboardData:{getData:()=>'no address'}});assert.equal(f.button.hidden,true);
});
test('Known contract name appears on Paste CA and updates after a lookup',async()=>{
  let name='';const f=fixture(async()=>ca,'granted',()=>name);
  await tick();assert.equal(f.button.textContent,'Paste CA');
  name='Cashed Money';f.control.updateLabel();
  assert.equal(f.button.textContent,'Paste CA · Cashed Money');
  assert.equal(f.button.attributes['aria-label'],'Paste Cashed Money contract address');
  f.button.emit('click');assert.deepEqual(f.pasted,[ca]);
  f.win.emit('blur');assert.equal(f.button.hidden,true);assert.equal(f.button.textContent,'Paste CA');
});
