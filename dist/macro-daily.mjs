import {usable} from './macro-analysis.mjs';

const signed=(n,unit='%')=>Number.isFinite(n)?`${n>=0?'+':''}${n.toFixed(unit===' bp'?1:2)}${unit}`:'Window incomplete';
export function dailyRead(report,a){
 const macro=['YIELD','BRENT'].map(key=>{
  const row=report.drivers?.[key]?.at(-1),fresh=usable(report,key,a.asOf),yieldAsset=key==='YIELD';
  const analysis=yieldAsset?a.yield:a.oil,high=fresh&&analysis?.percentile>=80;
  const prior=report.drivers?.[key]?.at(-2);
  const change=prior&&row?(yieldAsset?(row.close-prior.close)*100:100*(row.close/prior.close-1)):null;
  const easing=fresh&&change<0,rising=fresh&&change>0;
  return {key,label:yieldAsset?'Treasury yields / 10Y':'Brent oil',
   value:fresh?(yieldAsset?`${row.close.toFixed(3)}%`:`$${row.close.toFixed(2)} / bbl`):'Coverage incomplete',
   readings:fresh?[yieldAsset?`${row.close.toFixed(3)}% (${signed(change,' bp')})`:`$${row.close.toFixed(2)} (${signed(change)})`]:[],
   tone:!fresh?'unavailable':high||rising?'pressure':easing?'support':'neutral',
   detail:!fresh?'Fresh source observation required.':high?(yieldAsset?'Elevated financing hurdle':'Elevated energy hurdle'):rising?(yieldAsset?'Yields rising':'Oil rising'):easing?(yieldAsset?'Yields easing':'Oil easing'):'No clear regime shift',
   context:yieldAsset?'1D · change in basis points':'1D · change in percent / USD per barrel',
   date:row?`${prior?.date||'Previous close unavailable'} → ${row.date}`:'No source observation'};
 });
 const assetRows=Object.fromEntries(['BTC','QQQ','XAU'].map(key=>[key,
  (report.series?.[key]||[]).filter(r=>Number.isFinite(r.close)&&r.close>0&&
   (key!=='XAU'||[1,2,3,4,5].includes(new Date(r.date+'T00:00:00Z').getUTCDay())))
   .sort((a,b)=>a.date.localeCompare(b.date))]));
 const windows=Object.fromEntries(['BTC','QQQ','XAU'].map(key=>{
  const rows=assetRows[key];
  const last=rows.at(-1),prior=rows.at(-2);
  return [key,last&&prior?{date:last.date,prior:prior.date,price:last.close,change:100*(last.close/prior.close-1)}:null];
 }));
 const assets=['BTC','XAU'].map(key=>{
  const r=windows[key],age=r?(Date.parse(a.asOf)-Date.parse(r.date))/86400000:null;
  const fresh=r&&usable(report,key,a.asOf)&&age>=0&&age<=(key==='XAU'?4:2),change=r?.change;
  const relative=(other)=>{
   const rows=assetRows[other],last=rows.find(row=>row.date===r.date),prior=rows.find(row=>row.date===r.prior);
   if(!last||!prior||!usable(report,other,a.asOf))return `comparison with ${other==='XAU'?'gold':other} pending`;
   const otherChange=100*(last.close/prior.close-1);
   return `${change>otherChange?'ahead of':change<otherChange?'behind':'matching'} ${other==='XAU'?'gold':other}`;
  };
  const weekendExcluded=key==='XAU'&&(report.series?.XAU||[]).some(row=>row.date>r?.date&&[0,6].includes(new Date(row.date+'T00:00:00Z').getUTCDay()));
  return {key,label:key==='BTC'?'BTC response':'Gold / daily close',value:fresh?signed(change):'Response unavailable',readings:fresh?[`$${r.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} (${signed(change)})`]:[],tone:!fresh?'unavailable':change>0?'support':change<0?'pressure':'neutral',
   detail:fresh?key==='BTC'?`BTC ${relative('QQQ')} · ${relative('XAU')}`:`${change===0?'No change in reported closes':`Gold ${change>0?'rising':'falling'}`} · ${relative('BTC')} over these dates${weekendExcluded?' · weekend observations excluded':''}`:'Fresh daily closes required.',
   context:key==='XAU'?'GoldPrice.com · USD/oz · weekday closes (not live)':'1D · previous daily close',date:r?`${r.prior} → ${r.date}`:'No complete daily window'};
 });
 return [...macro,...assets];
}
export function mountDailyRead(root){
 if(!root)return {update(){}};
 const el=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;};
 return {update(report,a){root.replaceChildren(...dailyRead(report,a).map(row=>{const asset=row.key==='BTC'?' asset-btc':row.key==='XAU'?' asset-xau':'';
   const card=el('article','daily-read-card '+row.tone+asset,'');card.append(el('h3','',row.label),...(row.readings?.length?row.readings:[row.value]).map(value=>el('strong','daily-read-value',value)),el('p','daily-read-detail',row.detail),el('span','daily-read-context',row.context),el('time','daily-read-date',row.date));return card;}));}};
}
