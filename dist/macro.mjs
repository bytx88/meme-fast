import snapshot from './macro-data.mjs';
import {compareSeries,visibleRows,symbols,periodReturn,executionReview,assetPeriods,seasonalFrames,frameReturns} from './macro-series.mjs';
const host=document.getElementById('comparison-chart');
const colours={QQQ:'#63a9ff',BTC:'#ffad55',XAU:'#6bdbb2'};
const names={QQQ:'Equity risk',BTC:'Crypto risk',XAU:'Spot gold'};
const pct=n=>n===null?'Unavailable':`${n>=0?'+':''}${n.toFixed(2)}%`;
const price=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:2,minimumFractionDigits:2}).format(n);
const niceDate=d=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(d));
const el=(name,cls,text)=>{const n=document.createElement(name);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const set=(id,text)=>document.getElementById(id).textContent=text;
const svgEl=(name,attrs,text)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;};
const sourceLinks={FED:'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',YIELD:'https://finance.yahoo.com/quote/%5ETNX/',BRENT:'https://finance.yahoo.com/quote/BZ%3DF/'};
let previousVisit=null,lastFetchAt=0;
try{const saved=JSON.parse(localStorage.getItem('meme-macro-last-visit')||'null');if(saved&&/^\d{4}-\d{2}-\d{2}$/.test(saved.date)&&Number.isFinite(saved.btc)&&saved.btc>0)previousVisit=saved;}catch{}
let report={...snapshot,drivers:{},news:[],feeds:{}},c,review,rows,svg,cursor,dots,x,y,from,to,tip,badge,windowDays=0,renderTimer,selectedDate=null,selectedPoint=null;
const slider=document.getElementById('chart-date'),readout=document.getElementById('chart-readout');
function card(label,value,detail,tone=''){const n=el('article',tone);n.append(el('span','metric-label',label),el('strong','',value),el('p','',detail));return n;}
function driverRead(key){
 const list=report.drivers?.[key]||[],latest=list.at(-1),feed=report.feeds?.[key];
 if(!latest)return {value:'Unavailable',detail:'Current source could not be read; no current conclusion.',tone:'amber',text:'Source unavailable',date:null};
 const retained=feed?.status==='error'?' · retained after source failure':'';
 if(key==='FED'){
  let change=null;
  for(let i=list.length-1;i>0;i--)if(list[i].high!==list[i-1].high||list[i].low!==list[i-1].low){change={date:list[i].date,bp:(list[i].high-list[i-1].high)*100};break;}
  return {value:`${latest.low.toFixed(2)}–${latest.high.toFixed(2)}%`,detail:change?`Last change ${change.bp>0?'+':''}${change.bp.toFixed(0)} bp, statement ${niceDate(change.date)}. ${change.bp>0?'Tighter policy remains a hurdle for the expansion thesis.':'Policy easing supports the expansion thesis; price still needs to confirm.'}`:'Target unchanged within available history; market yields can still tighten conditions.',tone:change?.bp>0?'negative':change?.bp<0?'positive':'',date:latest.date,retained};
 }
 const prior=list.at(-2),week=list.at(-6),day=prior?(key==='YIELD'?(latest.close-prior.close)*100:100*(latest.close/prior.close-1)):null;
 const five=week?(key==='YIELD'?(latest.close-week.close)*100:100*(latest.close/week.close-1)):null;
 const neutral=five===null||Math.abs(five)<(key==='YIELD'?1:.1),rising=!neutral&&five>0;
 const movement=n=>n===null?'Unavailable':key==='YIELD'?`${n>=0?'+':''}${n.toFixed(1)} bp`:pct(n);
 const effect=neutral?'Little change over five sessions.':key==='YIELD'?(rising?'Rising yields increase the hurdle for risk expansion.':'Falling yields ease the hurdle; BTC participation must follow.'):(rising?'Rising energy prices challenge the inflation-relief story.':'Falling energy prices support the relief story.');
 return {value:key==='YIELD'?`${latest.close.toFixed(3)}%`:`$${price(latest.close)} / bbl`,detail:`1 session ${movement(day)} · 5 sessions ${movement(five)}. ${effect}`,tone:neutral?'':rising?'negative':'positive',date:latest.date,retained};
}
function showDrivers(){
 const panel=document.getElementById('driver-monitor');panel.replaceChildren();
 for(const [key,label] of [['FED','FED TARGET'],['YIELD','US 10Y YIELD / CBOE INDEX'],['BRENT','BRENT / FRONT-MONTH FUTURES']]){
  const r=driverRead(key),n=card(label,r.value,r.detail,r.tone);
  const a=el('a','driver-source',r.date?`Price / policy date: ${niceDate(r.date)}${r.retained||''} ↗`:'Source / retry status ↗');a.href=report.drivers?.[key]?.at(-1)?.sourceUrl||sourceLinks[key];a.target='_blank';a.rel='noopener noreferrer';n.append(a);panel.append(n);
 }
 set('rate-transmission',`Fed: ${driverRead('FED').value}. 10Y: ${driverRead('YIELD').value}. ${driverRead('YIELD').detail}`);
 set('feed-checked',report.attemptedAt?'Sources checked '+new Date(report.attemptedAt).toLocaleString('en-GB')+'. Completed closes only; the policy date is the latest FOMC statement. Refresh uses a 30-minute source cache.':'Published reference data shown while current sources are checked.');
 set('oil-transmission',`Brent: ${driverRead('BRENT').value}. ${driverRead('BRENT').detail}`);
}
function showNews(previousVisit){
 const list=document.getElementById('daily-news-list');list.replaceChildren();
 const relevant=(report.news||[]).filter(row=>row.topic||/\b(fed|inflation|cpi|interest rates?|treasury|yields?|iran|oil|etf|volatility|steadies)\b/i.test(row.title));
 const news=relevant.slice(0,6);
 if(!news.length)list.append(el('p','news-empty','No recent relevant publisher headlines available. This does not establish that no catalysts occurred.'));
 for(const row of news){
  const n=el('article'),time=el('span','news-time',`${row.source}${row.topic?" / "+row.topic:""} · ${new Date(row.publishedAt).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}`);
  if(previousVisit&&Date.parse(row.publishedAt)>previousVisit.visitedAt)time.append(el('b','news-new',' NEW SINCE LAST VISIT'));
  const link=el('a','',row.title);if(/^https:\/\/(www\.)?(coindesk|cnbc)\.com\//.test(row.url)){link.href=row.url;link.target='_blank';link.rel='noopener noreferrer';}
  n.append(time,link);list.append(n);
 }
 const status=['CNBC','CoinDesk'].map(s=>`${s}: ${report.feeds?.[s]?.status==='ok'?'checked':'unavailable / retained'}`).join(' · ');
 set('news-freshness',`${status}. Headline feed covers the past seven days; individual stories have not been independently verified here. News direction is tested against the market response above.`);
}
function showReview(saveVisit=false){
 c=compareSeries(report.series,report.start,'2025-10-01');review=executionReview(report.series);
 const last=c.rows.at(-1),r=review,feeds=report.feeds||{},failures=Object.entries(feeds).filter(([,v])=>v.status==='error').map(([k])=>k),age=(Date.now()-Date.parse(r.date))/(86400000);
 set('review-date',niceDate(r.date).toUpperCase());
 set('review-freshness',`BTC / QQQ close ${niceDate(r.date)} · three-asset chart ${niceDate(last.date)}${failures.length?' · unavailable: '+failures.join(', '):''}${age>4?' · delayed closes':''}`);
 set('review-headline',r.headline+(r.relative!==null?(r.relative>0?' / gaining versus QQQ':' / lagging QQQ'):''));
 const stateRead={unknown:'Too few shared closes to establish a 20-session range.',breakout:'BTC closed above the preceding 20-session closing range. The next test is whether a retest holds.',breakdown:'BTC closed below the preceding 20-session closing range. That challenges the reset-to-expansion setup.',range:'BTC remains inside the preceding 20-session closing range. A recovery inside that range does not establish a breakout.'}[r.state];
 const rates=driverRead('YIELD'),oil=driverRead('BRENT');
 set('review-verdict',stateRead+' '+(rates.date&&oil.date&&report.feeds?.YIELD?.status==='ok'&&report.feeds?.BRENT?.status==='ok'?'Rates / oil: '+rates.detail.split('. ').at(-1)+' '+oil.detail.split('. ').at(-1):'Rates or oil observations are unavailable; macro confirmation is incomplete.'));
 const signals=document.getElementById('review-signals');signals.replaceChildren(
  card('BTC / QQQ · 5-SESSION RELATIVE RETURN',pct(r.relative),r.relative===null?'Insufficient shared history.':r.relative>0?'Crypto is gaining relative strength.':'Crypto is losing relative strength.',r.relative>0?'positive':'negative'),
  card('BTC · CLOSING RANGE TO RECLAIM',`$${r.high===null?'Unavailable':price(r.high)}`,'Highest close of the preceding 20 shared sessions. Break above, then test persistence.'),
  card('BTC · LOWER RANGE BOUNDARY',`$${r.low===null?'Unavailable':price(r.low)}`,'Lowest close of the preceding 20 shared sessions. A close below challenges the recovery.')
 );
 const body=document.getElementById('return-body');body.replaceChildren();
 for(const s of ['BTC','QQQ','XAU']){
  const actual=assetPeriods(report.series[s],report.series.QQQ.map(row=>row.date)),tr=el('tr');tr.append(el('th','',s),el('td','',niceDate(actual.date)));for(const n of [1,5,20])tr.append(el('td',actual.returns[n]>0?'positive':actual.returns[n]<0?'negative':'',pct(actual.returns[n])));tr.append(el('td','',`$${price(actual.close)}`));body.append(tr);
 }
 const bitcoin=assetPeriods(report.series.BTC);set('btc-weekend',bitcoin.date>r.date?'Newer BTC daily close: $'+price(bitcoin.close)+' on '+niceDate(bitcoin.date)+' ('+pct(bitcoin.returns[1])+' over one UTC day). The equity-relative review remains dated '+niceDate(r.date)+'.':'');
 const leadership=`As of ${niceDate(r.date)}: 5-session BTC / QQQ relative return ${pct(r.relative)}. ${stateRead}`;
 set('comparison-read',leadership);set('map-market-read',leadership);set('flow-transmission',`BTC 5 sessions: ${pct(r.metrics.BTC[5])}; QQQ: ${pct(r.metrics.QQQ[5])}. ${r.relative>0?'BTC is gaining':'BTC is losing'} relative strength. This measures price participation, not ETF-flow volume.`);
 let previous=null;
 try{
  previous=previousVisit;
  const driverValues=Object.fromEntries(Object.entries(report.drivers||{}).map(([key,value])=>[key,value.at(-1)]));
  const driverChanges=[];
  for(const key of ['FED','YIELD','BRENT']){const a=previous?.drivers?.[key],b=driverValues[key];if(!a||!b||b.date<a.date||report.feeds?.[key]?.status==='error')continue;const delta=key==='FED'?(b.high-a.high)*100:key==='YIELD'?(b.close-a.close)*100:100*(b.close/a.close-1);if(Math.abs(delta)>.001)driverChanges.push(key==='BRENT'?'Brent '+pct(delta):(key==='FED'?'Fed ':'10Y ')+(delta>=0?'+':'')+delta.toFixed(1)+' bp');}
  if(previous?.date&&previous.date<r.date)set('visit-change',`Since your last visit (${niceDate(previous.date)}): BTC close ${pct(100*(r.price/previous.btc-1))}; setup ${previous.state} → ${r.state}. ${driverChanges.length?driverChanges.join(' · ')+'.':''}`);
  else set('visit-change',previous?.date>r.date?'Current shared closes are older than the previous visit; change comparison withheld.':previous?.date===r.date?'No new shared closing session since your last visit. '+(driverChanges.length?driverChanges.join(' · ')+'. ':'')+'Check newly published headlines.':'First visit here. On return, this line compares the closing price and setup with your previous visit.');
  if(saveVisit&&(!previous?.date||r.date>=previous.date))localStorage.setItem('meme-macro-last-visit',JSON.stringify({date:r.date,btc:r.price,state:r.state,drivers:driverValues,visitedAt:Date.now()}));
 }catch{set('visit-change','Previous-visit comparison is unavailable because this browser cannot store local history.');}
 showDrivers();showNews(previous);
 const summary=document.getElementById('comparison-summary');summary.replaceChildren();
 for(const s of symbols){const n=el('article');n.style.setProperty('--series',colours[s]);n.append(el('span','series-name',`${s} / ${names[s]}`),el('strong','',`$${price(last.prices[s])}`),el('small','',`5 shared sessions ${pct(periodReturn(c.rows,s,5))} · ${niceDate(last.date)}`));summary.append(n);}
 const frames=seasonalFrames('2025-10-01',last.date),scores=document.getElementById('season-scorecard');scores.replaceChildren();
 for(const frame of frames){const actual=frameReturns(c.rows,frame),n=el('article',frame.complete?'':'current-season');n.append(el('b','',`${frame.label} ${frame.start.slice(0,4)}${frame.end.slice(0,4)!==frame.start.slice(0,4)?'–'+frame.end.slice(2,4):''}`),el('small','',frame.complete?'COMPLETED WINDOW':'CURRENT WINDOW / IN PROGRESS'));
  if(actual){for(const s of symbols){const line=el('span','',`${s} ${pct(actual.returns[s])}`);line.style.color=colours[s];n.append(line);}n.append(el('small','',`${niceDate(actual.first)} → ${niceDate(actual.last)}`));}else n.append(el('span','','Awaiting enough closes'));scores.append(n);}
 const completed=frames.filter(f=>f.complete&&f.label==='Oct–Jan').map(f=>frameReturns(c.rows,f)).filter(Boolean);
 if(completed.length&&completed.at(-1).returns.BTC<0){const note=el('p','season-test',`Thesis test: BTC fell ${Math.abs(completed.at(-1).returns.BTC).toFixed(2)}% in the previous observed Oct–Jan window. The calendar alone did not produce expansion; the current window needs price and participation confirmation.`);scores.append(note);}
 set('chart-method',`Line return = close / ${c.anchor} close − 1 (the requested November reference). The view starts October 2025. Seasonal cards measure the first-to-last available shared close inside each frame, independently of the line reference. Current-window returns are partial. 1 / 5 / 20-session returns use shared QQQ / BTC / XAU observations; dates align but session closing times differ. The BTC range uses closing prices, not intraday highs / lows; it cannot confirm a liquidity sweep or absorption.`);
 set('chart-freshness',`Observed through ${niceDate(last.date)}. Shading marks seasonal windows; the future portion has no price path.`);
 render();
}
function inspect(index,point){
 index=Math.max(0,Math.min(rows.length-1,index));slider.value=index;const r=rows[index];
 if(point){selectedDate=r.date;selectedPoint=point;}
 const date=niceDate(r.date);readout.textContent=`${date} · ${symbols.map(s=>`${s} $${price(r.prices[s])} (${pct(r.returns[s])})`).join(' · ')}`;
 cursor.setAttribute('x1',x(Date.parse(r.date)));cursor.setAttribute('x2',x(Date.parse(r.date)));
 for(const s of symbols){dots[s].setAttribute('cx',x(Date.parse(r.date)));dots[s].setAttribute('cy',y(r.returns[s]));}
 badge.textContent=date;
 tip.replaceChildren(el('strong','',date),el('small','','Price / change from comparison reference'));
 for(const s of symbols){const line=el('div','tooltip-line');line.style.color=colours[s];line.append(el('b','',s),el('span','',`$${price(r.prices[s])}`),el('span','',pct(r.returns[s])));tip.append(line);}
 if(point){tip.hidden=false;const width=host.clientWidth,tipWidth=Math.min(330,width-16);tip.style.width=tipWidth+'px';tip.style.left=Math.max(8,Math.min(width-tipWidth-8,point.x+18))+'px';tip.style.top=Math.max(8,Math.min(host.clientHeight-150,point.y-90))+'px';}
}
function render(){
 rows=visibleRows(c,windowDays);const last=c.rows.at(-1),frames=seasonalFrames('2025-10-01',last.date);
 const w=Math.max(360,host.clientWidth),h=w<600?300:370,left=w<600?44:64,right=24,top=44,bottom=50;
 from=Date.parse(windowDays?rows[0].date:'2025-10-01');to=Date.parse(windowDays?last.date:frames.at(-1).end);if(to<=from)to=from+86400000;
 const values=rows.flatMap(r=>symbols.map(s=>r.returns[s]));let low=Math.floor(Math.min(0,...values)/10)*10-5,high=Math.ceil(Math.max(0,...values)/10)*10+5;
 x=t=>left+(t-from)/(to-from)*(w-left-right);y=v=>top+(high-v)/(high-low)*(h-top-bottom);
 svg=svgEl('svg',{viewBox:`0 0 ${w} ${h}`,role:'img','aria-label':`QQQ, BTC and gold seasonal performance through ${niceDate(last.date)}`});
 for(let i=0;i<frames.length;i++){
  const frame=frames[i],a=Math.max(from,Date.parse(frame.start)),b=Math.min(to,Date.parse(frame.end));if(a>=b)continue;
  svg.append(svgEl('rect',{x:x(a),y:0,width:x(b)-x(a),height:h-bottom,fill:i%2?'#142431':'#101b24',opacity:.8}),svgEl('line',{x1:x(a),x2:x(a),y1:0,y2:h-bottom,stroke:'#496278','stroke-dasharray':'3 4'}));
  if(x(b)-x(a)>95)svg.append(svgEl('text',{x:(x(a)+x(b))/2,y:21,'text-anchor':'middle',fill:frame.complete?'#b6c4d0':'#d5b57a','font-size':w<600?11:13},`${frame.label} ${frame.complete?'':' / current'}`));
 }
 for(let i=0;i<=4;i++){const v=low+(high-low)*i/4;svg.append(svgEl('line',{x1:left,x2:w-right,y1:y(v),y2:y(v),stroke:'#2a3947'}),svgEl('text',{x:left-8,y:y(v)+4,'text-anchor':'end',fill:'#a9bac9','font-size':w<600?11:13},`${v.toFixed(0)}%`));}
 svg.append(svgEl('line',{x1:left,x2:w-right,y1:y(0),y2:y(0),stroke:'#74808b','stroke-dasharray':'4 4'}));
 let tick=new Date(from);tick.setUTCDate(1);if(tick.getTime()<from)tick.setUTCMonth(tick.getUTCMonth()+1);
 const tickStep=w<600&&!windowDays?3:!windowDays?2:1;
 while(tick.getTime()<=to){const t=tick.getTime();svg.append(svgEl('text',{x:x(t),y:h-20,'text-anchor':'middle',fill:'#c5d3df','font-size':w<600?12:14},new Intl.DateTimeFormat('en-GB',{month:'short',year:'2-digit',timeZone:'UTC'}).format(tick)));tick.setUTCMonth(tick.getUTCMonth()+tickStep);}
 for(const s of symbols){svg.append(svgEl('polyline',{points:rows.map(r=>`${x(Date.parse(r.date))},${y(r.returns[s])}`).join(' '),fill:'none',stroke:colours[s],'stroke-width':2.2,'stroke-linejoin':'round','vector-effect':'non-scaling-stroke'}));}
 if(!windowDays){const current=x(Date.parse(last.date));svg.append(svgEl('line',{x1:current,x2:current,y1:top,y2:h-bottom,stroke:'#cfb782','stroke-dasharray':'4 4'}));if(w-right-current>95)svg.append(svgEl('text',{x:current+(w-right-current)/2,y:h/2,fill:'#9daeba','text-anchor':'middle','font-size':w<600?10:12},'No shared data yet'));}
 cursor=svgEl('line',{y1:top,y2:h-bottom,stroke:'#dae1e7','stroke-dasharray':'3 3'});svg.append(cursor);dots={};
 for(const s of symbols){dots[s]=svgEl('circle',{r:4,fill:colours[s]});svg.append(dots[s]);}
 tip=el('div','chart-tooltip');tip.hidden=true;badge=el('div','chart-date-badge');
 svg.addEventListener('pointermove',event=>{const rect=svg.getBoundingClientRect(),t=from+((event.clientX-rect.left)/rect.width*w-left)/(w-left-right)*(to-from);let nearest=0;rows.forEach((r,i)=>{if(Math.abs(Date.parse(r.date)-t)<Math.abs(Date.parse(rows[nearest].date)-t))nearest=i;});inspect(nearest,{x:event.clientX-rect.left,y:event.clientY-rect.top});if(t>Date.parse(last.date)+86400000){const date=niceDate(new Date(Math.min(to,t)));badge.textContent=date;cursor.setAttribute('x1',x(Math.min(to,t)));cursor.setAttribute('x2',x(Math.min(to,t)));tip.replaceChildren(el('strong','',date),el('p','','No shared closing observation for this date. Last plotted close: '+niceDate(last.date)+'. No projected price path.'));}});
 svg.addEventListener('pointerleave',()=>{tip.hidden=true;selectedPoint=null;});
 host.replaceChildren(svg,tip,badge);slider.max=rows.length-1;inspect(selectedDate&&rows.some(r=>r.date===selectedDate)?rows.findIndex(r=>r.date===selectedDate):rows.length-1,selectedPoint);
}
slider.addEventListener('input',()=>inspect(Number(slider.value),{x:host.clientWidth/2,y:80}));
document.querySelectorAll('[data-window]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-window]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));windowDays=Number(button.dataset.window);render();}));
document.getElementById('download-comparison').addEventListener('click',()=>{const lines=['date,QQQ_close,BTC_USD_close,XAU_USD_per_oz,QQQ_return_pct,BTC_return_pct,XAU_return_pct',...c.rows.map(r=>[r.date,...symbols.map(s=>r.prices[s]),...symbols.map(s=>r.returns[s])].join(','))];const url=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/csv'})),a=el('a');a.href=url;a.download='macro-seasonal-comparison.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
new ResizeObserver(()=>{clearTimeout(renderTimer);renderTimer=setTimeout(()=>{if(c)render();},100);}).observe(host);
async function refresh(){
 const button=document.getElementById('refresh-review');if(button.disabled)return;lastFetchAt=Date.now();button.disabled=true;button.textContent='Checking sources…';
 try{
  const response=await fetch('/api/macro-review',{cache:'no-store',signal:AbortSignal.timeout(40000)});
  if(!response.ok)throw Error('Source request unavailable');
  const next=await response.json();compareSeries(next.series,next.start,'2025-10-01');report=next;showReview(true);
 }catch{
  showReview(false);set('review-freshness',`Refresh unavailable · published closes through ${niceDate(c.rows.at(-1).date)}`);
 }finally{button.disabled=false;button.textContent='Refresh observations';}
}
document.getElementById('refresh-review').addEventListener('click',refresh);
const refreshIfDue=()=>{if(document.visibilityState==='visible'&&Date.now()-lastFetchAt>=1800000)refresh();};
document.addEventListener('visibilitychange',refreshIfDue);setInterval(refreshIfDue,60000);
try{showReview(false);refresh();}catch(error){host.replaceChildren(el('p','chart-loading',`Comparison unavailable: ${error.message}`));}
