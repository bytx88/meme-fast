import {RADAR_MODES,rankRadar,radarReading} from './radar-model.mjs?v=scalp-age-v1';
import {isSaved,toggleSaved} from './research-store.mjs';
import {axiomLink,fomoLink} from './contract-copy.mjs';

const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>value===null||value===undefined?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(value);
const count=value=>value===null||value===undefined?'—':Number(value).toLocaleString('en-US');
const percent=value=>value===null||value===undefined||!Number.isFinite(Number(value))?'—':`${Number(value).toFixed(1)}%`;
const age=timestamp=>{if(!Number.isFinite(timestamp))return 'unknown';const minutes=Math.max(0,Math.floor((Date.now()-timestamp)/60000));return minutes<60?`${minutes}m`:minutes<1440?`${Math.floor(minutes/60)}h`:`${Math.floor(minutes/1440)}d`};
const initial=new URLSearchParams(location.search);
const initialMode=initial.get('mode');
const initialContract=initial.get('contract')?.trim()||'';
const state={mode:RADAR_MODES[initialMode]?initialMode:'scalp',chain:'all',query:initialContract,selectedId:null,snapshot:null,error:null,loading:false};
const dialog=$('#radar-inspector');

function universe(){return Array.isArray(state.snapshot?.radarCoins)?state.snapshot.radarCoins:state.snapshot?.coins||[]}
function coinId(coin){return String(coin.id||`${coin.network}:${coin.contract_address}`)}
function ticker(coin){return `$${String(coin.symbol||'?').replace(/^\$+/, '')}`}
function thumbnail(coin){
 let image=null;try{const url=new URL(coin.image_url);if(url.protocol==='https:')image=url.href}catch{}
 const initial=String(coin.symbol||coin.name||'?').replace(/^\$+/, '').trim().slice(0,1).toUpperCase()||'?';
 return `<span class="radar-thumb" aria-hidden="true"><span>${esc(initial)}</span>${image?`<img src="${esc(image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:''}</span>`;
}
function flowLink(coin){return `./order-flow.html?${new URLSearchParams({query:String(coin.contract_address||'')})}`}
function savedItem(coin){return {type:'radar',id:coinId(coin),title:`${ticker(coin)} · ${coin.name||'Unknown'}`,subtitle:`${coin.chain||coin.network} · ${RADAR_MODES[state.mode].title} · ${coin.contract_address}`,href:`./radar.html?${new URLSearchParams({contract:String(coin.contract_address||''),mode:state.mode})}`}}
function partClass(part){return part.value===null?'unknown':part.value>=.67?'high':part.value>=.34?'mid':'low'}
function reason(part){return `<span class="${partClass(part)}" title="${esc(part.detail)}">${esc(part.label)} ${part.value===null?'unknown':part.value>=.67?'strong':part.value>=.34?'mixed':'weak'}</span>`}
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
 return {summary,source,label:linked?'Contract-linked story':'Related theme · unverified'};
}
function shortNarrative(value,length=175){return value.length<=length?value:`${value.slice(0,length).replace(/\s+\S*$/,'')}…`}
function narrativeMarkup(narrative,compact=false){
 if(!narrative)return '';
 return `<div class="radar-narrative ${compact?'compact':''}"><span>${esc(narrative.label)}</span><p title="${esc(narrative.summary)}">${esc(compact?shortNarrative(narrative.summary):narrative.summary)}</p>${narrative.source?`<a href="${esc(narrative.source)}" target="_blank" rel="noopener noreferrer">Source ↗</a>`:''}</div>`;
}

