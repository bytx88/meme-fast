import {RADAR_MODES,rankRadar,radarReading} from './radar-model.mjs?v=scalp-age-v1';
import {isSaved,toggleSaved} from './research-store.mjs';
import {contractForCopy,copyContract,axiomLink,fomoLink} from './contract-copy.mjs';
import {parseHolderInfo} from './holder-info.mjs';
import {sourceCoverageNote} from './source-coverage.mjs';
import {matchesChainFilter} from './radar-filter.mjs';

const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>value===null||value===undefined?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(value);
const count=value=>value===null||value===undefined?'—':Number(value).toLocaleString('en-US');
const percent=value=>value===null||value===undefined||!Number.isFinite(Number(value))?'—':`${Number(value).toFixed(1)}%`;
const age=timestamp=>{if(!Number.isFinite(timestamp))return 'unknown';const minutes=Math.max(0,Math.floor((Date.now()-timestamp)/60000));return minutes<60?`${minutes}m`:minutes<1440?`${Math.floor(minutes/60)}h`:`${Math.floor(minutes/1440)}d`};
const holderCacheKey='meme-fast-radar-holders-v1',holderCacheMs=30*60000;
const holderInfo=new Map(),holderQueue=[],queuedHolders=new Set();
let holderRunning=false,lastHolderRequest=0;
try{
 const cached=JSON.parse(localStorage.getItem(holderCacheKey)||'{}');
 for(const [id,value] of Object.entries(cached))if(value&&Date.now()-value.fetchedAt<holderCacheMs&&Number.isSafeInteger(value.count)&&value.count>=0)holderInfo.set(id,value);
}catch{}
function saveHolderCache(){
 try{localStorage.setItem(holderCacheKey,JSON.stringify(Object.fromEntries([...holderInfo].slice(-150))))}catch{}
}
function holderLabel(id){return count(holderInfo.get(id)?.count)}
function holderTitle(id){const info=holderInfo.get(id);return info?.updatedAt?`GeckoTerminal holder snapshot updated ${age(info.updatedAt)} ago`:info?'GeckoTerminal holder snapshot; update time unavailable':'GeckoTerminal holder count pending or unavailable'}
function updateHolderDom(id){
 document.querySelectorAll('[data-holder-id]').forEach(node=>{if(node.dataset.holderId===id){node.textContent=holderLabel(id);node.title=holderTitle(id)}});
 document.querySelectorAll('[data-holder-top10-id]').forEach(node=>{if(node.dataset.holderTop10Id===id)node.textContent=percent(holderInfo.get(id)?.top10)});
 if(state.selectedId!==id||!dialog.open)return;
 const info=holderInfo.get(id),holders=$('[data-holder-fact="count"]'),top10=$('[data-holder-fact="top10"]'),source=$('[data-holder-source]');
 if(holders)holders.textContent=count(info?.count);
 if(top10)top10.textContent=percent(info?.top10);
 if(source)source.textContent=info?.updatedAt?`GeckoTerminal holder snapshot updated ${age(info.updatedAt)} ago.`:'GeckoTerminal holder data pending or unavailable.';
}
async function pumpHolderQueue(){
 if(holderRunning)return;
 holderRunning=true;
 try{while(holderQueue.length){
  const id=holderQueue.shift();queuedHolders.delete(id);
  if(holderInfo.has(id))continue;
  const coin=universe().find(item=>coinId(item)===id),address=contractForCopy(coin);
  if(!address||!['solana','base','robinhood'].includes(coin.network))continue;
  const wait=Math.max(0,2200-(Date.now()-lastHolderRequest));
  if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
  lastHolderRequest=Date.now();
  try{
   const response=await fetch(`/api/market/networks/${coin.network}/tokens/${encodeURIComponent(address)}/info`,{signal:AbortSignal.timeout(12000)});
   if(response.status===429){await new Promise(resolve=>setTimeout(resolve,60000));continue}
   if(!response.ok)continue;
   const info=parseHolderInfo(await response.json(),coin.network,address);
   if(info){holderInfo.set(id,{...info,fetchedAt:Date.now()});saveHolderCache();updateHolderDom(id)}
  }catch{}
 }}finally{holderRunning=false}
}
function queueHolder(id){if(holderInfo.has(id)||queuedHolders.has(id))return;queuedHolders.add(id);holderQueue.push(id);void pumpHolderQueue()}
const initial=new URLSearchParams(location.search);
const initialMode=initial.get('mode');
const initialContract=initial.get('contract')?.trim()||'';
const state={mode:initialMode==='swing'?'swing':'research',chain:'all',query:initialContract,catalogCoin:null,selectedId:null,snapshot:null,error:null,loading:false};
const dialog=$('#radar-inspector');
const holderObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){holderObserver.unobserve(entry.target);queueHolder(entry.target.dataset.holderId)}},{rootMargin:'120px'});

