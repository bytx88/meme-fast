// Presentation rules: dated observations, conditional paths, no probability score.
import {usable} from './macro-analysis.mjs';
const finite=Number.isFinite;
export function factorChanges(a,previous){
 const names={QQQ:'BTC / QQQ',XAU:'BTC / gold',YIELD:'10Y yield',BRENT:'Brent',ETF:'ETF daily flow',OI:'Open interest',FUNDING:'Funding / payment',SPOT:'Spot buy share',STRUCTURE:'Market structure'};
 return Object.entries(names).map(([key,label])=>{
  const row=a.observations?.[key],old=previous?.observations?.[key]||a.priorObservations?.[key];
  const valid=row?.fresh&&(finite(row.value)||key==='STRUCTURE'&&typeof row.value==='string');
  const comparable=valid&&old?.fresh&&old.scope===row.scope&&(finite(old.value)||key==='STRUCTURE')&&(old.timestamp||old.date)<(row.timestamp||row.date);
  let delta='No earlier comparable observation',direction='Awaiting comparison';
  if(!valid){delta='Current evidence unavailable';direction='Unmeasured';}
  else if(old&&(old.timestamp||old.date)===(row.timestamp||row.date)){delta=old.value===row.value?'Same source observation':'Source value revised · same date';direction=old.value===row.value?'Unchanged source':'Revision';}
  else if(comparable){
   if(key==='STRUCTURE'){delta=old.value+' → '+row.value;direction=old.value===row.value?'Unchanged':'Phase changed';}
   else {const diff=row.value-old.value,scale=key==='YIELD'?100:key==='FUNDING'?10000:1;delta=(diff>=0?'+':'')+(key==='OI'||key==='BRENT'?100*diff/old.value:diff*scale).toFixed(2)+(key==='OI'||key==='BRENT'?'%':key==='YIELD'||key==='FUNDING'?' bp':key==='ETF'?' $m':' pp');direction=diff===0?'Unchanged':['QQQ','XAU'].includes(key)?diff>0?'Improving':'Deteriorating':diff>0?'Rising':'Falling';}
  }
  let reading=valid?key==='STRUCTURE'?row.value:key==='ETF'?(row.value>0?'Inflow':row.value<0?'Outflow':'Balanced')+' · '+row.value.toFixed(1)+' $m':key==='OI'?(finite(a.oi5)?(a.oi5<0?'Contracting':a.oi5>0?'Expanding':'Unchanged')+' · '+a.oi5.toFixed(2)+'% / 5 observations':'Window incomplete'):key==='FUNDING'?(row.value*100).toFixed(4)+'%':row.value.toFixed(2)+(key==='YIELD'?'%':key==='BRENT'?' USD':key==='SPOT'?'%':'% relative / 5 sessions'):'Unavailable';
  const interpretation=key==='OI'&&valid&&finite(a.oi5)&&finite(a.oiPrice)?(a.oi5<0?a.oiPrice<0?'Position contraction during price weakness; possible unwind':'Position contraction during price strength; possible short covering':'Position growth; leverage risk depends on price and funding'):'Measured condition · not a forecast';
  return {label,direction,reading,delta,date:row?.timestamp||row?.date||'No source date',previousDate:comparable?old.timestamp||old.date:null,scope:row?.scope||'Unknown scope',interpretation};
 });
}
export function deskStamp(report,key){
 const row=report.positioning?.[key]?.at(-1)||report.drivers?.[key]?.at(-1);
 return {date:row?.date||report.feeds?.[key]?.latestDate||null,timestamp:row?.timestamp||null};
}
export function reviewChanges(a,previous,report){
 if(!previous)return {baseline:null,items:[],message:'First saved session · no earlier review to compare'};
 const items=[];
 for(const row of factorChanges(a,previous).filter(r=>['ETF daily flow','Open interest'].includes(r.label)&&r.previousDate))items.push({label:row.label,value:row.direction+' · '+row.delta,tone:'neutral'});
 if(previous.phase!==a.phase)items.push({label:'Phase',value:previous.phase+' → '+a.phase,tone:'neutral'});
 const add=(label,old,next,fresh,unit,scale=1)=>{if(!fresh||!finite(old)||!finite(next))return;const delta=(next-old)*scale;if(Math.abs(delta)<.005)return;items.push({label,value:(delta>=0?'+':'')+delta.toFixed(2)+' '+unit,tone:'neutral'});};
 add('BTC / QQQ',previous.q?.value,a.q?.value,a.priceFresh&&usable(report,'QQQ',a.asOf),'pp');
 add('BTC / gold',previous.g?.value,a.g?.value,a.priceFresh&&usable(report,'XAU',a.asOf),'pp');
 add('Spot buy share',previous.spotBuyShare5,a.spotBuyShare5,a.spotFresh,'pp');
 add('Funding / payment',previous.fundingRate,a.fundingRate,a.fundFresh,'bp',10000);
 add('10Y yield',previous.yield?.level,a.yield?.level,usable(report,'YIELD',a.asOf),'bp',100);
 if(usable(report,'BRENT',a.asOf)&&previous.oil?.level>0&&finite(a.oil?.level)){
  const delta=100*(a.oil.level/previous.oil.level-1);if(Math.abs(delta)>.005)items.push({label:'Brent',value:(delta>=0?'+':'')+delta.toFixed(2)+'%',tone:'neutral'});
 }
 const incomplete=!finite(a.q?.value)||!finite(a.g?.value)||!finite(a.spotBuyShare5)||!a.priceFresh||!usable(report,'QQQ',a.asOf)||!usable(report,'XAU',a.asOf)||!a.spotFresh||!a.fundFresh||!usable(report,'YIELD',a.asOf)||!usable(report,'BRENT',a.asOf);
 return {baseline:previous.date,items,message:items.length?'Changes versus previous saved session':incomplete?'Comparable evidence incomplete · unchanged cannot be established':'No measured change in tracked phase / factors'};
}
export function horizonReads(a,report){
 const shortFresh=a.priceFresh&&usable(report,'QQQ',a.asOf)&&finite(a.q?.value);
 const short= !shortFresh?'Unmeasured':a.broken?'Range failure':a.q.value<0?'Relative pressure':a.q.value>0?'Relative improvement':'Relative balance';
 return [
 {label:'1–7 DAYS',state:short,tone:!shortFresh?'unavailable':a.broken||a.q.value<0?'pressure':a.q.value>0?'support':'neutral',detail:shortFresh?'BTC / QQQ leadership + daily range':'Fresh price / benchmark required'},
 {label:'1–3 MONTHS',state:!a.priceFresh||a.phase==='Assessment withheld'?'Unmeasured':a.accepted?'Acceptance observed':a.reclaimed?'Reclaim awaiting hold':'Recovery unconfirmed',tone:!a.priceFresh||a.phase==='Assessment withheld'?'unavailable':a.accepted?'support':'awaiting',detail:(a.accepted?'Structure supports recovery':a.reclaimed?'Reclaim supports recovery; hold pending':'Structure confirmation missing')+' · '+(a.etfFresh&&finite(a.flow5)?a.flow5>0?'ETF window supports':'ETF window challenges':'ETF window unmeasured')},
 {label:'2027–29',state:'Conditional cycle thesis',tone:'awaiting',detail:'Expansion → maturity · timing unvalidated'}
 ];
}
export function triggerReads(a){
 if(a.priceFresh===false||a.phase==='Assessment withheld')return {up:'Dated reference - current confirmation withheld',down:'Dated reference - current failure assessment withheld'};
 return {up:a.referenceHigh===null?'Range reference unavailable':a.accepted?'Stay above accepted level':'Daily close above → reclaim candidate',down:a.low===null?'Range floor unavailable':a.accepted?'Daily close at / below → acceptance lost':'Daily close below → range failure'};
}
export function restoreDeskCache(raw){
 try{const r=JSON.parse(raw);if(r?.version!==1||!r.report?.collectedAt||!r.report?.feeds||!r.report?.drivers||!r.report?.positioning)return null;
 for(const s of ['QQQ','BTC','XAU'])if(!Array.isArray(r.report.series?.[s])||!r.report.series[s].length||!r.report.series[s].every(row=>/^\d{4}-\d{2}-\d{2}$/.test(row.date)&&finite(row.close)&&row.close>0))return null;
 if(!finite(Date.parse(r.report.collectedAt)))return null;return r.report;
 }catch{return null;}
}

export function overviewEvidence(a,report){
 const structure=!a.priceFresh?'Price unavailable':!Number.isFinite(a.low)||a.phase==='Assessment withheld'?'Structure unavailable':a.broken?'Range failed':a.accepted?'Range accepted':'Range intact';
 const leader=a.priceFresh&&usable(report,'QQQ',a.asOf)&&Number.isFinite(a.q?.value)?a.q.value<0?'BTC lags QQQ':a.q.value>0?'BTC leads QQQ':'BTC / QQQ balanced':'Leadership unavailable';
 const spot=a.spotFresh&&Number.isFinite(a.spotBuyShare5)?a.spotBuyShare5<50?'Spot sellers lead':a.spotBuyShare5>=55?'Spot buying confirms':'Spot demand mixed':'Spot demand unavailable';
 return [structure,leader,spot];
}
