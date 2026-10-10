import {usable,driverContext} from './macro-analysis.mjs';
import {fedPolicyMove} from './macro-desk.mjs';

// Authored channels, not predictions or another scoring engine.
export const causalPositions={WAR:[30,35],BRENT:[240,35],CPI:[450,35],FED:[660,35],QE:[30,220],LIQUIDITY:[240,220],YIELD:[660,220],XAU:[240,430],QQQ:[450,430],BTC:[660,430]};
export const causalEdges=[
 {from:'WAR',to:'BRENT',kind:'conditional',path:'M194 83H240',effect:'Supply disruption or shipping risk can raise oil; de-escalation can ease the premium.'},
 {from:'BRENT',to:'CPI',kind:'mechanism',path:'M404 83H450',effect:'Energy prices enter consumer prices directly and through transport and production costs. Pass-through has lags.'},
 {from:'CPI',to:'FED',kind:'conditional',path:'M614 83H660',effect:'Persistent inflation can shift policy expectations. The Fed also weighs employment, growth and expectations.'},
 {from:'FED',to:'YIELD',kind:'conditional',path:'M742 131V220',effect:'Policy expectations affect Treasury yields. Long yields also reflect inflation expectations, growth and term premium; a hike does not force them higher.'},
 {from:'QE',to:'LIQUIDITY',kind:'mechanism',path:'M194 268H240',effect:'Asset purchases and runoff affect reserves and portfolio duration. This is one component of liquidity, not a measurement of the global total.'},
 {from:'LIQUIDITY',to:'QQQ',kind:'conditional',path:'M322 316L492 430',effect:'Easier financing and risk appetite can support equities; earnings and valuation can offset that support.'},
 {from:'LIQUIDITY',to:'BTC',kind:'conditional',path:'M362 316L702 430',effect:'Financing conditions can support crypto risk-taking. ETF and venue spot flows are separate demand channels, not a global liquidity proxy.'},
 {from:'YIELD',to:'QQQ',kind:'conditional',path:'M742 316L572 430',effect:'Higher discount rates can pressure equity valuations, especially long-duration growth. What was already priced matters.'},
 {from:'YIELD',to:'BTC',kind:'conditional',path:'M782 316L782 430',effect:'Higher competing yields and funding costs can challenge crypto demand. Positioning and spot buying determine the actual response.'},
 {from:'YIELD',to:'XAU',kind:'conditional',path:'M702 316L362 430',effect:'Higher real yields tend to increase the opportunity cost of gold. Nominal 10Y alone does not measure real yields.'},
 {from:'WAR',to:'XAU',kind:'conditional',path:'M194 131L268 430',effect:'Geopolitical stress can support safe-haven demand for gold; the response competes with real yields and the dollar.'},
 {from:'LIQUIDITY',to:'XAU',kind:'conditional',path:'M282 316L282 430',effect:'Easing can support gold through lower real yields or a weaker dollar. Neither channel is measured by this node.'}
];
const signed=n=>Number.isFinite(n)?`${n>=0?'+':''}${n.toFixed(2)}%`:'Window incomplete';
const dollars=n=>Number.isFinite(n)?'$'+n.toLocaleString('en-US',{maximumFractionDigits:2}):'Unavailable';
const flow=n=>Number.isFinite(n)?`${n<0?'-':'+'}$${Math.abs(n).toFixed(1)}m`:'Unavailable';

export function causalPath(id){
 const vertices=new Set([id]),edges=new Set();
 for(const direction of ['up','down']){
  const pending=[id],seen=new Set([id]);
  while(pending.length){const current=pending.pop();for(const [i,e] of causalEdges.entries()){
   if((direction==='up'?e.to:e.from)!==current)continue;
   const next=direction==='up'?e.from:e.to;edges.add(i);vertices.add(next);
   if(!seen.has(next)){seen.add(next);pending.push(next);}
  }}
 }
 return {vertices,edges};
}
export function marketResponse(report,count=5){
 const keys=['QQQ','BTC','XAU'],maps=Object.fromEntries(keys.map(k=>[k,new Map((report.series?.[k]||[]).filter(r=>Number.isFinite(r.close)&&r.close>0).map(r=>[r.date,r.close]))]));
 const dates=[...maps.QQQ.keys()].filter(d=>keys.every(k=>maps[k].has(d))).sort();
 const date=dates.at(-1),start=dates.at(-count-1);
 const values=Object.fromEntries(keys.map(k=>[k,{close:date?maps[k].get(date):null,change:start?100*(maps[k].get(date)/maps[k].get(start)-1):null}]));
 return {date,start,count,values};
}
export function responseSummary(report,asOf,count=5){
 const r=marketResponse(report,count),label=count===20?'1M / 20 shared sessions':count===1?'1D / 1 shared session':'5D / 5 shared sessions';
 if(!r.start)return `${label}: insufficient matching BTC, QQQ and gold observations.`;
 if(!['BTC','QQQ','XAU'].every(k=>usable(report,k,asOf))||(Date.parse(asOf)-Date.parse(r.date))/86400000>4)return `${label}: delayed / unavailable source; last comparable window ${r.start} → ${r.date}.`;
 const b=r.values.BTC.change,q=r.values.QQQ.change,g=r.values.XAU.change;
 const read=b<q&&b<g?'BTC underperforming QQQ and gold':b>q&&b>g?'BTC outperforming QQQ and gold':`BTC ${b===q?'matching':b>q?'outperforming':'underperforming'} QQQ; ${b===g?'matching':b>g?'outperforming':'underperforming'} gold`;
 return `${read} · ${label} · ${r.start} → ${r.date}. Observed returns; no causal attribution.`;
}

