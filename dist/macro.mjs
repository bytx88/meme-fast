const groups = [
 {name:'Liquidity',desc:'The cost of money and the inflation constraint.',factors:[
  ['fed','Fed expectations',3,-1,'Easing expectations','Hawkish expectations','Lower expected policy rates can support risk appetite; tighter policy can constrain it.','Rate expectations ease and yields confirm.','https://www.federalreserve.gov/monetarypolicy.htm'],
  ['yields','US Treasury yields',3,-1,'Yields falling','Yields elevated','Rising real yields can raise the opportunity cost of holding speculative assets.','Yields trend lower without a growth shock.','https://fred.stlouisfed.org/series/DGS10'],
  ['oil','Oil & inflation',2,-1,'Energy pressure easing','Oil pressure persists','Higher energy prices can complicate inflation and monetary easing.','Energy pressure falls and inflation expectations soften.','https://www.eia.gov/petroleum/']
 ]},
 {name:'Spot demand',desc:'Capital entering crypto through sustained buying.',factors:[
  ['etf','Institutional / ETF flows',3,1,'ETF demand recovering','ETF demand weakening','Repeated net inflows are stronger evidence than one positive session.','Several sessions of net inflows reverse to outflows.','https://www.farside.co.uk/btc/'],
  ['regulation','Regulation & access',2,0,'Access becomes clearer','Legislation / custody uncertainty','Separate a proposed framework from enacted rules and actual market access.','A rule is finalized or a bill advances with clear implementation.','https://www.sec.gov/crypto'],
  ['outlook','Institutional outlook',2,1,'Longer-term optimism','Institutional outlook weakens','An analyst target is an opinion; it is weaker evidence than executed spot buying.','Actual capital flows fail to confirm the outlook.','https://www.citigroup.com/']
 ]},
 {name:'Risk appetite',desc:'The wider market’s willingness to take risk.',factors:[
  ['geo','Geopolitics',3,1,'Tensions easing','Escalation risk','Reduced uncertainty can support a relief move. Confirm developments with dated reporting.','Escalation resumes or energy markets reprice the risk.','https://www.reuters.com/world/'],
  ['equities','US equity market',2,1,'Equities recovering','Equities weakening','Broad participation is stronger than a narrow technology rebound. Correlation can change.','Equity gains reverse and defensive positioning rises.','https://www.nasdaq.com/market-activity/index/comp'],
  ['breadth','Altcoin breadth',2,1,'Breadth recovering','Breadth deteriorating','Look for more coins participating, rather than one or two large winners.','The recovery narrows while BTC loses support.','./radar.html']
 ]},
 {name:'Market structure',desc:'Whether positioning can absorb the next shock.',factors:[
  ['leverage','Futures leverage',3,-1,'Leverage cooling','Leverage building','Open interest rising faster than spot demand can increase liquidation sensitivity.','Spot demand improves while open interest and funding normalize.','https://www.coinglass.com/'],
  ['support','BTC price structure',3,null,'Support holds / reclaim confirmed','Support breaks','Use a current chart to define support and invalidation; the pasted price levels are not live.','Price holds a retest with spot participation.','https://www.coinbase.com/price/bitcoin']
 ]}
];
const lenses={BTC:'BTC is the macro anchor. Confirm the tree with current spot demand and price structure.',ETH:'ETH shares the macro backdrop. Add ETH-specific flows, network demand and ETH/BTC evidence.',ALT:'Altcoins need expanding breadth and liquidity. A BTC relief bounce alone is incomplete confirmation.',MEME:'Meme coins amplify liquidity and attention shifts. Add exact-token liquidity, holder concentration and supply evidence.'};
export function calculate(readings){
 let score=0,coverage=0;
 const branches=groups.map(group=>{const total=group.factors.reduce((s,f)=>s+f[2],0);let sum=0,rated=0;for(const f of group.factors){const v=readings[f[0]];if(Number.isInteger(v)&&v>=-2&&v<=2){sum+=v*f[2];rated+=f[2]}}const value=sum/total/2*100;score+=value/4;coverage+=rated/total/4;return {value,rated,total}});
 return {score,coverage:coverage*100,branches};
}
if(typeof document!=='undefined'){
 const key='meme-fast-macro-v1';let state={coin:'BTC',mode:'personal',readings:{},notes:{}};
 try{const saved=JSON.parse(localStorage.getItem(key));if(saved&&lenses[saved.coin]){state={...state,coin:saved.coin,mode:saved.mode==='example'?'example':'personal',readings:{},notes:{}};for(const f of groups.flatMap(g=>g.factors)){if(Number.isInteger(saved.readings?.[f[0]])&&Math.abs(saved.readings[f[0]])<=2)state.readings[f[0]]=saved.readings[f[0]];if(typeof saved.notes?.[f[0]]==='string')state.notes[f[0]]=saved.notes[f[0]].slice(0,2000)}}}catch{}
 const $=id=>document.getElementById(id);
 function save(){try{localStorage.setItem(key,JSON.stringify(state))}catch{$('workspace-status').textContent='Browser storage unavailable. Readings will last for this visit only.'}}
 $('branches').innerHTML=groups.map((g,i)=>`<article class="branch"><div class="branch-head"><h3>${g.name}</h3><span class="branch-score" id="branch-${i}">—</span></div><p class="branch-desc">${g.desc}</p><span class="budget">25% OF TREE · IMPORTANCE WITHIN BRANCH</span>${g.factors.map(f=>`<div class="factor"><h4>${f[1]}</h4><span class="priority">${f[2]===3?'High':'Medium'} importance · weight ${f[2]}</span><select data-factor="${f[0]}" aria-label="${f[1]} direction"><option value="">Unrated / unknown</option><option value="2">+2 Strong bullish</option><option value="1">+1 Bullish</option><option value="0">0 Mixed / neutral</option><option value="-1">−1 Bearish</option><option value="-2">−2 Strong bearish</option></select><details><summary>Evidence & reversal trigger</summary><p>${f[6]}</p><p><strong>Reassess when:</strong> ${f[7]}</p><a href="${f[8]}" target="_blank" rel="noopener noreferrer">Research source ↗</a><label for="note-${f[0]}">Source URL, observation time & evidence</label><textarea id="note-${f[0]}" data-note="${f[0]}" maxlength="2000" placeholder="Add a dated observation and its source…"></textarea></details></div>`).join('')}</article>`).join('');
 function render(){
  const result=calculate(state.readings);const rated=result.coverage>0;const fmt=n=>`${n>0?'+':''}${Math.round(n)}`;
  $('coin').value=state.coin;$('lens-note').textContent=lenses[state.coin];$('score').textContent=rated?fmt(result.score):'—';$('balance').textContent=rated?(Math.abs(result.score)<10?'Mixed macro balance':result.score>0?'Bullish factor tilt':'Bearish factor tilt'):'Awaiting evidence';
  $('needle').style.left=`${(result.score+100)/2}%`;$('needle').hidden=!rated;$('coverage').textContent=`${Math.round(result.coverage)}% weighted coverage · ${Object.keys(state.readings).length} / 11 factors rated · ${state.mode==='example'?'Unverified example':'Personal assessment'} · Not a rally probability`;
  $('workspace-status').textContent=state.mode==='example'?'UNVERIFIED EXAMPLE · Directions reflect your pasted narrative, not checked live news. Editing a direction does not verify a headline. Add dated evidence before relying on this scenario.':'PERSONAL WORKSPACE · No live news feed. Directions and evidence are your own assessment, saved in this browser.';
  result.branches.forEach((b,i)=>{$(`branch-${i}`).textContent=b.rated?fmt(b.value):'—';$(`branch-${i}`).style.color=b.value<0?'var(--red)':'var(--green)'});
  document.querySelectorAll('[data-factor]').forEach(el=>el.value=state.readings[el.dataset.factor]??'');document.querySelectorAll('[data-note]').forEach(el=>{if(document.activeElement!==el)el.value=state.notes[el.dataset.note]||''});
  for(const [id,sign] of [['bullish',1],['bearish',-1]]){const factors=groups.flatMap(g=>g.factors).filter(f=>state.readings[f[0]]*sign>0);$(id).replaceChildren();if(!factors.length){const p=document.createElement('p');p.className='empty';p.textContent='No factors assigned to this side. Unrated does not mean neutral.';$(id).append(p)}for(const f of factors){const article=document.createElement('article');article.className='news-item';const h=document.createElement('h3');h.textContent=f[sign>0?4:5];const p=document.createElement('p');p.textContent=`${f[1]} · ${f[2]===3?'High':'Medium'} importance · ${state.mode==='example'?'Example claim, unverified':'Your assigned direction'}`;article.append(h,p);$(id).append(article)}}
 }
 $('branches').addEventListener('change',e=>{const id=e.target.dataset.factor;if(!id)return;if(e.target.value==='')delete state.readings[id];else state.readings[id]=Number(e.target.value);render();save()});
 $('branches').addEventListener('input',e=>{const id=e.target.dataset.note;if(id){state.notes[id]=e.target.value;save()}});
 $('coin').addEventListener('change',e=>{state.coin=e.target.value;render();save()});
 $('example').addEventListener('click',()=>{state.mode='example';state.readings=Object.fromEntries(groups.flatMap(g=>g.factors).filter(f=>f[3]!==null).map(f=>[f[0],f[3]]));render();save()});
 $('reset').addEventListener('click',()=>{state.mode='personal';state.readings={};state.notes={};render();save()});render();
}
