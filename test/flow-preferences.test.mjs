import test from 'node:test';
import assert from 'node:assert/strict';
import {readFlowWindow,saveFlowWindow} from '../dist/flow-preferences.mjs';

test('flow window defaults to one hour and restores each supported selection',()=>{
  let value=null;
  const storage=()=>({getItem:()=>value,setItem:(_,next)=>{value=next}});
  assert.equal(readFlowWindow(storage),60);
  for(const minutes of [5,15,60,1440,7200]){
    saveFlowWindow(minutes,storage);
    assert.equal(readFlowWindow(storage),minutes);
  }
  for(const invalid of ['', '0', 'NaN', '61', '{}']){value=invalid;assert.equal(readFlowWindow(storage),60)}
});

test('blocked browser storage leaves the default and current session usable',()=>{
  const blocked=()=>{throw new Error('Storage blocked')};
  assert.equal(readFlowWindow(blocked),60);
  assert.doesNotThrow(()=>saveFlowWindow(15,blocked));
});
