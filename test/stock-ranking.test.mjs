import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankingRows,rankingMarkup} from '../dist/stock-ranking.mjs';
const rows=[{symbol:'XLE',name:'Energy',ret:12,previousRet:-3,relative:10,previousRelative:-4},{symbol:'XLK',name:'Technology',ret:-9,previousRet:5,relative:-11,previousRelative:4},{symbol:'XLF',name:'Financials',ret:6,previousRet:null,relative:4,previousRelative:null}];
test('previous sort puts missing comparisons last without treating them as zero',()=>{
 const sorted=rankingRows(rows,'ret','previous');assert.deepEqual(sorted.map(r=>r.symbol),['XLK','XLE','XLF']);assert.equal(sorted[2].change,null);assert.equal(sorted[2].movement,null);
});
test('rotation change and rank movement derive from both actual periods',()=>{
 const sorted=rankingRows(rows,'ret','change');assert.deepEqual(sorted.map(r=>r.change),[15,-14,null]);assert.equal(sorted[0].movement,1);assert.equal(sorted[1].movement,-2);
 const relative=rankingRows(rows,'relative','change');assert.deepEqual(relative.map(r=>r.change),[14,-15,null]);
});
test('side by side shares the same scale and retains signed numbers and sector names',()=>{
 const html=rankingMarkup({rows,windows:{current:{label:'Oct 2026'},previous:{label:'Sep 2026'}}},{view:'side'});
 assert.match(html,/PREV · Sep/);assert.match(html,/NOW · Oct/);assert.match(html,/Energy/);assert.match(html,/-3.00%/);assert.match(html,/width:25%/);assert.match(html,/width:100%/);
});
