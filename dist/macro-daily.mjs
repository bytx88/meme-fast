import {usable} from './macro-analysis.mjs';
import {seasonalChange} from './macro-series.mjs';
const signed=(n,unit='%')=>Number.isFinite(n)?`${n>=0?'+':''}${n.toFixed(unit===' bp'?1:2)}${unit}`:'Window incomplete';
export function dailyRead(report,a){
 const macro=['YIELD','BRENT'].map(key=>{
  const row=report.drivers?.[key]?.at(-1),fresh=usable(report,key,a.asOf),yieldAsset=key==='YIELD';
  const analysis=yieldAsset?a.yield:a.oil,high=fresh&&analysis?.percentile>=80;
  const easing=fresh&&analysis?.significant&&analysis.change5<0,rising=fresh&&analysis?.significant&&analysis.change5>0;
  const change=yieldAsset?(report.drivers?.YIELD?.length>=6?(row.close-report.drivers.YIELD.at(-6).close)*100:null):analysis?.change5;
  return {key,label:yieldAsset?'Treasury yields / 10Y':'Brent oil',
   value:fresh?(yieldAsset?`${row.close.toFixed(3)}%`:`$${row.close.toFixed(2)} / bbl`):'Coverage incomplete',
   readings:fresh?[yieldAsset?`${row.close.toFixed(3)}% (${signed(change,' bp')})`:`$${row.close.toFixed(2)} (${signed(change)})`]:[],
   tone:!fresh?'unavailable':high||rising?'pressure':easing?'support':'neutral',
   detail:!fresh?'Fresh source observation required.':high?(yieldAsset?'Elevated financing hurdle':'Elevated energy hurdle'):rising?(yieldAsset?'Yields rising':'Oil rising'):easing?(yieldAsset?'Yields easing':'Oil easing'):'No clear regime shift',
   context:yieldAsset?'5 sessions · change in basis points':'5 sessions · change in percent / USD per barrel',
   date:row?.date||'No source observation'};
 });
 const r=seasonalChange(report.series),aligned=r&&(Date.parse(a.asOf)-Date.parse(r.date))/86400000<=4;
 const assets=['BTC','XAU'].map(key=>{
  const fresh=aligned&&['BTC','QQQ','XAU'].every(s=>usable(report,s,a.asOf)),change=r?.returns[key];
  const relative=(other)=>change>r.returns[other]?'ahead of':change<r.returns[other]?'behind':'matching';
  return {key,label:key==='BTC'?'BTC response':'Gold response',value:fresh?signed(change):'Response unavailable',readings:fresh?[`$${r.prices[key].toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} (${signed(change)})`]:[],tone:!fresh?'unavailable':change>0?'support':change<0?'pressure':'neutral',
   detail:fresh?key==='BTC'?`BTC ${relative('QQQ')} QQQ · ${relative('XAU')} gold`:`Gold ${change>0?'rising':change<0?'falling':'unchanged'} · ${relative('BTC')} BTC`:'Fresh matching closes and the seasonal starting baseline are required.',
   context:fresh?`${r.label} · observed price response`:'Seasonal comparison unavailable; interpretation withheld.',date:r?`Baseline ${r.anchor} → ${r.date}`:'No complete matching window'};
 });
 return [...macro,...assets];
}
export function mountDailyRead(root){
 if(!root)return {update(){}};
 const el=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;};
 return {update(report,a){root.replaceChildren(...dailyRead(report,a).map(row=>{const asset=row.key==='BTC'?' asset-btc':row.key==='XAU'?' asset-xau':'';
   const card=el('article','daily-read-card '+row.tone+asset,'');card.append(el('h3','',row.label),...(row.readings?.length?row.readings:[row.value]).map(value=>el('strong','daily-read-value',value)),el('p','daily-read-detail',row.detail),el('span','daily-read-context',row.context),el('time','daily-read-date',row.date));return card;}));}};
}