function universe(){const coins=Array.isArray(state.snapshot?.radarCoins)?state.snapshot.radarCoins:state.snapshot?.coins||[];return state.catalogCoin&&!coins.some(coin=>coin.id.toLowerCase()===state.catalogCoin.id)?[...coins,state.catalogCoin]:coins}
function coinId(coin){return String(coin.id||`${coin.network}:${coin.contract_address}`)}
function ticker(coin){return `$${String(coin.symbol||'?').replace(/^\$+/, '')}`}
function chainMarker(coin){
 const network=String(coin.network||'').toLowerCase();
 const chain=String(coin.chain||coin.network||'Unknown');
 if(network==='solana'||!network&&chain==='Solana')return '<span class="radar-chain-marker solana" role="img" aria-label="Solana" title="Solana">S</span>';
 if(network==='robinhood'||!network&&chain==='Robinhood Chain')return '<span class="radar-chain-marker robinhood" role="img" aria-label="Robinhood Chain" title="Robinhood Chain">R</span>';
 return '';
}
function thumbnail(coin){
 let image=null;try{const url=new URL(coin.image_url);if(url.protocol==='https:')image=url.href}catch{}
 const initial=String(coin.symbol||coin.name||'?').replace(/^\$+/, '').trim().slice(0,1).toUpperCase()||'?';
 return `<span class="radar-thumb" aria-hidden="true"><span>${esc(initial)}</span>${image?`<img src="${esc(image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:''}</span>`;
}
function flowLink(coin){return `./order-flow.html?${new URLSearchParams({query:String(coin.contract_address||'')})}`}
function savedItem(coin){return {type:'radar',id:coinId(coin),title:`${ticker(coin)} · ${coin.name||'Unknown'}`,subtitle:`${coin.chain||coin.network} · ${RADAR_MODES[state.mode].title} · ${coin.contract_address}`,href:`./radar.html?${new URLSearchParams({contract:String(coin.contract_address||''),mode:state.mode})}`}}
function partClass(part){return part.value===null?'unknown':part.value>=.67?'high':part.value>=.34?'mid':'low'}
function reason(part){
 const shortLabel={'Observed history':'History','Day persistence':'Persistence','Repeated activity':'Activity','24h turnover':'Turnover','5m turnover':'Turnover'}[part.label]||part.label;
 return `<span class="${partClass(part)}" title="${esc(`${part.label}: ${part.detail}`)}">${esc(shortLabel)} ${part.value===null?'unknown':part.value>=.67?'strong':part.value>=.34?'mixed':'weak'}</span>`;
}
function narrativeFor(coin){
 const found=coin.savedContext;
 if(!found)return null;
 const article=found.articles?.[0];
 const web=found.web,profile=found.profile;
 const raw=profile?.description||web?.snippet||article?.title||'';
 const summary=String(raw).replace(/\[[^\]]+\]\([^)]*\)/g,'').replace(/\s+/g,' ').trim();
 if(!summary)return null;
 let source=profile?.url||web?.url||article?.url||null;
 try{if(source&&new URL(source).protocol!=='https:')source=null}catch{source=null}
 const linked=found.kind==='verified'||found.kind==='web'&&web?.exact;
 return {summary,source,label:linked?'Exact-address source':'Related theme · unverified'};
}
function shortNarrative(value,length=175){return value.length<=length?value:`${value.slice(0,length).replace(/\s+\S*$/,'')}…`}
function narrativeMarkup(narrative,compact=false,inspectId=null){
 if(!narrative)return '';
 return `<div class="radar-narrative ${compact?'compact':''}"><span>${esc(narrative.label)}</span><p title="${esc(narrative.summary)}">${esc(compact?shortNarrative(narrative.summary):narrative.summary)}</p>${compact&&inspectId?`<button type="button" class="radar-narrative-more" data-inspect="${esc(inspectId)}" aria-label="Read full source story for ${esc(inspectId)}">More</button>`:''}${narrative.source?`<a href="${esc(narrative.source)}" target="_blank" rel="noopener noreferrer">Source ↗</a>`:''}</div>`;
}

