import test from 'node:test';
import assert from 'node:assert/strict';
import {tokenActions} from '../dist/token-actions.mjs';

test('Find sits after CA and opens a live X name search in a new tab',()=>{
 const html=tokenActions({id:'solana:abc',chain:'Solana',name:'First Life on Mars',symbol:'MARS',contract_address:'11111111111111111111111111111111',contract_verified:true});
 assert.ok(html.indexOf('CA ⧉')<html.indexOf('Find ↗'));
 assert.ok(html.indexOf('Find ↗')<html.indexOf('Stats ↗'));
 assert.match(html,/https:\/\/x\.com\/search\?q=First\+Life\+on\+Mars&amp;src=typed_query&amp;f=live/);
 assert.match(html,/class="token-find"[^>]+target="_blank"[^>]+rel="noopener noreferrer"/);
});
