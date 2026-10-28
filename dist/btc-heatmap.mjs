const root=document.querySelector('#btc-liquidation-heatmap');
const usd=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:2}).format(v);
const price=v=>'$'+Math.round(v).toLocaleString('en-US');
const rangePrice=v=>'$'+v.toLocaleString('en-US',{maximumFractionDigits:v<10000?2:0});
const date=t=>new Date(t).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const palette=[[26,11,52],[67,30,102],[54,86,139],[40,139,145],[60,188,115],[177,220,53],[255,230,53]];
export function heatColor(value,max){
 const t=Math.max(0,Math.min(1,Math.sqrt(value/(max||1))))*(palette.length-1),i=Math.min(palette.length-2,Math.floor(t)),f=t-i;
 return `rgb(${palette[i].map((v,k)=>Math.round(v+(palette[i+1][k]-v)*f)).join(',')})`;
}
export function peak(values){let index=0;for(let i=1;i<values.length;i++)if(values[i]>values[index])index=i;return {index,value:values[index]};}
if(root){
 const canvas=root.querySelector('canvas'),ctx=canvas.getContext('2d'),status=root.querySelector('.heat-status'),tooltip=root.querySelector('.heat-tooltip');
 let data=null,days=30,symbol='BTCUSDT',scale=1,centerT=.5,centerP=.5,sequence=0,geometry=null,lastFetch=0,controller;
 const snapshots=new Map(),nextChecks=new Map();
 const labels=[root.querySelector('.heat-band-short'),root.querySelector('.heat-band-long')];
 function clear(message){data=null;geometry=null;tooltip.hidden=true;labels.forEach(label=>{label.hidden=true;label.replaceChildren();});ctx.clearRect(0,0,canvas.width,canvas.height);status.textContent=message;}
 function draw(){
  if(!data)return;
  const w=canvas.clientWidth,h=canvas.clientHeight,dpr=window.devicePixelRatio||1;
  canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const left=5,top=12,bottom=h-32,axis=w-63,profile=Math.max(45,Math.min(110,w*.13)),right=axis-profile-9;
  const current=data.current_price??data.ohlc.at(-1)[3],binSize=(data.price_hi-data.price_lo)/data.nbins;
  const edges=data.price_edges||Array.from({length:data.nbins+1},(_,i)=>data.price_lo+i*binSize);
  const start=Math.max(0,Math.floor(data.times.length*(centerT-.5/scale))),end=Math.min(data.times.length,Math.ceil(data.times.length*(centerT+.5/scale)));
  const span=data.price_hi-data.price_lo,low=data.price_lo+span*(centerP-.5/scale),high=data.price_lo+span*(centerP+.5/scale);
  const y=p=>bottom-(p-low)/(high-low)*(bottom-top),dx=(right-left)/(end-start);
  geometry={left,right,top,bottom,axis,y,low,high,dx,edges,start,end};
  ctx.fillStyle='#1a0b34';ctx.fillRect(left,top,right-left,bottom-top);
  let max=0;for(const row of data.matrix)for(const v of row)max=Math.max(max,v);
  ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
  data.matrix.forEach((row,i)=>row.forEach((v,j)=>{
   if(i<start||i>=end)return;
   const a=y(edges[j+1]),b=y(edges[j]);
   if(b<top||a>bottom)return;ctx.fillStyle=heatColor(v,max);ctx.fillRect(left+(i-start)*dx,a,dx+.5,b-a+.5);
  }));
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
  ctx.fillStyle='#439b71';ctx.beginPath();ctx.arc(right,y(current),3,0,Math.PI*2);ctx.fill();
  const bands=[['Top shorts',peak(data.profile_short)],['Top longs',peak(data.profile_long)]];
  bands.forEach(([name,p],i)=>{
   const label=labels[i];label.hidden=p.value<=0;if(label.hidden)return;
   const mid=(edges[p.index]+edges[p.index+1])/2,rawY=y(mid),out=rawY<top?'Above view':rawY>bottom?'Below view':'';
   const title=document.createElement('strong'),range=document.createElement('span');
   title.textContent=`${name} ≈ ${usd(p.value)}`;range.textContent=`${rangePrice(edges[p.index])}–${rangePrice(edges[p.index+1])}${out?' · '+out:''}`;
   label.replaceChildren(title,range);
   label.setAttribute('aria-label',`${name}: ${rangePrice(edges[p.index])} to ${rangePrice(edges[p.index+1])}, ${usd(p.value)} estimated exposure${out?', '+out.toLowerCase():''}`);
  });
 }
 function display(report,key){
  data=report;
  status.dataset.error='false';
  const stale=data.cache?.state==='stale'||Date.now()-data.updated>900000;
   status.textContent=`${stale?'CACHED / DELAYED · ':''}${symbol} ${price(data.current_price??data.ohlc.at(-1)[3])} · Updated ${date(data.updated)} · ${data.coverageDays} days returned${data.exchanges.length?' · '+data.exchanges.join(' / '):''} · Next check ${date(nextChecks.get(key))} · Local time`;
   if(data.cache?.reason)status.textContent+=' · '+data.cache.reason;
   status.dataset.stale=String(stale);
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
  const requested=days;
  try{
   const response=await fetch(`/api/btc-liquidation-heatmap?days=${requested}&symbol=${symbol}`,{signal:controller.signal,cache:'no-store'});
   const retryHeader=response.headers.get('Retry-After');let wait=Number(retryHeader)*1000;if(!Number.isFinite(wait))wait=Date.parse(retryHeader)-Date.now();
   if(id!==sequence)return;nextChecks.set(key,Date.now()+Math.max(300000,wait||0));
   const next=await response.json();if(id!==sequence)return;
   if(next.cache?.retryAt)nextChecks.set(key,Math.max(Date.now()+300000,next.cache.retryAt));
   if(!response.ok)throw new Error('unavailable');
   if(next.symbol!==symbol||!next.times?.length||!next.matrix?.length)throw new Error('empty');data=next;snapshots.set(key,next);lastFetch=Date.now();
   display(data,key);
  }catch(error){if(id!==sequence||error.name==='AbortError')return;
   const old=snapshots.get(key);if(old&&Date.now()-old.updated<=86400000){data={...old,cache:{...old.cache,state:'stale',reason:'Refresh unavailable'}};snapshots.set(key,data);draw();status.textContent=`CACHED / DELAYED · ${symbol} snapshot ${date(old.updated)} · Refresh unavailable · Next check ${date(nextChecks.get(key))}`;status.dataset.stale='true';}
   else{clear(`Heatmap unavailable; no usable cached snapshot. Next check ${date(nextChecks.get(key))}.`);status.dataset.error='true';}
  }
 }
 function marketChanged(){
  symbol=root.querySelector('.heat-symbol').value;
  ++sequence;controller?.abort();clear(`Loading ${symbol} liquidation estimates…`);resetZoom();
  const gold=symbol==='XAUUSDT',source=root.querySelector('.heat-source'),license=root.querySelector('.heat-license');
  source.textContent=gold?'Swolecharts':'Edge or Not';source.href=gold?'https://swolecharts.com/liquidation-heatmap/XAU':'https://edgeornot.com/api';
  license.textContent=gold?'Provider terms':'CC BY 4.0';license.href=gold?'https://swolecharts.com/developers#terms':'https://creativecommons.org/licenses/by/4.0/';
  root.querySelector('.heat-scope').textContent=gold?'Aggregated XAU gold perpetual model in USD; not a single exchange XAUUSDT pair. Side bars split latest model cells above/below price. Values are quantized estimates.':'Aggregated BTC perpetual model; venue coverage shown above.';
  canvas.setAttribute('aria-label',`${symbol} estimated liquidation heatmap with price candles and latest long and short exposure profiles. Largest bands are listed below.`);
  load();
 }
 root.querySelector('.heat-symbol').addEventListener('change',marketChanged);
 root.querySelectorAll('[data-days]').forEach(button=>button.addEventListener('click',()=>{days=Number(button.dataset.days);++sequence;controller?.abort();clear(`Loading ${symbol} liquidation estimates…`);resetZoom();root.querySelectorAll('[data-days]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));load();}));
 function syncZoom(){const button=root.querySelector('.heat-zoom');button.textContent=scale>1?'Reset zoom':'Zoom in';button.setAttribute('aria-pressed',String(scale>1));root.querySelector('.heat-zoom-readout').textContent=scale.toFixed(1)+'×';}
 function resetZoom(){scale=1;centerT=centerP=.5;syncZoom();draw();}
 function changeZoom(factor,rx=.75,ry=.5){
  if(!data)return;rx=Math.max(0,Math.min(1,rx));ry=Math.max(0,Math.min(1,ry));const old=scale,next=Math.max(1,Math.min(12,scale*factor));
  centerT=Math.max(.5/next,Math.min(1-.5/next,centerT+(rx-.5)/old-(rx-.5)/next));
  centerP=Math.max(.5/next,Math.min(1-.5/next,centerP+(.5-ry)/old-(.5-ry)/next));
  scale=next;tooltip.hidden=true;syncZoom();draw();
 }
 root.querySelector('.heat-zoom').addEventListener('click',()=>scale>1?resetZoom():changeZoom(2));
 canvas.addEventListener('wheel',event=>{if(!data||!geometry)return;const r=canvas.getBoundingClientRect(),g=geometry,x=event.clientX-r.left,y=event.clientY-r.top;if(x<g.left||x>g.axis||y<g.top||y>g.bottom)return;event.preventDefault();changeZoom(Math.exp(-Math.max(-160,Math.min(160,event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?400:1)))*.002),(x-g.left)/(g.right-g.left),(y-g.top)/(g.bottom-g.top));},{passive:false});
 canvas.addEventListener('keydown',event=>{if(['+','=','-','0'].includes(event.key)){event.preventDefault();if(event.key==='0')resetZoom();else changeZoom(event.key==='-'?1/1.3:1.3);}});
 root.querySelector('.heat-refresh').addEventListener('click',load);
 canvas.addEventListener('pointermove',event=>{
  if(!data||!geometry)return;const r=canvas.getBoundingClientRect(),x=event.clientX-r.left,y=event.clientY-r.top,g=geometry;
  if(x<g.left||x>g.axis||y<g.top||y>g.bottom){tooltip.hidden=true;return;}
  const p=g.low+(g.bottom-y)/(g.bottom-g.top)*(g.high-g.low),upper=g.edges.findIndex(edge=>edge>p),j=upper<0?data.nbins-1:Math.max(0,upper-1),i=Math.max(g.start,Math.min(g.end-1,g.start+Math.floor((x-g.left)/g.dx)));
  tooltip.textContent=x>g.right?`${price(g.edges[j])}–${price(g.edges[j+1])}\nShorts: ${usd(data.profile_short[j])}\nLongs: ${usd(data.profile_long[j])}\nLatest estimated exposure`:`${date(data.times[i])}\n${price(g.edges[j])}–${price(g.edges[j+1])}\nEstimated exposure: ${usd(data.matrix[i][j])}`;
  tooltip.hidden=false;tooltip.style.left=Math.max(0,Math.min(x+12,r.width-245))+'px';tooltip.style.top=Math.max(0,y-95)+'px';
 });
 canvas.addEventListener('pointerleave',()=>tooltip.hidden=true);new ResizeObserver(draw).observe(canvas.parentElement);
 setInterval(()=>{if(!document.hidden)load();},30000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});load();
}
