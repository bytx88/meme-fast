import test from 'node:test';
import assert from 'node:assert/strict';
import {deltaRows,chart,HOUR} from '../dist/market-delta.mjs';
test('Market ROC uses matching historical periods and never invents startup history',()=>{
 const rows=deltaRows([{at:HOUR,index:100,alt:1000},{at:2*HOUR,index:110,alt:950}],1);
 assert.equal(rows[0].meme,null);
 assert.ok(Math.abs(rows[1].meme-10)<1e-9);
 assert.ok(Math.abs(rows[1].altDelta+5)<1e-9);
 assert.match(chart(rows),/centered on zero/);
});
test('An old baseline outside tolerance cannot become a shorter horizon return',()=>{
 const rows=deltaRows([{at:HOUR,index:100,alt:1000},{at:3*HOUR,index:110,alt:950}],1);
 assert.equal(rows[1].meme,null);
 assert.match(chart(rows),/Building history/);
});
