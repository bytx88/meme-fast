const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=value=>typeof value==='number'&&Number.isFinite(value)?`${value>=0?'+':''}${value.toFixed(2)}%`:'—';
const direction=value=>typeof value==='number'&&Number.isFinite(value)?value>0?'up':value<0?'down':'flat':'flat';
const when=value=>value?new Date(value).toLocaleString():'—';
export function chart(rows){
 const points=(rows||[]).filter(r=>Number.isFinite(r.at)&&Number.isFinite(r.meme)&&Number.isFinite(r.altDelta)).slice(-48);
 if(!points.length)return '<div class="market-chart-empty"><strong>Awaiting a 1H reading</strong><span>One complete price update is needed.</span></div>';
 const end=points.at(-1).at,start=Math.min(points[0].at,end-300000),scale=Math.max(.1,...points.flatMap(r=>[Math.abs(r.meme),Math.abs(r.altDelta)]));
 const x=t=>48+(t-start)/(end-start)*425,y=v=>100-v/scale*75;
 const width=Math.max(5,Math.min(14,425/Math.max(points.length,2)*.65));
 const line=points.map((r,i)=>`${i?'L':'M'}${x(r.at)},${y(r.altDelta)}`).join(' ');
 return `<svg viewBox="0 0 510 205" role="img" aria-label="One-hour meme change histogram and broad-alt change line centered on zero"><text x="3" y="25">+${scale.toFixed(1)}%</text><text x="22" y="104">0</text><text x="3" y="180">-${scale.toFixed(1)}%</text><line x1="45" x2="490" y1="100" y2="100" stroke="#73849a"/>${points.map(r=>`<rect tabindex="0" role="img" aria-label="${esc(when(r.at))}: Meme ${pct(r.meme)}, Alt ${pct(r.altDelta)}" x="${x(r.at)-width/2}" y="${Math.min(100,y(r.meme))}" width="${width}" height="${Math.max(1,Math.abs(y(r.meme)-100))}" fill="${r.meme>=0?'#2bdfaa':'#fb7185'}"><title>${esc(when(r.at))} · Meme ${pct(r.meme)} · Alt ${pct(r.altDelta)}</title></rect>`).join('')}<path d="${line}" fill="none" stroke="#81baff" stroke-width="2"/><circle cx="${x(end)}" cy="${y(points.at(-1).altDelta)}" r="3" fill="#81baff"/><text x="48" y="197">${esc(new Date(start).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))}</text><text x="473" y="197" text-anchor="end">${esc(new Date(end).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))}</text></svg>`;
}
export function mountMarket(market,dialog){
 let report=null,failed=false;
 const body=dialog.querySelector('.market-content');
 function render(){
  const last=report?.readings?.at(-1),stale=!last||Date.now()-last.at>15*60000;
  const ready=!failed&&!stale&&last;
  const status=failed?'Unavailable':stale?(last?'Stale data':'Awaiting data'):report.error?'Partial update':'Live';
  const meme=ready?last.meme:null,alt=ready?last.altDelta:null;
  market.innerHTML=`<span class="market-overview-title">MARKET DELTA · 1H <span aria-hidden="true">↗</span></span><span class="market-overview-values"><span>Meme <b class="${direction(meme)}">${pct(meme)}</b></span><span>Alt <b class="${direction(alt)}">${pct(alt)}</b></span></span>`;
  market.setAttribute('aria-label',`Market Delta 1 hour overview. Meme ${pct(ready?last.meme:null)}, Alt ${pct(ready?last.altDelta:null)}. ${status}. Open details`);
  body.innerHTML=`<p>Market-wide · one-hour change · independent of the selected token.</p><p class="market-reading">Meme <strong>${pct(ready?last.meme:null)}</strong> · Alt <strong>${pct(ready?last.altDelta:null)}</strong> · ${status}</p><div class="market-chart">${chart(report?.readings)}</div><div class="market-overview-legend"><span><i class="market-histogram-key"></i>Meme · histogram</span><span><i class="market-alt-key"></i>Alt · line</span></div><p class="market-timestamp">Updated ${esc(when(last?.at))}</p>${report?.error?`<p role="status">${esc(report.error)}</p>`:''}<details class="market-method"><summary>Basket · ${report?.basket?.length||0}/10 constituents</summary><p>Meme: average of the one-hour USD price changes for 10 equal-weight FOMO Most Held tokens. Membership is refreshed once every three days. Each token must have an exact-contract liquid pool; missing changes withhold the reading.</p><p>Alt: market-cap-weighted one-hour change of the 25 largest eligible altcoins in CoinLore's top-50 feed, excluding BTC, ETH, stablecoins, and wrapped assets. The group is selected from each fresh feed. Readings are sampled every five minutes; the chart grows from the first sample.</p><p>Basket set ${esc(when(report?.rebalancedAt))} · next due ${esc(when(report?.rebalancedAt?report.rebalancedAt+72*3600000:null))}</p><ol>${(report?.basket||[]).map(t=>`<li><strong>${esc(t.symbol)}</strong> · ${esc(t.chain)} · 10% · ${esc(t.priceSource)}<small>${esc(t.address)}</small></li>`).join('')}</ol></details>`;
 }
 async function refresh(){try{const response=await fetch('/api/meme-index',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error();const data=await response.json();if(!Array.isArray(data.readings)||!Array.isArray(data.basket))throw Error();report=data;failed=false}catch{failed=true}render()}
 render();refresh();setInterval(()=>{if(!document.hidden)refresh()},60000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
}
