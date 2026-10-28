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
 let data=null,days=30,symbol='BTCUSDT',zoom=false,sequence=0,geometry=null,lastFetch=0,controller;
 const summary=root.querySelector('.heat-summary');
 const labels=[root.querySelector('.heat-band-short'),root.querySelector('.heat-band-long')];
 function clear(message){data=null;geometry=null;tooltip.hidden=true;labels.forEach(label=>{label.hidden=true;label.replaceChildren();});summary.textContent='';ctx.clearRect(0,0,canvas.width,canvas.height);status.textContent=message;}
 function draw(){
  if(!data)return;
  const w=canvas.clientWidth,h=canvas.clientHeight,dpr=window.devicePixelRatio||1;
  canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const left=5,top=12,bottom=h-32,axis=w-63,profile=Math.max(45,Math.min(110,w*.13)),right=axis-profile-9;
  const current=data.current_price??data.ohlc.at(-1)[3],binSize=(data.price_hi-data.price_lo)/data.nbins;
  const edges=data.price_edges||Array.from({length:data.nbins+1},(_,i)=>data.price_lo+i*binSize);
  const low=zoom?Math.max(data.price_lo,current*.94):data.price_lo,high=zoom?Math.min(data.price_hi,current*1.06):data.price_hi;
  const y=p=>bottom-(p-low)/(high-low)*(bottom-top),dx=(right-left)/data.times.length;
  geometry={left,right,top,bottom,axis,y,low,high,dx,edges};
  ctx.fillStyle='#1a0b34';ctx.fillRect(left,top,right-left,bottom-top);
  let max=0;for(const row of data.matrix)for(const v of row)max=Math.max(max,v);
  ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
  data.matrix.forEach((row,i)=>row.forEach((v,j)=>{
   const a=y(edges[j+1]),b=y(edges[j]);
   if(b<top||a>bottom)return;ctx.fillStyle=heatColor(v,max);ctx.fillRect(left+i*dx,a,dx+.5,b-a+.5);
  }));
  data.ohlc.forEach((row,i)=>{if(!row)return;const [o,h,l,c]=row,x=left+(i+.5)*dx;ctx.strokeStyle=ctx.fillStyle=c>=o?'#35c99b':'#f16a77';ctx.lineWidth=Math.max(.7,Math.min(1.3,dx*.4));ctx.beginPath();ctx.moveTo(x,y(h));ctx.lineTo(x,y(l));ctx.stroke();ctx.fillRect(x-Math.max(1,dx*.55)/2,Math.min(y(o),y(c)),Math.max(1,dx*.55),Math.max(1,Math.abs(y(o)-y(c))));});
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
  ctx.textAlign='center';const ticks=w<600?3:5;for(let i=0;i<ticks;i++){const n=Math.round((data.times.length-1)*i/(ticks-1)),x=left+(n+.5)*dx;ctx.fillText(new Date(data.times[n]).toLocaleString(undefined,{month:'short',day:'numeric',...(days<=3?{hour:'2-digit'}:{})}),Math.max(40,Math.min(right-40,x)),h-10);}
  ctx.fillStyle='#439b71';ctx.beginPath();ctx.arc(right,y(current),3,0,Math.PI*2);ctx.fill();
  const bands=[['Top shorts',peak(data.profile_short)],['Top longs',peak(data.profile_long)]];
  const positions=bands.map(([name,p],i)=>{
   const label=labels[i];label.hidden=p.value<=0;if(label.hidden)return null;
   const mid=(edges[p.index]+edges[p.index+1])/2,rawY=y(mid),out=rawY<top?'Above view':rawY>bottom?'Below view':'';
   const title=document.createElement('strong'),range=document.createElement('span');
   title.textContent=`${name} ≈ ${usd(p.value)}`;range.textContent=`${rangePrice(edges[p.index])}–${rangePrice(edges[p.index+1])}${out?' · '+out:''}`;
   label.replaceChildren(title,range);label.style.width=Math.min(230,right-left-12)+'px';
   label.style.left=Math.max(left+6,right-Math.min(230,right-left-12)-10)+'px';
   label.setAttribute('aria-label',`${name}: ${rangePrice(edges[p.index])} to ${rangePrice(edges[p.index+1])}, ${usd(p.value)} estimated exposure${out?', '+out.toLowerCase():''}`);
   return {label,rawY,position:Math.max(top+2,Math.min(bottom-54,rawY-58)),color:i===0?'#7ec8ab':'#db9390'};
  }).filter(Boolean).sort((a,b)=>a.position-b.position);
  if(positions.length===2&&positions[1].position-positions[0].position<58){positions[1].position=Math.min(bottom-54,positions[0].position+58);positions[0].position=Math.min(positions[0].position,positions[1].position-58);}
  positions.forEach(({label,position,rawY,color})=>{
   label.style.top=position+'px';const anchorY=Math.max(top,Math.min(bottom,rawY)),labelX=parseFloat(label.style.left)+parseFloat(label.style.width);
   ctx.strokeStyle=color;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(labelX,position+25);ctx.lineTo(right+3,anchorY);ctx.lineTo(right+10,anchorY);ctx.stroke();
  });
 }
 async function load(){
  const id=++sequence;controller?.abort();controller=new AbortController();clear(`Loading ${symbol} liquidation estimates…`);status.dataset.error='false';
  const requested=days;
  try{
   const response=await fetch(`/api/btc-liquidation-heatmap?days=${requested}&symbol=${symbol}`,{signal:controller.signal});if(!response.ok)throw new Error('unavailable');const next=await response.json();if(id!==sequence)return;
   if(next.symbol!==symbol||!next.times?.length||!next.matrix?.length)throw new Error('empty');data=next;lastFetch=Date.now();
   const long=peak(data.profile_long),short=peak(data.profile_short),size=(data.price_hi-data.price_lo)/data.nbins;
   summary.replaceChildren();for(const [name,p] of [['Largest short band',short],['Largest long band',long]]){const item=document.createElement('span'),lo=data.price_edges?data.price_edges[p.index]:data.price_lo+p.index*size,hi=data.price_edges?data.price_edges[p.index+1]:lo+size;item.textContent=p.value>0?`${name}: ${rangePrice(lo)}–${rangePrice(hi)} · ${usd(p.value)} estimated`:`${name}: none reported`;summary.append(item);}
   status.textContent=`${symbol} ${price(data.current_price??data.ohlc.at(-1)[3])} · Updated ${date(data.updated)} · ${data.coverageDays} days returned${data.exchanges.length?' · '+data.exchanges.join(' / '):''} · Local time`;
   draw();
  }catch(error){if(id!==sequence||error.name==='AbortError')return;clear('Heatmap unavailable. The free provider may be delayed or rate limited. Use Refresh to retry.');status.dataset.error='true';}
 }
 function marketChanged(){
  symbol=root.querySelector('.heat-symbol').value;
  const gold=symbol==='XAUUSDT',source=root.querySelector('.heat-source'),license=root.querySelector('.heat-license');
  source.textContent=gold?'Swolecharts':'Edge or Not';source.href=gold?'https://swolecharts.com/liquidation-heatmap/XAU':'https://edgeornot.com/api';
  license.textContent=gold?'Provider terms':'CC BY 4.0';license.href=gold?'https://swolecharts.com/developers#terms':'https://creativecommons.org/licenses/by/4.0/';
  root.querySelector('.heat-scope').textContent=gold?'Aggregated XAU gold perpetual model in USD; not a single exchange XAUUSDT pair. Side bars split latest model cells above/below price. Values are quantized estimates.':'Aggregated BTC perpetual model; venue coverage shown above.';
  canvas.setAttribute('aria-label',`${symbol} estimated liquidation heatmap with price candles and latest long and short exposure profiles. Largest bands are listed below.`);
  load();
 }
 root.querySelector('.heat-symbol').addEventListener('change',marketChanged);
 root.querySelectorAll('[data-days]').forEach(button=>button.addEventListener('click',()=>{days=Number(button.dataset.days);root.querySelectorAll('[data-days]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));load();}));
 root.querySelector('.heat-zoom').addEventListener('click',event=>{zoom=!zoom;event.currentTarget.textContent=zoom?'Zoom out':'Zoom in';event.currentTarget.setAttribute('aria-pressed',String(zoom));draw();});
 root.querySelector('.heat-refresh').addEventListener('click',load);
 canvas.addEventListener('pointermove',event=>{
  if(!data||!geometry)return;const r=canvas.getBoundingClientRect(),x=event.clientX-r.left,y=event.clientY-r.top,g=geometry;
  if(x<g.left||x>g.axis||y<g.top||y>g.bottom){tooltip.hidden=true;return;}
  const p=g.low+(g.bottom-y)/(g.bottom-g.top)*(g.high-g.low),upper=g.edges.findIndex(edge=>edge>p),j=upper<0?data.nbins-1:Math.max(0,upper-1),i=Math.max(0,Math.min(data.times.length-1,Math.floor((x-g.left)/g.dx)));
  tooltip.textContent=x>g.right?`${price(g.edges[j])}–${price(g.edges[j+1])}\nShorts: ${usd(data.profile_short[j])}\nLongs: ${usd(data.profile_long[j])}\nLatest estimated exposure`:`${date(data.times[i])}\n${price(g.edges[j])}–${price(g.edges[j+1])}\nEstimated exposure: ${usd(data.matrix[i][j])}`;
  tooltip.hidden=false;tooltip.style.left=Math.max(0,Math.min(x+12,r.width-245))+'px';tooltip.style.top=Math.max(0,y-95)+'px';
 });
 canvas.addEventListener('pointerleave',()=>tooltip.hidden=true);new ResizeObserver(draw).observe(canvas.parentElement);
 setInterval(()=>{if(!document.hidden&&Date.now()-lastFetch>=120000)load();},120000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastFetch>=120000)load();});load();
}
