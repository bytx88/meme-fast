export const HOUR=3600000;
export function deltaRows(samples,hours){
 const rows=(samples||[]).filter(s=>Number.isFinite(s.at)&&s.index>0&&s.alt>0).sort((a,b)=>a.at-b.at);
 return rows.map((row,i)=>{
  const target=row.at-hours*HOUR;
  const base=rows.slice(0,i).findLast(s=>s.at<=target);
  const valid=base&&target-base.at<=10*60000;
  return {...row,meme:valid?(row.index/base.index-1)*100:null,altDelta:valid?(row.alt/base.alt-1)*100:null};
 });
}
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=value=>value===null?'—':`${value>=0?'+':''}${value.toFixed(2)}%`;
const when=value=>value?new Date(value).toLocaleString():'—';
export function chart(rows){
 const valid=rows.filter(r=>r.meme!==null);
 if(!valid.length)return '<div class="market-chart-empty"><strong>Building history</strong><span>The selected horizon needs more recorded samples.</span></div>';
 const end=rows.at(-1).at,start=Math.max(rows[0].at,end-24*HOUR),points=rows.filter(r=>r.at>=start);
 const scale=Math.max(.1,...valid.filter(r=>r.at>=start).flatMap(r=>[Math.abs(r.meme),Math.abs(r.altDelta)]));
 const x=t=>40+(t-start)/Math.max(end-start,300000)*440,y=v=>100-v/scale*75;
 const width=Math.max(1,Math.min(12,440*300000/Math.max(end-start,300000)*.7));
 let path='',last=null;
 for(const row of points){if(row.meme===null){last=null;continue}path+=`${last&&row.at-last.at<=10*60000?'L':'M'}${x(row.at)},${y(row.altDelta)} `;last=row}
 return `<svg viewBox="0 0 510 215" role="img" aria-label="Meme percentage change histogram and broad-alt percentage change line, centered on zero"><text x="2" y="26">+${scale.toFixed(1)}%</text><text x="16" y="104">0</text><text x="2" y="180">-${scale.toFixed(1)}%</text><line x1="38" x2="495" y1="100" y2="100" stroke="#73849a"/>${points.filter(r=>r.meme!==null).map(r=>`<rect tabindex="0" role="img" aria-label="${esc(when(r.at))}: Meme ${pct(r.meme)}, Alt ${pct(r.altDelta)}" x="${x(r.at)-width/2}" y="${Math.min(100,y(r.meme))}" width="${width}" height="${Math.max(1,Math.abs(y(r.meme)-100))}" fill="${r.meme>=0?'#2bdfaa':'#fb7185'}"><title>${esc(when(r.at))} · Meme ${pct(r.meme)} · Alt ${pct(r.altDelta)}</title></rect>`).join('')}<path d="${path}" fill="none" stroke="#81baff" stroke-width="2"/>${valid.length===1?`<circle cx="${x(valid[0].at)}" cy="${y(valid[0].altDelta)}" r="3" fill="#81baff"/>`:''}<text x="40" y="205">${esc(new Date(start).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))}</text><text x="480" y="205" text-anchor="end">${esc(new Date(end).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))}</text></svg>`;
}
export function mountMarket(market,dialog){
 let report=null,hours=1,failed=false;
 const body=dialog.querySelector('.market-content');
 function render(){
  const rows=deltaRows(report?.samples,hours),last=rows.at(-1);
  const stale=!report?.updatedAt||Date.now()-report.updatedAt>15*60000;
  const ready=!failed&&!stale&&last?.meme!=null;
  const status=failed?'Unavailable':stale?(report?.updatedAt?'Stale data':'Awaiting data'):last?.meme==null?'Building history':report.error?'Partial update':'Live';
  market.innerHTML=`<span class="market-overview-title">MARKET DELTA · ${hours}H <span aria-hidden="true">↗</span></span><span class="market-overview-values"><span>Meme <b>${pct(ready?last.meme:null)}</b></span><span>Alt <b>${pct(ready?last.altDelta:null)}</b></span></span><small class="market-status">${status}</small>`;
  market.setAttribute('aria-label',`Market Delta ${hours} hour overview. Meme ${pct(ready?last.meme:null)}, Alt ${pct(ready?last.altDelta:null)}. ${status}. Open details`);
  body.innerHTML=`<p>Market-wide · independent of the selected token.</p><div class="market-horizons" role="group" aria-label="Market lookback">${[1,6,24].map(h=>`<button type="button" data-horizon="${h}" aria-pressed="${hours===h}">${h}h</button>`).join('')}</div><p class="market-reading">Meme <strong>${pct(ready?last.meme:null)}</strong> · Alt <strong>${pct(ready?last.altDelta:null)}</strong> · ${status}</p><div class="market-chart">${chart(rows)}</div><div class="market-overview-legend"><span><i class="market-histogram-key"></i>Meme · histogram</span><span><i class="market-alt-key"></i>Alt · line</span></div><p class="market-timestamp">Updated ${esc(when(report?.updatedAt))}</p>${report?.error?`<p role="status">${esc(report.error)}</p>`:''}<details class="market-method"><summary>Basket · ${report?.basket?.length||0}/10 constituents</summary><p>Equal-weight sampled returns, compounded from 100. Membership changes every 3 days without resetting the index. Minimum observed pool liquidity $10,000 and positive 24h volume. All 10 prices are required for each sample.</p><p>Alt: CoinGecko total market cap excluding BTC and ETH, including stablecoins. Both series use ${hours}h percentage change; this is not TradingView OTHERS. History starts at collection, without backfill.</p><p>Basket set ${esc(when(report?.rebalancedAt))} · next due ${esc(when(report?.rebalancedAt?report.rebalancedAt+72*HOUR:null))}</p><ol>${(report?.basket||[]).map(t=>`<li><strong>${esc(t.symbol)}</strong> · ${esc(t.chain)} · 10% · ${esc(t.priceSource)}<small>${esc(t.address)}</small></li>`).join('')}</ol></details>`;
 }
 body.addEventListener('click',e=>{const h=e.target.closest('[data-horizon]');if(h){hours=Number(h.dataset.horizon);render()}});
 async function refresh(){try{const response=await fetch('/api/meme-index',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error();const data=await response.json();if(!Array.isArray(data.samples)||!Array.isArray(data.basket))throw Error();report=data;failed=false}catch{failed=true}render()}
 render();refresh();setInterval(()=>{if(!document.hidden)refresh()},60000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
}
