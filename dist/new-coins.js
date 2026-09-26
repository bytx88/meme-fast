import {tokenActions} from './token-actions.mjs?v=find-stats-v1';
import {copyContract,axiomLink,fomoLink} from './contract-copy.mjs?v=fomo-scanner-v1';
import {groupCoins} from './coin-groups.mjs';
import {sourcesFor, storyParagraph, bestSearchLead} from './coin-context.mjs';
import {NETWORKS, parsePools} from './public-radar.mjs';
import {stageFor} from './coin-stages.mjs?v=stage-coverage-v1';

const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>v===null||v===undefined?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(v);
const num=v=>v===null||v===undefined?'—':Number(v).toLocaleString('en-US');
const age=time=>{const mins=Math.max(0,Math.round((Date.now()-time)/60000));return mins<60?`${mins}m`:mins<1440?`${Math.floor(mins/60)}h`:`${Math.floor(mins/1440)}d`};
const viewPreferenceKey='meme-fast.coin-view-v2';
function savedView(){try{const view=localStorage.getItem(viewPreferenceKey);return ['discover','explore','research'].includes(view)?view:'discover'}catch{return 'discover'}}
const contractQuery=new URLSearchParams(location.search).get('contract')?.trim()||'';
const state={historyLoaded:false,historyError:false,hours:contractQuery?120:1,sort:'newest',query:contractQuery,notice:'',lastRun:0,pendingSnapshot:null,selectedId:null,view:contractQuery?'research':savedView(),activeStage:'new'};
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
function variants(c){if(!c.variants||c.variants.length<2)return '';return `<details class="coin-variants"><summary>${c.variants.length} contracts · listings</summary><p>Metrics and evidence belong to the displayed contract.</p>${c.variants.map(v=>`<div class="coin-variant"><code>${esc(v.contract_address)}</code><span>Liquidity ${money(v.liquidity)} · 5m volume ${money(v.volume5m)}</span>${tokenActions(v)}</div>`).join('')}</details>`}
function thumbnail(c){
 const label=String(c.symbol||'?').replace(/^\$/,'').trim().slice(0,1).toUpperCase()||'?';
 return `<span class="coin-thumb" aria-hidden="true"><span>${esc(label)}</span>${c.image_url?`<img src="${esc(c.image_url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:''}</span>`;
}
function card(c,index){
 const found=context(c),market=marketState(c),trade=axiomLink(c),fomo=fomoLink(c),read=quickRead(found,c),badge=verified(found)?'verified':found?'unverified':'pending';
 const stage=stageFor(c),stageFact=stage==='stretch'?`${Math.round(c.launchpad.graduationPercentage)}% to graduation`:stage==='migrated'?c.launchpad?.completed?'Graduation observed':`${money(c.volume)} 24h volume · graduation unconfirmed`:`Pool ${age(c.poolCreated)} old`;
 return `<article class="new-coin-card scan-card"><div class="coin-head"><span class="rank">${String(index+1).padStart(2,'0')}</span><div class="card-identity"><div class="card-title-line"><h3>$${esc(c.symbol)}</h3>${c.variants?.length>1?`<span class="card-listings">${c.variants.length} listings</span>`:''}<span class="freshness ${market.className}" data-market-time="${market.timestamp||''}" title="${market.timestamp?esc(new Date(market.timestamp).toLocaleString()):'Market timestamp unavailable'}">${esc(market.label)}</span></div><small title="${esc(c.name)}">${esc(c.name)} · ${esc(c.chain)}${c.manual?' · Manual':''}</small></div>${thumbnail(c)}</div><div class="card-read ${badge}"><span class="card-context">${contextLabel(found)}</span><p title="${esc(read)}">${esc(read)}</p></div><div class="card-stage-fact">${esc(stageFact)}</div>${metrics(c)}<div class="card-actions">${fomo?`<a href="${esc(fomo)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(c.symbol)} on Fomo">Fomo ↗</a>`:''}${trade?`<a href="${esc(trade)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(c.symbol)} on Axiom">Axiom ↗</a>`:''}<button type="button" data-open-coin="${esc(c.id)}" aria-label="Details for ${esc(c.symbol)}">Details</button></div></article>`;
}
function cardSection(key,title,description,items,id){return `<section class="discovery-lane ${state.activeStage===key?'stage-active':''}" aria-labelledby="${id}"><div class="discovery-lane-head"><h2 id="${id}">${title} <span class="count-badge">${items.length}</span></h2><p>${description}</p></div><div class="discovery-lane-list">${items.length?items.map(card).join(''):'<p class="lane-empty">No coins in this stage for the selected window.</p>'}</div></section>`}
function newPairsSection(stages,known,total){const near=stages.stretch,fresh=stages.new,nearEmpty=state.hours===120?'No near-graduation coins measured in the current public feed.':'No near-graduation coins first discovered in this window.';return `<section class="discovery-lane ${state.activeStage==='new'?'stage-active':''}" aria-labelledby="new-pairs-title"><div class="discovery-lane-head"><h2 id="new-pairs-title">New Pairs <span class="count-badge">${near.length+fresh.length}</span></h2><p>Final Stretch first · narrative ready</p></div><div class="discovery-lane-list"><div class="lane-subheading"><strong>Final Stretch <span>${near.length}</span></strong><small>80–99% progress · data for ${known}/${total}</small></div>${near.length?near.map(card).join(''):`<p class="lane-empty compact">${nearEmpty}</p>`}<div class="lane-subheading"><strong>Fresh Pairs <span>${fresh.length}</span></strong></div>${fresh.map((coin,index)=>card(coin,index+near.length)).join('')}</div></section>`}
function sustainedSection(){return `<section class="discovery-lane ${state.activeStage==='sustained'?'stage-active':''}" aria-labelledby="sustained-title"><div class="discovery-lane-head"><h2 id="sustained-title">Sustained</h2><p>After the first wash · criteria to define</p></div><div class="discovery-lane-list"><p class="lane-empty">Criteria are still being defined. No coins are classified as Sustained yet.</p></div></section>`}
function cards(stages,known,total){return `<div class="discovery-board"><div class="stage-tabs" role="group" aria-label="Discovery stage">${[['new','New Pairs',stages.new.length+stages.stretch.length],['sustained','Sustained',null],['migrated','Migrated',stages.migrated.length]].map(([key,label,count])=>`<button type="button" data-stage-tab="${key}" aria-pressed="${state.activeStage===key}">${label}${count===null?'':` <span>${count}</span>`}</button>`).join('')}</div>${newPairsSection(stages,known,total)}${sustainedSection()}${cardSection('migrated','Migrated','Graduated or $50K+ volume proxy',stages.migrated,'migrated-title')}</div>`}
function exploreSection(title,items,id){return items.length?`<section class="explore-section" aria-labelledby="${id}"><div class="section-heading"><h2 id="${id}">${title}</h2><span class="count-badge">${items.length}</span></div><div class="explore-grid">${items.map(card).join('')}</div></section>`:''}
function exploreCards(rows){
 if(!rows.length)return '<div class="new-empty"><strong>No coins in this window.</strong> Try a longer window or another search.</div>';
 const exact=rows.filter(c=>verified(context(c))),other=rows.filter(c=>!verified(context(c)));
 return `<div class="explore-board">${exploreSection('Verified context',exact,'explore-verified-title')}${exploreSection('Context pending or unverified',other,'explore-pending-title')}</div>`;
}
function contextLabel(found){return verified(found)?'Exact contract':found?'Unverified':'Pending'}
function quickRead(found,c){
 if(found?.articles?.length)return clean(found.articles[0].title)||'Article available; open Details for the source.';
 if(found?.web)return clean(found.web.snippet||found.web.title)||'Public lead available; open Details for the source.';
 if(found?.profile)return clean(found.profile.description)||'Exact contract profile, without a description.';
 const checked=data.checks.get(c.id);
 return checked==='searching'?'Checking public context…':checked==='error'?'Context source unavailable.':'No story found yet.';
}
function scannerRow(c,index){
 const found=context(c),market=marketState(c),trade=axiomLink(c),fomo=fomoLink(c),label=contextLabel(found),badge=verified(found)?'verified':found?'unverified':'pending',read=quickRead(found,c);
 return `<article class="scanner-row"><span class="scanner-rank">${String(index+1).padStart(2,'0')}</span><div class="scanner-coin">${thumbnail(c)}<div><strong>$${esc(c.symbol)}</strong><small title="${esc(c.name)}">${esc(c.name)} · ${esc(c.chain)}${c.manual?' · Manual':''}${c.variants?.length>1?` · ${c.variants.length} listings`:''} · <span class="freshness ${market.className}" data-market-time="${market.timestamp||''}" title="${market.timestamp?esc(new Date(market.timestamp).toLocaleString()):'Market timestamp unavailable'}">${esc(market.label)}</span></small></div></div><span class="scanner-quick ${badge}" title="${esc(read)}">${esc(read)}</span><span class="scanner-age" title="Pool created ${esc(new Date(c.poolCreated).toLocaleString())}">${esc(age(c.poolCreated))}</span><strong class="scanner-number">${money(c.liquidity)}</strong><span class="scanner-flow ${c.buys5m==null&&c.sells5m==null?'unavailable':''}" title="5m buy and sell transaction counts">${num(c.buys5m)} <i>/</i> ${num(c.sells5m)}</span><span class="scanner-context ${badge}">${label}</span>${fomo?`<a class="scanner-trade" href="${esc(fomo)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(c.symbol)} on Fomo">Fomo ↗</a>`:'<span class="scanner-trade unavailable">—</span>'}${trade?`<a class="scanner-trade" href="${esc(trade)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(c.symbol)} on Axiom">Axiom ↗</a>`:'<span class="scanner-trade unavailable">—</span>'}<button class="scanner-detail-button" type="button" data-open-coin="${esc(c.id)}" aria-label="Details for ${esc(c.symbol)}">Details</button></article>`;
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
 const all=candidates(),rows=groupCoins(all,context),stages={new:[],stretch:[],migrated:[]};
 for(const coin of all)stages[stageFor(coin)].push(coin);
 for(const key of Object.keys(stages))stages[key]=groupCoins(stages[key],context);
 visibleRows=state.view==='discover'?[...stages.stretch,...stages.new,...stages.migrated]:rows;
 $('#coin-count').textContent=rows.length;
 $('#coin-list').className=`coin-list ${state.view==='discover'?'discover-mode':state.view==='explore'?'explore-mode':'grid-mode'}`;
 $('.coin-scanner').classList.toggle('discover-mode',state.view==='discover');
 $('.coin-scanner').classList.toggle('explore-mode',state.view==='explore');
 document.querySelectorAll('[data-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===state.view)));
 $('#coin-list').innerHTML=state.view==='discover'?cards(stages,all.filter(c=>c.launchpad).length,all.length):state.view==='explore'?exploreCards(rows):rows.length?rows.map(scannerRow).join(''):'<div class="new-empty"><strong>No coins in this window.</strong> Try a longer window or another search.</div>';
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
function setView(view){if(!['discover','explore','research'].includes(view))return;state.view=view;try{localStorage.setItem(viewPreferenceKey,view)}catch{}render()}
function setSort(value){state.sort=value;render()}
document.addEventListener('click',async event=>{
 const period=event.target.closest('[data-hours]');if(period){state.hours=Number(period.dataset.hours);document.querySelectorAll('[data-hours]').forEach(x=>x.setAttribute('aria-pressed',String(x===period)));render();await refresh();return}
 const stageTab=event.target.closest('[data-stage-tab]');if(stageTab){state.activeStage=stageTab.dataset.stageTab;render();return}
 if(event.target.closest('[data-apply-update]')&&state.pendingSnapshot){applySnapshot(state.pendingSnapshot);return}
 const view=event.target.closest('[data-view]');if(view){setView(view.dataset.view);return}
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
$('#query').value=state.query;
setInterval(poll,60000);setInterval(()=>{document.querySelectorAll('[data-market-time]').forEach(node=>{const c={fetchedAt:Number(node.dataset.marketTime)},fresh=marketState(c);node.textContent=fresh.label;node.className=`freshness ${fresh.className}`})},15000);
render();
refresh().then(()=>{
 if(contractQuery&&!data.coins.some(c=>String(c.contract_address).toLowerCase()===contractQuery.toLowerCase()))investigate();
});
