import test from 'node:test';
import assert from 'node:assert/strict';
import reference,{templates} from '../dist/macro-qqq-reference.mjs';
import {referenceOverlay,referenceSelection,chartSeasonStart,btcReferenceSelection} from '../dist/macro-series.mjs';
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

test('fixed templates remain fixed and align to future chart years',()=>{
 for(const year of [2025,2026,2027]){
  const start=`${year}-10-01`,r=referenceSelection('2024',templates,[],start),rows=referenceOverlay(r,start,false,start);
  assert.equal(r.start,'2024-10-01');assert.equal(rows[0].date,start);assert.equal(rows[0].sourceDate,'2024-10-01');
  assert.equal(rows.at(-1).date,`${year+1}-10-31`);
 }
 const r=referenceSelection('2010',templates,[],'2026-10-01');
 assert.equal(r.start,'2010-10-01');assert.equal(referenceOverlay(r,'2026-10-01',false,'2026-10-01')[0].sourceDate,'2010-10-01');
});
test('previous year follows the chart start and merges available history without duplicate dates',()=>{
 const series=Object.fromEntries(['QQQ','BTC','XAU'].map(s=>[s,[{date:'2027-10-08',close:100}]]));
 assert.equal(chartSeasonStart(series),'2026-10-01');
 const r=referenceSelection('previous',templates,[{date:'2025-09-30',close:100},{date:'2025-10-01',close:101},{date:'2026-10-30',close:110}],'2026-10-01');
 assert.equal(r.start,'2025-10-01');assert.equal(r.end,'2026-10-31');
 const rows=referenceOverlay(r,'2026-10-01',false,'2026-10-01');
 assert.equal(rows[0].return,1.0000000000000009);assert.equal(rows.at(-1).sourceDate,'2026-10-30');
});

test('2015 and 2010 standards preserve their source periods when aligned to future years',()=>{
 for(const year of ['2015','2010']){
  const reference=referenceSelection(year,templates,[],'2027-10-01');
  assert.equal(reference.start,`${year}-10-01`);
  const rows=referenceOverlay(reference,'2027-10-01',false,'2027-10-01');
  assert.equal(rows[0].sourceDate,`${year}-10-01`);assert.equal(rows[0].date,'2027-10-01');
  assert.equal(rows.at(-1).date,'2028-10-31');assert.ok(rows.every(r=>Number.isFinite(r.return)));
 }
});

test('BTC defaults to None, keeps standards fixed and rolls Previous Year',()=>{
 const series=[];
 for(let year=2020;year<=2027;year++)series.push({date:`${year}-09-30`,close:100},{date:`${year}-10-01`,close:110},{date:`${year}-10-31`,close:120});
 assert.equal(btcReferenceSelection('none',series,'2025-10-01'),null);
 for(const chartYear of [2025,2026,2027])for(const [choice,year] of [['previous',chartYear-1],['2022',2022],['2021',2021]]){
  const ref=btcReferenceSelection(choice,series,`${chartYear}-10-01`);
  assert.equal(ref.start,`${year}-10-01`);
  assert.equal(ref.end,`${year+1}-10-31`);
  assert.equal(referenceOverlay(ref,`${chartYear}-10-01`,false,`${chartYear}-10-01`)[0].sourceDate,ref.start);
 }
 assert.equal(btcReferenceSelection('previous',[],'2025-10-01'),null);
 assert.equal(btcReferenceSelection('previous',[{date:'2024-09-01',close:100},{date:'2024-10-01',close:110}],'2025-10-01'),null);
});

test('whole chart rolls on June 1, preserving October start through January and May',()=>{
 const series=Object.fromEntries(['QQQ','BTC','XAU'].map(s=>[s,[{date:'2027-05-31',close:100}]]));
 for(const [date,start] of [['2026-10-11','2025-10-01'],['2027-01-01','2025-10-01'],['2027-05-31','2025-10-01'],['2027-06-01','2026-10-01'],['2027-10-01','2026-10-01'],['2028-05-31','2026-10-01'],['2028-06-01','2027-10-01']])assert.equal(chartSeasonStart(series,date),start);
 // June 1 rollover does not wait for the first June source close.
 assert.equal(chartSeasonStart(series,'2027-06-01'),'2026-10-01');
});
