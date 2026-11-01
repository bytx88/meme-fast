import {esc,pct,direction,when} from './market-format.mjs';
import {runnerMode,runnerDetails,formatMode} from './runner-mode.mjs';
export {runnerMode,runnerDetails} from './runner-mode.mjs';
const HOUR=3600000;
const fixedPresetSize=method=>Number(/^fixed-preset-([1-9]|[12]\d|30)-1h-v1-[0-9a-f]{12}$/.exec(method||'')?.[1])||null;
const isFixedMethod=method=>fixedPresetSize(method)!==null;
const validMeme=row=>{const size=fixedPresetSize(row?.method);return size!==null&&row?.coverage?.totalTokens===size&&row.coverage.includedTokens===size&&row.coverage.excludedTokens===0&&Number.isFinite(row.meme)&&row.meme>=-100&&row.meme<=10000};
const exclusionLabel=reason=>({awaiting_collection:'Awaiting collection',missing_quote:'Quote unavailable',source_unavailable:'Market source unavailable',provider_unavailable:'Market provider unavailable',missing_observation:'Quote observation time unavailable',missing_return:'1H return unavailable',invalid_return:'Invalid 1H return',stale_quote:'Quote is stale',invalid_change:'Invalid 1H return',missing_pool:'Selected pool unavailable',unknown_pool_age:'Selected pool age unknown',incomplete_1h_window:'Pool has less than one hour of history',unverified_extreme_return:'Unverified 1H return above 10,000%'}[reason]||'Quote unavailable');
const hasComponentComparison=row=>Boolean(row&&Object.hasOwn(row,'memeComparison'));
const validReturn=value=>Number.isFinite(value)&&value>=-100&&value<=10000;
const close=(left,right)=>Number.isFinite(left)&&Number.isFinite(right)&&Math.abs(left-right)<=1e-8*Math.max(1,Math.abs(left),Math.abs(right));
const basketId=row=>row?.id||`${row?.chain}:${row?.address}`;
const hasMembershipProjection=report=>Boolean(report&&(Object.hasOwn(report,'membershipReading')||Object.hasOwn(report,'membershipProjection')));
const matchingAdmissions=(components,admissions)=>Boolean(Array.isArray(components)&&admissions&&typeof admissions==='object'&&!Array.isArray(admissions)&&Object.keys(admissions).length===components.length&&components.every(component=>{
 const admission=admissions[component?.id];return admission&&admission.kind===component.kind&&admission.addedAt===component.addedAt;
}));
function componentEvidence(row,basket,allowLegacy=false,projectedPending,admissions,allowUnavailable=false){
 const size=fixedPresetSize(row?.method),engine=row?.memeComparison,coverage=row?.coverage;
 const legacy=allowLegacy&&engine?.method==='component-1h-vs24h-v2';
 if(row&&Object.hasOwn(row,'membershipProjection')&&!projectedPending)return null;
 if(size===null||!Number.isFinite(row.at)||(!legacy&&engine?.method!=='component-1h-vs24h-v3')||engine.at!==row.at||!Array.isArray(engine.components)||engine.components.length!==size)return null;
 if(coverage?.totalTokens!==size||!Number.isInteger(coverage.includedTokens)||coverage.includedTokens<0||coverage.includedTokens>size||coverage.excludedTokens!==size-coverage.includedTokens)return null;
 // Earlier complete active comparisons have the same denominator. Warming v2
 // readings diluted existing members and cannot be reused as chart evidence.
 if(legacy&&(!validMeme(row)||engine.components.some(component=>component?.status!=='active')))return null;
 const ids=engine.components.map(component=>component?.id);
 if(ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==size)return null;
 if(admissions!==undefined&&!matchingAdmissions(engine.components,admissions))return null;
 if(basket!==undefined&&(!Array.isArray(basket)||basket.length!==size||new Set(basket.map(basketId)).size!==size||basket.some((member,index)=>ids[index]!==basketId(member))))return null;
 const excluded=component=>['warming','pending'].includes(component?.status);
 const denominator=engine.components.filter(component=>!excluded(component)).length;
 if(!legacy&&engine.denominator!==denominator)return null;
 let active=0,warming=0,awaiting=0,unavailable=0,delta=0,current=0,qualified=0;
 for(const component of engine.components){
  if(!close(component.weight,excluded(component)||!denominator?0:1/denominator))return null;
  if(!['existing','added'].includes(component.kind)||component.kind==='existing'&&component.addedAt!==null||component.kind==='added'&&(!Number.isFinite(component.addedAt)||component.addedAt<=0||component.addedAt>row.at&&!projectedPending?.has(component.id)))return null;
  const currentEligible=legacy||component.currentEligible;
  if(!legacy&&typeof currentEligible!=='boolean')return null;
  if(currentEligible){
   if(!validReturn(component.currentReturn)||!Number.isFinite(component.currentObservedAt)||component.currentObservedAt<=0||row.at<component.currentObservedAt||row.at-component.currentObservedAt>=15*60000)return null;
   qualified++;current+=component.currentReturn;
  }else{
   if(!excluded(component)&&!(allowUnavailable&&component.status==='unavailable')||component.currentReturn!==null&&!Number.isFinite(component.currentReturn)||component.currentObservedAt!==null&&!Number.isFinite(component.currentObservedAt))return null;
  }
  if(component.status==='active'){
   active++;
   if(!currentEligible||!validReturn(component.baselineReturn)||!['saved-h1','gecko-5m-close'].includes(component.baselineSource)||!Number.isFinite(component.baselineObservedAt)||Math.abs(component.baselineObservedAt-(component.currentObservedAt-24*HOUR))>10*60000||component.baselineWindowEndAt!==component.baselineObservedAt||component.baselineWindowStartAt!==component.baselineWindowEndAt-HOUR||!close(component.delta,component.currentReturn-component.baselineReturn))return null;
  }else if(component.status==='warming'){
   warming++;
   if(component.kind!=='added'||component.reason!=='neutral_until_24h'||component.delta!==0||!validReturn(component.initialReturn)||component.baselineReturn!==component.initialReturn||component.baselineSource!=='initial-reference'||!Number.isFinite(component.firstAt)||component.firstAt<component.addedAt||!Number.isFinite(component.firstObservedAt)||component.firstObservedAt<=0||component.firstAt<component.firstObservedAt||component.firstAt-component.firstObservedAt>=15*60000||component.baselineObservedAt!==component.firstObservedAt||component.warmUntil!==component.firstAt+24*HOUR||row.at<component.firstAt||row.at>=component.warmUntil||component.baselineWindowStartAt!=null||component.baselineWindowEndAt!=null)return null;
  }else if(component.status==='pending'){
   warming++;
   if(component.kind!=='added'||currentEligible||component.delta!==0||component.reason!=='awaiting_initial_quote'||['initialReturn','firstAt','firstObservedAt','warmUntil','baselineReturn','baselineObservedAt','baselineSource','baselineWindowStartAt','baselineWindowEndAt'].some(key=>component[key]!==null))return null;
  }else if(component.status==='awaiting_history'){
   awaiting++;
   if(!currentEligible||component.kind!=='existing'||component.reason!=='missing_24h_baseline'||component.warmUntil!==null||['delta','baselineReturn','baselineObservedAt','baselineSource','baselineWindowStartAt','baselineWindowEndAt'].some(key=>component[key]!==null))return null;
  }else if(allowUnavailable&&component.status==='unavailable'){
   unavailable++;
   if(['delta','baselineReturn','baselineObservedAt','baselineSource','baselineWindowStartAt','baselineWindowEndAt'].some(key=>component[key]!==null))return null;
  }else return null;
  if(!['awaiting_history','unavailable'].includes(component.status))delta+=component.delta;
 }
 if(qualified!==coverage.includedTokens||(qualified===size?(!validMeme(row)||!close(current/size,row.meme)):row.meme!==null))return null;
 if(engine.matchedMembers!==active||engine.warmingMembers!==warming||engine.awaitingHistoryMembers!==awaiting||engine.unavailableMembers!==unavailable||active+warming+awaiting+unavailable!==size||(awaiting||unavailable||!denominator?engine.value!==null:!close(delta/denominator,engine.value)))return null;
 return engine;
}
function membershipEvidence(report){
 const row=report?.membershipReading,marker=row?.membershipProjection,reportMarker=report?.membershipProjection;
 const markerKeys=['sourceMethod','sourceAt','configuredAt','revision'];
 if(!row||!marker||!reportMarker||markerKeys.some(key=>!Object.hasOwn(marker,key)||!Object.hasOwn(reportMarker,key)||marker[key]!==reportMarker[key]))return null;
 if(row.method!==report.method||!isFixedMethod(marker.sourceMethod)||marker.sourceAt!==row.at||!Number.isFinite(marker.configuredAt)||marker.configuredAt<0||marker.configuredAt!==report.presetUpdatedAt||typeof marker.revision!=='string'||!marker.revision||marker.revision!==report.presetRevision)return null;
 const sources=(Array.isArray(report.readings)?report.readings:[]).filter(source=>source?.at===marker.sourceAt&&source.method===marker.sourceMethod);
 if(sources.length!==1||sources[0].memeComparison?.method!=='component-1h-vs24h-v3')return null;
 const sourceEngine=componentEvidence(sources[0],undefined,false,undefined,undefined,true);
 if(!sourceEngine)return null;
 const components=row.memeComparison?.components,admissions=report.presetAdmissions;
 if(!Array.isArray(components)||!matchingAdmissions(components,admissions))return null;
 const original=new Map(sourceEngine.components.map(component=>[component.id,component])),pending=new Set();
 for(const component of components){
  const admission=admissions[component?.id],previous=original.get(component?.id);
  if(!admission||admission.kind!==component.kind||admission.addedAt!==component.addedAt)return null;
  if(previous&&previous.kind===component.kind&&previous.addedAt===component.addedAt){
   // A membership edit may change effective weights, never observed evidence or
   // the admission clock belonging to an unchanged exact contract.
   const fields=new Set([...Object.keys(previous),...Object.keys(component)]);
   if([...fields].some(key=>key!=='weight'&&(!Object.hasOwn(previous,key)||!Object.hasOwn(component,key)||!Object.is(previous[key],component[key]))))return null;
  }else{
   if(component.kind!=='added'||component.status!=='pending'||!Number.isFinite(component.addedAt)||component.addedAt<=0||component.addedAt>marker.configuredAt||component.currentReturn!==null||component.currentObservedAt!==null)return null;
   pending.add(component.id);
  }
 }
 const engine=componentEvidence(row,report.basket,false,pending);
 return engine?{row,engine}:null;
}
export function componentComparison(row,basket,allowLegacy=false,reportContext){
 const engine=row&&Object.hasOwn(row,'membershipProjection')?
  reportContext?.membershipReading===row?membershipEvidence(reportContext)?.engine:null:componentEvidence(row,basket,allowLegacy,undefined,reportContext?.presetAdmissions);
 return Number.isFinite(engine?.value)?engine:null;
}
// Match the same observation time yesterday; allow legacy five-minute samples and collector jitter.
export function compareReading(rows,current=rows?.at(-1)){
 if(!current||!Number.isFinite(current.at))return null;
 const target=current.at-24*HOUR;
 const prior=(rows||[]).filter(r=>Number.isFinite(r.at)&&r.at<current.at&&Math.abs(r.at-target)<=10*60000)
  .reduce((best,r)=>!best||Math.abs(r.at-target)<Math.abs(best.at-target)?r:best,null);
 if(!prior)return null;
 const difference=key=>key==='meme'&&current.method!==prior.method?null:Number.isFinite(current[key])&&Number.isFinite(prior[key])?current[key]-prior[key]:null;
 return {at:current.at,baselineAt:prior.at,meme:difference('meme'),altDelta:difference('altDelta'),btcDelta:difference('btcDelta')};
}
export function hourlyComparisons(rows){
 const hours=new Map();
 for(const row of rows||[]){if(!Number.isFinite(row.at))continue;const hour=Math.floor(row.at/HOUR),saved=hours.get(hour);if(!saved||row.at>saved.at)hours.set(hour,row)}
 return [...hours.values()].sort((a,b)=>a.at-b.at).slice(-48).map(row=>compareReading(rows,row)).filter(Boolean);
}
export function memeComparisons(rows,method,basket){
 const hours=new Map();
 for(const row of rows||[]){
  if(!Number.isFinite(row.at))continue;
  let point;
  if(hasComponentComparison(row)){
   const engine=componentComparison(row,row.method===method?basket:undefined,true);
   if(!engine)continue;
   const benchmarks=compareReading(rows,row);
   point={at:row.at,meme:engine.value,altDelta:benchmarks?.altDelta??null,btcDelta:benchmarks?.btcDelta??null};
  }else if(validMeme(row)&&row.method===method){
   point=compareReading((rows||[]).filter(saved=>validMeme(saved)&&saved.method===method),row);
  }
  if(!Number.isFinite(point?.meme))continue;
  const hour=Math.floor(row.at/HOUR),saved=hours.get(hour);
  if(!saved||row.at>saved.at)hours.set(hour,point);
 }
 return [...hours.values()].sort((a,b)=>a.at-b.at).slice(-48);
}
export function chart(rows,unit='%'){
 const points=(rows||[]).filter(r=>Number.isFinite(r.at)&&Number.isFinite(r.meme)).slice(-48);
 if(!points.length)return `<div class="market-chart-empty"><strong>${unit===' pp'?'Awaiting a 24H comparison':'Awaiting a 1H reading'}</strong><span>${unit===' pp'?'Matching observations 24 hours apart are needed.':'One complete price update is needed.'}</span></div>`;
 const end=points.at(-1).at,start=Math.min(points[0].at,end-300000),scale=Math.max(.1,...points.flatMap(r=>[r.meme,r.altDelta,r.btcDelta].filter(Number.isFinite).map(Math.abs)));
 const x=t=>48+(t-start)/(end-start)*425,y=v=>100-v/scale*75;
 const width=Math.max(5,Math.min(14,425/Math.max(points.length,2)*.65));
 const btcLine=points.map((r,i)=>Number.isFinite(r.btcDelta)?`${i&&Number.isFinite(points[i-1].btcDelta)?'L':'M'}${x(r.at)},${y(r.btcDelta)}`:'').join(' ');
 const line=points.map((r,i)=>Number.isFinite(r.altDelta)?`${i&&Number.isFinite(points[i-1].altDelta)?'L':'M'}${x(r.at)},${y(r.altDelta)}`:'').join(' ');
 return `<svg viewBox="0 0 510 205" role="img" aria-label="${unit===' pp'?'Change in one-hour readings versus 24 hours ago, in percentage points':'One-hour changes'}: Meme histogram, Alt and BTC lines centered on zero"><text x="3" y="25">+${scale.toFixed(2)}${unit}</text><text x="22" y="104">0</text><text x="3" y="180">-${scale.toFixed(2)}${unit}</text><line x1="45" x2="490" y1="100" y2="100" stroke="#73849a"/>${points.map(r=>`<rect tabindex="0" role="img" aria-label="${esc(when(r.at))}: Meme ${pct(r.meme,unit)}, Alt ${pct(r.altDelta,unit)}, BTC ${pct(r.btcDelta,unit)}" x="${x(r.at)-width/2}" y="${Math.min(100,y(r.meme))}" width="${width}" height="${Math.max(1,Math.abs(y(r.meme)-100))}" fill="${r.meme>=0?'#2bdfaa':'#fb7185'}"><title>${esc(when(r.at))} · Meme ${pct(r.meme,unit)} · Alt ${pct(r.altDelta,unit)}, BTC ${pct(r.btcDelta,unit)}</title></rect>`).join('')}<path d="${line}" fill="none" stroke="#81baff" stroke-width="2"/><path d="${btcLine}" fill="none" stroke="#f6b85a" stroke-width="2"/>${Number.isFinite(points.at(-1).btcDelta)?`<circle cx="${x(end)}" cy="${y(points.at(-1).btcDelta)}" r="3" fill="#f6b85a"/>`:''}${Number.isFinite(points.at(-1).altDelta)?`<circle cx="${x(end)}" cy="${y(points.at(-1).altDelta)}" r="3" fill="#81baff"/>`:''}<text x="48" y="197">${esc(new Date(start).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))}</text><text x="473" y="197" text-anchor="end">${esc(new Date(end).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))}</text></svg>`;
}
export function inputQualityNote(report){
 const last=hasMembershipProjection(report)?membershipEvidence(report)?.row:(report?.readings||[]).filter(row=>row.method===report?.method).at(-1);
 const quality=last?.inputQuality||report?.inputQuality;
 const count=quality?.extremeReturnCount;
 if(!(Number.isInteger(count)&&count>0)&&!(Number.isFinite(last?.meme)&&Math.abs(last.meme)>10000))return '';
 const size=fixedPresetSize(report?.method);
 return `<p role="status" class="market-input-quality">${Number.isInteger(count)&&count>0?`${count} provider-reported 1H return${count===1?' is':'s are'} above 10,000% in magnitude.`:'The saved reading contains extreme provider-reported returns.'} ${size!==null?`These observations are unavailable for the Meme calculation. ${hasComponentComparison(last)?'The complete raw 1H average':'The complete reading'} is withheld until all ${size} preset members have fresh qualified quotes. Raw returns are retained below; they are not capped or replaced with zero.`:'The legacy Meme calculation is withheld. Only the manually managed fixed preset is used for new Meme readings.'}</p>`;
}
function marketState(report,failed,now=Date.now()){
  const projected=hasMembershipProjection(report),last=projected?report?.membershipReading:report?.readings?.filter(row=>row.method===report?.method)?.at(-1),stale=!last||!Number.isFinite(last.at)||now<last.at||now-last.at>75*60000;
  const ready=!failed&&!stale&&last;
  const usesComponents=projected||hasComponentComparison(last);
  const components=ready&&usesComponents?projected?membershipEvidence(report)?.engine:componentEvidence(last,report?.basket,false,undefined,report?.presetAdmissions):null;
  const admissionSafe=projected?Boolean(components):report?.presetAdmissions===undefined||matchingAdmissions(usesComponents?last?.memeComparison?.components||[]:(report?.basket||[]).map(member=>({id:basketId(member),kind:'existing',addedAt:null})),report.presetAdmissions);
  const memeReady=Boolean(ready)&&validMeme(last)&&admissionSafe;
  const memeHistory=(report?.readings||[]).filter(row=>validMeme(row)&&row.method===last?.method);
  const comparison=memeReady&&!usesComponents?compareReading(memeHistory,last):null;
  const baseline=comparison?memeHistory.find(row=>row.at===comparison.baselineAt):null;
  // A method migration or coverage repair can leave no reading for the active
  // Meme preset. Independent benchmarks still use fresh, genuinely matched rows.
  const benchmarkCurrent=!failed&&Array.isArray(report?.readings)?[...report.readings].reverse().find(row=>Number.isFinite(row.at)&&0<=now-row.at&&now-row.at<=75*60000&&(()=>{const pair=compareReading(report.readings,row);return Number.isFinite(pair?.altDelta)||Number.isFinite(pair?.btcDelta)})()):null;
  const benchmarkComparison=benchmarkCurrent?compareReading(report.readings,benchmarkCurrent):null;
  const benchmarkBaseline=benchmarkComparison?report.readings.find(row=>row.at===benchmarkComparison.baselineAt):null;
  const meme=usesComponents?components?.value:memeReady&&validMeme(baseline)?comparison?.meme:null,alt=benchmarkComparison?.altDelta,btc=benchmarkComparison?.btcDelta;
  const pending=components?.components.filter(component=>component.status==='pending').length||0,warming=(components?.warmingMembers||0)-pending;
  const status=failed?'Unavailable':stale?(last?'Stale data':'Awaiting data'):!isFixedMethod(report.method)?'Awaiting fixed preset calculation':usesComponents&&!components?'Component comparison unavailable':!usesComponents&&!memeReady?'Incomplete preset data':components?.awaitingHistoryMembers?'Recovering 24H history':components?.warmingMembers?[warming?`${warming} new member${warming===1?'':'s'} warming`:'',pending?`${pending} new member${pending===1?'':'s'} awaiting initial quote`:''].filter(Boolean).join(' · '):!Number.isFinite(meme)?'Awaiting fixed preset 24H baseline':report.error||!Number.isFinite(btc)?'Partial update':'Live';
  return {last,ready,memeReady,comparison,baseline,status,meme,alt,btc,benchmarkCurrent,benchmarkComparison,benchmarkBaseline,usesComponents,components};
}

