import {esc,pct,direction,when} from './market-format.mjs';
import {runnerMode,runnerDetails,formatMode} from './runner-mode.mjs';
export {runnerMode,runnerDetails} from './runner-mode.mjs';
const HOUR=3600000;
const MEME_METHOD='shared-trending-mature-1h-v2';
const validMeme=row=>row?.method===MEME_METHOD&&Number.isFinite(row.meme)&&row.meme>=-100&&row.meme<=10000;
const exclusionLabel=reason=>({missing_pool:'Selected pool unavailable',unknown_pool_age:'Selected pool age unknown',incomplete_1h_window:'Pool has less than one hour of history',unverified_extreme_return:'Unverified 1H return above 10,000%'}[reason]||'Excluded');
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
export function chart(rows,unit='%'){
 const points=(rows||[]).filter(r=>Number.isFinite(r.at)&&Number.isFinite(r.meme)&&Number.isFinite(r.altDelta)).slice(-48);
 if(!points.length)return `<div class="market-chart-empty"><strong>${unit===' pp'?'Awaiting a 24H comparison':'Awaiting a 1H reading'}</strong><span>${unit===' pp'?'Matching observations 24 hours apart are needed.':'One complete price update is needed.'}</span></div>`;
 const end=points.at(-1).at,start=Math.min(points[0].at,end-300000),scale=Math.max(.1,...points.flatMap(r=>[Math.abs(r.meme),Math.abs(r.altDelta),Number.isFinite(r.btcDelta)?Math.abs(r.btcDelta):0]));
 const x=t=>48+(t-start)/(end-start)*425,y=v=>100-v/scale*75;
 const width=Math.max(5,Math.min(14,425/Math.max(points.length,2)*.65));
 const btcLine=points.map((r,i)=>Number.isFinite(r.btcDelta)?`${i&&Number.isFinite(points[i-1].btcDelta)?'L':'M'}${x(r.at)},${y(r.btcDelta)}`:'').join(' ');
 const line=points.map((r,i)=>`${i?'L':'M'}${x(r.at)},${y(r.altDelta)}`).join(' ');
 return `<svg viewBox="0 0 510 205" role="img" aria-label="${unit===' pp'?'Change in one-hour readings versus 24 hours ago, in percentage points':'One-hour changes'}: Meme histogram, Alt and BTC lines centered on zero"><text x="3" y="25">+${scale.toFixed(2)}${unit}</text><text x="22" y="104">0</text><text x="3" y="180">-${scale.toFixed(2)}${unit}</text><line x1="45" x2="490" y1="100" y2="100" stroke="#73849a"/>${points.map(r=>`<rect tabindex="0" role="img" aria-label="${esc(when(r.at))}: Meme ${pct(r.meme,unit)}, Alt ${pct(r.altDelta,unit)}, BTC ${pct(r.btcDelta,unit)}" x="${x(r.at)-width/2}" y="${Math.min(100,y(r.meme))}" width="${width}" height="${Math.max(1,Math.abs(y(r.meme)-100))}" fill="${r.meme>=0?'#2bdfaa':'#fb7185'}"><title>${esc(when(r.at))} · Meme ${pct(r.meme,unit)} · Alt ${pct(r.altDelta,unit)}, BTC ${pct(r.btcDelta,unit)}</title></rect>`).join('')}<path d="${line}" fill="none" stroke="#81baff" stroke-width="2"/><path d="${btcLine}" fill="none" stroke="#f6b85a" stroke-width="2"/>${Number.isFinite(points.at(-1).btcDelta)?`<circle cx="${x(end)}" cy="${y(points.at(-1).btcDelta)}" r="3" fill="#f6b85a"/>`:''}<circle cx="${x(end)}" cy="${y(points.at(-1).altDelta)}" r="3" fill="#81baff"/><text x="48" y="197">${esc(new Date(start).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))}</text><text x="473" y="197" text-anchor="end">${esc(new Date(end).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))}</text></svg>`;
}
export function inputQualityNote(report){
 const last=(report?.readings||[]).filter(row=>row.method===report?.method).at(-1);
 const quality=last?.inputQuality||report?.inputQuality;
 const count=quality?.extremeReturnCount;
 if(!(Number.isInteger(count)&&count>0)&&!(Number.isFinite(last?.meme)&&Math.abs(last.meme)>10000))return '';
 return `<p role="status" class="market-input-quality">${Number.isInteger(count)&&count>0?`${count} provider-reported 1H return${count===1?' is':'s are'} above 10,000% in magnitude.`:'The saved reading contains extreme provider-reported returns.'} ${report?.method===MEME_METHOD?'These observations are excluded from the Meme average. Raw returns are retained below; they are not capped or replaced with zero.':'The legacy Meme calculation is withheld because it did not exclude incomplete launch windows or unverified extreme returns.'}</p>`;
}
function marketState(report,failed,now=Date.now()){
  const last=report?.readings?.filter(row=>row.method===report?.method)?.at(-1),stale=!last||!Number.isFinite(last.at)||now<last.at||now-last.at>75*60000;
  const ready=!failed&&!stale&&last;
  const comparison=ready?compareReading(report.readings,last):null;
  const baseline=comparison?report.readings.find(row=>row.at===comparison.baselineAt):null;
  const memeReady=Boolean(ready)&&validMeme(last);
  const meme=memeReady&&validMeme(baseline)?comparison?.meme:null,alt=comparison?.altDelta,btc=comparison?.btcDelta;
  const status=failed?'Unavailable':stale?(last?'Stale data':'Awaiting data'):report.method!==MEME_METHOD?'Awaiting corrected Meme calculation':!memeReady?'No qualified Meme reading':!Number.isFinite(meme)?'Awaiting mature-pool 24H baseline':report.error||!Number.isFinite(comparison?.btcDelta)?'Partial update':'Live';
  return {last,ready,memeReady,comparison,baseline,status,meme,alt,btc};
}

