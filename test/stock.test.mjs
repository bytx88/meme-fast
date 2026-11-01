import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyze,change,sectors} from '../dist/stock-analysis.mjs';
const dates=Array.from({length:110},(_,i)=>new Date(Date.UTC(2025,10,1+i)).toISOString().slice(0,10));
const series=Object.fromEntries(['SPY',...Object.keys(sectors)].map((s,j)=>[s,dates.map((date,i)=>({date,close:100*(1+(j+1)*.0001)**i}))]));
test('returns and benchmark relative performance use the same endpoints',()=>{
 const m=analyze(series,'1M');assert.equal(m.date,dates.at(-1));assert.equal(m.start,dates.at(-22));assert.equal(m.outperforming,11);assert.equal(m.advancing,11);
 assert.ok(Math.abs(m.rows.find(r=>r.symbol==='XLE').relative-(((1.0002**21-1)-(1.0001**21-1))*100))<1e-9);
});
test('YTD starts with the prior year close',()=>{const m=analyze(series,'YTD');assert.equal(m.start,'2025-12-31');assert.equal(change([{date:'2026-01-02',close:1}],'YTD'),null)});
test('missing dates align the whole universe, rather than mixing endpoints',()=>{const m=analyze({...series,XLK:series.XLK.slice(0,-1)},'1D');assert.equal(m.date,dates.at(-2));assert.equal(m.start,dates.at(-3))});
test('rotation uses a fixed horizon regardless of return selector',()=>{const a=analyze(series,'1D'),b=analyze(series,'3M');for(const r of a.rows){const other=b.rows.find(x=>x.symbol===r.symbol);assert.equal(r.rs,other.rs);assert.equal(r.momentum,other.momentum)}});
test('incomplete history cannot produce a market assessment',()=>assert.equal(analyze({...series,XLK:[]}),null));