function memeDisplay(state){
 return {value:state.meme,unit:' pp'};
}

// Keep extreme provider returns readable in the header; details retain the full value.
function headerPercent(value,unit){
 if(!Number.isFinite(value)||Math.abs(value)<10000)return pct(value,unit);
 const magnitude=Math.abs(value),suffixes=[[1e12,'T'],[1e9,'B'],[1e6,'M'],[1e3,'K']];
 if(magnitude>=1e15)return `${value>=0?'+':''}${value.toExponential(1).replace('e+','e')}${unit}`;
 const [scale,suffix]=suffixes.find(([scale])=>magnitude>=scale);
 return `${value>=0?'+':''}${(value/scale).toFixed(2)}${suffix}${unit}`;
}

function marketOverview(state,mode){
 const {alt,btc}=state,meme=memeDisplay(state);
 return `<span class="market-overview-title">1H DELTA · VS 24H AGO <span aria-hidden="true">↗</span></span><span class="market-overview-values"><span>Meme <b class="${direction(meme.value)}" title="${pct(meme.value,meme.unit)}">${headerPercent(meme.value,meme.unit)}</b></span><span>Alt <b class="${direction(alt)}">${headerPercent(alt,' pp')}</b></span><span>Btc <b class="${direction(btc)}">${headerPercent(btc,' pp')}</b></span><span class="market-mode-value">Mode <b class="mode-${Number(mode)||'unknown'}">${formatMode(mode)}</b></span></span>`;
}