function memeDisplay(state){
 const current=!Number.isFinite(state.meme)&&state.memeReady;
 return {current,value:current?state.last.meme:state.meme,unit:current?'%':' pp'};
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
 return `<span class="market-overview-title">${meme.current?'MEME CURRENT 1H · ALT/BTC VS 24H AGO':'1H DELTA · VS 24H AGO'} <span aria-hidden="true">↗</span></span><span class="market-overview-values"><span>Meme${meme.current?' · 1H':''} <b class="${direction(meme.value)}" title="${pct(meme.value,meme.unit)}">${headerPercent(meme.value,meme.unit)}</b></span><span>Alt <b class="${direction(alt)}">${headerPercent(alt,' pp')}</b></span><span>Btc <b class="${direction(btc)}">${headerPercent(btc,' pp')}</b></span><span class="market-mode-value">Mode <b class="mode-${Number(mode)||'unknown'}">${formatMode(mode)}</b></span></span>`;
}

function marketDetails(report,state,modeDetails){
 const {last,ready,memeReady,comparison,baseline,status,alt,btc}=state;
 const display=memeDisplay(state);
 const coverage=last?.coverage||report?.coverage;
 const covered=Number.isInteger(coverage?.includedTokens)&&Number.isInteger(coverage?.totalTokens);
 const coverageText=covered?`Meme sample: ${coverage.includedTokens}/${coverage.totalTokens} shared pools included; ${coverage.excludedTokens} excluded.`:'';
 return `<p>Eligible mature pools from the shared trending sample · hourly update · ${display.current?'Meme shows the current 1H change (%). Alt and BTC show the difference versus their 1H readings 24 hours earlier, in percentage points (pp).':'difference between the current 1H reading and the 1H reading 24 hours earlier, in percentage points (pp).'}</p><p class="market-reading">Meme${display.current?' · current 1H':''} <strong>${pct(display.value,display.unit)}</strong> · Alt <strong>${pct(alt,' pp')}</strong> · BTC <strong>${pct(btc,' pp')}</strong> · ${status}</p>
 ${covered?`<p class="market-input-quality">${esc(coverageText)} ${Object.entries(coverage.exclusions||{}).map(([reason,count])=>`${esc(exclusionLabel(reason))}: ${esc(count)}`).join(' · ')}</p>`:''}
 ${display.current?'<p role="status">24H comparison · Meme —. Awaiting a matching reading from the same calculation method 24 hours earlier. The header shows the available current 1H change and will switch to the comparison automatically.</p>':''}
 <p>Current 1H: Meme ${pct(memeReady?last.meme:null)} · Alt ${pct(ready?last.altDelta:null)} · BTC ${pct(ready?last.btcDelta:null)}</p>
 <p>1H reading 24H ago: ${comparison?esc(when(comparison.baselineAt)):'Awaiting matching history'}</p>${comparison?`<p>Meme ${pct(validMeme(baseline)?baseline.meme:null)} · Alt ${pct(baseline?.altDelta)} · BTC ${pct(baseline?.btcDelta)}</p>`:''}<div class="market-chart">${chart(hourlyComparisons((report?.readings||[]).filter(validMeme)),' pp')}</div><div class="market-overview-legend"><span><i class="market-histogram-key"></i>Meme · histogram</span><span><i class="market-alt-key"></i>Alt · line</span><span><i class="market-btc-key"></i>BTC · line</span></div><p class="market-timestamp">Updated ${esc(when(last?.at))}</p>${inputQualityNote(report)}${report?.error?`<p role="status">${esc(report.error)}</p>`:''}${modeDetails}<details class="market-method"><summary>Basket · ${report?.basket?.length||0} observed pools${covered?` · ${coverage.includedTokens} included`:''}</summary><p>Meme: equal-weight arithmetic average of qualified one-hour USD price changes in the shared 1H trending sample. The exact selected pool must have existed for at least one hour at the quote's original observation time. Missing pool identity or age, incomplete launch windows, and unverified returns above 10,000% are excluded, with raw observations retained below. Included pools share equal weight; exclusions are never capped or replaced with zero. Membership follows the shared ranking each hour. Existing observations are reused; missing or stale price inputs withhold the reading. Older calculation methods remain in history but are never compared with this method.</p>
 <p>Alt: market-cap-weighted one-hour change of the 25 largest eligible altcoins in CoinLore's top-50 feed, excluding BTC, ETH, stablecoins, and wrapped assets. The group is selected from each fresh feed. Readings are sampled hourly. The chart shows changes in 1H readings versus 24 hours earlier, one point per hour. A historical reading within 10 minutes of the target is required; missing comparisons stay unavailable. Basket membership can change between the two readings.</p>
 <p>BTC: Bitcoin's one-hour USD price change from the same CoinLore feed, with no additional data request. Missing BTC changes display as an em dash; older readings are not backfilled.</p>
 <p>Pool selected ${esc(when(report?.rebalancedAt))} · oldest market observation ${esc(when(report?.marketObservedAt))}</p><ol>${(report?.basket||[]).map(t=>`<li><strong>${esc(t.symbol)}</strong> · ${esc(t.chain)} · raw 1H ${pct(t.priceChange1h)} · ${t.eligible===true?`${Number.isFinite(t.weight)?(100*t.weight).toFixed(2):'—'}% weight`:`Excluded: ${esc(exclusionLabel(t.exclusionReason))}`} · ${esc(t.priceSource)}<small>${esc(t.address)} · pool ${esc(t.pool||'unknown')} · created ${esc(when(t.poolCreatedAt))}</small></li>`).join('')}</ol></details>`;
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
  const meme=memeDisplay(state);
  market.setAttribute('aria-label',`${meme.current?`Meme current 1H ${pct(meme.value,meme.unit)}. Meme 24H comparison unavailable. Alt and BTC changes in 1 hour readings versus 24 hours ago.`:`Change in 1 hour readings versus 24 hours ago. Meme ${pct(state.meme,' pp')}.`} Alt ${pct(state.alt,' pp')}, BTC ${pct(state.btc,' pp')}. ${state.status}. Solana Mode ${formatMode(mode)}. Open details`);
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
