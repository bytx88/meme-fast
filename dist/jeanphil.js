import {chartRange} from './jeanphil-range.mjs';
const $=id=>document.getElementById(id);
const fmtTime=at=>new Date(at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const fmtPrice=value=>value==null?'—':'$'+Number(value).toLocaleString('en-US',{maximumFractionDigits:9,minimumSignificantDigits:2,maximumSignificantDigits:5});
const fmtMoney=value=>value==null?'—':'$'+Number(value).toLocaleString('en-US',{notation:'compact',maximumFractionDigits:2});
const fmtNum=value=>value==null?'—':Number(value).toLocaleString('en-US');
let report={market:[],social:[]},hours=24,selectedAt=null;
const now=()=>Date.now();
const latestBefore=(rows,at,maxAge)=>{for(let i=rows.length-1;i>=0;i--)if(rows[i].at<=at)return at-rows[i].at<=maxAge?rows[i]:null;return null};
function plot(svgId,rows,key,domain,color,maxGap,view){
 const svg=$(svgId),{start,end}=view,W=1000,H=190,L=55,R=16,T=12,B=12;
 const clean=rows.filter(row=>row.at>=start&&row.at<=end&&Number.isFinite(row[key]));
 const values=clean.map(row=>row[key]);
 let [min,max]=domain||[Math.min(...values),Math.max(...values)];
 if(!values.length&&!domain){min=0;max=1}
 if(max===min){min=Math.max(0,min*.95);max=max*1.05||1}
 else if(!domain){const padding=(max-min)*.15;min=Math.max(0,min-padding);max+=padding}
 const x=at=>L+(at-start)/(end-start)*(W-L-R),y=value=>H-B-(value-min)/(max-min)*(H-T-B);
 let paths=[],part=[];
 for(const row of clean){if(part.length&&row.at-part.at(-1).at>maxGap){paths.push(part);part=[]}part.push(row)}
 if(part.length)paths.push(part);
 const grid=[0,.5,1].map(f=>{const yy=T+f*(H-T-B),value=max-f*(max-min);return `<line x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}" stroke="#354353" stroke-dasharray="3 6"/><text x="${L-7}" y="${yy+4}" text-anchor="end" fill="#9aabba" font-size="11">${domain?Math.round(value):value<.001?value.toPrecision(2):value.toPrecision(3)}</text>`}).join('');
 const lines=paths.map(path=>`<polyline fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${path.map(row=>`${x(row.at).toFixed(2)},${y(row[key]).toFixed(2)}`).join(' ')}"/>`).join('');
 const dots=clean.length<8?clean.map(row=>`<circle cx="${x(row.at).toFixed(2)}" cy="${y(row[key]).toFixed(2)}" r="4" fill="${color}"/>`).join(''):'';
 const cursor=selectedAt!=null&&selectedAt>=start&&selectedAt<=end?`<line x1="${x(selectedAt)}" x2="${x(selectedAt)}" y1="${T}" y2="${H-B}" stroke="#cbd6df" stroke-width="1" stroke-dasharray="4 3"/>`:'';
 svg.innerHTML=grid+lines+dots+cursor;
 svg.onpointermove=event=>{const rect=svg.getBoundingClientRect();const frac=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));selectedAt=start+frac*(end-start);renderSelection();renderPlots()};
 svg.onpointerleave=()=>{};
}
function renderPlots(){
 const view=chartRange(report,hours,now()),{start,end,selectedStart}=view;
 const market=(report.market||[]).filter(row=>row.at>=selectedStart),social=(report.social||[]).filter(row=>row.at>=selectedStart);
 plot('social-chart',social,'warmth',[0,100],'#efb565',70*60000,view);
 plot('price-chart',market,'priceUsd',null,'#6bd5b6',16*60000,view);
 $('time-axis').innerHTML=`<span>${fmtTime(start)}</span><span>${fmtTime(start+(end-start)/2)}</span><span>${fmtTime(end)}</span>`;
 const label=hours===24?'24 hours':`${hours/24} days`;
 $('chart-context').textContent=view.zoomed
  ?`Only ${Math.max(1,Math.round((now()-view.first)/60000))} minutes of history collected in the selected ${label}. Zoomed to available samples · ${market.length} price reading${market.length===1?'':'s'} · ${social.length} social reading${social.length===1?'':'s'}.${social.length<2?' Waiting for another social sample to draw its line.':''}`
  :view.first?`Showing collected samples within the selected ${label}. History began ${fmtTime(view.first)}.`:`No collected samples in the selected ${label} yet.`;
 $('chart-empty').hidden=market.length>0||social.length>0;
 $('chart-empty').textContent='No samples in this window yet. Collection begins when the monitor is deployed.';
}
function renderSelection(){
 const at=selectedAt??now(),market=latestBefore(report.market||[],at,16*60000),social=latestBefore(report.social||[],at,65*60000);
 $('moment').textContent=fmtTime(at);
 $('detail-warmth').textContent=social?`${social.warmth} / 100`:'—';
 $('detail-posts').textContent=social?fmtNum(social.posts2h):'—';
 $('detail-coin-posts').textContent=social?fmtNum(social.coinPosts2h):'—';
 $('detail-price').textContent=fmtPrice(market?.priceUsd);
 $('detail-cap').textContent=fmtMoney(market?.marketCap);
 $('detail-volume').textContent=fmtMoney(market?.volume5m);
 $('sample-note').textContent=`${social?'Social sampled '+fmtTime(social.at):'No nearby social sample'} · ${market?'Market sampled '+fmtTime(market.at):'No nearby market sample'}. Readings are observed at different cadences.`;
 const list=$('posts-list');list.replaceChildren();
 if(!social?.posts?.length){const p=document.createElement('p');p.textContent=social?'No qualifying indexed posts in this two-hour sample.':'No nearby social evidence sample.';list.append(p);return}
 for(const post of social.posts){const a=document.createElement('a');a.href=post.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=post.title+' ↗';const small=document.createElement('small');small.textContent=`${post.kind==='personality'?'Personality mention':'Coin-only mention'} · ${fmtTime(post.publishedAt)}`;a.append(small);list.append(a)}
}
function render(){
 report.market=(report.market||[]).sort((a,b)=>a.at-b.at);report.social=(report.social||[]).sort((a,b)=>a.at-b.at);
 const market=report.market.at(-1),social=report.social.at(-1);
 $('warmth').textContent=social?`${social.warmth} / 100`:'—';$('posts').textContent=social?fmtNum(social.posts2h):'—';
 $('price').textContent=fmtPrice(market?.priceUsd);$('cap').textContent=fmtMoney(market?.marketCap);
 $('warmth-sub').textContent=social?`Sampled ${fmtTime(social.at)} · ${social.partial?'partial RSS coverage':'X RSS sample'}`:'Awaiting X RSS sample';
 $('price-sub').textContent=market?`Sampled ${fmtTime(market.at)}`:'Awaiting market sample';
 $('cap-sub').textContent=market?.marketCap==null?'Not supplied by selected pool':'Exact-contract pool';
 $('updated').textContent=report.updatedAt?`Updated ${fmtTime(report.updatedAt)}`:'Waiting for collection';
 const errors=Object.entries(report.errors||{}).map(([key,value])=>`${key}: ${value.message}`);
 $('coverage').textContent=errors.length?`Collection issues: ${errors.join(' · ')}`:'Market: DexScreener exact-contract pool. Social: sampled Google News RSS index of X; coverage is incomplete.';
 if(selectedAt==null)selectedAt=market?.at??social?.at??now();renderPlots();renderSelection();
}
async function load(){try{const response=await fetch('/api/jeanphil-monitor',{cache:'no-store'});if(!response.ok)throw new Error(`HTTP ${response.status}`);report=await response.json();render()}catch(error){$('updated').textContent=`Monitor unavailable: ${error.message}`}}
for(const button of document.querySelectorAll('[data-hours]'))button.addEventListener('click',()=>{hours=Number(button.dataset.hours);for(const b of document.querySelectorAll('[data-hours]'))b.setAttribute('aria-pressed',String(b===button));selectedAt=null;render()});
$('refresh').addEventListener('click',load);load();setInterval(load,60000);