function memberComparisonDetails(component,validated){
 if(!component||typeof component!=='object')return '';
 if(!validated)return `<small>24H comparison unavailable${component.status==='unavailable'&&component.reason?`: ${esc(String(component.reason).replaceAll('_',' '))}`:''}.</small>`;
 if(component.status==='awaiting_history')return '<small>Recovering 24H history. Existing member; no new-member warmup.</small>';
 if(component.status==='pending')return '<small>Awaiting initial qualified quote · zero comparison weight. The 24H warmup has not started.</small>';
 if(component.status==='warming')return `<small>24H comparison: warming · neutral +0.00 pp. Initial reference copied from the first observed 1H return ${pct(component.initialReturn)} at ${esc(when(component.firstObservedAt))}; this is not a historical baseline. Neutral until ${esc(when(component.warmUntil))} (24H warmup).</small>`;
 const source=component.baselineSource==='saved-h1'?'saved 1H observation':'Gecko 5-minute closes';
 return `<small>24H comparison: ${pct(component.delta,' pp')} · baseline ${pct(component.baselineReturn)} observed ${esc(when(component.baselineObservedAt))} · source: ${source}. Historical 1H window ${esc(when(component.baselineWindowStartAt))}–${esc(when(component.baselineWindowEndAt))}.</small>`;
}

