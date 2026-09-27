import {requestRefreshPriority} from './refresh-priority.mjs';
import {marketFreshness,freshnessCounts} from './market-freshness.mjs';
import {tokenActions} from './token-actions.mjs?v=find-stats-v1';
import {chainMarker} from './chain-marker.mjs';
import {contractForCopy,copyContract,axiomLink,fomoLink} from './contract-copy.mjs?v=fomo-scanner-v1';
import {groupCoins} from './coin-groups.mjs';
import {sourcesFor, storyParagraph, bestSearchLead} from './coin-context.mjs';
import {NETWORKS, parsePools} from './public-radar.mjs';
import {stageFor,isUnderObservation} from './coin-stages.mjs?v=observation-v1';
import {DEFAULT_SCREENER,normalizeScreener,passesScreener} from './coin-screener.mjs';
import {sourceCoverageNote} from './source-coverage.mjs';
import {DEFAULT_ENTRY,normalizeEntry,assessEntry} from './snipe-decision.mjs';
import {isSaved,toggleSaved,watchlist} from './research-store.mjs?v=watchlist-fomo-v2';

const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>v===null||v===undefined?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(v);
const num=v=>v===null||v===undefined?'—':Number(v).toLocaleString('en-US');
const age=time=>{const mins=Math.max(0,Math.round((Date.now()-time)/60000));return mins<60?`${mins}m`:mins<1440?`${Math.floor(mins/60)}h`:`${Math.floor(mins/1440)}d`};
const viewPreferenceKey='meme-fast.coin-view-v3';
const screenerPreferenceKey='meme-fast.coin-screener-v1';
const skipRugPreferenceKey='meme-fast.skip-rug-v1';
const entryPreferenceKey='meme-fast.entry-v1';
const AUTO_UPDATE_MS=20000;
function savedView(){try{const view=localStorage.getItem(viewPreferenceKey);return ['entry','discover','explore'].includes(view)?view:'entry'}catch{return 'entry'}}
function savedScreener(){try{return normalizeScreener(JSON.parse(localStorage.getItem(screenerPreferenceKey)||'{}'))}catch{return {...DEFAULT_SCREENER}}}
function savedSkipRug(){try{return localStorage.getItem(skipRugPreferenceKey)!=='false'}catch{return true}}
function savedEntry(){try{return normalizeEntry(JSON.parse(localStorage.getItem(entryPreferenceKey)||'{}'))}catch{return {...DEFAULT_ENTRY}}}
const params=new URLSearchParams(location.search);
const contractQuery=(params.get('contract')||params.get('query')||'').trim();
const state={historyLoaded:false,historyError:false,hours:contractQuery?120:1,sort:'newest',screener:savedScreener(),entry:savedEntry(),skipRug:savedSkipRug(),query:contractQuery,freshEnabled:false,checkError:false,notice:'',coverageNote:'',lastRun:0,revision:'0',pendingSnapshot:null,selectedId:null,view:contractQuery?'entry':savedView(),activeStage:'new',holdsOpen:false};
const data={coins:[],manualCoins:[],web:new Map(),checks:new Map()};let loading=false,visibleRows=[],freshTimer=null,pollInFlight=false,highlightIds=new Set(),highlightTimer=null;
const isNewGroup=coin=>highlightIds.has(coin.id)||coin.variants?.some(variant=>highlightIds.has(variant.id));

