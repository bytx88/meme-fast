import {usable} from './macro-analysis.mjs';
import {seasonalChange} from './macro-series.mjs';
const signed=(n,unit='%')=>Number.isFinite(n)?`${n>=0?'+':''}${n.toFixed(unit===' bp'?1:2)}${unit}`:'Window incomplete';
export function dailyRead(report,a){
 const yieldRow=report.drivers?.YIELD?.at(-1),oilRow=report.drivers?.BRENT?.at(-1);
 const ready=usable(report,'YIELD',a.asOf)&&usable(report,'BRENT',a.asOf);
 const high=ready&&(a.yield?.percentile>=80||a.oil?.percentile>=80);
 const easing=ready&&(a.yield?.significant&&a.yield.change5<0||a.oil?.significant&&a.oil.change5<0);
 const rising=ready&&(a.yield?.significant&&a.yield.change5>0||a.oil?.significant&&a.oil.change5>0);
 const macro={key:'MACRO',label:'Macro pressure',value:!ready?'Coverage incomplete':high?'High rate / energy hurdle':easing&&rising?'Mixed directions':rising?'Pressure increasing':easing?'Rates / energy easing':'No clear regime shift',tone:!ready?'unavailable':high?'pressure':easing&&rising?'neutral':rising?'pressure':easing?'support':'neutral',
  detail:ready?`10Y ${yieldRow.close.toFixed(3)}% · Brent $${oilRow.close.toFixed(2)}`:'Fresh yield and oil observations required; pressure assessment withheld.',
  context:ready?`5 sessions: yield ${signed(report.drivers.YIELD.length>=6?(yieldRow.close-report.drivers.YIELD.at(-6).close)*100:null,' bp')} · oil ${signed(a.oil?.change5)}`:'Missing data does not establish a bearish macro condition.',
  date:`Yield ${yieldRow?.date||'unavailable'} · Oil ${oilRow?.date||'unavailable'}`};
 if(ready){macro.readings=[`10Y ${yieldRow.close.toFixed(3)}% (${signed(report.drivers.YIELD.length>=6?(yieldRow.close-report.drivers.YIELD.at(-6).close)*100:null,' bp')})`,`Brent $${oilRow.close.toFixed(2)} (${signed(a.oil?.change5)})`];macro.detail=macro.value;macro.context='5 sessions · yield change in basis points / oil in percent';}
 const r=seasonalChange(report.series),aligned=r&&(Date.parse(a.asOf)-Date.parse(r.date))/86400000<=4;
 const assets=['BTC','XAU'].map(key=>{
  const fresh=aligned&&['BTC','QQQ','XAU'].every(s=>usable(report,s,a.asOf)),change=r?.returns[key];
  const relative=(other)=>change>r.returns[other]?'ahead of':change<r.returns[other]?'behind':'matching';
  return {key,label:key==='BTC'?'BTC response':'Gold response',value:fresh?signed(change):'Response unavailable',readings:fresh?[`$${r.prices[key].toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} (${signed(change)})`]:[],tone:!fresh?'unavailable':change>0?'support':change<0?'pressure':'neutral',
   detail:fresh?key==='BTC'?`BTC ${relative('QQQ')} QQQ · ${relative('XAU')} gold`:`Gold ${change>0?'rising':change<0?'falling':'unchanged'} · ${relative('BTC')} BTC`:'Fresh matching closes and the seasonal starting baseline are required.',
   context:fresh?`${r.label} · observed price response`:'Seasonal comparison unavailable; interpretation withheld.',date:r?`Baseline ${r.anchor} → ${r.date}`:'No complete matching window'};
 });
 return [macro,...assets];
}
export function mountDailyRead(root){
 if(!root)return {update(){}};
 const el=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;};
 return {update(report,a){root.replaceChildren(...dailyRead(report,a).map(row=>{const card=el('article','daily-read-card '+row.tone,'');card.append(el('h3','',row.label),...(row.readings?.length?row.readings:[row.value]).map(value=>el('strong','daily-read-value',value)),el('p','daily-read-detail',row.detail),el('span','daily-read-context',row.context),el('time','daily-read-date',row.date));return card;}));}};
}