export function causalNodes(report,a,count=5){
 const unknown=(id,label,note)=>({id,label,value:'Unmeasured',trend:'No dedicated live series',date:null,tone:'unmeasured',note,evidence:[]});
 const nodes=[
  unknown('WAR','War / geopolitics','Headlines are investigation leads. There is no verified event-severity or supply-disruption measure here.'),
  unknown('CPI','Inflation / CPI','Actual CPI, consensus and inflation surprises are not collected. Oil is an input, not a substitute for CPI.'),
  unknown('QE','QE / QT','No central-bank balance-sheet series is collected. A rate hike or cut does not establish QE or QT.'),
  unknown('LIQUIDITY','Global liquidity','Broad liquidity is unmeasured. ETF flows, OKX open interest and funding are narrower channels and cannot establish the global total.')
 ];
 const cpi=report.drivers?.CPI?.at(-1),balance=report.drivers?.H41?.at(-1);
 if(cpi){const n=nodes.find(n=>n.id==='CPI'),fresh=usable(report,'CPI',a.asOf);Object.assign(n,{value:cpi.yoy.toFixed(1)+'% YoY',trend:fresh?`${signed(cpi.mom)} MoM / SA`:'Delayed / unavailable',date:cpi.date,displayDate:cpi.period+' / reference month',tone:fresh?'mixed':'unmeasured',note:`US headline CPI / reference month ${cpi.period}. YoY uses unadjusted indexes; MoM uses seasonally adjusted indexes. Consensus, surprises and core inflation are not measured.`,evidence:[{text:'BLS / all-items CPI; reference-period end, not release date',date:cpi.date,url:cpi.sourceUrl}]});}
 if(balance){const fresh=usable(report,'H41',a.asOf),money=v=>'$'+(v/1e6).toFixed(3)+'tn',delta=v=>`${v>=0?'+':'−'}$${(Math.abs(v)/1000).toFixed(1)}bn / week`;
  Object.assign(nodes.find(n=>n.id==='QE'),{label:'Fed securities / QE–QT',value:money(balance.securities),trend:fresh?delta(balance.securitiesChange):'Delayed / unavailable',date:balance.date,tone:fresh?'mixed':'unmeasured',note:'H.4.1 securities held outright, weekly average. The weekly balance change includes settlements and maturities; it does not establish an announced QE or QT regime.',evidence:[{text:'Fed H.4.1 / securities held outright; USD millions',date:balance.date,url:balance.sourceUrl}]});
  Object.assign(nodes.find(n=>n.id==='LIQUIDITY'),{label:'US reserves / liquidity',value:money(balance.reserves),trend:fresh?delta(balance.reservesChange):'Delayed / unavailable',date:balance.date,tone:fresh?'mixed':'unmeasured',note:'US reserve balances, weekly average. A measured US component; global liquidity remains unmeasured. Treasury cash and reverse repos also affect reserves.',evidence:[{text:`Fed H.4.1 / reserve balances. TGA ${money(balance.tga)} (${delta(balance.tgaChange)}); total reverse repos ${money(balance.rrp)} (${delta(balance.rrpChange)}). All weekly averages; reverse repos include foreign official accounts.`,date:balance.date,url:balance.sourceUrl}]});
 }
 for(const [key,label] of [['BRENT','Oil / Brent'],['YIELD','Treasury yields']]){
  const list=report.drivers?.[key]||[],c=driverContext(list),fresh=usable(report,key,a.asOf),ready=fresh&&c&&Number.isFinite(c.level);
  const pressure=ready&&(c.percentile>=80||c.significant&&c.change5>0),support=ready&&c.significant&&c.change5<0;
  nodes.push({id:key,label,value:c?key==='YIELD'?c.level.toFixed(3)+'%':dollars(c.level)+' / bbl':'Unavailable',date:c?.date||null,
   trend:ready?'5 sessions '+(key==='YIELD'&&list.length>=6?((c.level-list.at(-6).close)*100>=0?'+':'')+((c.level-list.at(-6).close)*100).toFixed(1)+' bp':signed(c.change5)):'Delayed / unavailable',tone:!ready?'unmeasured':pressure&&support?'mixed':pressure?'pressure':support?'support':'mixed',
   note:key==='YIELD'?'Nominal 10Y / CBOE index. Real yields, the dollar and expected rate surprises remain unmeasured. Existing fixed-rate bond prices generally move inversely to market yields.':'Front-month Brent futures. Oil can transmit supply stress into inflation; it does not establish the cause of a move.',
   evidence:c?[{text:key==='YIELD'?'Yahoo / CBOE 10Y yield':'Yahoo / Brent futures',date:c.date,url:key==='YIELD'?'https://finance.yahoo.com/quote/%5ETNX/':'https://finance.yahoo.com/quote/BZ%3DF/'}]:[]});
 }
 const fed=report.drivers?.FED?.at(-1),move=fedPolicyMove(report.drivers?.FED),fedFresh=usable(report,'FED',a.asOf);
 nodes.push({id:'FED',label:'Fed policy',value:fed?`${fed.low.toFixed(2)}–${fed.high.toFixed(2)}%`:'Unavailable',date:fed?.date||null,tone:!fedFresh?'unmeasured':move?move.bp>0?'pressure':'support':'mixed',trend:!fedFresh?'Delayed / unavailable':move?move.label:'Change unmeasured',note:(move?`${move.context} · move dated ${move.date}. `:'')+'This is the observed target, not market pricing of the next decision. A single hike does not establish a sustained hiking cycle.',evidence:fed?[{text:'Federal Reserve / latest policy decision',date:fed.date,url:fed.sourceUrl}]:[]});
 const response=marketResponse(report,count);
 for(const [key,label] of [['XAU','Gold / XAU'],['QQQ','Stocks / QQQ'],['BTC','Bitcoin / BTC']]){
  const period={date:response.date,close:response.values[key].close},fresh=usable(report,key,a.asOf)&&response.date&&(Date.parse(a.asOf)-Date.parse(response.date))/86400000<=4,change=response.values[key].change;
  nodes.push({id:key,label,value:dollars(period?.close),date:period?.date||null,trend:fresh?(count===20?'20 sessions ':count+' session'+(count===1?' ':'s '))+signed(change):'Delayed / unavailable',tone:!fresh?'unmeasured':key==='XAU'||!Number.isFinite(change)||change===0?'mixed':change>0?'support':'pressure',
   note:key==='XAU'?'Gold has competing safe-haven, real-yield and currency channels. A rising nominal yield or CPI print does not determine its direction.':'This is an observed price response over QQQ trading dates, not proof that any one incoming catalyst caused it.',
   evidence:response.date?[{text:key==='XAU'?'GoldPrice.com / spot USD per ounce':'Yahoo / daily raw close',date:period.date,url:key==='XAU'?'https://goldprice.com/gold-price-history':'https://finance.yahoo.com/quote/'+(key==='BTC'?'BTC-USD':'QQQ')+'/'}]:[]});
 }
 const liquidity=nodes.find(n=>n.id==='LIQUIDITY'),etf=report.positioning?.ETF?.at(-1);
 if(etf)liquidity.evidence.push({text:`US BTC ETFs: ${flow(etf.millionUsd)} latest; five-session total ${flow(a.flow5)} · ${a.etfFresh?'reported':'delayed / unavailable'}. ETF channel only.`,date:etf.date,url:etf.sourceUrl});
 if(a.oiFresh)liquidity.evidence.push({text:`OKX BTC-unit OI: ${signed(a.oi5)} over five observations. Exchange-specific; not aggregate leverage.`,date:report.positioning?.OI?.at(-1)?.date,url:'https://www.okx.com/docs-v5/en/#trading-statistics-rest-api-get-contracts-open-interest-history'});
 if(a.fundFresh&&Number.isFinite(a.fundingRate))liquidity.evidence.push({text:`OKX funding: ${(a.fundingRate*100).toFixed(4)}% per payment. Perpetual positioning, not spot capital flows.`,date:report.positioning?.FUNDING?.at(-1)?.timestamp||report.positioning?.FUNDING?.at(-1)?.date,url:'https://www.okx.com/docs-v5/en/#public-data-rest-api-get-funding-rate-history'});
 if(a.spotFresh&&Number.isFinite(a.spotBuyShare5))liquidity.evidence.push({text:`OKX spot taker-buy share: ${a.spotBuyShare5.toFixed(1)}% / five daily buckets. Venue participation, not global liquidity.`,date:a.spotDate,url:'https://www.okx.com/docs-v5/en/#trading-statistics-rest-api-get-taker-volume'});
 return nodes;
}

