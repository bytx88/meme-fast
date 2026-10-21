const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=(value,unit='%')=>typeof value==='number'&&Number.isFinite(value)?`${value>=0?'+':''}${value.toFixed(2)}${unit}`:'—';
const direction=value=>typeof value==='number'&&Number.isFinite(value)?value>0?'up':value<0?'down':'flat':'flat';
const when=value=>value?new Date(value).toLocaleString():'—';
const HOUR=3600000;
// Match the same observation time yesterday; allow legacy five-minute samples and collector jitter.
export function compareReading(rows,current=rows?.at(-1)){
 if(!current||!Number.isFinite(current.at))return null;
 const target=current.at-24*HOUR;
 const prior=(rows||[]).filter(r=>Number.isFinite(r.at)&&r.at<current.at&&Math.abs(r.at-target)<=10*60000)
  .reduce((best,r)=>!best||Math.abs(r.at-target)<Math.abs(best.at-target)?r:best,null);
 if(!prior)return null;
 const difference=key=>Number.isFinite(current[key])&&Number.isFinite(prior[key])?current[key]-prior[key]:null;
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
export function runnerMode(report,now=Date.now()){
 const score=report?.score;
 return report?.ready===true&&report?.coverage?.reliable===true&&report?.coverage?.reservedPass===true&&report?.history?.usable===true&&
  report?.history?.comparablePeriods>=3&&report?.history?.baselinePeriods>=2&&report?.policy?.version===3&&
  Number.isFinite(report.updatedAt)&&now-report.updatedAt>=0&&now-report.updatedAt<=15*60000&&
  Number.isInteger(score)&&score>=1&&score<=5?String(score):'—';
}
export function runnerDetails(report,failed=false){
 const mode=failed?'—':runnerMode(report);
 const counts=report?.counts24h;
 const rows=[[500000,'$500K'],[1000000,'$1M'],[5000000,'$5M'],[10000000,'$10M']];
 const periods=Number.isInteger(report?.history?.comparablePeriods)?report.history.comparablePeriods:0;
 const hours=[1,6,24].includes(report?.history?.periodHours)?`${report.history.periodHours}H`:'equal-length';
 const label={'1':'Hard','2':'Cooling','3':'Balanced','4':'Improving','5':'Easy'}[mode];
 return `<section class="market-runner-mode" aria-label="Solana runner mode"><h3>Solana Mode <strong>${mode}${label?` · ${label}`:''}</strong></h3><p>${esc(failed?'Runner data unavailable':report?.reason||'Awaiting reliable Solana runner history')}</p><div class="market-runner-counts">${rows.map(([key,label])=>`<span>${label}<b>${Number.isInteger(counts?.[key])&&counts[key]>=0?counts[key].toLocaleString():'—'}</b></span>`).join('')}</div><p>Observed runners · rolling 24H · partial sample</p><p>${periods} comparable covered ${hours} periods · ${report?.coverage?.valuedTokens??0}/${report?.coverage?.eligibleTokens??0} tracked tokens with fresh valuations</p><p>Tracked sample, not a market-wide census. ${report?.coverage?.gaps?`Coverage gaps: ${Object.entries(report.coverage.gaps).map(([key,value])=>`${esc(key)} ${Number(value)||0}`).join(', ')||'none'}.`: ''}</p><p class="market-timestamp">Runner update ${esc(when(report?.updatedAt))}</p><details><summary>Mode method and coverage</summary><p>1 Hard · 2 Cooling · 3 Balanced · 4 Improving · 5 Easy. A dash means the evidence is insufficient. Mode follows a bounded rolling sample of observable Solana markets, admitted independently of future gains. It counts unique tracked tokens reaching $500K, $1M, $5M and $10M market cap. Initial above-threshold tokens and repeat reclaims are excluded. Two distinct quotes within 15 minutes must confirm attainment, with at least $3K liquidity and positive 24H volume. Up to 300 markets are tracked. Every admitted token stays in the denominator for 72 hours, including fallen or missing markets. Quote sampling runs independently every five minutes through the shared source; missing follow-up remains unknown.</p><p>Use existing covered history: compare adjacent 24H, 6H or 1H periods, with two earlier periods for a baseline. Each period needs at least 50 tracked markets, 90% reliable collection slots, 95% fresh valuation coverage of the entire cohort per slot, and comparable sample sizes. A fully covered absence of sustained runners is 1 (Hard); sparse positive evidence is withheld. Discovery freshness is shown separately; complete cohort quotes do not certify market-wide discovery. At least three supported thresholds must agree. High/low uses the available baseline median; rising/falling needs a change of at least 20%. Sufficient, broadly stable evidence gives 3. Conflicting or insufficient evidence stays —. There is no fixed calendar waiting rule.</p><p>These are sampled first observed crossings, not all Solana memes or first lifetime crossings. Saved event and coverage records are reused; price-only snapshots and untimed market caps cannot supply missing crossings. Missing market caps are not replaced with FDV. Counts can miss moves between observations. Mode is descriptive and has no validated predictive trading performance.</p></details></section>`;
}
export function mountMarket(market,dialog){
 let report=null,failed=false,runnerReport=null,runnerFailed=false;
 const body=dialog.querySelector('.market-content');
 function render(){
  const last=report?.readings?.at(-1),stale=!last||Date.now()-last.at>75*60000;
  const ready=!failed&&!stale&&last;
  const comparison=ready?compareReading(report.readings,last):null;
  const baseline=comparison?report.readings.find(row=>row.at===comparison.baselineAt):null;
  const status=failed?'Unavailable':stale?(last?'Stale data':'Awaiting data'):!comparison?'Awaiting 24H baseline':report.error||!Number.isFinite(comparison.btcDelta)?'Partial update':'Live';
  const meme=comparison?.meme,alt=comparison?.altDelta,btc=comparison?.btcDelta;
  const mode=runnerFailed?'—':runnerMode(runnerReport);
  market.innerHTML=`<span class="market-overview-title">1H DELTA · VS 24H AGO <span aria-hidden="true">↗</span></span><span class="market-overview-values"><span>Meme <b class="${direction(meme)}">${pct(meme,' pp')}</b></span><span>Alt <b class="${direction(alt)}">${pct(alt,' pp')}</b></span><span>Btc <b class="${direction(btc)}">${pct(btc,' pp')}</b></span><span class="market-mode-value">Mode <b class="mode-${Number(mode)||'unknown'}">${mode}</b></span></span>`;
  market.setAttribute('aria-label',`Change in 1 hour readings versus 24 hours ago. Meme ${pct(meme,' pp')}, Alt ${pct(alt,' pp')}, BTC ${pct(btc,' pp')}. ${status}. Solana Mode ${mode}. Open details`);
  body.innerHTML=`<p>Market-wide · hourly update · difference between the current 1H reading and the 1H reading 24 hours earlier, in percentage points (pp).</p><p class="market-reading">Meme <strong>${pct(meme,' pp')}</strong> · Alt <strong>${pct(alt,' pp')}</strong> · BTC <strong>${pct(btc,' pp')}</strong> · ${status}</p><p>Current 1H: Meme ${pct(ready?last.meme:null)} · Alt ${pct(ready?last.altDelta:null)} · BTC ${pct(ready?last.btcDelta:null)}</p><p>1H reading 24H ago: ${comparison?esc(when(comparison.baselineAt)):'Awaiting matching history'}</p>${comparison?`<p>Meme ${pct(baseline?.meme)} · Alt ${pct(baseline?.altDelta)} · BTC ${pct(baseline?.btcDelta)}</p>`:''}<div class="market-chart">${chart(hourlyComparisons(report?.readings),' pp')}</div><div class="market-overview-legend"><span><i class="market-histogram-key"></i>Meme · histogram</span><span><i class="market-alt-key"></i>Alt · line</span><span><i class="market-btc-key"></i>BTC · line</span></div><p class="market-timestamp">Updated ${esc(when(last?.at))}</p>${report?.error?`<p role="status">${esc(report.error)}</p>`:''}${runnerDetails(runnerReport,runnerFailed)}<details class="market-method"><summary>Basket · ${report?.basket?.length||0}/10 constituents</summary><p>Meme: average of the one-hour USD price changes for 10 equal-weight FOMO Most Held tokens. Membership is refreshed once every three days. Each token must have an exact-contract liquid pool; missing changes withhold the reading.</p><p>Alt: market-cap-weighted one-hour change of the 25 largest eligible altcoins in CoinLore's top-50 feed, excluding BTC, ETH, stablecoins, and wrapped assets. The group is selected from each fresh feed. Readings are sampled hourly. The chart shows changes in 1H readings versus 24 hours earlier, one point per hour. A historical reading within 10 minutes of the target is required; missing comparisons stay unavailable. Basket membership can change between the two readings.</p><p>BTC: Bitcoin's one-hour USD price change from the same CoinLore feed, with no additional data request. Missing BTC changes display as an em dash; older readings are not backfilled.</p><p>Basket set ${esc(when(report?.rebalancedAt))} · next due ${esc(when(report?.rebalancedAt?report.rebalancedAt+72*3600000:null))}</p><ol>${(report?.basket||[]).map(t=>`<li><strong>${esc(t.symbol)}</strong> · ${esc(t.chain)} · 10% · ${esc(t.priceSource)}<small>${esc(t.address)}</small></li>`).join('')}</ol></details>`;
 }
 async function refresh(){try{const response=await fetch('/api/meme-index',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error();const data=await response.json();if(!Array.isArray(data.readings)||!Array.isArray(data.basket))throw Error();report=data;failed=false}catch{failed=true}render()}
 async function refreshRunners(){try{const response=await fetch('/api/runner-mode',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error();const data=await response.json();if(data.version!==1||!data.counts24h)throw Error();runnerReport=data;runnerFailed=false}catch{runnerFailed=true}render()}
 render();refresh();refreshRunners();setInterval(()=>{if(!document.hidden){refresh();refreshRunners()}},60000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){refresh();refreshRunners()}});
}
