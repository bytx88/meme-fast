const root=document.querySelector('#btc-liquidation-heatmap');
const usd=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:2}).format(v);
const rangePrice=v=>'$'+v.toLocaleString('en-US',{maximumFractionDigits:v<10000?2:0});
const date=t=>new Date(t).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const palette=[[26,11,52],[67,30,102],[54,86,139],[40,139,145],[60,188,115],[177,220,53],[255,230,53]];
export function heatColor(value,max){
 const t=Math.max(0,Math.min(1,Math.sqrt(value/(max||1))))*(palette.length-1),i=Math.min(palette.length-2,Math.floor(t)),f=t-i;
 return `rgb(${palette[i].map((v,k)=>Math.round(v+(palette[i+1][k]-v)*f)).join(',')})`;
}
export function peak(values){let index=0;for(let i=1;i<values.length;i++)if(values[i]>values[index])index=i;return {index,value:values[index]};}
if(root){
 const canvas=root.querySelector('canvas'),ctx=canvas.getContext('2d'),status=root.querySelector('.heat-status'),tooltip=root.querySelector('.heat-tooltip'),priceAxis=root.querySelector('.heat-price-axis');
 let data=null,days=30,symbol='BTCUSDT',scale=1,priceScale=1,centerT=.5,centerP=.5,sequence=0,geometry=null,controller,priceDrag=null,panDrag=null,hover=null,intensity=.8;
 const marker=document.createElement('div');marker.className='heat-current-price';marker.hidden=true;root.querySelector('.heat-chart').append(marker);
 const snapshots=new Map(),nextChecks=new Map();
 const labels=[root.querySelector('.heat-band-short'),root.querySelector('.heat-band-long')];
 function clear(message){stopPriceDrag();stopPan();data=null;geometry=null;hover=null;marker.hidden=true;tooltip.hidden=true;labels.forEach(label=>{label.hidden=true;label.replaceChildren();});ctx.clearRect(0,0,canvas.width,canvas.height);status.textContent=message;status.removeAttribute('title');status.dataset.stale='false';}
 function draw(){
  if(!data)return;
  const w=canvas.clientWidth,h=canvas.clientHeight,dpr=window.devicePixelRatio||1;
  canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const left=5,top=12,bottom=h-32,axis=w-63,profile=Math.max(45,Math.min(110,w*.13)),right=axis-profile-9;
  const current=data.current_price??data.ohlc.at(-1)[3],binSize=(data.price_hi-data.price_lo)/data.nbins;
  const edges=data.price_edges||Array.from({length:data.nbins+1},(_,i)=>data.price_lo+i*binSize);
  const start=Math.max(0,Math.floor(data.times.length*(centerT-.5/scale))),end=Math.min(data.times.length,Math.ceil(data.times.length*(centerT+.5/scale)));
  const span=data.price_hi-data.price_lo,low=Math.max(0,data.price_lo+span*(centerP-.5/priceScale)),high=data.price_lo+span*(centerP+.5/priceScale);
  const y=p=>bottom-(p-low)/(high-low)*(bottom-top),dx=(right-left)/(end-start);
  geometry={left,right,top,bottom,axis,y,low,high,dx,edges,start,end};
  priceAxis.style.top=top+'px';priceAxis.style.height=(bottom-top)+'px';
  ctx.fillStyle=getComputedStyle(root).getPropertyValue('--panel').trim()||'#101820';ctx.fillRect(left,top,right-left,bottom-top);
  let max=0;for(const row of data.matrix)for(const v of row)max=Math.max(max,v);
  ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
  ctx.globalAlpha=intensity;data.matrix.forEach((row,i)=>row.forEach((v,j)=>{
   if(i<start||i>=end)return;
   const a=y(edges[j+1]),b=y(edges[j]);
   if(b<top||a>bottom)return;ctx.fillStyle=heatColor(v,max);ctx.fillRect(left+(i-start)*dx,a,dx+.5,b-a+.5);
  }));ctx.globalAlpha=1;
  // Draw subtle level guides beneath the candles, so price stays legible.
  for(const [values,color] of [[data.profile_short,'#7ec8ab66'],[data.profile_long,'#db939066']]){
   const p=peak(values),level=(edges[p.index]+edges[p.index+1])/2;
   if(p.value<=0||level<low||level>high)continue;
   ctx.strokeStyle=color;ctx.lineWidth=1;ctx.setLineDash([6,5]);ctx.beginPath();ctx.moveTo(left,y(level));ctx.lineTo(right,y(level));ctx.stroke();
  }ctx.setLineDash([]);
  data.ohlc.forEach((row,i)=>{if(!row||i<start||i>=end)return;const [o,h,l,c]=row,x=left+(i-start+.5)*dx;ctx.strokeStyle=ctx.fillStyle=c>=o?'#35c99b':'#f16a77';ctx.lineWidth=Math.max(.7,Math.min(1.3,dx*.4));ctx.beginPath();ctx.moveTo(x,y(h));ctx.lineTo(x,y(l));ctx.stroke();ctx.fillRect(x-Math.max(1,dx*.55)/2,Math.min(y(o),y(c)),Math.max(1,dx*.55),Math.max(1,Math.abs(y(o)-y(c))));});
  ctx.strokeStyle='#ffffffa0';ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(left,y(current));ctx.lineTo(right,y(current));ctx.stroke();ctx.setLineDash([]);ctx.restore();
  const profileMax=Math.max(...data.profile_long,...data.profile_short,1);
  ctx.save();ctx.beginPath();ctx.rect(right+4,top,profile+4,bottom-top);ctx.clip();
  for(let j=0;j<data.nbins;j++){
   const a=y(edges[j+1]),b=y(edges[j]),mid=(edges[j]+edges[j+1])/2;
   // Preserve both sides when a provider bucket contains overlapping exposures.
   const values=mid>=current?[[data.profile_long[j],'#d65a55'],[data.profile_short[j],'#439b71']]:[[data.profile_short[j],'#439b71'],[data.profile_long[j],'#d65a55']];
   values.forEach(([v,color],i)=>{ctx.fillStyle=color;const both=values[0][0]>0&&values[1][0]>0;ctx.fillRect(right+5,a+(both?i*(b-a)/2:0),v/profileMax*(profile-2),Math.max(.5,(b-a)/(both?2:1)-.6));});
  }ctx.restore();
  ctx.font='11px system-ui';ctx.fillStyle=getComputedStyle(root).getPropertyValue('--muted').trim()||'#8e9eae';ctx.textAlign='left';
  for(let i=0;i<=6;i++){const p=low+(high-low)*i/6;ctx.fillText(Math.round(p).toLocaleString('en-US'),axis+3,y(p)+4);}
  ctx.textAlign='center';const ticks=w<600?3:5;for(let i=0;i<ticks;i++){const n=start+Math.round((end-start-1)*i/(ticks-1)),x=left+(n-start+.5)*dx;ctx.fillText(new Date(data.times[n]).toLocaleString(undefined,{month:'short',day:'numeric',...(days/scale<=3?{hour:'2-digit'}:{})}),Math.max(40,Math.min(right-40,x)),h-10);}
  marker.hidden=y(current)<top||y(current)>bottom;marker.textContent=rangePrice(current);marker.style.top=(y(current)-12)+'px';marker.title=`Latest model price ${rangePrice(current)} · ${date(data.updated)}`;
  if(!marker.hidden){ctx.fillStyle='#439b71';ctx.beginPath();ctx.arc(right,y(current),3,0,Math.PI*2);ctx.fill();}
  if(hover&&!panDrag){
   const hx=Math.max(left,Math.min(right,hover.x)),hy=Math.max(top,Math.min(bottom,hover.y));
   ctx.save();ctx.strokeStyle='#dcecf0b0';ctx.lineWidth=1;ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(hx,top);ctx.lineTo(hx,bottom);ctx.moveTo(left,hy);ctx.lineTo(axis,hy);ctx.stroke();ctx.restore();
   const at=gPrice(hy),index=Math.max(start,Math.min(end-1,start+Math.floor((hx-left)/dx)));
   const badge=(text,x,yy,width)=>{ctx.fillStyle='#18363f';ctx.fillRect(x,yy,width,20);ctx.strokeStyle='#80b9c9';ctx.strokeRect(x,yy,width,20);ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText(text,x+width/2,yy+14);};
   badge(rangePrice(at),axis,Math.max(top,Math.min(bottom-20,hy-10)),63);
   badge(date(data.times[index]),Math.max(left,Math.min(right-150,hx-75)),bottom+4,150);
  }
  const bands=[['Top shorts',peak(data.profile_short)],['Top longs',peak(data.profile_long)]];
  const placements=[];let below=w<640;
  bands.forEach(([name,p],i)=>{
   const label=labels[i];label.hidden=p.value<=0;if(label.hidden)return;
   const mid=(edges[p.index]+edges[p.index+1])/2,rawY=y(mid),out=rawY<top?'Above view':rawY>bottom?'Below view':'';
   const title=document.createElement('strong'),range=document.createElement('span');
   title.textContent=`${name} ≈ ${usd(p.value)}`;range.textContent=`${rangePrice(edges[p.index])}–${rangePrice(edges[p.index+1])}`;
   const distance=document.createElement('small'),pct=(mid/current-1)*100;distance.textContent=`${Math.abs(pct).toFixed(1)}% ${pct>=0?'above':'below'} price${out?' · '+out:''}`;
   label.replaceChildren(title,range,distance);
   label.setAttribute('aria-label',`${name}: ${rangePrice(edges[p.index])} to ${rangePrice(edges[p.index+1])}, ${usd(p.value)} estimated exposure${out?', '+out.toLowerCase():''}`);
   const labelWidth=Math.min(180,right-left-16),labelX=left+Math.max(8,(right-left)*.68-labelWidth);
   label.style.width=labelWidth+'px';label.style.left=labelX+'px';
   const labelHeight=label.offsetHeight||48;
   let labelY=i===0?rawY-labelHeight-8:rawY+8;
   let candleTop=bottom,candleBottom=top,hasCandles=false;
   data.ohlc.forEach((row,n)=>{
    const x=left+(n-start+.5)*dx;
    if(!row||n<start||n>=end||x<labelX-4||x>labelX+labelWidth+4)return;
    hasCandles=true;candleTop=Math.min(candleTop,y(row[1]));candleBottom=Math.max(candleBottom,y(row[2]));
   });
   if(hasCandles&&labelY<candleBottom+6&&labelY+labelHeight>candleTop-6){
    labelY=i===0?Math.min(labelY,candleTop-labelHeight-8):Math.max(labelY,candleBottom+8);
   }
   labelY=Math.max(top+4,Math.min(bottom-labelHeight-4,labelY));
   if(out||(hasCandles&&labelY<candleBottom+6&&labelY+labelHeight>candleTop-6))below=true;
   label.style.top=labelY+'px';placements.push({top:labelY,bottom:labelY+labelHeight});
  });
  if(placements.length===2&&Math.max(placements[0].top,placements[1].top)<Math.min(placements[0].bottom,placements[1].bottom)+6)below=true;
  root.classList.toggle('heat-labels-below',below);
 }
 function refreshStatus(){
  if(!data)return;const key=symbol+':'+days,stale=data.cache?.state==='stale'||Date.now()-data.updated>900000;
  const minutes=Math.max(0,Math.floor((Date.now()-data.updated)/60000));
  status.textContent=`${stale?'CACHED / DELAYED · ':''}${symbol} ${rangePrice(data.current_price??data.ohlc.at(-1)[3])} · Updated ${minutes<1?'just now':minutes+' min ago'} · ${data.coverageDays} ${data.coverageDays===1?'day':'days'}`;
  status.title=`Source snapshot ${date(data.updated)} · Next check ${date(nextChecks.get(key))} · Local time${data.cache?.reason?' · '+data.cache.reason:''}${data.exchanges.length?' · '+data.exchanges.join(' / '):''}`;
  status.dataset.stale=String(stale);
 }
 function display(report,key){
  data=report;
  root.querySelector('.heat-source').textContent=data.source;root.querySelector('.heat-source').href=data.sourceUrl;
  root.querySelector('.heat-license').textContent=data.licenseLabel;root.querySelector('.heat-license').href=data.licenseUrl;
  root.querySelector('.heat-scope').textContent=data.scope;
  status.dataset.error='false';
  refreshStatus();
   draw();
 }
 async function load(){
  const key=symbol+':'+days,candidate=snapshots.get(key),known=candidate&&Date.now()-candidate.updated<=86400000?candidate:null;
  if(known){display(known,key);}
  if(Date.now()<(nextChecks.get(key)||0)){
   if(!known){clear(`Heatmap unavailable; no usable cached snapshot. Next check ${date(nextChecks.get(key))}.`);status.dataset.error='true';}
   return;
  }
  nextChecks.set(key,Date.now()+300000);
  const id=++sequence;controller?.abort();controller=new AbortController();if(!known)clear(`Loading ${symbol} liquidation estimates…`);status.dataset.error='false';
  const requested=days;let failureReason='Provider refresh unavailable';
  try{
   const response=await fetch(`/api/btc-liquidation-heatmap?days=${requested}&symbol=${symbol}`,{signal:controller.signal,cache:'no-store'});
   const retryHeader=response.headers.get('Retry-After');let wait=Number(retryHeader)*1000;if(!Number.isFinite(wait))wait=Date.parse(retryHeader)-Date.now();
   if(id!==sequence)return;nextChecks.set(key,Date.now()+Math.max(300000,wait||0));
   const next=await response.json();if(id!==sequence)return;
   if(next.cache?.retryAt)nextChecks.set(key,Math.max(Date.now()+300000,next.cache.retryAt));
   if(next.cache?.reason)failureReason=next.cache.reason;
   if(!response.ok)throw new Error('unavailable');
   if(next.symbol!==symbol||!next.times?.length||!next.matrix?.length)throw new Error('empty');data=next;snapshots.set(key,next);
   display(data,key);
  }catch(error){if(id!==sequence||error.name==='AbortError')return;
   const old=snapshots.get(key);if(old&&Date.now()-old.updated<=86400000){data={...old,cache:{...old.cache,state:'stale',reason:'Refresh unavailable'}};snapshots.set(key,data);refreshStatus();draw();}
   else{clear(`Heatmap unavailable: ${failureReason}; no usable cached snapshot. Next check ${date(nextChecks.get(key))}.`);status.dataset.error='true';}
  }
 }
 function marketChanged(nextSymbol){
  symbol=nextSymbol;root.querySelectorAll('[data-symbol]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.symbol===symbol)));
  ++sequence;controller?.abort();clear(`Loading ${symbol} liquidation estimates…`);resetZoom();
  const gold=symbol==='XAUUSDT',source=root.querySelector('.heat-source'),license=root.querySelector('.heat-license');
  source.textContent='Swolecharts';source.href=gold?'https://swolecharts.com/liquidation-heatmap/XAU':'https://swolecharts.com/liquidation-heatmap/BTC';
  license.textContent='Provider terms';license.href='https://swolecharts.com/developers#terms';
  root.querySelector('.heat-scope').textContent=gold?'Aggregated XAU gold perpetual model in USD; not a single exchange XAUUSDT pair. Side bars split latest model cells above/below price. Values are quantized estimates.':'Aggregated BTC perpetual model in USD; not a single exchange BTCUSDT pair. Side bars split latest model cells above/below price. Values are quantized estimates.';
  canvas.setAttribute('aria-label',`${symbol} estimated liquidation heatmap with price candles and latest long and short exposure profiles. Largest bands are listed below.`);
  load();
 }
 root.querySelectorAll('[data-symbol]').forEach(button=>button.addEventListener('click',()=>{if(button.dataset.symbol!==symbol)marketChanged(button.dataset.symbol);}));
 root.querySelectorAll('[data-days]').forEach(button=>button.addEventListener('click',()=>{days=Number(button.dataset.days);++sequence;controller?.abort();clear(`Loading ${symbol} liquidation estimates…`);resetZoom();root.querySelectorAll('[data-days]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));load();}));
 function syncZoom(){const changed=scale!==1||priceScale!==1||centerT!==.5||centerP!==.5,button=root.querySelector('.heat-zoom');button.textContent='Reset view';button.setAttribute('aria-pressed',String(changed));root.querySelector('.heat-zoom-readout').textContent=`Time ${scale.toFixed(1)}× · Price ${priceScale.toFixed(1)}×`;priceAxis.setAttribute('aria-valuenow',String(Math.round(priceScale*100)));priceAxis.setAttribute('aria-valuetext',`Price scale ${priceScale.toFixed(2)} times`);}
 function resetZoom(){stopPriceDrag();stopPan();hover=null;tooltip.hidden=true;scale=priceScale=1;centerT=centerP=.5;syncZoom();draw();}
 function changeZoom(factor,rx=.75,ry=.5){
  if(!data)return;rx=Math.max(0,Math.min(1,rx));ry=Math.max(0,Math.min(1,ry));const old=scale,next=Math.max(1,Math.min(12,scale*factor)),oldPrice=priceScale,nextPrice=Math.max(.25,Math.min(12,priceScale*factor));
  centerT=Math.max(.5/next,Math.min(1-.5/next,centerT+(rx-.5)/old-(rx-.5)/next));
  centerP+= (.5-ry)/oldPrice-(.5-ry)/nextPrice;
  if(nextPrice>=1)centerP=Math.max(.5/nextPrice,Math.min(1-.5/nextPrice,centerP));
  scale=next;priceScale=nextPrice;hover=null;tooltip.hidden=true;syncZoom();draw();
 }
 function stopPriceDrag(){if(!priceDrag)return;const id=priceDrag.id;priceDrag=null;priceAxis.classList.remove('is-dragging');if(priceAxis.hasPointerCapture(id))priceAxis.releasePointerCapture(id);}
 function resetPriceScale(){stopPriceDrag();priceScale=1;centerP=.5;syncZoom();draw();}
 priceAxis.addEventListener('pointerdown',event=>{
  if(!data||!geometry||event.button!==0||priceDrag)return;
  event.preventDefault();tooltip.hidden=true;priceAxis.focus({preventScroll:true});
  priceDrag={id:event.pointerId,y:event.clientY,scale:priceScale,center:centerP};
  priceAxis.setPointerCapture(event.pointerId);priceAxis.classList.add('is-dragging');
 });
 priceAxis.addEventListener('pointermove',event=>{
  if(!priceDrag||event.pointerId!==priceDrag.id)return;
  event.preventDefault();priceScale=Math.max(.25,Math.min(12,priceDrag.scale*Math.exp((priceDrag.y-event.clientY)*.008)));centerP=priceDrag.center;
  syncZoom();draw();
 });
 for(const name of ['pointerup','pointercancel','lostpointercapture'])priceAxis.addEventListener(name,event=>{if(priceDrag&&event.pointerId===priceDrag.id)stopPriceDrag();});
 priceAxis.addEventListener('dblclick',resetPriceScale);
 priceAxis.addEventListener('keydown',event=>{if(!data||!['ArrowUp','ArrowDown','Home'].includes(event.key))return;event.preventDefault();if(event.key==='Home')resetPriceScale();else{priceScale=Math.max(.25,Math.min(12,priceScale*(event.key==='ArrowUp'?1.2:1/1.2)));tooltip.hidden=true;syncZoom();draw();}});
 root.querySelector('.heat-zoom').addEventListener('click',resetZoom);
 canvas.addEventListener('wheel',event=>{if(!data||!geometry)return;const r=canvas.getBoundingClientRect(),g=geometry,x=event.clientX-r.left,y=event.clientY-r.top;if(x<g.left||x>g.axis||y<g.top||y>g.bottom)return;event.preventDefault();changeZoom(Math.exp(-Math.max(-160,Math.min(160,event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?400:1)))*.002),(x-g.left)/(g.right-g.left),(y-g.top)/(g.bottom-g.top));},{passive:false});
 canvas.addEventListener('keydown',event=>{if(['+','=','-','0'].includes(event.key)){event.preventDefault();if(event.key==='0')resetZoom();else changeZoom(event.key==='-'?1/1.3:1.3);}else if(data&&event.key.startsWith('Arrow')){event.preventDefault();hover=null;tooltip.hidden=true;if(event.key==='ArrowLeft'||event.key==='ArrowRight')centerT=Math.max(.5/scale,Math.min(1-.5/scale,centerT+(event.key==='ArrowLeft'?-.1:.1)/scale));else centerP+=(event.key==='ArrowUp'?.1:-.1)/priceScale;positivePriceView();syncZoom();draw();}});
 root.querySelector('.heat-refresh').addEventListener('click',load);
 function gPrice(y){const g=geometry;return g.low+(g.bottom-y)/(g.bottom-g.top)*(g.high-g.low);}
 function positivePriceView(){centerP=Math.max(.5/priceScale-data.price_lo/(data.price_hi-data.price_lo),centerP);}
 function stopPan(){if(!panDrag)return;const id=panDrag.id;panDrag=null;canvas.classList.remove('is-panning');if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);}
 canvas.addEventListener('pointerdown',event=>{
  if(!data||!geometry||event.button!==0||panDrag)return;const r=canvas.getBoundingClientRect(),x=event.clientX-r.left,y=event.clientY-r.top,g=geometry;
  if(x<g.left||x>g.right||y<g.top||y>g.bottom)return;
  event.preventDefault();canvas.focus({preventScroll:true});hover=null;tooltip.hidden=true;
  panDrag={id:event.pointerId,x:event.clientX,y:event.clientY,t:centerT,p:centerP,width:g.right-g.left,height:g.bottom-g.top};canvas.setPointerCapture(event.pointerId);canvas.classList.add('is-panning');draw();
 });
 for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,event=>{if(panDrag&&event.pointerId===panDrag.id)stopPan();});
 root.querySelector('.heat-intensity').addEventListener('input',event=>{intensity=Number(event.target.value)/100;draw();});
 const fullButton=root.querySelector('.heat-fullscreen');
 function syncFullscreen(){const active=document.fullscreenElement===root;root.classList.toggle('heat-expanded',active);fullButton.textContent=active?'Exit full screen':'Full screen';fullButton.setAttribute('aria-pressed',String(active));draw();}
 fullButton.addEventListener('click',async()=>{hover=null;tooltip.hidden=true;if(root.classList.contains('heat-expanded')&&!document.fullscreenElement){syncFullscreen();return;}try{if(document.fullscreenElement===root)await document.exitFullscreen();else await root.requestFullscreen();}catch{const active=root.classList.toggle('heat-expanded');fullButton.textContent=active?'Exit full screen':'Full screen';fullButton.setAttribute('aria-pressed',String(active));draw();}});
 document.addEventListener('fullscreenchange',syncFullscreen);
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&root.classList.contains('heat-expanded')&&!document.fullscreenElement){root.classList.remove('heat-expanded');syncFullscreen();}});
 canvas.addEventListener('pointermove',event=>{
  if(!data||!geometry)return;const r=canvas.getBoundingClientRect(),x=event.clientX-r.left,y=event.clientY-r.top,g=geometry;
  if(panDrag){if(event.pointerId!==panDrag.id)return;centerT=Math.max(.5/scale,Math.min(1-.5/scale,panDrag.t-(event.clientX-panDrag.x)/panDrag.width/scale));centerP=panDrag.p+(event.clientY-panDrag.y)/panDrag.height/priceScale;positivePriceView();syncZoom();draw();return;}
  if(x<g.left||x>g.axis||y<g.top||y>g.bottom){tooltip.hidden=true;hover=null;draw();return;}
  hover=x<=g.right?{x,y}:null;
  const p=g.low+(g.bottom-y)/(g.bottom-g.top)*(g.high-g.low),upper=g.edges.findIndex(edge=>edge>p),j=upper<0?data.nbins-1:Math.max(0,upper-1),i=Math.max(g.start,Math.min(g.end-1,g.start+Math.floor((x-g.left)/g.dx)));
  tooltip.textContent=p<g.edges[0]||p>g.edges.at(-1)?`Price: ${rangePrice(p)}\nNo model coverage at this price`:x>g.right?`${rangePrice(g.edges[j])}–${rangePrice(g.edges[j+1])}\nShorts: ${usd(data.profile_short[j])}\nLongs: ${usd(data.profile_long[j])}\nLatest estimated exposure`:`${date(data.times[i])}\nPrice: ${rangePrice(p)}\nBand: ${rangePrice(g.edges[j])}–${rangePrice(g.edges[j+1])}\nEstimated exposure: ${usd(data.matrix[i][j])}${data.ohlc[i]?'\nCandle close: '+rangePrice(data.ohlc[i][3]):''}`;
  tooltip.hidden=false;tooltip.style.left=Math.max(0,Math.min(x+14,r.width-245))+'px';tooltip.style.top=Math.max(0,Math.min(y+16,canvas.clientHeight-tooltip.offsetHeight-36))+'px';draw();
 });
 canvas.addEventListener('pointerleave',()=>{tooltip.hidden=true;hover=null;draw();});new ResizeObserver(draw).observe(canvas.parentElement);
 setInterval(()=>{if(!document.hidden){refreshStatus();load();}},30000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});syncZoom();load();
}