const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const svgEl=(tag,attrs)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attrs))n.setAttribute(key,value);return n;};
export function mountCausalMap(root){
 if(!root)return {update(){}};
 let nodes=[],selected='FED',count=5,lastReport,lastAssessment;
 const stage=root.querySelector('.causal-stage'),detail=root.querySelector('.causal-detail');
 const svg=svgEl('svg',{viewBox:'0 0 870 570','aria-hidden':'true',class:'causal-wires'}),defs=svgEl('defs',{}),marker=svgEl('marker',{id:'causal-arrow',viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:6,markerHeight:6,orient:'auto-start-reverse'});
 marker.append(svgEl('path',{d:'M0 0L10 5L0 10Z',fill:'context-stroke'}));defs.append(marker);svg.append(defs);
 for(const edge of causalEdges)svg.append(svgEl('path',{d:edge.path,class:'causal-wire '+edge.kind,'data-from':edge.from,'data-to':edge.to,'marker-end':'url(#causal-arrow)'}));
 stage.append(svg);
 const buttons=new Map();for(const [id,[x,y]] of Object.entries(causalPositions)){
  const b=el('button','causal-node');b.type='button';b.style.left=x+'px';b.style.top=y+'px';b.dataset.node=id;b.setAttribute('aria-controls','causal-detail');b.addEventListener('click',()=>select(id));stage.append(b);buttons.set(id,b);
 }
 function select(id){
  selected=id;const node=nodes.find(n=>n.id===id);if(!node)return;
  const pathway=causalPath(id);
  for(const [key,b] of buttons){b.setAttribute('aria-pressed',String(key===id));b.classList.toggle('muted',!pathway.vertices.has(key));}
  for(const [i,path] of [...svg.querySelectorAll('.causal-wire')].entries()){const active=pathway.edges.has(i);path.classList.toggle('active',active);path.classList.toggle('muted',!active);}
  detail.replaceChildren(el('small','causal-kicker','SELECTED CHANNEL'),el('h3','',node.label),el('strong','causal-detail-value',node.value),el('p','causal-note',node.note));
  for(const [heading,edges,direction] of [['Causes / inputs',causalEdges.filter(e=>e.to===id),'from'],['Effects / transmission',causalEdges.filter(e=>e.from===id),'to']]){
   detail.append(el('h4','',heading));if(!edges.length)detail.append(el('p','causal-empty',id==='WAR'||id==='QE'?'External policy / event input':'Observed outcome; confirm against dated prices'));
   for(const edge of edges){const n=el('p','causal-relation');n.append(el('b','',nodes.find(r=>r.id===edge[direction])?.label||edge[direction]),el('span','',edge.effect));detail.append(n);}
  }
  detail.append(el('h4','','Supporting evidence'));
  if(!node.evidence.length)detail.append(el('p','causal-empty','No dedicated observation. Conceptual arrows do not fill this gap.'));
  for(const row of node.evidence){const p=el('p','causal-evidence'),link=el('a','',row.text);if(/^https:\/\//.test(row.url||'')){link.href=row.url;link.target='_blank';link.rel='noopener noreferrer';}const date=row.date?.includes('T')?new Date(row.date).toLocaleString('en-GB',{timeZone:'Asia/Singapore'})+' SGT':row.date||'No source observation';p.append(link,el('time','',date));detail.append(p);}
 }
 root.querySelector('.causal-horizon')?.addEventListener('change',e=>{count=Number(e.target.value);if(lastReport)render(lastReport,lastAssessment);});
 root.querySelector('.causal-compact')?.addEventListener('click',e=>{const compact=root.classList.toggle('compact');e.currentTarget.setAttribute('aria-pressed',String(compact));e.currentTarget.textContent=compact?'Detailed map':'Compact overview';});
 function render(report,a){lastReport=report;lastAssessment=a;nodes=causalNodes(report,a,count);const response=root.querySelector('.causal-response');if(response)response.textContent=responseSummary(report,a.asOf,count);for(const node of nodes){const b=buttons.get(node.id);b.className='causal-node '+node.tone;b.replaceChildren(el('b','',node.label),el('strong','',node.value),el('span','',node.trend),el('time','',node.displayDate||node.date||'No source observation'));}select(selected);}
 return {update:render};
}