function card(reading,index){
 const {coin,score,coverage,stale,parts}=reading,id=coinId(coin),chain=String(coin.network||'');
 const signal=score===null?`<span class="pending">Collecting history</span><small>${coverage}% inputs available</small>`:`${score}<small>Signal / 100 · ${coverage}% coverage</small>`;
 const fomo=fomoLink(coin),axiom=axiomLink(coin),narrative=narrativeFor(coin);
 return `<article class="radar-card ${stale?'stale':''}"><span class="radar-rank">${String(index+1).padStart(2,'0')}</span><div class="radar-token">${thumbnail(coin)}<strong>${esc(ticker(coin))}</strong><small>${esc(coin.name||'Unknown')} · ${esc(chain==='solana'?'Solana':chain==='base'?'Base':chain)} · pool ${age(coin.poolCreated==null?NaN:Number(coin.poolCreated))} old</small></div><div class="radar-signal"><strong>${signal}</strong><small class="${stale?'stale-note':''}">${stale?'Market data stale':`Updated ${age(reading.updatedAt)} ago`}</small><small>Liquidity ${money(coin.liquidity)} · 5m ${money(coin.volume5m)}</small></div><div class="radar-reasons">${parts.map(reason).join('')}</div><div class="radar-actions"><button type="button" class="radar-inspect-action" data-inspect="${esc(id)}">Inspect</button>${fomo?`<a href="${esc(fomo)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(ticker(coin))} on Fomo">Fomo ↗</a>`:''}${axiom?`<a href="${esc(axiom)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(ticker(coin))} on Axiom">Axiom ↗</a>`:''}<a href="${esc(flowLink(coin))}">Order Flow ↗</a><button type="button" data-save="${esc(id)}" aria-pressed="${isSaved('radar',id)}">${isSaved('radar',id)?'Saved ✓':'Watchlist +'}</button></div>${narrativeMarkup(narrative,true)}</article>`;
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
 const marketLinks=[['Fomo',fomoLink(coin)],['Axiom',axiomLink(coin)]].filter(([,url])=>url).map(([label,url])=>`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`).join('');
 const exact=coin.savedContext?.kind==='verified'||coin.savedContext?.kind==='web'&&coin.savedContext.web?.exact;
 const context=exact?'Exact contract evidence':coin.savedContext?'Related context only':'Context pending';
 const unknown=parts.filter(part=>part.value===null).map(part=>part.label);
 return `<div class="inspect-head"><div class="inspect-identity">${thumbnail(coin)}<span class="radar-kicker">${esc(RADAR_MODES[state.mode].title.toUpperCase())} INSPECTION</span><h2>${esc(ticker(coin))}</h2><p>${esc(coin.name||'Unknown')} · ${esc(coin.chain||coin.network)} · pool ${age(coin.poolCreated==null?NaN:Number(coin.poolCreated))} old</p></div><button type="button" class="inspect-close" data-close-inspect aria-label="Close inspection">×</button></div><div class="inspect-score"><strong>${score===null?'Collecting history':`${score} / 100`}</strong><span>${coverage}% inputs available · ${stale?'Market data stale':`Market updated ${age(updatedAt)} ago`}</span></div><div class="inspect-actions"><button type="button" data-save="${esc(id)}" aria-pressed="${isSaved('radar',id)}">${isSaved('radar',id)?'Saved to Watchlist ✓':'Save to Watchlist'}</button><a href="${esc(flowLink(coin))}">Order Flow ↗</a>${marketLinks}</div>${narrativeFor(coin)?`<section class="inspect-section"><h3>Narrative context</h3>${narrativeMarkup(narrativeFor(coin))}</section>`:''}<section class="inspect-section"><h3>Market snapshot</h3><dl class="inspect-facts"><div><dt>Liquidity</dt><dd>${money(coin.liquidity)}</dd></div><div><dt>5m volume</dt><dd>${money(coin.volume5m)}</dd></div><div><dt>5m buys / sells</dt><dd>${count(coin.buys5m)} / ${count(coin.sells5m)}</dd></div><div><dt>24h volume</dt><dd>${money(coin.volume)}</dd></div><div><dt>24h price change</dt><dd>${percent(coin.priceChange)}</dd></div><div><dt>Pool age</dt><dd>${age(coin.poolCreated==null?NaN:Number(coin.poolCreated))}</dd></div></dl></section><section class="inspect-section"><h3>Why this signal</h3><p>Weighted inputs for the ${esc(RADAR_MODES[state.mode].title.toLowerCase())} horizon. The score is a research priority, not a return forecast.</p><div class="inspect-parts">${parts.map(part=>`<div><strong>${esc(part.label)}</strong><span class="${partClass(part)}">${part.value===null?'Unknown':`${Math.round(part.value*100)}%`}</span><small>${esc(part.detail)} · ${part.weight}% weight</small></div>`).join('')}</div></section>${inspectedHistory(coin)}<section class="inspect-section"><h3>Evidence & unknowns</h3><p><strong>${context}</strong>${context==='Context pending'?' · No contract-linked context is available yet.':context==='Related context only'?' · The available source does not identify this exact contract.':' · This is source identity evidence, not a safety check.'}</p><p>${unknown.length?`Missing inputs: ${esc(unknown.join(', '))}. `:''}Holder concentration, developer holdings, contract safety, and execution risk are not assessed.</p><p class="inspect-contract">Contract · <code>${esc(coin.contract_address||'Unknown')}</code></p></section>`;
}
function renderInspector(){
 if(!dialog.open||!state.selectedId)return;
 const coin=universe().find(item=>coinId(item)===state.selectedId);
 $('#radar-inspector-content').innerHTML=coin?inspector(radarReading(coin,state.mode)):`<div class="inspect-head"><div><h2>Candidate no longer observed</h2><p>This contract has left Radar's retained sample.</p></div><button type="button" class="inspect-close" data-close-inspect aria-label="Close inspection">×</button></div><p class="inspect-contract">Contract · <code>${esc(state.selectedId.split(':').slice(1).join(':'))}</code></p><div class="inspect-actions"><a href="${esc(`./order-flow.html?${new URLSearchParams({query:state.selectedId.split(':').slice(1).join(':')})}`)}">Order Flow ↗</a></div>`;
}
function openInspector(id){state.selectedId=id;if(!dialog.open)dialog.showModal();renderInspector()}
function render(){
 $('#mode-description').textContent=RADAR_MODES[state.mode].description;
 document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===state.mode)));
 const status=$('#status'),results=$('#radar-results');
 if(state.loading){status.textContent='Loading observed coins…';return}
 if(state.error){status.textContent=state.error;results.innerHTML='<div class="radar-empty">Radar data is unavailable. Try refreshing.</div>';return}
 const snapshot=state.snapshot;if(!snapshot){status.textContent='Waiting for coin collection…';results.innerHTML='';return}
 const q=state.query.toLowerCase(),coins=universe().filter(coin=>(state.chain==='all'||coin.network===state.chain)&&(!q||`${coin.name} ${coin.symbol} ${coin.contract_address}`.toLowerCase().includes(q)));
 const ranked=rankRadar(coins,state.mode),shown=ranked.slice(0,60);
 const fresh=ranked.filter(row=>!row.stale).length,historyNote=state.mode==='scalp'?'Acceleration needs a previous sample.':state.mode==='swing'?'One-hour signals need at least six samples.':'Day persistence needs at least eight hourly samples.';
 const degraded=Object.values(snapshot.feeds||{}).some(feed=>feed.error);
 status.textContent=`${ranked.length} observed coins · ${fresh} with recent market data · last collection ${snapshot.lastRun?age(Number(snapshot.lastRun))+' ago':'pending'}${degraded?' · some feeds unavailable':''}. ${historyNote}`;
 results.innerHTML=shown.length?shown.map(card).join(''):`<div class="radar-empty">${degraded&&!universe().length?'Market feeds are unavailable. Radar will show coins when collection succeeds.':'No observed coins match these filters. Try another chain or search.'}</div>`;
 renderInspector();
}
async function load(){
 state.loading=true;state.error=null;render();$('#refresh').disabled=true;
 try{const response=await fetch('/api/new-coins',{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('Coin history unavailable');const snapshot=await response.json();if(!Array.isArray(snapshot.coins))throw new Error('Invalid coin history');state.snapshot=snapshot}
 catch(error){state.error=error.message||'Coin history unavailable'}
 finally{state.loading=false;$('#refresh').disabled=false;render()}
}
document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{state.mode=button.dataset.mode;render()}));
$('#chain').addEventListener('change',event=>{state.chain=event.target.value;render()});
$('#query').addEventListener('input',event=>{state.query=event.target.value.trim();render()});
$('#refresh').addEventListener('click',load);
document.addEventListener('click',event=>{
 const close=event.target.closest('[data-close-inspect]');if(close){dialog.close();return}
 const inspect=event.target.closest('[data-inspect]');if(inspect){openInspector(inspect.dataset.inspect);return}
 const save=event.target.closest('[data-save]');if(!save)return;
 const coin=universe().find(item=>coinId(item)===save.dataset.save);if(!coin)return;
 toggleSaved(savedItem(coin));render();
});
document.addEventListener('error',event=>{if(event.target.matches?.('.radar-thumb img'))event.target.remove()},true);
dialog.addEventListener('close',()=>{state.selectedId=null});
window.addEventListener('storage',event=>{if(event.key==='meme-fast-watchlist-v1')render()});
$('#query').value=state.query;
load().then(()=>{if(initialContract){const coin=universe().find(item=>String(item.contract_address).toLowerCase()===initialContract.toLowerCase());openInspector(coin?coinId(coin):`${state.chain}:${initialContract}`)}});
