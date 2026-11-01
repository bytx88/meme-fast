import {analyze,sectors} from './stock-analysis.mjs';
const $=id=>document.getElementById(id),fmt=(n,suffix='%')=>Number.isFinite(n)?`${n>=0?'+':''}${n.toFixed(2)}${suffix}`:'—',tone=n=>n>=0?'positive':'negative';
let source,model,period='1M',selected='XLK',request=0;
const samples=new Map();
function render(){
 model=analyze(source.series,period);
 if(!model){$('status').textContent='A complete, aligned sector history is unavailable.';$('dashboard').hidden=true;return}
 $('dashboard').hidden=false;$('asof').textContent=model.date;
 const age=(Date.now()-Date.parse(model.date+'T21:00:00Z'))/86400000;
 $('freshness').textContent=source.status==='delayed'?'CACHED / PROVIDER DELAY':age>4?'OLD SESSION / CHECK SOURCE':'Daily adjusted closes';
 $('status').textContent=`${source.status==='delayed'?source.message+' ':''}${age>4?'Latest session is over four calendar days old. ':''}Source checked ${new Date(source.fetchedAt).toLocaleString()} · Yahoo Finance · 30-minute cache.`;
 $('range').textContent=`${model.start} → ${model.date} · ${period==='YTD'?'year to date':({'1D':'1','1W':'5','1M':'21','3M':'63'}[period])+' sessions'}`;
 document.querySelectorAll('[data-period]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.period===period));
 const best=model.rows[0],worst=model.rows.at(-1),relative=[...model.rows].sort((a,b)=>b.relative-a.relative),leader=relative[0];
 $('stats').innerHTML=`<article class="stat"><small>SECTORS ADVANCING / ${period}</small><strong>${model.advancing} <small style="display:inline">/ 11</small></strong><span>${model.outperforming} of 11 outperform SPY</span></article><article class="stat"><small>STRONGEST SECTOR / ${period}</small><strong>${best.name}</strong><span class="${tone(best.ret)}">${fmt(best.ret)}</span></article><article class="stat"><small>WEAKEST SECTOR / ${period}</small><strong>${worst.name}</strong><span class="${tone(worst.ret)}">${fmt(worst.ret)}</span></article><article class="stat"><small>RELATIVE LEADER / ${period}</small><strong>${leader.symbol}</strong><span class="${tone(leader.relative)}">${fmt(leader.relative,' pp')} vs SPY</span></article>`;
 const improving=model.rows.filter(r=>r.quadrant==='Improving'||r.quadrant==='Leading').sort((a,b)=>b.momentum-a.momentum).slice(0,3);
 $('read').textContent=`${leader.name} leads SPY by ${fmt(leader.relative,' pp')} over ${period}. ${model.outperforming} of 11 sectors beat the benchmark, while ${model.advancing} rose in absolute terms.${improving.length?' Relative momentum is improving most in '+improving.map(r=>r.name).join(', ')+'.':' No sector has positive relative momentum in the fixed 1M rotation lens.'}`;
 const max=Math.max(...model.rows.map(r=>Math.abs(r.ret)),1);
 $('heatmap').innerHTML=model.rows.map(r=>`<button class="heat-tile" data-sector="${r.symbol}" aria-pressed="${selected===r.symbol}" style="background:${r.ret>=0?'rgba(12,151,105,':'rgba(190,56,79,'}${.28+.65*Math.abs(r.ret)/max})"><span>${r.name}</span><small>${r.symbol}</small><b>${fmt(r.ret)}</b></button>`).join('');
 const measure=$('measure').value,ranked=[...model.rows].sort((a,b)=>b[measure]-a[measure]),limit=Math.max(...ranked.map(r=>Math.abs(r[measure])),.01);
 $('ranking').innerHTML=ranked.map(r=>{const v=r[measure],width=Math.abs(v)/limit*50;return `<div class="rank-row"><button data-sector="${r.symbol}" title="Explore ${r.name}">${r.symbol}</button><div class="rank-track"><span class="rank-bar" style="left:${v>=0?50:50-width}%;width:${width}%;background:${v>=0?'#31bd8c':'#eb657e'}"></span></div><strong class="${tone(v)}">${fmt(v,measure==='relative'?' pp':'%')}</strong></div>`}).join('');
 $('spy').textContent=fmt(model.benchmark);$('spy').className=tone(model.benchmark);
 rotation();focus();
}
function rotation(){
 const xMax=Math.max(...model.rows.map(r=>Math.abs(r.rs)),1)*1.2,yMax=Math.max(...model.rows.map(r=>Math.abs(r.momentum)),1)*1.25;
 const used=[];
 const points=model.rows.map(r=>{
  const x=270+r.rs/xMax*210,y=155-r.momentum/yMax*112;
  const offsets=[[0,-17],[0,20],[28,0],[-28,0],[28,-20],[-28,-20],[28,20],[-28,20],[0,-36],[0,38],[48,0],[-48,0]];
  let label;
  for(const [dx,dy] of offsets){const lx=Math.max(58,Math.min(482,x+dx)),ly=Math.max(55,Math.min(260,y+dy));if(!used.some(p=>Math.abs(p.x-lx)<35&&Math.abs(p.y-ly)<17)){label={x:lx,y:ly};break}}
  label||={x:x,y:y-17};used.push(label);return {...r,x,y,label};
 });
 const colors={Leading:'#28ba91',Improving:'#35a6ca',Weakening:'#c69849',Lagging:'#d95b78'};
 $('rotation').innerHTML=`<svg viewBox="0 0 540 320" role="group" aria-labelledby="rotation-title"><title id="rotation-title">All 11 sectors: relative strength versus SPY and its five-session change</title><path d="M40 25H500V285H40Z" fill="#0c1822"/><path d="M270 25V285M40 155H500" stroke="#9ab3c0" stroke-dasharray="3 4" opacity=".6"/><g fill="#7f9eaf" font-size="11"><text x="50" y="43">Improving</text><text x="445" y="43">Leading</text><text x="50" y="275">Lagging</text><text x="435" y="275">Weakening</text><text x="42" y="307">−${xMax.toFixed(1)} pp</text><text x="255" y="307">0</text><text x="452" y="307">+${xMax.toFixed(1)} pp</text><text x="4" y="28">+${yMax.toFixed(1)}</text><text x="4" y="286">−${yMax.toFixed(1)}</text></g>${points.map(r=>`<g class="dot" data-sector="${r.symbol}" tabindex="0" role="button" aria-label="Explore ${r.name}, ${r.quadrant}, relative strength ${fmt(r.rs,' pp')}, momentum ${fmt(r.momentum,' pp')}"><title>${r.name}: ${r.quadrant}; strength ${fmt(r.rs,' pp')}; momentum ${fmt(r.momentum,' pp')}</title><path d="M${r.x} ${r.y}L${r.label.x} ${r.label.y}" stroke="${colors[r.quadrant]}" opacity=".6"/><circle cx="${r.x}" cy="${r.y}" r="${selected===r.symbol?8:6}" fill="${colors[r.quadrant]}" stroke="${selected===r.symbol?'#fff':'#0d1922'}" stroke-width="2"/><rect x="${r.label.x-16}" y="${r.label.y-8}" width="32" height="16" rx="3" fill="#13232d"/><text x="${r.label.x}" y="${r.label.y+3}" text-anchor="middle" fill="${colors[r.quadrant]}" font-size="10" font-weight="bold">${r.symbol}</text></g>`).join('')}</svg>`;
}
async function focus(){
 const token=++request,symbol=selected,r=model.rows.find(r=>r.symbol===symbol);
 $('detail-title').textContent=r.name;$('detail-symbol').textContent=symbol+' / '+period;
 $('focus').innerHTML=`<div><small>RETURN</small><strong class="${tone(r.ret)}">${fmt(r.ret)}</strong></div><div><small>VS SPY</small><strong class="${tone(r.relative)}">${fmt(r.relative,' pp')}</strong></div><div><small>1M ROTATION</small><strong>${r.quadrant}</strong></div>`;
 $('stocks').textContent='Loading stock sample…';
 try{
  let data=samples.get(symbol);if(!data||Date.now()>data.retryAt*1000){const response=await fetch('/api/stock?sector='+symbol,{signal:AbortSignal.timeout(95000)});data=await response.json();if(!response.ok||!data.series)throw Error('Stock sample is temporarily unavailable.');samples.set(symbol,data)}
  if(token!==request)return;
  const rows=Object.entries(data.series).map(([symbol,history])=>{const first=history.find(d=>d.date===model.start),last=history.find(d=>d.date===model.date);return{symbol,value:first&&last?(last.close/first.close-1)*100:null}}).sort((a,b)=>(b.value??-Infinity)-(a.value??-Infinity));
  $('stocks').innerHTML=`<table class="stock-table"><thead><tr><th>Stock / Yahoo</th><th>${period} return</th></tr></thead><tbody>${rows.map(r=>`<tr><td><a href="https://finance.yahoo.com/quote/${r.symbol}/" target="_blank" rel="noopener">${r.symbol} ↗</a></td><td class="${r.value===null?'':tone(r.value)}">${fmt(r.value)}</td></tr>`).join('')}</tbody></table><p class="panel-note">${model.start} → ${model.date} · ${data.status==='delayed'?'CACHED / DELAYED · ':''}Missing matching closes show —. Sample checked ${new Date(data.fetchedAt).toLocaleString()}.</p>`;
 }catch{if(token===request)$('stocks').textContent='Stock sample unavailable. Sector data remains available; retry after the provider cache expires.'}
}
async function load(){
 $('refresh').disabled=true;$('status').textContent='Checking daily history…';
 try{const response=await fetch('/api/stock',{signal:AbortSignal.timeout(95000)});const data=await response.json();if(!response.ok||!data.series)throw Error(data.message||'Daily history unavailable. Please retry later.');source=data;render()}
 catch(error){$('status').textContent=source?'Refresh failed. Displaying the previously loaded snapshot.':error.message}
 finally{$('refresh').disabled=false}
}
document.addEventListener('click',event=>{const b=event.target.closest('[data-sector],[data-period]');if(!b)return;if(b.dataset.period){period=b.dataset.period;if(source)render()}else if(model){selected=b.dataset.sector;render()}});
$('rotation').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){const dot=event.target.closest('[data-sector]');if(dot){event.preventDefault();dot.dispatchEvent(new MouseEvent('click',{bubbles:true}))}}});
$('measure').addEventListener('change',()=>{if(source)render()});$('refresh').addEventListener('click',load);
load();
