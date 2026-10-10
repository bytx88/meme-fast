import snapshot from './macro-data.mjs';
import {compareSeries,visibleRows,symbols} from './macro-series.mjs';
const host=document.getElementById('comparison-chart');
const colours={QQQ:'#63a9ff',BTC:'#ffad55',XAU:'#6bdbb2'};
const names={QQQ:'Equity risk',BTC:'Crypto risk',XAU:'Spot gold'};
const pct=n=>`${n>=0?'+':''}${n.toFixed(2)}%`;
const price=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:2,minimumFractionDigits:2}).format(n);
const el=(name,cls,text)=>{const n=document.createElement(name);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const svgEl=(name,attrs,text)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;};
try{
 const c=compareSeries(snapshot.series,snapshot.start),latest=c.rows.at(-1);
 const summary=document.getElementById('comparison-summary');
 for(const s of symbols){const n=el('article');n.style.setProperty('--series',colours[s]);n.append(el('span','series-name',`${s} / ${names[s]}`),el('strong','',pct(latest.returns[s])),el('small','',`$${price(latest.prices[s])} · ${latest.date}`));summary.append(n);}
 const ordered=[...symbols].sort((a,b)=>latest.returns[b]-latest.returns[a]);
 const leadership=`${ordered[0]} leads since November 1; ${ordered[2]} lags. BTC ${pct(latest.returns.BTC)} vs QQQ ${pct(latest.returns.QQQ)}: ${latest.returns.BTC<latest.returns.QQQ?'crypto underperforms equity risk':'crypto outperforms equity risk'}. ${latest.returns.BTC>0&&latest.returns.QQQ>0?'Both risk assets gained over this window.':'The window does not show a broad advance in both risk assets.'}`;
 document.getElementById('comparison-read').textContent=leadership;
 document.getElementById('map-market-read').textContent=leadership+' Relative returns do not establish absorption or a completed reclaim.';
 document.getElementById('chart-method').textContent=`Baseline: ${c.anchor} common closes (1 Nov was Saturday). Last shared observation: ${latest.date}. Collected ${snapshot.collectedAt.slice(0,10)} UTC. Return = close / baseline − 1.`;
 const slider=document.getElementById('chart-date'),readout=document.getElementById('chart-readout');
 let rows,svg,cursor,dots,x,y,from,to;
 function inspect(index){index=Math.max(0,Math.min(rows.length-1,index));slider.value=index;const r=rows[index];readout.textContent=`${r.date} · ${symbols.map(s=>`${s} ${pct(r.returns[s])} ($${price(r.prices[s])})`).join(' · ')}`;cursor.setAttribute('x1',x(Date.parse(r.date)));cursor.setAttribute('x2',x(Date.parse(r.date)));for(const s of symbols){dots[s].setAttribute('cx',x(Date.parse(r.date)));dots[s].setAttribute('cy',y(r.returns[s]));}}
 function render(days=0){
  rows=visibleRows(c,days);const w=1100,h=360,left=62,right=30,top=24,bottom=40;
  from=Date.parse(days?rows[0].date:c.start);to=Date.parse(latest.date);if(to<=from)to=from+86400000;
  const values=rows.flatMap(r=>symbols.map(s=>r.returns[s]));let low=Math.floor(Math.min(0,...values)/10)*10-5,high=Math.ceil(Math.max(0,...values)/10)*10+5;
  x=t=>left+(t-from)/(to-from)*(w-left-right);y=v=>top+(high-v)/(high-low)*(h-top-bottom);
  svg=svgEl('svg',{viewBox:`0 0 ${w} ${h}`,role:'img','aria-label':`QQQ, BTC and spot gold percentage change from ${c.anchor}, through ${latest.date}`});svg.append(svgEl('title',{},'Fixed November baseline comparison'));
  for(let i=0;i<=5;i++){const v=low+(high-low)*i/5;svg.append(svgEl('line',{x1:left,x2:w-right,y1:y(v),y2:y(v),stroke:'#243341'}),svgEl('text',{x:left-8,y:y(v)+4,'text-anchor':'end',fill:'#8f9eac','font-size':12},`${v.toFixed(0)}%`));}
  svg.append(svgEl('line',{x1:left,x2:w-right,y1:y(0),y2:y(0),stroke:'#74808b','stroke-dasharray':'4 4'}));
  for(let i=0;i<6;i++){const t=from+(to-from)*i/5;svg.append(svgEl('text',{x:x(t),y:h-12,'text-anchor':i===0?'start':i===5?'end':'middle',fill:'#8f9eac','font-size':12},new Date(t).toISOString().slice(0,10)));}
  for(const s of symbols){const coordinates=rows.map(r=>`${x(Date.parse(r.date))},${y(r.returns[s])}`);svg.append(svgEl('polyline',{points:coordinates.join(' '),fill:'none',stroke:colours[s],'stroke-width':2.2,'stroke-linejoin':'round','vector-effect':'non-scaling-stroke'}));}
  cursor=svgEl('line',{y1:top,y2:h-bottom,stroke:'#9aa6b3','stroke-dasharray':'3 3'});svg.append(cursor);dots={};for(const s of symbols){dots[s]=svgEl('circle',{r:4,fill:colours[s]});svg.append(dots[s]);}
  svg.addEventListener('pointermove',event=>{const rect=svg.getBoundingClientRect();const t=from+((event.clientX-rect.left)/rect.width*w-left)/(w-left-right)*(to-from);let nearest=0;rows.forEach((r,i)=>{if(Math.abs(Date.parse(r.date)-t)<Math.abs(Date.parse(rows[nearest].date)-t))nearest=i;});inspect(nearest);});
  host.replaceChildren(svg);slider.max=rows.length-1;inspect(rows.length-1);
 }
 slider.addEventListener('input',()=>inspect(Number(slider.value)));
 document.querySelectorAll('[data-window]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-window]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));render(Number(button.dataset.window));}));
 document.getElementById('download-comparison').addEventListener('click',()=>{const header='date,QQQ_close,BTC_USD_close,XAU_USD_per_oz,QQQ_return_pct,BTC_return_pct,XAU_return_pct';const lines=[header,[c.anchor,...symbols.map(s=>c.baseline[s]),0,0,0].join(','),...c.rows.map(r=>[r.date,...symbols.map(s=>r.prices[s]),...symbols.map(s=>r.returns[s])].join(','))];const url=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/csv'}));const a=el('a');a.href=url;a.download='macro-since-2025-11-01.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 render();
}catch(error){host.replaceChildren(el('p','chart-loading',`Comparison unavailable: ${error.message}`));document.getElementById('map-market-read').textContent='Comparison unavailable; liquidity confirmation remains unmeasured.';}
