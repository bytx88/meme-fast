import {tokenActions} from './token-actions.mjs?v=find-stats-v1';
import {copyContract,axiomLink} from './contract-copy.mjs';
import {groupCoins} from './coin-groups.mjs';
import {sourcesFor, storyParagraph, bestSearchLead} from './coin-context.mjs';
import {NETWORKS, parsePools} from './public-radar.mjs';

const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>v===null||v===undefined?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(v);
const num=v=>v===null||v===undefined?'—':Number(v).toLocaleString('en-US');
const age=time=>{const mins=Math.max(0,Math.round((Date.now()-time)/60000));return mins<60?`${mins}m`:mins<1440?`${Math.floor(mins/60)}h`:`${Math.floor(mins/1440)}d`};
const state={historyLoaded:false,historyError:false,hours:1,sort:'newest',query:'',notice:'',lastRun:0,pendingSnapshot:null,selectedId:null,view:'grid'};
const data={coins:[],manualCoins:[],web:new Map(),checks:new Map()};let loading=false,visibleRows=[];

function clean(value){return String(value??'').replace(/\[[^\]]+\]\([^)]*\)/g,'').replace(/\(?https?:\/\/\S+\)?/g,'').replace(/\buddg=\S+/g,'').replace(/\s+/g,' ').trim()}
function context(c){return data.web.get(c.id)?{kind:'web',web:data.web.get(c.id)}:c.savedContext||null}
function verified(found){return found?.kind==='verified'||found?.kind==='web'&&found.web?.exact}
function sortValue(c){
 if(state.sort==='volume5m')return c.volume5m??-1;
 if(state.sort==='liquidity')return c.liquidity??-1;
 if(state.sort==='activity')return (c.buys5m??0)+(c.sells5m??0);
 return c.firstSeen??c.poolCreated??0;
}
function candidates(){
 const q=state.query.trim().toLowerCase(),cutoff=Date.now()-state.hours*3600000;
 const regular=data.coins.filter(c=>c.firstSeen>=cutoff),manual=data.manualCoins;
 return [...new Map([...manual,...regular].filter(c=>!q||`${c.name} ${c.symbol} ${c.contract_address}`.toLowerCase().includes(q)).map(c=>[c.id,c])).values()]
  .sort((a,b)=>Number(Boolean(b.manual))-Number(Boolean(a.manual))||sortValue(b)-sortValue(a));
}
function marketState(c){
 const timestamp=c.marketUpdatedAt??c.fetchedAt,minutes=Number.isFinite(timestamp)?Math.max(0,Math.floor((Date.now()-timestamp)/60000)):Infinity;
 return {timestamp,minutes,label:minutes===Infinity?'No market timestamp':minutes<1?'Live':minutes<10?`${minutes}m fresh`:`Stale ${minutes<60?minutes+'m':Math.floor(minutes/60)+'h'}`,className:minutes<10?'fresh':'stale'};
}
function profileLinks(profile){return (profile.links||[]).filter(l=>/^https:\/\//.test(l.url||'')).slice(0,1).map(l=>`<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.type==='twitter'?'X source':l.label||'Source')} ↗</a>`).join('')}
function explanation(found,c){
 if(found?.articles){const exact=verified(found),article=found.articles[0];return `<div class="story-block ${exact?'verified':'unverified'}"><span class="evidence-state">${exact?'Exact contract evidence':'Unverified context'}</span><p>${exact?'Public coverage identifies this contract.':'Name or ticker overlap; the source is not proof that it describes this contract.'}</p><a href="${esc(article.url)}" target="_blank" rel="noopener noreferrer">${esc(article.publisher)} · ${esc(article.title)} ↗</a></div>`}
 if(found?.web){const exact=verified(found);return `<div class="story-block ${exact?'verified':'unverified'}"><span class="evidence-state">${exact?'Exact contract evidence':'Unverified context'}</span><p title="${esc(clean(found.web.snippet))}">${esc(clean(found.web.snippet))}</p><a href="${esc(found.web.url)}" target="_blank" rel="noopener noreferrer">${esc(found.web.title||'Public source')} ↗</a></div>`}
 if(found?.profile){return `<div class="story-block verified"><span class="evidence-state">Contract profile</span><p title="${esc(clean(found.profile.description))}">${esc(clean(found.profile.description)||'The exact contract profile links to a public source.')}</p>${profileLinks(found.profile)}</div>`}
 const checked=data.checks.get(c.id),message=checked==='searching'?'Searching public sources…':checked==='error'?'Context source unavailable.':'No contract-supported explanation yet.';
 const query=encodeURIComponent(`"${c.contract_address}" OR "$${c.symbol}" OR "${c.name}"`);
 return `<div class="story-block pending"><span class="evidence-state">Context pending</span><p>${message}</p><a href="https://x.com/search?q=${query}&src=typed_query&f=live" target="_blank" rel="noopener noreferrer">Search X ↗</a></div>`;
}
function metrics(c){return `<dl class="new-metrics"><div><dt>Liquidity</dt><dd>${money(c.liquidity)}</dd></div><div><dt>5m volume</dt><dd>${money(c.volume5m)}</dd></div><div><dt>5m buys / sells</dt><dd>${num(c.buys5m)} / ${num(c.sells5m)}</dd></div></dl>`}
function cardMetrics(c){
 const short=c.volume5m!==null&&c.volume5m!==undefined;
 return `<dl class="new-metrics"><div><dt>Liquidity</dt><dd>${money(c.liquidity)}</dd></div><div><dt>${short?'5m volume':'24h volume'}</dt><dd>${money(short?c.volume5m:c.volume)}</dd></div><div><dt>${short?'5m buys / sells':'24h buys'}</dt><dd>${short?`${num(c.buys5m)} / ${num(c.sells5m)}`:num(c.buys)}</dd></div></dl>`;
}
function variants(c){if(!c.variants||c.variants.length<2)return '';return `<details class="coin-variants"><summary>${c.variants.length} contracts · listings</summary><p>Metrics and evidence belong to the displayed contract.</p>${c.variants.map(v=>`<div class="coin-variant"><code>${esc(v.contract_address)}</code><span>Liquidity ${money(v.liquidity)} · 5m volume ${money(v.volume5m)}</span>${tokenActions(v)}</div>`).join('')}</details>`}
function thumbnail(c){
 const label=String(c.symbol||'?').replace(/^\$/,'').trim().slice(0,1).toUpperCase()||'?';
 return `<span class="coin-thumb" aria-hidden="true"><span>${esc(label)}</span>${c.image_url?`<img src="${esc(c.image_url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:''}</span>`;
}
function card(c,index){
 const market=marketState(c),origin=c.manual?' · Manual':'';
 return `<article class="new-coin-card"><div class="coin-head"><span class="rank">${String(index+1).padStart(2,'0')}</span><div><h3>$${esc(c.symbol)}</h3><small>${esc(c.name)} · ${esc(c.chain)} · pool ${esc(age(c.poolCreated))}${origin}</small></div>${thumbnail(c)}${tokenActions(c)}</div>${cardMetrics(c)}${explanation(context(c),c)}<div class="coin-meta"><span class="freshness ${market.className}" data-market-time="${market.timestamp||''}" title="${market.timestamp?esc(new Date(market.timestamp).toLocaleString()):'Market timestamp unavailable'}">${esc(market.label)}</span><span>Seen ${esc(age(c.firstSeen))} ago</span></div>${variants(c)}</article>`;
}
function cardSection(title,items,id){return `<section class="card-section" aria-labelledby="${id}"><div class="section-heading"><h2 id="${id}">${title}</h2><span class="count-badge">${items.length}</span></div><div class="card-grid new-coin-grid">${items.length?items.map(card).join(''):`<div class="new-empty"><strong>${title==='Verified context'?'No contract-supported context in this window.':'No pending coins in this window.'}</strong></div>`}</div></section>`}
function cards(rows){return cardSection('Verified context',rows.filter(c=>verified(context(c))),'explained-title')+cardSection('Context pending or unverified',rows.filter(c=>!verified(context(c))),'pending-title')}
function contextLabel(found){return verified(found)?'Exact contract':found?'Unverified':'Pending'}
function scannerRow(c,index){
 const found=context(c),market=marketState(c),trade=axiomLink(c),label=contextLabel(found),badge=verified(found)?'verified':found?'unverified':'pending';
 return `<article class="scanner-row"><span class="scanner-rank">${String(index+1).padStart(2,'0')}</span><div class="scanner-coin">${thumbnail(c)}<div><strong>$${esc(c.symbol)}</strong><small title="${esc(c.name)}">${esc(c.name)} · ${esc(c.chain)}${c.manual?' · Manual':''}${c.variants?.length>1?` · ${c.variants.length} listings`:''} · <span class="freshness ${market.className}" data-market-time="${market.timestamp||''}" title="${market.timestamp?esc(new Date(market.timestamp).toLocaleString()):'Market timestamp unavailable'}">${esc(market.label)}</span></small></div></div><span class="scanner-age" title="Pool created ${esc(new Date(c.poolCreated).toLocaleString())}">${esc(age(c.poolCreated))}</span><strong class="scanner-number">${money(c.liquidity)}</strong><strong class="scanner-number ${c.volume5m==null?'unavailable':''}" title="${c.volume5m==null?'5m volume unavailable':'5m volume'}">${money(c.volume5m)}</strong><span class="scanner-flow ${c.buys5m==null&&c.sells5m==null?'unavailable':''}" title="5m buy and sell transaction counts">${num(c.buys5m)} <i>/</i> ${num(c.sells5m)}</span><span class="scanner-context ${badge}">${label}</span>${trade?`<a class="scanner-trade" href="${esc(trade)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(c.symbol)} on Axiom">Axiom ↗</a>`:'<span class="scanner-trade unavailable">—</span>'}<button class="scanner-detail-button" type="button" data-open-coin="${esc(c.id)}" aria-label="Details for ${esc(c.symbol)}">Details</button></article>`;
}
function detailHtml(c){
 const found=context(c),market=marketState(c);
 return `<div class="detail-head"><div class="detail-identity">${thumbnail(c)}<div><h2>$${esc(c.symbol)}</h2><p>${esc(c.name)} · ${esc(c.chain)} · pool ${esc(age(c.poolCreated))} old</p></div></div><button class="detail-close" type="button" data-close-detail aria-label="Close coin details">×</button></div><p class="detail-freshness"><span class="freshness ${market.className}" data-market-time="${market.timestamp||''}">${esc(market.label)}</span> · Seen ${esc(age(c.firstSeen))} ago</p>${metrics(c)}${explanation(found,c)}<div class="detail-actions">${tokenActions(c)}</div>${variants(c)}`;
}
function renderDetail(){
 const dialog=$('#coin-detail');if(!dialog.open)return;
 const coin=visibleRows.find(c=>c.id===state.selectedId);if(!coin){dialog.close();return}
 const content=$('#coin-detail-content'),html=detailHtml(coin);if(content.innerHTML!==html)content.innerHTML=html;
}
function updateAvailable(){
 const snapshot=state.pendingSnapshot,buttons=document.querySelectorAll('[data-apply-update]');
 if(!snapshot){buttons.forEach(b=>b.hidden=true);return}
 const known=new Set(data.coins.map(c=>c.id)),added=snapshot.coins.filter(c=>!known.has(c.id)).length;
 buttons.forEach(b=>{b.hidden=false;b.textContent=added?`+${added} new`:'Update available'});
}
function render(){
 const retained=data.coins.filter(c=>c.firstSeen>Date.now()-5*86400000),supported=retained.filter(c=>verified(context(c))).length;
 $('#collection-summary').textContent=state.historyLoaded?`5D: ${retained.length} total · ${supported} verified · ${retained.length-supported} pending`:state.historyError?'Totals unavailable':'Loading…';
 $('#investigate').disabled=loading;$('#refresh').disabled=loading;
 const all=candidates(),rows=groupCoins(all,context);visibleRows=rows;
 $('#coin-count').textContent=rows.length;
 $('#coin-list').className=`coin-list ${state.view==='card'?'card-mode':'grid-mode'}`;
 $('.coin-scanner').classList.toggle('card-mode',state.view==='card');
 $('#coin-list').innerHTML=state.view==='card'?cards(rows):rows.length?rows.map(scannerRow).join(''):'<div class="new-empty"><strong>No coins in this window.</strong> Try a longer window or another search.</div>';
 $('#status').textContent=loading?'Loading shared server history…':state.notice||`${rows.length} coin groups · ${all.length} contracts · ${state.hours===120?'5D':state.hours+'H'} window`;
 document.querySelectorAll('[data-sort]').forEach(select=>select.value=state.sort);
 $('#full-freshness').textContent=state.lastRun?`Server ${age(state.lastRun)} ago`:'Server waiting';
 updateAvailable();
 renderDetail();
}
function applySnapshot(snapshot){
 data.coins=snapshot.coins;state.historyLoaded=true;state.historyError=false;state.lastRun=snapshot.lastRun||0;state.pendingSnapshot=null;
 const failed=Object.values(snapshot.feeds||{}).some(feed=>feed.error);
 state.notice=snapshot.lastRun?`Server checked ${new Date(snapshot.lastRun).toLocaleString()}${failed?' · Some feeds unavailable; saved snapshots retained.':''}`:'The server is preparing its first collection.';
 render();
}
async function getSnapshot(){
 const response=await fetch('/api/new-coins',{cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error('History unavailable');
 const snapshot=await response.json();if(!Array.isArray(snapshot.coins))throw new Error('Invalid history');return snapshot;
}
async function refresh(){
 if(loading)return;loading=true;state.notice='';render();
 try{applySnapshot(await getSnapshot())}catch{state.historyError=true;state.notice='Server history unavailable. Displayed snapshots were retained.'}
 finally{loading=false;render()}
}
async function poll(){
 try{const snapshot=await getSnapshot();if(snapshot.lastRun>state.lastRun){state.pendingSnapshot=snapshot;updateAvailable()}}catch{}
}
async function readStory(source){
 const response=await fetch(`/api/context/source/${source.id}`,{signal:AbortSignal.timeout(18000)});if(!response.ok)throw new Error();
 const text=await response.text();return {snippet:storyParagraph(text),text};
}
async function fetchWebContext(c){
 for(const source of sourcesFor(c)){try{const result=await readStory(source);if(result.snippet)return {...source,snippet:result.snippet,exact:source.contract===c.contract_address&&result.text.includes(c.contract_address)}}catch{}}
 const query=new URLSearchParams({name:c.name,symbol:c.symbol,contract:c.contract_address,mode:'story'}),response=await fetch(`/api/context/search?${query}`,{signal:AbortSignal.timeout(18000)});
 if(!response.ok)throw new Error();return bestSearchLead(await response.text());
}
async function enrich(coins){
 const queue=[...coins];await Promise.all(Array.from({length:2},async()=>{while(queue.length){const c=queue.shift();data.checks.set(c.id,'searching');render();try{const lead=await fetchWebContext(c);if(lead)data.web.set(c.id,{...lead,exact:false});data.checks.set(c.id,lead?'found':'empty')}catch{data.checks.set(c.id,'error')}render()}}));
}
async function investigate(){
 if(loading)return;const query=state.query.trim();if(!query){state.notice='Enter a coin name, ticker, or contract.';render();return}
 loading=true;state.notice=`Looking up ${query}…`;render();
 try{
  const response=await fetch(`/api/market/search/pools?query=${encodeURIComponent(query)}`,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error();
  const payload=await response.json(),key=query.toLowerCase().replace(/[^a-z0-9]/g,''),exact=c=>[c.name,c.symbol].some(v=>String(v).toLowerCase().replace(/[^a-z0-9]/g,'')===key);
  const coins=NETWORKS.flatMap(network=>parsePools({...payload,data:(payload.data||[]).filter(pool=>String(pool.id||'').startsWith(`${network.id}_`))},network)).sort((a,b)=>Number(exact(b))-Number(exact(a))).slice(0,6).map(c=>({...c,manual:true,firstSeen:Date.now(),marketUpdatedAt:c.fetchedAt}));
  if(!coins.length){state.notice=`No Solana or Base pool found for “${query}”.`;return}
  data.manualCoins=[...new Map([...coins,...data.manualCoins].map(c=>[c.id,c])).values()];render();await enrich(coins);state.notice=`Found ${coins.length} market match${coins.length===1?'':'es'} for “${query}”.`;
 }catch{state.notice=`Could not investigate “${query}” right now.`}finally{loading=false;render()}
}
function setFull(enabled){document.body.classList.toggle('tiles-only',enabled);$('#full-mode').setAttribute('aria-pressed',String(enabled));$('#full-mode').textContent=enabled?'Exit Full':'Full'}
function setCard(enabled){state.view=enabled?'card':'grid';document.querySelectorAll('[data-card-mode]').forEach(button=>button.setAttribute('aria-pressed',String(enabled)));render()}
function setSort(value){state.sort=value;render()}
document.addEventListener('click',async event=>{
 const period=event.target.closest('[data-hours]');if(period){state.hours=Number(period.dataset.hours);document.querySelectorAll('[data-hours]').forEach(x=>x.setAttribute('aria-pressed',String(x===period)));render();return}
 if(event.target.closest('[data-apply-update]')&&state.pendingSnapshot){applySnapshot(state.pendingSnapshot);return}
 if(event.target.closest('[data-card-mode]')){setCard(state.view!=='card');return}
 const open=event.target.closest('[data-open-coin]');if(open){state.selectedId=open.dataset.openCoin;const coin=visibleRows.find(c=>c.id===state.selectedId);if(coin){$('#coin-detail-content').innerHTML=detailHtml(coin);$('#coin-detail').showModal()}return}
 if(event.target.closest('[data-close-detail]')){$('#coin-detail').close();return}
 const button=event.target.closest('[data-copy-ca]');if(!button)return;
 const coin=[...data.manualCoins,...data.coins].find(c=>c.id===button.dataset.copyCa),result=await copyContract(coin,navigator.clipboard);
 if(result.status==='copied'){button.textContent='Copied ✓';$('#ca-status').textContent='Contract copied.';setTimeout(()=>{if(button.isConnected)button.textContent='CA ⧉'},1800)}
 else if(result.status==='manual'){const input=$('#manual-ca');input.value=result.address;$('#ca-dialog').showModal();input.focus();input.select()}
});
document.addEventListener('error',event=>{if(event.target.matches?.('.coin-thumb img'))event.target.remove()},true);
$('#coin-detail').addEventListener('close',()=>{state.selectedId=null});
document.querySelectorAll('[data-sort]').forEach(select=>select.addEventListener('change',event=>setSort(event.target.value)));
$('#query').addEventListener('input',event=>{state.query=event.target.value;render()});$('#query').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();investigate()}});
$('#investigate').addEventListener('click',investigate);$('#refresh').addEventListener('click',refresh);$('#full-mode').addEventListener('click',()=>setFull(!document.body.classList.contains('tiles-only')));
$('.full-refresh').addEventListener('click',refresh);
$('.full-exit').addEventListener('click',()=>setFull(false));
document.addEventListener('keydown',event=>{if(event.key==='Escape'){setFull(false);$('.collection-info').open=false}});
setInterval(poll,60000);setInterval(()=>{document.querySelectorAll('[data-market-time]').forEach(node=>{const c={fetchedAt:Number(node.dataset.marketTime)},fresh=marketState(c);node.textContent=fresh.label;node.className=`freshness ${fresh.className}`})},15000);
render();refresh();
