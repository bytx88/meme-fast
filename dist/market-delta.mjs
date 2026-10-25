import {esc,pct,direction,when} from './market-format.mjs';
import {runnerMode,runnerDetails,formatMode} from './runner-mode.mjs';
export {runnerMode,runnerDetails} from './runner-mode.mjs';
const HOUR=3600000;
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
 return `<p role="status" class="market-input-quality">${Number.isInteger(count)&&count>0?`${count} provider-reported 1H return${count===1?' is':'s are'} above 10,000% in magnitude.`:'The saved reading contains extreme provider-reported returns.'} A few tokens can dominate this equal-weight average. Returns are not capped; check the constituent observations below.</p>`;
}
function marketState(report,failed,now=Date.now()){
  const last=report?.readings?.filter(row=>row.method===report?.method)?.at(-1),stale=!last||now-last.at>75*60000;
  const ready=!failed&&!stale&&last;
  const comparison=ready?compareReading(report.readings,last):null;
  const baseline=comparison?report.readings.find(row=>row.at===comparison.baselineAt):null;
  const status=failed?'Unavailable':stale?(last?'Stale data':'Awaiting data'):!comparison?'Awaiting 24H baseline':!Number.isFinite(comparison.meme)?'Awaiting shared-pool 24H baseline':report.error||!Number.isFinite(comparison.btcDelta)?'Partial update':'Live';
  const meme=comparison?.meme,alt=comparison?.altDelta,btc=comparison?.btcDelta;
  return {last,ready,comparison,baseline,status,meme,alt,btc};
}

function marketOverview(state,mode){
 const {meme,alt,btc}=state;
 return `<span class="market-overview-title">1H DELTA · VS 24H AGO <span aria-hidden="true">↗</span></span><span class="market-overview-values"><span>Meme <b class="${direction(meme)}">${pct(meme,' pp')}</b></span><span>Alt <b class="${direction(alt)}">${pct(alt,' pp')}</b></span><span>Btc <b class="${direction(btc)}">${pct(btc,' pp')}</b></span><span class="market-mode-value">Mode <b class="mode-${Number(mode)||'unknown'}">${formatMode(mode)}</b></span></span>`;
}

function marketDetails(report,state,modeDetails){
 const {last,ready,comparison,baseline,status,meme,alt,btc}=state;
 return `<p>Shared trending pool · hourly update · difference between the current 1H reading and the 1H reading 24 hours earlier, in percentage points (pp).</p><p class="market-reading">Meme <strong>${pct(meme,' pp')}</strong> · Alt <strong>${pct(alt,' pp')}</strong> · BTC <strong>${pct(btc,' pp')}</strong> · ${status}</p>
 <p>Current 1H: Meme ${pct(ready?last.meme:null)} · Alt ${pct(ready?last.altDelta:null)} · BTC ${pct(ready?last.btcDelta:null)}</p>
 <p>1H reading 24H ago: ${comparison?esc(when(comparison.baselineAt)):'Awaiting matching history'}</p>${comparison?`<p>Meme ${pct(Number.isFinite(comparison.meme)?baseline?.meme:null)} · Alt ${pct(baseline?.altDelta)} · BTC ${pct(baseline?.btcDelta)}</p>`:''}<div class="market-chart">${chart(hourlyComparisons((report?.readings||[]).filter(row=>row.method===report?.method)),' pp')}</div><div class="market-overview-legend"><span><i class="market-histogram-key"></i>Meme · histogram</span><span><i class="market-alt-key"></i>Alt · line</span><span><i class="market-btc-key"></i>BTC · line</span></div><p class="market-timestamp">Updated ${esc(when(last?.at))}</p>${inputQualityNote(report)}${report?.error?`<p role="status">${esc(report.error)}</p>`:''}${modeDetails}<details class="market-method"><summary>Basket · ${report?.basket?.length||0} constituents</summary><p>Meme: equal-weight average of the one-hour USD price changes for every token in the shared 1H trending pool. Membership follows the shared ranking each hour, including older tokens with recent activity. Existing market observations are reused; missing or stale changes withhold the reading. The former FOMO method is retained in history but never compared with this method.</p>
 <p>Alt: market-cap-weighted one-hour change of the 25 largest eligible altcoins in CoinLore's top-50 feed, excluding BTC, ETH, stablecoins, and wrapped assets. The group is selected from each fresh feed. Readings are sampled hourly. The chart shows changes in 1H readings versus 24 hours earlier, one point per hour. A historical reading within 10 minutes of the target is required; missing comparisons stay unavailable. Basket membership can change between the two readings.</p>
 <p>BTC: Bitcoin's one-hour USD price change from the same CoinLore feed, with no additional data request. Missing BTC changes display as an em dash; older readings are not backfilled.</p>
 <p>Pool selected ${esc(when(report?.rebalancedAt))} · oldest market observation ${esc(when(report?.marketObservedAt))}</p><ol>${(report?.basket||[]).map(t=>`<li><strong>${esc(t.symbol)}</strong> · ${esc(t.chain)} · 1H ${pct(t.priceChange1h)} · ${Number.isFinite(t.weight)?(100*t.weight).toFixed(2):"—"}% · ${esc(t.priceSource)}<small>${esc(t.address)}</small></li>`).join('')}</ol></details>`;
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
  market.setAttribute('aria-label',`Change in 1 hour readings versus 24 hours ago. Meme ${pct(state.meme,' pp')}, Alt ${pct(state.alt,' pp')}, BTC ${pct(state.btc,' pp')}. ${state.status}. Solana Mode ${formatMode(mode)}. Open details`);
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
