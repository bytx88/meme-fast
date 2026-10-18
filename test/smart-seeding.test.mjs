import test from 'node:test';
import assert from 'node:assert/strict';
import {seedStatus} from '../dist/smart-seeding.mjs';

test('collection states distinguish paused, scoped work, saved and unknown evidence',()=>{
 assert.equal(seedStatus({token:'a',mode:'dormant'},{token:'a',scope:'universe'}),'Dormant · weekly probe');
 assert.equal(seedStatus({token:'a',mode:'active'},{token:'a',scope:'interested'}),'Collecting · interested');
 assert.equal(seedStatus({token:'a',mode:'active',check:{status:'complete'}},{token:'b'}),'Snapshot saved');
 assert.equal(seedStatus({token:'a',mode:'active',check:{status:'partial'}},null),'Partial · retry queued');
 assert.equal(seedStatus({token:'a',mode:'active'},null),'Queued');
});