function marketDetails(report,state,modeDetails){
 const {last,ready,memeReady,comparison,baseline,status,alt,btc,benchmarkCurrent,benchmarkComparison,benchmarkBaseline,usesComponents,components}=state;
 const display=memeDisplay(state);
 const size=fixedPresetSize(report?.method);
 const coverage=last?.coverage||report?.coverage;
 const covered=size!==null&&coverage?.totalTokens===size&&Number.isInteger(coverage?.includedTokens)&&Number.isInteger(coverage?.excludedTokens);
 const coverageText=covered?`${coverage.includedTokens}/${size} fresh qualified; ${coverage.excludedTokens} unavailable${coverage.includedTokens<size?usesComponents?'; complete raw 1H average withheld':'; complete Meme reading withheld':''}.`:'';
 const presetLabel=size!==null?`Fixed ${size}-coin preset`:'Fixed preset';
 const members=(report?.basket||[]).map(t=>esc(t.symbol)).join(', ');
 const memberWeight=size!==null?1/size:null;
 const componentRows=components?.components||last?.memeComparison?.components;
 const comparisonMembers=new Map((Array.isArray(componentRows)?componentRows:[]).filter(component=>component&&typeof component.id==='string').map(component=>[component.id,component]));
 const pendingMembers=components?.components.filter(component=>component.status==='pending').length||0;
 const componentSummary=usesComponents?components?`<p class="market-input-quality">Per-member comparison: ${components.matchedMembers}/${size} matched historical baselines · ${components.warmingMembers-pendingMembers} warming${pendingMembers?` · ${pendingMembers} awaiting initial quote`:""}${components.awaitingHistoryMembers?` · ${components.awaitingHistoryMembers} existing awaiting history`:""} · 0 unavailable.</p>${components.warmingMembers?'<p role="status">Warming members: only newly added contracts copy their first observed 1H return and stay neutral until 24H. This reference is not a real historical baseline. A pending addition waits for its first qualified quote before its 24H warmup begins. Missing quotes for an excluded addition do not interrupt existing members’ comparisons.</p>':''}`:'<p role="status">Component comparison evidence is incomplete or unavailable. Meme is withheld; an available raw 1H average does not replace the comparison.</p>':'';
 return `<p>${presetLabel} · equal weight · hourly · ${usesComponents?'Meme averages each active member’s change in its 1H return versus its own 24H baseline. Newly added warming members have no influence until activation. Values are percentage points (pp).':'difference between the current 1H reading and the 1H reading 24 hours earlier, in percentage points (pp).'}</p><p class="market-reading">Meme <strong>${pct(display.value,display.unit)}</strong> · Alt <strong>${pct(alt,' pp')}</strong> · BTC <strong>${pct(btc,' pp')}</strong> · ${status}</p>
 ${componentSummary}
 ${covered?`<p class="market-input-quality">${esc(coverageText)} ${Object.entries(coverage.exclusions||{}).map(([reason,count])=>`${esc(exclusionLabel(reason))}: ${esc(count)}`).join(' · ')}</p>`:''}
 ${memeReady&&!Number.isFinite(display.value)?'<p role="status">24H comparison · Meme —. Recovering matching historical observations. The current 1H average remains separate from the 24H comparison.</p>':''}
 <p>Current 1H: Meme ${pct(memeReady?last.meme:null)} · Alt ${pct(benchmarkCurrent?.altDelta)} · BTC ${pct(benchmarkCurrent?.btcDelta)}</p>
 ${benchmarkComparison?`<p>Alt/BTC comparison: observed ${esc(when(benchmarkCurrent.at))} · baseline ${esc(when(benchmarkComparison.baselineAt))}. Baseline 1H: Alt ${pct(benchmarkBaseline?.altDelta)} · BTC ${pct(benchmarkBaseline?.btcDelta)}. Only matching observations within the 75-minute freshness limit are used.</p>`:''}
 ${usesComponents?'<p>Meme 24H baselines: each exact contract uses its own observation; see member details below.</p>':`<p>Meme 1H reading 24H ago: ${validMeme(baseline)&&baseline.method===last?.method?`${esc(when(baseline.at))} · ${pct(baseline.meme)}`:'Awaiting matching history'}</p>`}<div class="market-chart">${chart(memeComparisons(report?.readings,report?.method,report?.basket),' pp')}</div><div class="market-overview-legend"><span><i class="market-histogram-key"></i>Meme · histogram</span><span><i class="market-alt-key"></i>Alt · line</span><span><i class="market-btc-key"></i>BTC · line</span></div><p class="market-timestamp">Updated ${esc(when(last?.at))}</p>${inputQualityNote(report)}${report?.error?`<p role="status">${esc(report.error)}</p>`:''}${modeDetails}<details class="market-method"><summary>Basket · ${report?.basket?.length||0} preset members${covered?` · ${coverage.includedTokens} fresh qualified`:''}</summary><p>Meme: the manually managed fixed preset${members?` is ${members}`:' awaits its member list'}. ${size!==null?`Each member carries 1/${size} weight (${(100/size).toFixed(2)}%). ${usesComponents?'The separate current 1H reading':'The reading'} is the arithmetic average of all ${size} one-hour USD price changes`:'The reading is the arithmetic average of every preset member’s one-hour USD price change'}, and is published only when every member has a fresh qualified quote. Missing or invalid observations withhold the complete ${usesComponents?'raw 1H average':'Meme reading'}; the remaining quote returns are never reweighted and missing returns are never replaced with zero. The exact selected pool must have existed for at least one hour at the quote's original observation time. Missing pool identity or age, incomplete launch windows, and unverified returns above 10,000% make the quote unavailable, with raw observations retained below. Membership never follows trending rankings; it changes only through Admin. ${usesComponents?'Each exact contract keeps its own actual 24H baseline across basket edits. Existing members retain their actual recorded comparisons across basket edits and do not restart a warmup. The Meme comparison averages the deltas of the contributing members; newly added warming contracts are excluded from its denominator until activation. Only a genuinely added contract without a historical baseline copies its first observed return as an initial reference and contributes a neutral 0.00 pp for 24H. A warming addition has zero comparison weight and cannot dilute the existing members. Current 1H readings remain separate from the 24H comparison. After its warmup, a missing actual baseline withholds Meme. The copied reference is never represented as a historical price.':'Only identical membership can share a 24H baseline. Only readings from the identical preset are compared; older calculation methods remain in history but are withheld from Meme comparisons.'}</p>
 <p>Alt: market-cap-weighted one-hour change of the 25 largest eligible altcoins in CoinLore's top-50 feed, excluding BTC, ETH, stablecoins, and wrapped assets. The Alt group is selected from each fresh feed and can change. Readings are sampled hourly. The chart shows changes in 1H readings versus 24 hours earlier, one point per hour. A historical reading within 10 minutes of the target is required; missing comparisons stay unavailable.</p>
 <p>BTC: Bitcoin's one-hour USD price change from the same CoinLore feed, with no additional data request. Missing BTC changes display as an em dash; older readings are not backfilled.</p>
 <p>Preset selected ${esc(when(report?.rebalancedAt))} · oldest market observation ${esc(when(report?.marketObservedAt))}</p><ol>${(report?.basket||[]).map(t=>`<li><strong>${esc(t.symbol)}</strong> · ${esc(t.chain)} · raw 1H ${pct(t.priceChange1h)} · ${Number.isFinite(memberWeight)?(100*memberWeight).toFixed(2):'—'}% weight · ${t.eligible===true?'Fresh qualified':`Unavailable: ${esc(exclusionLabel(t.exclusionReason))}`} · ${esc(t.priceSource)}<small>${esc(t.address)} · pool ${esc(t.pool||'unknown')} · created ${esc(when(t.poolCreatedAt))}</small>${usesComponents?memberComparisonDetails(comparisonMembers.get(basketId(t)),Boolean(components)):''}</li>`).join('')}</ol></details>`;
}