function cardReasons(parts,id){
 const available=parts.filter(part=>part.value!==null);
 const strongest=[...available].sort((a,b)=>b.value-a.value)[0]||parts[0];
 const weakest=[...parts].filter(part=>part!==strongest).sort((a,b)=>(a.value??-1)-(b.value??-1))[0];
 const shown=[strongest,weakest].filter(Boolean),hidden=parts.filter(part=>!shown.includes(part));
 const more=hidden.length?`<button type="button" class="radar-more-reasons" data-inspect="${esc(id)}" title="${esc(hidden.map(part=>`${part.label}: ${part.value===null?'unknown':part.value>=.67?'strong':part.value>=.34?'mixed':'weak'}`).join('; '))}" aria-label="Inspect ${hidden.length} more signals">+${hidden.length}</button>`:'';
 return shown.map(reason).join('')+more;
}

function card(reading,index){
 const {coin,score,coverage,stale,parts}=reading,id=coinId(coin);
 const updatedAt=reading.updatedAt==null?null:Number(reading.updatedAt);
 const updatedAge=updatedAt===null||!Number.isFinite(updatedAt)?'No data':`${age(updatedAt)} ago`;
 const updatedTitle=updatedAt===null||!Number.isFinite(updatedAt)?'Market update unavailable':`Market updated ${new Date(updatedAt).toLocaleString()}`;
 const signal=score===null?`<span class="pending">Collecting</span><small>${coverage}% inputs</small>`:`${score}<small>${coverage}% coverage</small>`;
 const fomo=fomoLink(coin),axiom=axiomLink(coin),address=contractForCopy(coin),narrative=narrativeFor(coin),marker=chainMarker(coin);
 const activity=state.mode==='research'
  ?[['Pool liq',money(coin.liquidity)],['24h pool vol',money(coin.volume)],['24h price',percent(coin.priceChange)]]
  :[['Pool liq',money(coin.liquidity)],['5m pool vol',money(coin.volume5m)],['5m buys / sells',`${count(coin.buys5m)} / ${count(coin.sells5m)}`]];
 return `<article class="radar-card ${stale?'stale':''}">
  <div class="radar-token">
   <div class="radar-thumb-stack">${fomo?`<a class="radar-image-link" href="${esc(fomo)}" target="_blank" rel="noopener noreferrer" title="Open ${esc(ticker(coin))} on Fomo" aria-label="Open ${esc(ticker(coin))} on Fomo">${thumbnail(coin)}</a>`:thumbnail(coin)}<time class="radar-market-age ${stale?'stale-note':''}" title="${esc(updatedTitle)}">${esc(updatedAge)}</time></div>
   <div class="radar-token-title"><span class="radar-rank">${index===null?'—':String(index+1).padStart(2,'0')}</span><strong>${esc(ticker(coin))}</strong>${marker}${address?`<button type="button" class="contract-copy-icon" data-copy-ca="${esc(id)}" title="Copy contract address" aria-label="Copy ${esc(ticker(coin))} contract address"></button>`:''}</div>
   <small class="radar-token-meta"><span class="radar-token-name" title="${esc(coin.name||'Unknown')}">${esc(coin.name||'Unknown')}${marker?'':` · ${esc(coin.chain||coin.network||'Unknown')}`}</span><span class="radar-pool-age">pool ${age(coin.poolCreated==null?NaN:Number(coin.poolCreated))} old</span></small>
  </div>
  <div class="radar-holders"><span>Holders</span><strong data-holder-id="${esc(id)}" title="${esc(holderTitle(id))}">${esc(holderLabel(id))}</strong><small>Top 10 <span data-holder-top10-id="${esc(id)}">${percent(holderInfo.get(id)?.top10)}</span></small></div>
  <div class="radar-signal"><span class="radar-score-label">Score</span><strong>${signal}</strong></div>
  <div class="radar-activity">${activity.map(([label,value])=>`<span>${label} <b>${value}</b></span>`).join('')}</div>
  <div class="radar-reasons">${cardReasons(parts,id)}</div>
  <div class="radar-actions"><button type="button" class="radar-inspect-action" data-inspect="${esc(id)}">Inspect</button><button type="button" class="radar-save-action" data-save="${esc(id)}" aria-pressed="${isSaved('radar',id)}">${isSaved('radar',id)?'Saved ✓':'Watchlist +'}</button>${fomo?`<a class="radar-external-action" href="${esc(fomo)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(ticker(coin))} on Fomo">Fomo ↗</a>`:''}${axiom?`<a class="radar-external-action" href="${esc(axiom)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(ticker(coin))} on Axiom">Axiom ↗</a>`:''}<a class="radar-external-action" href="${esc(flowLink(coin))}" aria-label="Open ${esc(ticker(coin))} Order Flow">Flow ↗</a></div>
  ${narrativeMarkup(narrative,true,id)}
 </article>`;
}

