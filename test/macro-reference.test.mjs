import test from 'node:test';
import assert from 'node:assert/strict';
import reference from '../dist/macro-qqq-reference.mjs';
import {referenceOverlay} from '../dist/macro-series.mjs';
test('historical QQQ reference shifts one year and includes first October move',()=>{
 const rows=referenceOverlay(reference),base=reference.rows.find(r=>r.date==='2024-09-30');
 assert.equal(rows[0].sourceDate,'2024-10-01');assert.equal(rows[0].date,'2025-10-01');
 assert.equal(rows.at(-1).sourceDate,'2025-10-31');assert.equal(rows.at(-1).date,'2026-10-31');
 assert.equal(rows[0].anchor,base.date);assert.equal(rows[0].return,100*(rows[0].close/base.close-1));
});
test('short reference view rebases its first displayed close and excludes earlier data',()=>{
 const rows=referenceOverlay(reference,'2026-07-10',true);
 assert.ok(rows.every(r=>r.date>='2026-07-10'));assert.equal(rows[0].return,0);
 assert.deepEqual(referenceOverlay({rows:[],start:reference.start,end:reference.end}),[]);
});