async function fetchReport(url,valid){
 const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Market report unavailable');
 const data=await response.json();
 if(!valid(data))throw Error('Invalid market report');
 return data;
}

export function mountMarket(market,dialog){
 const delta={report:null,failed:false},runner={report:null,failed:false};
 const body=dialog.querySelector('.market-content');
 function render(){
  const state=marketState(delta.report,delta.failed);
  const mode=runner.failed?'—':runnerMode(runner.report);
  market.innerHTML=marketOverview(state,mode);
  market.setAttribute('aria-label',`Change in 1 hour readings versus 24 hours ago. Meme ${pct(state.meme,' pp')}. Alt ${pct(state.alt,' pp')}, BTC ${pct(state.btc,' pp')}. ${state.status}. Solana Mode ${formatMode(mode)}. Open details`);
  body.innerHTML=marketDetails(delta.report,state,runnerDetails(runner.report,runner.failed));
 }
 async function refresh(url,target,valid){
  try{target.report=await fetchReport(url,valid);target.failed=false}
  catch{target.failed=true}
  render();
 }
 function refreshAll(){
  // Independent requests: either report can succeed while the other fails.
  refresh('/api/meme-index',delta,data=>Array.isArray(data?.readings)&&Array.isArray(data?.basket));
  refresh('/api/runner-mode',runner,data=>data?.version===1&&Boolean(data.counts24h));
 }
 render();refreshAll();
 setInterval(()=>{if(!document.hidden)refreshAll()},60000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshAll()});
}
