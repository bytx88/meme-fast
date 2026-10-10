// Presentation rules: dated observations, conditional paths, no probability score.
import {usable} from './macro-analysis.mjs';
const finite=Number.isFinite;
export function deskStamp(report,key){
 const row=report.positioning?.[key]?.at(-1)||report.drivers?.[key]?.at(-1);
 return {date:row?.date||report.feeds?.[key]?.latestDate||null,timestamp:row?.timestamp||null};
}
export function reviewChanges(a,previous,report){
 if(!previous)return {baseline:null,items:[],message:'First saved session · no earlier review to compare'};
 const items=[];
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
 {label:'1–3 MONTHS',state:!a.priceFresh?'Unmeasured':a.accepted?'Acceptance observed':a.reclaimed?'Reclaim awaiting hold':'Recovery unconfirmed',tone:!a.priceFresh?'unavailable':a.accepted?'support':'awaiting',detail:'Daily structure + demand · no forecast'},
 {label:'2027–29',state:'Conditional cycle thesis',tone:'awaiting',detail:'Expansion → maturity · timing unvalidated'}
 ];
}
export function triggerReads(a){
 if(a.priceFresh===false)return {up:'Dated reference - current confirmation withheld',down:'Dated reference - current failure assessment withheld'};
 return {up:a.referenceHigh===null?'Range reference unavailable':a.accepted?'Stay above accepted level':'Daily close above → reclaim candidate',down:a.low===null?'Range floor unavailable':a.accepted?'Daily close at / below → acceptance lost':'Daily close below → range failure'};
}
export function restoreDeskCache(raw){
 try{const r=JSON.parse(raw);if(r?.version!==1||!r.report?.collectedAt||!r.report?.feeds||!r.report?.drivers||!r.report?.positioning)return null;
 for(const s of ['QQQ','BTC','XAU'])if(!Array.isArray(r.report.series?.[s])||!r.report.series[s].length||!r.report.series[s].every(row=>/^\d{4}-\d{2}-\d{2}$/.test(row.date)&&finite(row.close)&&row.close>0))return null;
 if(!finite(Date.parse(r.report.collectedAt)))return null;return r.report;
 }catch{return null;}
}

export function overviewEvidence(a,report){
 const structure=!a.priceFresh?'Price unavailable':a.broken?'Range failed':a.accepted?'Range accepted':'Range intact';
 const leader=a.priceFresh&&usable(report,'QQQ',a.asOf)&&Number.isFinite(a.q?.value)?a.q.value<0?'BTC lags QQQ':a.q.value>0?'BTC leads QQQ':'BTC / QQQ balanced':'Leadership unavailable';
 const spot=a.spotFresh&&Number.isFinite(a.spotBuyShare5)?a.spotBuyShare5<50?'Spot sellers lead':a.spotBuyShare5>=55?'Spot buying confirms':'Spot demand mixed':'Spot demand unavailable';
 return [structure,leader,spot];
}