function historyRows(coin){
 const now=Date.now(),hourly=state.mode==='research',period=state.mode==='scalp'?30*60000:state.mode==='swing'?3600000:86400000;
 const rows=hourly?coin.marketHistoryHourly:coin.marketHistory;
 return (Array.isArray(rows)?rows:[]).filter(row=>Number.isFinite(Number(row.at))&&Number(row.at)>=now-period&&Number(row.at)<=now).sort((a,b)=>a.at-b.at).slice(-6);
}
function inspectedHistory(coin){
 const rows=historyRows(coin),label=state.mode==='research'?'Hourly samples · last day':state.mode==='swing'?'Samples · last hour':'Samples · last 30 minutes';
 return `<section class="inspect-section"><h3>Observed history</h3><p>${label}. Each row is a provider snapshot, not an individual trade.</p>${rows.length?`<div class="inspect-table-wrap"><table><thead><tr><th>Sample</th><th>5m volume</th><th>Buys / sells</th><th>Liquidity</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(new Date(Number(row.at)).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))}</td><td>${money(row.volume5m)}</td><td>${count(row.buys5m)} / ${count(row.sells5m)}</td><td>${money(row.liquidity)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="inspect-empty">No samples recorded in this window yet.</p>'}</section>`;
}
function inspector(reading){
 const {coin,score,coverage,stale,parts,updatedAt}=reading,id=coinId(coin);
 const fomo=fomoLink(coin);
 const marketLinks=[['Fomo',fomo],['Axiom',axiomLink(coin)]].filter(([,url])=>url).map(([label,url])=>`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`).join('');
 const artwork=fomo?`<a class="inspect-image-link" href="${esc(fomo)}" target="_blank" rel="noopener noreferrer" title="Open ${esc(ticker(coin))} on Fomo" aria-label="Open ${esc(ticker(coin))} on Fomo">${thumbnail(coin)}</a>`:thumbnail(coin);
 const exact=coin.savedContext?.kind==='verified'||coin.savedContext?.kind==='web'&&coin.savedContext.web?.exact;
 const context=exact?'Exact-address source':coin.savedContext?'Related context only':'Context pending';
 const unknown=parts.filter(part=>part.value===null).map(part=>part.label);
 return `<div class="inspect-head"><div class="inspect-identity">${artwork}<span class="radar-kicker">${esc(RADAR_MODES[state.mode].title.toUpperCase())} INSPECTION</span><h2>${esc(ticker(coin))}</h2><p>${esc(coin.name||'Unknown')} · ${esc(coin.chain||coin.network)} · pool ${age(coin.poolCreated==null?NaN:Number(coin.poolCreated))} old</p></div><button type="button" class="inspect-close" data-close-inspect aria-label="Close inspection">×</button></div><div class="inspect-score"><strong>${score===null?'Collecting history':`${score} / 100`}</strong><span>${coverage}% inputs available · ${stale?'Market data stale':`Market updated ${age(updatedAt)} ago`}</span></div><div class="inspect-actions"><button type="button" data-save="${esc(id)}" aria-pressed="${isSaved('radar',id)}">${isSaved('radar',id)?'Saved to Watchlist ✓':'Save to Watchlist'}</button><a href="${esc(flowLink(coin))}">Order Flow ↗</a>${marketLinks}</div>${narrativeFor(coin)?`<section class="inspect-section"><h3>Narrative context</h3>${narrativeMarkup(narrativeFor(coin))}</section>`:''}<section class="inspect-section"><h3>Market snapshot</h3><dl class="inspect-facts"><div><dt>Liquidity</dt><dd>${money(coin.liquidity)}</dd></div><div><dt>5m volume</dt><dd>${money(coin.volume5m)}</dd></div><div><dt>5m buys / sells</dt><dd>${count(coin.buys5m)} / ${count(coin.sells5m)}</dd></div><div><dt>24h volume</dt><dd>${money(coin.volume)}</dd></div><div><dt>24h price change</dt><dd>${percent(coin.priceChange)}</dd></div><div><dt>Pool age</dt><dd>${age(coin.poolCreated==null?NaN:Number(coin.poolCreated))}</dd></div><div><dt>Holders</dt><dd data-holder-fact="count">${count(holderInfo.get(id)?.count)}</dd></div><div><dt>Top 10 share</dt><dd data-holder-fact="top10">${percent(holderInfo.get(id)?.top10)}</dd></div></dl><p data-holder-source>${esc(holderTitle(id))}</p></section><section class="inspect-section"><h3>Why this signal</h3><p>Weighted inputs for the ${esc(RADAR_MODES[state.mode].title.toLowerCase())} horizon. The score is a research priority, not a return forecast.</p><div class="inspect-parts">${parts.map(part=>`<div><strong>${esc(part.label)}</strong><span class="${partClass(part)}">${part.value===null?'Unknown':`${Math.round(part.value*100)}%`}</span><small>${esc(part.detail)} · ${part.weight}% weight</small></div>`).join('')}</div></section>${inspectedHistory(coin)}<section class="inspect-section"><h3>Evidence & unknowns</h3><p><strong>${context}</strong>${context==='Context pending'?' · No contract-linked context is available yet.':context==='Related context only'?' · The available source does not identify this exact contract.':' · This is source identity evidence, not a safety check.'}</p><p>${unknown.length?`Missing inputs: ${esc(unknown.join(', '))}. `:''}Holder count and top-10 concentration are informational and do not affect this score. Developer holdings, contract safety, and execution risk are not assessed.</p><p class="inspect-contract">Contract · <code>${esc(coin.contract_address||'Unknown')}</code></p></section>`;
}
function renderInspector(){
 if(!dialog.open||!state.selectedId)return;
 const coin=universe().find(item=>coinId(item)===state.selectedId);
 $('#radar-inspector-content').innerHTML=coin?inspector(radarReading(coin,state.mode)):`<div class="inspect-head"><div><h2>Candidate no longer observed</h2><p>This contract has left Hodl's retained sample.</p></div><button type="button" class="inspect-close" data-close-inspect aria-label="Close inspection">×</button></div><p class="inspect-contract">Contract · <code>${esc(state.selectedId.split(':').slice(1).join(':'))}</code></p><div class="inspect-actions"><a href="${esc(`./order-flow.html?${new URLSearchParams({query:state.selectedId.split(':').slice(1).join(':')})}`)}">Order Flow ↗</a></div>`;
}
function openInspector(id){state.selectedId=id;if(!dialog.open)dialog.showModal();renderInspector();queueHolder(id)}
function render(){
 holderObserver.disconnect();
 const modeDescription=$('#mode-description');
 modeDescription.textContent=state.mode==='swing'?'Hours · liquidity, repeat activity, buy pressure':'Days · persistence, liquidity, context';
 modeDescription.title=RADAR_MODES[state.mode].description;
 document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===state.mode)));
 document.querySelectorAll('[data-chain-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.chainFilter===state.chain)));
 const status=$('#status'),results=$('#radar-results');
 if(state.loading){status.textContent='Loading observed coins…';return}
 if(state.error){status.textContent=state.error;results.innerHTML='<div class="radar-empty">Hodl data is unavailable. Try refreshing.</div>';return}
 const snapshot=state.snapshot;if(!snapshot){status.textContent='Waiting for coin collection…';results.innerHTML='';return}
 const q=state.query.toLowerCase(),coins=universe().filter(coin=>matchesChainFilter(coin,state.chain)&&(!q||`${coin.name} ${coin.symbol} ${coin.contract_address}`.toLowerCase().includes(q)));
 const ranked=rankRadar(coins,state.mode),ready=ranked.filter(row=>row.score!==null&&!row.stale),pending=ranked.filter(row=>row.score===null),staleRows=ranked.filter(row=>row.score!==null&&row.stale);
 const shownReady=ready.slice(0,60),shownPending=pending.slice(0,Math.max(0,60-shownReady.length)),shownStale=staleRows.slice(0,Math.max(0,60-shownReady.length-shownPending.length));
 const fresh=ranked.filter(row=>!row.stale).length,historyNote=state.mode==='scalp'?'Acceleration needs a previous sample.':state.mode==='swing'?'One-hour signals need at least six samples.':'Day persistence needs at least eight hourly samples.';
 const degraded=Object.values(snapshot.feeds||{}).some(feed=>feed.error),sourceNote=sourceCoverageNote(snapshot);
 const robinhoodIncomplete=snapshot.feeds?.robinhood_rpc?.backfillComplete!==true;
 const collected=snapshot.lastRun?`${age(Number(snapshot.lastRun))} ago`:'pending';
 status.textContent=`${ready.length} ranked · ${pending.length} collecting · ${staleRows.length} stale · updated ${collected}${sourceNote}${robinhoodIncomplete?' · Robinhood indexing':''}`;
 const statusDetail=`${ranked.length} observed coins. ${fresh} with recent market data. Last collection ${collected}.${sourceNote?` ${sourceNote.slice(3)}.`:''}${robinhoodIncomplete?' Robinhood pool backfill in progress.':''} ${historyNote}`;
 status.title=statusDetail;
 status.setAttribute('aria-label',statusDetail);
 results.innerHTML=ranked.length?`${shownReady.length?`<h2 class="radar-section-title">Ready to rank <span>${ready.length}</span></h2>${shownReady.map(card).join('')}`:''}${shownPending.length?`<h2 class="radar-section-title">Collecting history <span>${pending.length}</span></h2><p class="radar-section-note">These coins are visible for research and have no ranking yet. ${state.mode==='research'?'The Days view needs at least eight hourly samples.':'The Hours view needs repeated one-hour samples.'}</p>${shownPending.map(row=>card(row,null)).join('')}`:''}${shownStale.length?`<h2 class="radar-section-title">Stale market data <span>${staleRows.length}</span></h2><p class="radar-section-note">Refresh market data before comparing these coins with the current ranking.</p>${shownStale.map(row=>card(row,null)).join('')}`:''}`:`<div class="radar-empty">${degraded&&!universe().length?'Market feeds are unavailable. Hodl will show coins when collection succeeds.':robinhoodIncomplete&&/^0x[0-9a-f]{40}$/i.test(q)&&(state.chain==='all'||state.chain==='robinhood')?'No pool found in the indexed Robinhood sources yet. Historical backfill is still in progress.':'No observed coins match these filters. Try another chain or search.'}</div>`;
 results.querySelectorAll('[data-holder-id]').forEach(node=>{if(!holderInfo.has(node.dataset.holderId))holderObserver.observe(node)});
 renderInspector();
}
async function load(){
 state.loading=true;state.error=null;render();$('#refresh').disabled=true;
 try{const response=await fetch('/api/new-coins?view=radar',{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('Market history unavailable');const snapshot=await response.json();if(!Array.isArray(snapshot.coins))throw new Error('Invalid market history');state.snapshot=snapshot}
 catch(error){state.error=error.message||'Market history unavailable'}
 finally{state.loading=false;$('#refresh').disabled=false;render()}
}
async function loadCatalogMatch(){
 const query=state.query.trim().toLowerCase();
 state.catalogCoin=null;
 if(!/^0x[0-9a-f]{40}$/.test(query)||(state.chain!=='all'&&state.chain!=='robinhood')){render();return}
 try{
  const response=await fetch(`/api/pool-catalog?${new URLSearchParams({query})}`,{cache:'no-store',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('Pool catalog unavailable');
  const catalog=await response.json();
  if(query!==state.query.trim().toLowerCase())return;
  const pool=catalog.pools?.[0];
  if(pool)state.catalogCoin={id:`robinhood:${query}`,network:'robinhood',chain:'Robinhood Chain',contract_address:query,contract_verified:true,name:'On-chain pool token',symbol:'?',pool:pool.pool,catalogOnly:true};
 }catch{}
 render();
}
document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{state.mode=button.dataset.mode;render()}));
document.querySelectorAll('[data-chain-filter]').forEach(button=>button.addEventListener('click',()=>{state.chain=button.dataset.chainFilter;render()}));
let catalogTimer;
$('#query').addEventListener('input',event=>{state.query=event.target.value.trim();state.catalogCoin=null;render();clearTimeout(catalogTimer);catalogTimer=setTimeout(loadCatalogMatch,300)});
$('#refresh').addEventListener('click',load);
document.addEventListener('click',async event=>{
 const close=event.target.closest('[data-close-inspect]');if(close){dialog.close();return}
 const copy=event.target.closest('[data-copy-ca]');if(copy){
  const coin=universe().find(item=>coinId(item)===copy.dataset.copyCa),result=await copyContract(coin,navigator.clipboard);
  if(result.status==='copied'){copy.classList.add('copied');copy.setAttribute('aria-label','Contract copied');$('#radar-copy-status').textContent=`${ticker(coin)} contract copied.`;setTimeout(()=>{if(!copy.isConnected)return;copy.classList.remove('copied');copy.setAttribute('aria-label',`Copy ${ticker(coin)} contract address`)},1800)}
  else if(result.status==='manual'){const input=$('#radar-manual-ca');input.value=result.address;$('#radar-ca-dialog').showModal();input.focus();input.select()}
  return;
 }
 const inspect=event.target.closest('[data-inspect]');if(inspect){openInspector(inspect.dataset.inspect);return}
 const save=event.target.closest('[data-save]');if(!save)return;
 const coin=universe().find(item=>coinId(item)===save.dataset.save);if(!coin)return;
 toggleSaved(savedItem(coin));render();
});
document.addEventListener('error',event=>{if(event.target.matches?.('.radar-thumb img'))event.target.remove()},true);
dialog.addEventListener('close',()=>{state.selectedId=null});
window.addEventListener('storage',event=>{if(event.key==='meme-fast-watchlist-v1')render()});
$('#query').value=state.query;
load().then(async()=>{if(initialContract){await loadCatalogMatch();const coin=universe().find(item=>String(item.contract_address).toLowerCase()===initialContract.toLowerCase());openInspector(coin?coinId(coin):`${state.chain}:${initialContract}`)}});