function clean(value){return String(value??'').replace(/\[[^\]]+\]\([^)]*\)/g,'').replace(/\(?https?:\/\/\S+\)?/g,'').replace(/\buddg=\S+/g,'').replace(/\s+/g,' ').trim()}
function context(c){return data.web.get(c.id)?{kind:'web',web:data.web.get(c.id)}:c.savedContext||null}
function verified(found){return found?.kind==='verified'||found?.kind==='web'&&found.web?.exact}
function stageOrder(c){
 if(c.ruggedAt)return {key:'rugged',label:'Deep drawdown',rank:0};
 if(c.earlyRampWarning)return {key:'rapid',label:'Rapid early rise',rank:0};
 if(stageFor(c)==='sustained'&&c.laterRecoveryAt)return {key:'sustained',label:'Later recovery',rank:5};
 if(stageFor(c)==='sustained'&&c.sustainedAt)return {key:'sustained',label:c.successScenario==='continuation'?'45m · B':'45m · A',rank:5};
 const stage=stageFor(c);
 if(stage==='migrated'&&isUnderObservation(c))return {key:'observing',label:'Observing',rank:4};
 return {key:stage,label:({new:'New',stretch:'Stretch',migrated:'Migration confirmed',active:'Volume only',sustained:'Observed recovery'}[stage]||'New'),rank:({new:1,stretch:2,migrated:3,active:2,sustained:5}[stage]??1)};
}
function contextOrder(c){const found=context(c);return verified(found)?'verified':found?'unverified':'pending'}
function sortValue(c){
 if(state.sort==='stage')return stageOrder(c).rank;
 if(state.sort==='poolAge')return Number.isFinite(c.poolCreated)?Date.now()-c.poolCreated:null;
 if(state.sort==='volume5m')return c.volume5m??null;
 if(state.sort==='volume24h')return c.volume??null;
 if(state.sort==='liquidity')return c.liquidity??null;
 if(state.sort==='activity')return c.buys5m==null&&c.sells5m==null?null:(c.buys5m??0)+(c.sells5m??0);
 if(state.sort==='context')return ({verified:2,unverified:1,pending:0})[contextOrder(c)];
 return state.view==='discover'&&c.launchpad?.completed===true?c.graduationObservedAt??c.firstSeen??0:c.firstSeen??c.poolCreated??0;
}
function compareCoins(a,b){
 const first=sortValue(a),second=sortValue(b);
 if(first==null)return second==null?0:1;
 if(second==null)return -1;
 return second-first||(b.firstSeen??0)-(a.firstSeen??0);
}
function candidates(){
 const q=state.query.trim().toLowerCase(),cutoff=Date.now()-state.hours*3600000;
 const regular=data.coins.filter(c=>c.firstSeen>=cutoff||state.view==='discover'&&c.launchpad?.completed===true&&c.graduationObservedAt>=cutoff),manual=data.manualCoins;
 return [...new Map([...manual,...regular].filter(c=>(!state.skipRug||!c.ruggedAt&&!c.earlyRampWarning||contractQuery&&String(c.contract_address).toLowerCase()===contractQuery.toLowerCase())&&(state.view==='entry'||passesScreener(c,state.screener))&&(!q||`${c.name} ${c.symbol} ${c.contract_address}`.toLowerCase().includes(q))).map(c=>[c.id,c])).values()]
  .sort((a,b)=>Number(Boolean(b.manual))-Number(Boolean(a.manual))||compareCoins(a,b));
}
function marketState(c){
 const reading=marketFreshness(c,Date.now(),6);
 return {timestamp:reading.at,label:reading.label,className:reading.usable?'fresh':'stale'};
}
function duration(minutes){return minutes==null?'—':minutes<1?`${Math.floor(minutes*60)}s`:minutes<60?`${Math.floor(minutes)}m`:`${Math.floor(minutes/60)}h`}
function signedMoney(value){return value==null?'—':`${value>=0?'+':'−'}${money(Math.abs(value))}`}
function signedNum(value){return value==null?'—':`${value>=0?'+':'−'}${num(Math.abs(value))}`}
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
 const fomo=fomoLink(c),tag=fomo?'a':'span';
 return `<${tag} class="coin-thumb" ${fomo?`href="${esc(fomo)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(c.symbol)} on Fomo" title="Open on Fomo"`:'aria-hidden="true"'}><span>${esc(label)}</span>${c.image_url?`<img src="${esc(c.image_url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:''}</${tag}>`;
}
function watchButton(c){const saved=isSaved('coin',c.id);return `<button type="button" data-save-coin="${esc(c.id)}" aria-pressed="${saved}">${saved?'Saved ✓':'Watchlist +'}</button>`}
function identitySubtitle(c){return [c.name,chainMarker(c)?null:c.chain].filter(Boolean).map(esc).join(' · ')}
function card(c,index,phase=''){
 const found=context(c),market=marketState(c),trade=axiomLink(c),address=contractForCopy(c),read=quickRead(found,c),badge=verified(found)?'verified':found?'unverified':'pending';
 const stage=stageFor(c),minutes=Math.max(0,Math.floor((Date.now()-c.graduationObservedAt)/60000)),stageFact=c.earlyRampWarning?`Rapid early rise · +${c.earlyRampWarning.risePercent}% in ${c.earlyRampWarning.minutes}m · caution`:phase==='tracking'?`Recovery check · ${minutes}m since migration`:stage==='sustained'&&c.laterRecoveryAt?`Later recovery · ${c.laterRecoveryPercent}% from low`:stage==='sustained'&&c.sustainedAt?c.successScenario==='continuation'?`45m scenario B · continued +${c.recoveryPercent}%`:`45m scenario A · recovered ${c.recoveryPercent}% from low`:c.ruggedAt?`Deep drawdown · ${c.rugDrawdownPercent}% from peak`:c.sustainedAt||c.laterRecoveryAt?'Historical price move · market inactive':stage==='stretch'?`${Math.round(c.launchpad.graduationPercentage)}% to graduation`:c.successCoverage==='insufficient'?'Outcome unconfirmed · price history incomplete':stage==='migrated'?'Graduation observed':stage==='active'?`${money(c.volume)} 24h volume · graduation unconfirmed`:'';
 return `<article class="new-coin-card scan-card${isNewGroup(c)?' snapshot-new':''}"><div class="card-top"><div class="coin-head"><span class="rank">${String(index+1).padStart(2,'0')}</span><div class="card-identity"><div class="card-title-line"><h3>$${esc(c.symbol)}</h3>${chainMarker(c)}${address?`<button class="contract-copy-icon" type="button" data-copy-ca="${esc(c.id)}" title="Copy contract address" aria-label="Copy ${esc(c.symbol)} contract address"></button>`:''}${c.variants?.length>1?`<span class="card-listings">${c.variants.length} listings</span>`:''}<span class="freshness ${market.className}" data-market-id="${esc(c.id)}" data-market-time="${market.timestamp||''}" title="${market.timestamp?esc(new Date(market.timestamp).toLocaleString()):'Market timestamp unavailable'}">${esc(market.label)}</span></div><small title="${esc(c.name)}">${identitySubtitle(c)}${c.manual?' · Manual':''}</small></div></div><div class="card-read ${badge}"><span class="card-context">${contextLabel(found)}</span><p title="${esc(read)}">${esc(read)}</p></div><div class="card-art">${thumbnail(c)}<span class="card-pool-age" title="Pool age">Pool ${esc(age(c.poolCreated))} old</span></div></div>${stageFact?`<div class="card-stage-fact ${c.earlyRampWarning?'ramp-risk':phase==='tracking'?'tracking':c.ruggedAt?'rugged':stage==='sustained'?'sustained':''}">${esc(stageFact)}</div>`:''}${metrics(c)}<div class="card-actions"><button type="button" data-open-coin="${esc(c.id)}" aria-label="Details for ${esc(c.symbol)}">Details</button>${watchButton(c)}${trade?`<a href="${esc(trade)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(c.symbol)} on Axiom">Axiom ↗</a>`:''}</div></article>`;
}
function cardSection(key,title,description,items,id,empty='No coins in this stage for the selected window.'){return `<section class="discovery-lane ${state.activeStage===key?'stage-active':''}" aria-labelledby="${id}"><div class="discovery-lane-head"><h2 id="${id}">${title} <span class="count-badge">${items.length}</span></h2><p>${description}</p></div><div class="discovery-lane-list">${items.length?items.map(card).join(''):`<p class="lane-empty">${empty}</p>`}</div></section>`}
function newPairsSection(stages,known,total){const near=stages.stretch,fresh=stages.new,nearEmpty=state.hours===120?'No near-graduation coins measured in the current public feed.':'No near-graduation coins match this window and screener.';return `<section class="discovery-lane ${state.activeStage==='new'?'stage-active':''}" aria-labelledby="new-pairs-title"><div class="discovery-lane-head"><h2 id="new-pairs-title">New Pairs <span class="count-badge">${near.length+fresh.length}</span></h2><p>Final Stretch first · check story evidence</p></div><div class="discovery-lane-list"><div class="lane-subheading"><strong>Final Stretch <span>${near.length}</span></strong><small>80–99% progress · data for ${known}/${total}</small></div>${near.length?near.map(card).join(''):`<p class="lane-empty compact">${nearEmpty}</p>`}<div class="lane-subheading"><strong>Fresh Pairs <span>${fresh.length}</span></strong></div>${fresh.length?fresh.map((coin,index)=>card(coin,index+near.length)).join(''):'<p class="lane-empty compact">No fresh pairs match this window and screener.</p>'}</div></section>`}
function sustainedSection(stages){const early=stages.sustained.filter(c=>!c.laterRecoveryAt),later=stages.sustained.filter(c=>c.laterRecoveryAt);return `<section class="discovery-lane ${state.activeStage==='sustained'?'stage-active':''}" aria-labelledby="sustained-title"><div class="discovery-lane-head"><h2 id="sustained-title">Observed recovery <span class="count-badge">${stages.sustained.length}</span></h2><p>45m scenarios A/B for coins ≤6h · later recovery by 24h</p></div><div class="discovery-lane-list"><div class="lane-subheading"><strong>45m patterns <span>${early.length}</span></strong><small>A: rebound · B: continuation</small></div>${early.length?early.map(card).join(''):'<p class="lane-empty compact">No 45m recovery or continuation measured yet.</p>'}<div class="lane-subheading"><strong>Later recovery <span>${later.length}</span></strong></div>${later.length?later.map(card).join(''):'<p class="lane-empty compact">No later recovery confirmed yet.</p>'}<div class="lane-subheading"><strong>Under observation <span>${stages.tracking.length}</span></strong><small>Confirmed migrations in the first 45m</small></div>${stages.tracking.length?stages.tracking.map((coin,index)=>card(coin,index,'tracking')).join(''):'<p class="lane-empty compact">No migrations currently being measured.</p>'}</div></section>`}
function activitySection(stages){return `<section class="discovery-lane ${state.activeStage==='migrated'?'stage-active':''}" aria-labelledby="migrated-title"><div class="discovery-lane-head"><h2 id="migrated-title">Pool activity <span class="count-badge">${stages.migrated.length+stages.active.length}</span></h2><p>Confirmed migration and volume-only evidence</p></div><div class="discovery-lane-list"><div class="lane-subheading"><strong>Migration confirmed <span>${stages.migrated.length}</span></strong></div>${stages.migrated.length?stages.migrated.map(card).join(''):'<p class="lane-empty compact">No confirmed migrations in this window.</p>'}<div class="lane-subheading"><strong>Volume only · migration unknown <span>${stages.active.length}</span></strong><small>$50K+ observed 24h pool volume</small></div>${stages.active.length?stages.active.map(card).join(''):'<p class="lane-empty compact">No volume-only candidates in this window.</p>'}</div></section>`}
function cards(stages,known,total){return `<div class="discovery-board"><div class="stage-tabs" role="group" aria-label="Discovery stage">${[['new','New Pairs',stages.new.length+stages.stretch.length],['sustained','Recovery',stages.sustained.length+stages.tracking.length],['migrated','Pool activity',stages.migrated.length+stages.active.length]].map(([key,label,count])=>`<button type="button" data-stage-tab="${key}" aria-pressed="${state.activeStage===key}">${label} <span>${count}</span></button>`).join('')}</div>${newPairsSection(stages,known,total)}${sustainedSection(stages)}${activitySection(stages)}</div>`}
function exploreSection(title,items,id){return items.length?`<section class="explore-section" aria-labelledby="${id}"><div class="section-heading"><h2 id="${id}">${title}</h2><span class="count-badge">${items.length}</span></div><div class="explore-grid">${items.map(card).join('')}</div></section>`:''}
function exploreCards(rows){
 if(!rows.length)return '<div class="new-empty"><strong>No coins in this window.</strong> Try a longer window or another search.</div>';
 const exact=rows.filter(c=>verified(context(c))),other=rows.filter(c=>!verified(context(c)));
 return `<div class="explore-board">${exploreSection('Exact address linked',exact,'explore-verified-title')}${exploreSection('Context pending or unverified',other,'explore-pending-title')}</div>`;
}
function contextLabel(found){return verified(found)?'Exact contract':found?'Unverified':'Pending'}
function quickRead(found,c){
 if(found?.articles?.length)return clean(found.articles[0].title)||'Article available; open Details for the source.';
 if(found?.web)return clean(found.web.snippet||found.web.title)||'Public lead available; open Details for the source.';
 if(found?.profile)return clean(found.profile.description)||'Exact contract profile, without a description.';
 const checked=data.checks.get(c.id);
 return checked==='searching'?'Checking public context…':checked==='error'?'Context source unavailable.':'No story found yet.';
}
function entryCheck(c){
 const check=assessEntry(c,state.entry),caution=c.ruggedAt?'Observed deep drawdown':c.earlyRampWarning?'Rapid early rise':null;
 return caution?{...check,passesScreen:false,reasons:[...check.reasons,caution]}:check;
}
function entryCard(c){
 const check=entryCheck(c),flow=check.volumeChange;
 return `<article class="entry-row ${check.passesScreen?'entry-pass':'entry-hold'}${isNewGroup(c)?' snapshot-new':''}"><div class="entry-identity">${thumbnail(c)}<div><div class="entry-name"><strong>$${esc(c.symbol)}</strong>${chainMarker(c)}<button class="contract-copy-icon" type="button" data-copy-ca="${esc(c.id)}" title="Copy contract address" aria-label="Copy ${esc(c.symbol)} contract address"></button></div><small>${identitySubtitle(c)}</small></div><span class="entry-status ${check.passesScreen?'pass':'hold'}">${check.passesScreen?'Threshold pass':'Hold'}</span></div><div class="entry-metrics"><div class="entry-stat"><span>Pool</span><strong title="Created ${c.poolCreated?esc(new Date(c.poolCreated).toLocaleString()):'Unknown'}">${duration(check.poolAgeMinutes)}</strong></div><div class="entry-stat"><span>Detected after</span><strong>${duration(check.detectionLagMinutes)}</strong></div><div class="entry-stat"><span>Market fetch</span><strong class="${check.marketAgeMinutes==null||check.marketAgeMinutes>state.entry.maxMarketAgeMinutes?'risk':''}" title="Updated ${c.marketUpdatedAt??c.fetchedAt?esc(new Date(c.marketUpdatedAt??c.fetchedAt).toLocaleString()):'Unknown'}">${duration(check.marketAgeMinutes)} ago</strong></div><div class="entry-stat"><span>5m buys / sells</span><strong>${num(c.buys5m)} / ${num(c.sells5m)}</strong><small title="Change in overlapping five minute windows">Δ ${signedNum(check.buysChange)} / ${signedNum(check.sellsChange)}</small></div><div class="entry-stat"><span>5m volume Δ</span><strong title="Change in overlapping five minute windows; not incremental volume">${signedMoney(flow)}</strong></div><div class="entry-stat"><span>Liquidity</span><strong>${money(c.liquidity)}</strong><small title="Change since the prior collector sample">Δ ${signedMoney(check.liquidityChange)}</small></div><div class="entry-stat"><span>Size / liq</span><strong>${check.sizeLiquidityPercent==null?'—':check.sizeLiquidityPercent.toFixed(1)+'%'}</strong></div></div><div class="entry-verification"><span>Quote / sell simulation / contract checks: unverified</span>${check.reasons.length?`<small>Screen flags: ${esc(check.reasons.join(', '))}</small>`:'<small>Thresholds met. Check live quote and sellability before entry.</small>'}</div><div class="entry-actions"><button type="button" data-open-coin="${esc(c.id)}" aria-label="Inspect ${esc(c.symbol)}">Inspect</button>${watchButton(c)}</div></article>`;
}
function entryBoard(rows){
 const ranked=rows.map(c=>({coin:c,check:entryCheck(c)})).sort((a,b)=>(b.coin.firstSeen??0)-(a.coin.firstSeen??0));
 const passing=ranked.filter(row=>row.check.passesScreen),held=ranked.filter(row=>!row.check.passesScreen);
 return `<div class="entry-board"><div class="entry-summary"><strong>${passing.length} threshold pass · ${held.length} hold</strong><span>5-minute collector snapshots show fetch time, not exchange event time. A pass is not trade approval; live quote, sell simulation, and contract checks remain unverified.</span></div>${passing.length?`<section class="entry-priority" aria-label="Review first"><h3>Review first <span>${passing.length}</span></h3>${passing.map(row=>entryCard(row.coin)).join('')}</section>`:rows.length?'<div class="entry-no-pass">No pools pass the current thresholds. Review holds or change the screen settings.</div>':'<div class="new-empty">No pools match this window. Try a longer time window.</div>'}${held.length?`<details class="entry-holds" ${state.holdsOpen?'open':''}><summary>Review holds <span>${held.length}</span></summary>${held.map(row=>entryCard(row.coin)).join('')}</details>`:''}</div>`;
}
function lifecycleTag(c){return c.ruggedAt?'<span class="lifecycle-tag rugged" title="Observed price fell at least 78% from an early peak.">Deep drawdown</span>':c.earlyRampWarning?'<span class="lifecycle-tag rugged" title="Sharp early price rise with concentrated buying and thin liquidity; not proof of a rug.">Rapid rise</span>':stageFor(c)==='sustained'&&c.laterRecoveryAt?'<span class="lifecycle-tag sustained">Later recovery</span>':stageFor(c)==='sustained'&&c.sustainedAt?`<span class="lifecycle-tag sustained">45m ${c.successScenario==='continuation'?'B':'A'}</span>`:''}
function detailHtml(c){
 const found=context(c),market=marketState(c),check=entryCheck(c);
 return `<div class="detail-head"><div class="detail-identity">${thumbnail(c)}<div><h2>$${esc(c.symbol)} ${chainMarker(c)} ${lifecycleTag(c)}</h2><p>${identitySubtitle(c)} · pool ${esc(age(c.poolCreated))} old</p></div></div><button class="detail-close" type="button" data-close-detail aria-label="Close coin details">×</button></div><p class="detail-freshness"><span class="freshness ${market.className}" data-market-id="${esc(c.id)}" data-market-time="${market.timestamp||''}">${esc(market.label)}</span> · Seen ${esc(age(c.firstSeen))} ago</p>${state.view==='entry'?`<section class="detail-screen"><h3>Starter screen · ${check.passesScreen?'thresholds met':'hold'}</h3><p>${check.reasons.length?`Checks to review: ${esc(check.reasons.join(', '))}.`:'Pool age, market freshness, liquidity, buy activity, sell pressure, and order size meet the selected thresholds.'} Live quote, sellability, and contract risk are unverified.</p></section>`:''}${metrics(c)}${explanation(found,c)}<div class="detail-actions">${watchButton(c)}${tokenActions(c)}</div>${variants(c)}`;
}
function renderDetail(){
 const dialog=$('#coin-detail');if(!dialog.open)return;
 const coin=visibleRows.find(c=>c.id===state.selectedId)||data.coins.find(c=>c.id===state.selectedId)||data.manualCoins.find(c=>c.id===state.selectedId);if(!coin){dialog.close();return}
 const content=$('#coin-detail-content'),html=detailHtml(coin);if(content.innerHTML!==html)content.innerHTML=html;
}
function updateAutoButtons(){document.querySelectorAll('[data-fresh]').forEach(button=>{button.setAttribute('aria-pressed',String(state.freshEnabled));button.textContent=`Auto ${state.freshEnabled?'On':'Off'}`})}
function updateFreshnessStatus(){
 const health=$('#market-health');if(health&&state.historyLoaded)health.textContent=`${freshnessCounts(candidates(),Date.now(),6)} · market freshness across these contracts${state.coverageNote}. Collection runs every 5m.`;
 const status=$('#full-freshness'),timestamp=state.lastRun?`Collection ${age(state.lastRun)} ago`:'Server waiting';
 status.textContent=state.checkError?`Couldn’t check for updates · ${timestamp}`:timestamp;
 status.title=state.lastRun?`Latest server snapshot: ${new Date(state.lastRun).toLocaleString()}`:'';
}
function preserveScroll(renderWork){
 const selectors=['.discovery-lane-list','.scanner-scroll','.explore-board'];
 const positions=selectors.map(selector=>[selector,[...document.querySelectorAll(selector)].map(node=>({top:node.scrollTop,left:node.scrollLeft}))]);
 const page={top:window.scrollY,left:window.scrollX};
 renderWork();
 requestAnimationFrame(()=>{
  for(const [selector,items]of positions)document.querySelectorAll(selector).forEach((node,index)=>{if(items[index]){node.scrollTop=items[index].top;node.scrollLeft=items[index].left}});
  window.scrollTo(page.left,page.top);
 });
}
function updateAvailable(){
 const snapshot=state.pendingSnapshot,buttons=document.querySelectorAll('[data-apply-update]');
 if(!snapshot){buttons.forEach(b=>b.hidden=true);return}
 const known=new Set(data.coins.map(c=>c.id)),added=snapshot.coins.filter(c=>!known.has(c.id)).length;
 buttons.forEach(b=>{b.hidden=false;b.textContent=added?`+${added} new`:'Update available'});
}
function render(){
 document.body.classList.toggle('entry-view',state.view==='entry');
 const retained=data.coins.filter(c=>c.firstSeen>Date.now()-5*86400000),supported=retained.filter(c=>verified(context(c))).length;
 $('#collection-summary').textContent=state.historyLoaded?`5D: ${retained.length} total · ${supported} address linked · ${retained.length-supported} pending`:state.historyError?'Totals unavailable':'Loading…';
 $('#investigate').disabled=loading;$('#refresh').disabled=loading;
 const all=candidates(),rows=groupCoins(all,context),stages={new:[],stretch:[],sustained:[],tracking:[],migrated:[],active:[]};
 for(const coin of all){const stage=stageFor(coin);stages[stage==='migrated'&&isUnderObservation(coin)?'tracking':stage].push(coin)}
 for(const key of Object.keys(stages))stages[key]=groupCoins(stages[key],context);
 visibleRows=state.view==='entry'?all:state.view==='discover'?[...stages.stretch,...stages.new,...stages.sustained,...stages.tracking,...stages.migrated,...stages.active]:rows;
 $('#coin-count').textContent=state.view==='entry'?all.length:rows.length;
 $('#coin-list').className=`coin-list ${state.view==='entry'?'entry-mode':state.view==='discover'?'discover-mode':'explore-mode'}`;
 $('.coin-scanner').classList.toggle('entry-mode',state.view==='entry');
 $('.coin-scanner').classList.toggle('discover-mode',state.view==='discover');
 $('.coin-scanner').classList.toggle('explore-mode',state.view==='explore');
  document.querySelectorAll('[data-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===state.view)));
 document.querySelectorAll('[data-skip-rug]').forEach(input=>input.checked=state.skipRug);
 updateAutoButtons();
 $('#coin-list').innerHTML=state.view==='entry'?entryBoard(all):state.view==='discover'?cards(stages,all.filter(c=>c.launchpad).length,all.length):exploreCards(rows);
 const health=$('#market-health');if(health)health.textContent=state.historyLoaded?`${freshnessCounts(all,Date.now(),6)} · market freshness across these contracts${state.coverageNote}. Collection runs every 5m.`:state.historyError?'Collection unavailable; retained values may be stale.':'Loading market freshness…';
 $('#status').textContent=loading?'Loading shared server history…':state.notice||`${rows.length} coin groups · ${all.length} contracts · ${state.hours===120?'5D':state.hours+'H'} window`;
 document.querySelectorAll('[data-sort]').forEach(select=>select.value=state.sort);
 document.querySelectorAll('[data-open-screener]').forEach(button=>button.title=`Screener settings · minimum 24h volume $${state.screener.volume24h.toLocaleString('en-US')}`);
 document.querySelectorAll('[data-volume-min]').forEach(label=>label.textContent=state.screener.volume24h?`${money(state.screener.volume24h)}+`:'All vol');
 document.querySelectorAll('[data-entry]').forEach(input=>input.value=state.entry[input.dataset.entry]);
 updateFreshnessStatus();
 updateAvailable();
 renderDetail();
}
function applySnapshot(snapshot){
 const known=new Set(data.coins.map(coin=>coin.id)),newIds=state.historyLoaded?snapshot.coins.filter(coin=>!known.has(coin.id)).map(coin=>coin.id):[];
 if(highlightTimer)clearTimeout(highlightTimer);
 highlightIds=new Set(newIds);
 const hadHistory=state.historyLoaded;
 data.coins=snapshot.coins;state.historyLoaded=true;state.historyError=false;state.checkError=false;state.lastRun=snapshot.lastRun||0;state.revision=snapshot.revision||String(snapshot.lastRun||0);state.pendingSnapshot=null;
 state.coverageNote=sourceCoverageNote(snapshot);
 state.notice=snapshot.lastRun?`Server checked ${new Date(snapshot.lastRun).toLocaleString()}${sourceCoverageNote(snapshot)}.`:'The server is preparing its first collection.';
 if(hadHistory)preserveScroll(render);else render();
 if(newIds.length)highlightTimer=setTimeout(()=>{highlightIds.clear();document.querySelectorAll('.snapshot-new').forEach(node=>node.classList.remove('snapshot-new'));highlightTimer=null},5000);
}
async function getSnapshot(){
 const response=await fetch('/api/new-coins?view=coin',{cache:'no-store',signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw new Error('History unavailable');
 const snapshot=await response.json();if(!Array.isArray(snapshot.coins))throw new Error('Invalid history');return snapshot;
}
async function refresh(){
 if(loading)return;loading=true;
 document.querySelectorAll('#refresh,.full-refresh').forEach(button=>{button.disabled=true;button.textContent='Checking…'});
 try{const snapshot=await getSnapshot();loading=false;applySnapshot(snapshot)}
 catch{state.historyError=true;state.checkError=true;state.notice='Server history unavailable. Displayed snapshots were retained.';$('#status').textContent=state.notice;updateFreshnessStatus()}
 finally{loading=false;document.querySelectorAll('#refresh,.full-refresh').forEach(button=>{button.disabled=false;button.textContent='Refresh ↻'})}
}
async function poll(){
 if(document.hidden||pollInFlight||loading)return;
 pollInFlight=true;
 try{
  const response=await fetch('/api/new-coins/version',{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('Snapshot version unavailable');
  const version=await response.json();
  state.checkError=false;updateFreshnessStatus();
  if(version.revision!==state.revision&&version.revision!==(state.pendingSnapshot?.revision||String(state.pendingSnapshot?.lastRun||0))){
   const snapshot=await getSnapshot();
   if(state.freshEnabled)applySnapshot(snapshot);else{state.pendingSnapshot=snapshot;updateAvailable()}
  }
 }catch{state.checkError=true;updateFreshnessStatus()}finally{pollInFlight=false}
}
function setFresh(enabled){
 state.freshEnabled=enabled;
 if(freshTimer){clearInterval(freshTimer);freshTimer=null}
 if(enabled){if(state.pendingSnapshot)applySnapshot(state.pendingSnapshot);poll();freshTimer=setInterval(poll,AUTO_UPDATE_MS)}
 updateAutoButtons();updateFreshnessStatus();
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
  if(!coins.length){state.notice=`No Solana, Base, or Robinhood Chain pool found for “${query}”.`;return}
  data.manualCoins=[...new Map([...coins,...data.manualCoins].map(c=>[c.id,c])).values()];render();await enrich(coins);state.notice=`Found ${coins.length} market match${coins.length===1?'':'es'} for “${query}”.`;
 }catch{state.notice=`Could not investigate “${query}” right now.`}finally{loading=false;render()}
}
function setFull(enabled){document.body.classList.toggle('tiles-only',enabled);$('#full-mode').setAttribute('aria-pressed',String(enabled));$('#full-mode').textContent=enabled?'Exit Full':'Full';if(state.view==='entry')render()}
function setView(view){if(!['entry','discover','explore'].includes(view))return;state.view=view;try{localStorage.setItem(viewPreferenceKey,view)}catch{}if(view==='entry'&&!state.freshEnabled)setFresh(true);render()}
function setSort(value){state.sort=value;render()}
function openScreener(){
 for(const [key,value] of Object.entries(state.screener))$('#screener-settings').elements.namedItem(key).value=value;
 $('#screener-dialog').showModal();
}
function applyScreener(settings){
 state.screener=normalizeScreener(settings);
 try{localStorage.setItem(screenerPreferenceKey,JSON.stringify(state.screener))}catch{}
 $('#screener-dialog').close();
 render();
}
document.addEventListener('click',async event=>{
 if(event.target.closest('[data-open-screener]')){openScreener();return}
 if(event.target.closest('[data-close-screener]')){$('#screener-dialog').close();return}
 const period=event.target.closest('[data-hours]');if(period){state.hours=Number(period.dataset.hours);document.querySelectorAll('[data-hours]').forEach(x=>x.setAttribute('aria-pressed',String(x===period)));render();await refresh();return}
 const stageTab=event.target.closest('[data-stage-tab]');if(stageTab){state.activeStage=stageTab.dataset.stageTab;render();return}
 if(event.target.closest('[data-apply-update]')&&state.pendingSnapshot){applySnapshot(state.pendingSnapshot);return}
 if(event.target.closest('[data-fresh]')){setFresh(!state.freshEnabled);return}
 const view=event.target.closest('[data-view]');if(view){setView(view.dataset.view);return}
 const save=event.target.closest('[data-save-coin]');if(save){const coin=[...data.manualCoins,...data.coins].find(c=>c.id===save.dataset.saveCoin);if(coin){const saved=toggleSaved({type:'coin',id:coin.id,title:`$${coin.symbol} · ${coin.name}`,subtitle:`${coin.chain} · Snipe`,href:`./?contract=${encodeURIComponent(coin.contract_address)}`,image_url:coin.image_url,marketSnapshot:coin});document.querySelectorAll('[data-save-coin]').forEach(button=>{if(button.dataset.saveCoin===coin.id){button.setAttribute('aria-pressed',String(saved));button.textContent=saved?'Saved ✓':'Watchlist +'}})}return}
 const open=event.target.closest('[data-open-coin]');if(open){state.selectedId=open.dataset.openCoin;const coin=visibleRows.find(c=>c.id===state.selectedId);if(coin){$('#coin-detail-content').innerHTML=detailHtml(coin);$('#coin-detail').showModal()}return}
 if(event.target.closest('[data-close-detail]')){$('#coin-detail').close();return}
 const button=event.target.closest('[data-copy-ca]');if(!button)return;
 const coin=[...data.manualCoins,...data.coins].find(c=>c.id===button.dataset.copyCa),result=await copyContract(coin,navigator.clipboard);
 if(result.status==='copied'){button.classList.add('copied');button.setAttribute('aria-label','Contract copied');$('#ca-status').textContent='Contract copied.';setTimeout(()=>{if(!button.isConnected)return;button.classList.remove('copied');button.setAttribute('aria-label',`Copy ${coin.symbol} contract address`)},1800)}
 else if(result.status==='manual'){const input=$('#manual-ca');input.value=result.address;$('#ca-dialog').showModal();input.focus();input.select()}
});
document.addEventListener('error',event=>{if(event.target.matches?.('.coin-thumb img'))event.target.remove()},true);
window.addEventListener('storage',event=>{if(event.key==='meme-fast-watchlist-v1')document.querySelectorAll('[data-save-coin]').forEach(button=>{const saved=isSaved('coin',button.dataset.saveCoin);button.setAttribute('aria-pressed',String(saved));button.textContent=saved?'Saved ✓':'Watchlist +'})});
document.addEventListener('toggle',event=>{if(event.target.matches?.('.entry-holds'))state.holdsOpen=event.target.open},true);
$('#coin-detail').addEventListener('close',()=>{state.selectedId=null});
document.querySelectorAll('[data-sort]').forEach(select=>select.addEventListener('change',event=>setSort(event.target.value)));
document.querySelectorAll('[data-skip-rug]').forEach(input=>input.addEventListener('change',event=>{state.skipRug=event.target.checked;try{localStorage.setItem(skipRugPreferenceKey,String(state.skipRug))}catch{}render()}));
$('#screener-settings').addEventListener('submit',event=>{event.preventDefault();applyScreener(Object.fromEntries(new FormData(event.currentTarget)))});
$('#screener-reset').addEventListener('click',()=>applyScreener(DEFAULT_SCREENER));
document.querySelectorAll('[data-entry]').forEach(input=>input.addEventListener('change',event=>{state.entry=normalizeEntry({...state.entry,[event.target.dataset.entry]:event.target.value});try{localStorage.setItem(entryPreferenceKey,JSON.stringify(state.entry))}catch{}render()}));
$('#query').addEventListener('input',event=>{state.query=event.target.value;render()});$('#query').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();investigate()}});
$('#investigate').addEventListener('click',investigate);$('#refresh').addEventListener('click',refresh);$('#full-mode').addEventListener('click',()=>setFull(!document.body.classList.contains('tiles-only')));
$('.full-refresh').addEventListener('click',refresh);
$('.full-exit').addEventListener('click',()=>setFull(false));
document.addEventListener('keydown',event=>{if(event.key==='Escape'){setFull(false);$('.collection-info').open=false}});
$('#query').value=state.query;
setInterval(()=>{if(!state.freshEnabled)poll()},60000);setInterval(()=>{updateFreshnessStatus();if(state.view==='entry'&&!document.activeElement?.matches('[data-entry]')&&!$('#coin-detail').open){preserveScroll(render);return}document.querySelectorAll('[data-market-time]').forEach(node=>{const c=visibleRows.find(coin=>coin.id===node.dataset.marketId),fresh=marketState(c||{fetchedAt:Number(node.dataset.marketTime)});node.textContent=fresh.label;node.className=`freshness ${fresh.className}`})},15000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll()});
render();
if(state.view==='entry')setFresh(true);
refresh().then(()=>{
 if(contractQuery&&!data.coins.some(c=>String(c.contract_address).toLowerCase()===contractQuery.toLowerCase()))investigate();
});

void requestRefreshPriority(watchlist());
