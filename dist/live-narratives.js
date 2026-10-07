import {tokenActions as actions} from './token-actions.mjs?v=snipe-route-v1';
import {FEEDS,NETWORKS,buildPublicView,fetchPublicSource,mergeArticles,compareSnapshots,safeURL} from './public-radar.mjs';
import {contractForCopy,copyContract,axiomLink,fomoLink} from './contract-copy.mjs';
import {chainMarker} from './chain-marker.mjs';
import {SOURCE_KEY,loadSources} from './source-watchlist.mjs';
import {feedStatus} from './source-coverage.mjs';
import {loadXFactor} from './x-factor.mjs';
import {buildTweetView,tweetSocialBadge,newsExcerpt,tweetCoinMetrics,tweetCoinOneLiner} from './tweet-view.mjs';
import {buildEvidenceLinks} from './evidence-links.mjs';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>n===null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(n),num=n=>n===null?'—':n.toLocaleString('en-US');
const ago=time=>!Number.isFinite(time)?'Unknown':Math.max(0,Math.round((Date.now()-time)/60000))<60?`${Math.max(0,Math.round((Date.now()-time)/60000))}m ago`:(Date.now()-time)<86400000?`${Math.floor((Date.now()-time)/3600000)}h ago`:`${Math.floor((Date.now()-time)/86400000)}d ago`;
const state={hours:24,topic:'all',chain:'all',stage:'all',query:''};let expandedTrends=false,expandedCoins=false,loading=false,lastAttempt=0,toastTimer;
const dataset={articles:[],coins:[]},sourceState=new Map();let previous=null,current=null,baselineSet=false;
let xFactorReport={version:1,status:'disconnected',coins:{}};
const evidenceCache=new Map();
const coinContexts=new Map();
function loadCoinContexts(coins){
 const pending=coins.filter(c=>!coinContexts.has(c.id));
 for(const c of pending)coinContexts.set(c.id,null);
 if(!pending.length)return;
 Promise.allSettled(pending.map(async c=>{
  try{
   const response=await fetch(`/api/coin-context?id=${encodeURIComponent(c.id)}`,{cache:'no-store',signal:AbortSignal.timeout(12000)});
   if(response.ok)coinContexts.set(c.id,(await response.json()).context||null);
  }catch{}
 })).then(()=>render());
}
function read(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}}
function save(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true}catch{return false}}
function metrics(items){return `<dl class="signal-metrics">${items.map(([name,value])=>`<div><dt>${esc(name)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`}
function tokens(n){const links=buildEvidenceLinks([n],dataset.coins);return links.length?links.slice(0,3).map(link=>`<span class="token-match"><button type="button" class="evidence-pill ${link.level}" data-coin-evidence="${esc(link.coin.id)}">$${esc(link.coin.symbol)} · ${link.level==='exact'?'exact CA':'related lead'}</button>${chainMarker(link.coin)}</span>`).join(''):''}
function socialBadge(c){return tweetSocialBadge(xFactorReport,c.id,evidenceCache.get(c.id))}
function evidence(n){return n.posts.map(p=>`<article class="evidence-post"><div><span>${esc(p.publisher)}</span><time datetime="${new Date(p.time).toISOString()}">${esc(ago(p.time))}</time></div><p><a href="${esc(safeURL(p.url))}" target="_blank" rel="noopener noreferrer">${esc(p.title)} ↗</a></p></article>`).join('')}
function detail(title,body){$('#detail-title').textContent=title;$('#detail-body').innerHTML=body;if(!$('#detail-dialog').open)$('#detail-dialog').showModal()}
function empty(message){return `<p class="empty-state">${esc(message)}</p>`}
function render(){
 const view=buildTweetView(dataset,state);
 const links=buildEvidenceLinks(view.trends,view.coins);
 loadCoinContexts(expandedCoins?view.coins:view.coins.slice(0,3));
 $('#trend-count').textContent=view.trends.length;$('#coin-count').textContent=view.coins.length;$('#crossover-count').textContent=links.length;
 $('#filter-status').textContent=`${view.trends.length} news signals · ${view.coins.length} coins · ${state.hours===72?'3-day':state.hours+'H'} news window${state.topic!=='all'?' · topic: '+state.topic:''}${state.chain!=='all'?' · chain: '+state.chain:''}${state.stage!=='all'?' · '+(state.stage==='single'?'single publisher':'multiple publishers'):''} · market metrics: 24H`;
 $('#trends').innerHTML=(expandedTrends?view.trends:view.trends.slice(0,3)).map(n=>{
  const excerpt=newsExcerpt(n),sources=excerpt.sources.map(p=>safeURL(p.url)?`<a href="${esc(safeURL(p.url))}" target="_blank" rel="noopener noreferrer" title="${esc(p.title)}">${esc(p.publisher)} ↗</a>`:'').filter(Boolean);
  return `<article class="signal-card tweet-news-card"><div class="signal-top"><span class="rank">${String(n.rank).padStart(2,'0')}</span><div class="signal-name"><h3>${esc(n.title)}</h3></div></div><div class="tags"><span class="stage-tag">${n.stage===1?'Multiple publishers':'Single publisher'}</span>${tokens(n)}</div><p class="signal-summary">${esc(excerpt.text||'Publisher excerpt unavailable. Open the source article for the full story.')}</p>${sources.length?`<div class="news-source-links"><span>Publisher excerpts</span>${sources.join(' · ')}</div>`:''}<div class="news-coverage">${n.sources} publisher${n.sources===1?'':'s'} · ${n.mentions} article${n.mentions===1?'':'s'} · latest ${esc(ago(n.latest))}</div><div class="signal-bottom"><span>First observed article ${esc(ago(n.first))}</span><div class="signal-actions"><a class="text-button" href="./narrative.html?id=${encodeURIComponent(n.id)}">Open research ↗</a><button class="text-button" data-timeline="${n.id}">Quick timeline</button></div></div></article>`;
 }).join('')||empty(loading&&!dataset.articles.length?'Loading public news…':'No articles match this window and filters. Try 24H or 3D. Feed availability is shown above.');
 $('#coins').innerHTML=(expandedCoins?view.coins:view.coins.slice(0,3)).map(c=>{
  const related=links.filter(link=>link.coin.id===c.id),exact=related.filter(link=>link.level==='exact').length,m=tweetCoinMetrics(c),fomo=fomoLink(c),image=safeURL(c.image_url);
  const change=m.change24h==null?'—':`${m.change24h>0?'+':''}${m.change24h.toFixed(1)}%`;
  const stats=[['MC',money(m.mc),'Reported market cap; FDV is not substituted'],['Liquidity',money(m.liquidity),'Liquidity in the selected pool'],['Price · 24H',change,'Reported price change over 24 hours',m.change24h==null?'':m.change24h>0?'positive':m.change24h<0?'negative':''],['Vol · 24H',money(m.volume24h),'USD volume in the selected pool over 24 hours'],['Buyers · 24H',num(m.buyers24h),'Reported buyers in the selected pool over 24 hours'],['B/S · 24H',`${num(m.buys24h)} / ${num(m.sells24h)}`,'Buy / sell swap counts over 24 hours; not USD flow'],['Vol · 5m',money(m.volume5m),'USD volume in the selected pool over five minutes'],['B/S · 5m',`${num(m.buys5m)} / ${num(m.sells5m)}`,'Buy / sell swap counts over five minutes; not USD flow'],['Pool age',Number.isFinite(c.poolCreated)&&c.poolCreated>0&&c.poolCreated<=Date.now()?ago(c.poolCreated).replace(' ago',''):'—','Time since pool creation; not token launch age']];
  const portrait=`<span class="tweet-coin-avatar"><span>${esc(c.symbol.slice(0,1))}</span>${image?`<img src="${esc(image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:''}</span>`;
  const brief=tweetCoinOneLiner(coinContexts.get(c.id)||c.savedContext),oneLiner=brief?`<button type="button" class="tweet-coin-brief" data-coin-evidence="${esc(c.id)}" title="${esc(brief.label+': '+brief.text)}"><span>${esc(brief.label)}</span> ${esc(brief.text)}</button>`:'';
  return `<article class="signal-card tweet-coin-card"><div class="signal-top"><span class="rank">${String(c.rank).padStart(2,'0')}</span>${fomo?`<a href="${esc(fomo)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(c.symbol)} on Fomo">${portrait}</a>`:portrait}<div class="signal-name"><h3>$${esc(c.symbol)} ${chainMarker(c)}</h3><small>${esc(c.name)}</small></div>${oneLiner}${actions(c)}</div><dl class="tweet-coin-metrics">${stats.map(([name,value,title,tone=''])=>`<div><dt title="${esc(title)}">${name}</dt><dd class="${tone}">${esc(value)}</dd></div>`).join('')}</dl>${related.length?`<div class="coin-context">News links: ${exact} exact CA · ${related.length-exact} related lead${related.length-exact===1?'':'s'}</div>`:''}<div class="signal-bottom"><div class="tweet-coin-evidence">${socialBadge(c)}<span class="tweet-market-time${sourceState.get(c.network)?.status==='failed'?' cached':''}">${sourceState.get(c.network)?.status==='failed'?'Cached · ':''}Fetched ${esc(ago(c.fetchedAt))}</span></div><button type="button" class="text-button" data-coin-evidence="${esc(c.id)}">View evidence ↗</button></div></article>`;
 }).join('')||empty(loading&&!dataset.coins.length?'Loading market activity…':'No coins match these filters, or the market feed is unavailable. Try another coin chain or search term.');
 for(const [selector,count,expanded,noun] of [['#trends-more',view.trends.length,expandedTrends,'signals'],['#coins-more',view.coins.length,expandedCoins,'coins']]){const b=$(selector);b.hidden=count<=3;b.textContent=expanded?'Show top 3':`View all ${count} ${noun}`;b.setAttribute('aria-expanded',expanded)}
 $('#crossovers').innerHTML=links.slice(0,8).map(link=>`<button type="button" class="crossover-card" data-match="${esc(link.id)}"><span class="crossover-direction">NEWS ↔ COIN · ${link.level==='exact'?'EXACT CONTRACT':'RELATED LEAD'}</span><strong>$${esc(link.coin.symbol)} ${chainMarker(link.coin)} ↗</strong><span class="crossover-brief">${esc(link.narrative.title)} · ${esc(link.reason)}</span></button>`).join('')||'<p class="crossover-empty">No supported links between the current news and coin samples. Open a coin’s evidence to check indexed X posts.</p>';
 renderStatus();
 $('#x-coverage').textContent=xFactorReport.source==='google-news-rss'?xFactorReport.status==='connected'?`X RSS mentions: ${xFactorReport.coverage?.sampled??Object.keys(xFactorReport.coins||{}).length} / ${xFactorReport.coverage?.targeted??'?'} sampled coins; badges count indexed posts only.`:'X RSS sampling failed; mention counts are unavailable.':xFactorReport.status==='connected'?`X samples: ${xFactorReport.coverage?.sampled??Object.keys(xFactorReport.coins||{}).length} / ${xFactorReport.coverage?.targeted??'?'} monitored coins; open a badge for evidence.`:xFactorReport.status==='error'?'X collection failed; scores are unavailable.':'Account collection is inactive; open a coin’s evidence for indexed X mentions.';
}
function renderStatus(){
 $('#feed-status').innerHTML=[...FEEDS,...NETWORKS].map(s=>{const item=sourceState.get(s.id);return `<span class="feed-state ${item?.status==='failed'?'feed-failed':''}">${esc(s.name)}: ${item?item.status==='loaded'?`${item.count} ${s.url?'articles':'tokens'} · fetched ${esc(ago(item.at))}`:item.status==='failed'?esc(item.error)+(item.at?' · cached results retained':''):'loading':'waiting'}</span>`}).join('');
 $('#refresh-radar').disabled=loading;$('#refresh-radar').textContent=loading?'Refreshing…':'Refresh ↻';
}
function snapshot(){const view=buildPublicView(dataset,{hours:24});return {at:Date.now(),trends:view.trends.map(n=>({id:n.id,title:n.title,rank:n.rank})),coins:view.coins.map(c=>({id:c.id,title:'$'+c.symbol,rank:c.rank})),crossovers:view.crossovers.map(c=>({id:c.id,title:'$'+c.coin.symbol+' CA match'}))}}
function updateHistory(){
 if([...FEEDS,...NETWORKS].some(s=>sourceState.get(s.id)?.status!=='loaded'))return;
 if(!baselineSet){const value=read('meme-fast-public-snapshot-v1',null);previous=value&&['trends','coins','crossovers'].every(k=>Array.isArray(value[k])&&value[k].every(x=>x&&typeof x.id==='string'&&typeof x.title==='string'))?value:null;baselineSet=true}
 current=snapshot();save('meme-fast-public-snapshot-v1',current);
}
async function refresh(){
 if(loading)return;
 if(Date.now()-lastAttempt<60000){toast('Please allow one minute between refreshes.');return}
 loading=true;lastAttempt=Date.now();render();
 await Promise.allSettled([...FEEDS,...NETWORKS].map(async(s,index)=>{
  // Stagger market requests to respect the public provider's request budget.
  if(!s.url)await new Promise(resolve=>setTimeout(resolve,(index-FEEDS.length)*2200));
   const old=sourceState.get(s.id);sourceState.set(s.id,{...old,status:'loading',lastAttempt:Date.now()});renderStatus();
   try{const items=await fetchPublicSource(s),at=Date.now();sourceState.set(s.id,{...feedStatus(old,at,{records:items.length}),status:'loaded',count:items.length,at});
   if(s.url){dataset.articles=mergeArticles(dataset.articles,items);save('meme-fast-public-articles-v1',dataset.articles)}
   else {dataset.coins=[...dataset.coins.filter(c=>c.network!==s.id),...items];save('meme-fast-public-coins-v1',dataset.coins)}
   }catch(error){sourceState.set(s.id,{...feedStatus(old,Date.now(),{error:error.message||'Could not reach feed.'}),status:'failed'})}
  render();
 }));
 xFactorReport=await loadXFactor();
 loading=false;updateHistory();render();
}
function toast(message){$('#copy-status').textContent=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#copy-status').textContent='',4000)}
function showNarrative(id,timelineOnly=false){
 const n=buildTweetView(dataset,state).all.find(n=>n.id===id);if(!n)return;
 detail(n.title,`<div class="tags"><span class="stage-tag">${n.stage===1?'LC1 candidate':'LC0 raw news signal'}</span>${tokens(n)}</div><p class="detail-note">Public news coverage, not X-account spread. ${state.hours}H window. Grouped by shared headline terms; this is not semantic or bot analysis.</p>${metrics([['Publishers',n.sources],['Articles in window',n.mentions]])}${timelineOnly?`<ol class="timeline-list">${[...n.posts].reverse().map(p=>`<li><time>${esc(new Date(p.time).toLocaleString())}</time>${esc(p.publisher)} · <a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.title)} ↗</a></li>`).join('')}</ol>`:evidence(n)}`);
}
function showCoin(id){const c=dataset.coins.find(c=>c.id===id);if(!c)return;detail('$'+c.symbol+' · '+c.name,`<p class="detail-summary">${chainMarker(c)} ${esc(c.chain)} · GeckoTerminal-listed contract</p><div class="contract-detail">${actions(c)}<code>${esc(c.contract_address)}</code></div>${metrics([['Market cap',money(c.mc)],['FDV (separate)',money(c.fdv)],['Pool liquidity',money(c.liquidity)]])}${metrics([['Pool volume · 24H',money(c.volume)],['Pool buyers · 24H',num(c.buyers)],['Pool buys / sells',num(c.buys)+' / '+num(c.sells)]])}<p class="detail-note">Fetched ${esc(new Date(c.fetchedAt).toLocaleString())}. One selected pool per token; buyers are not summed across pools. Pool creation is not token launch time. Holder counts, holder growth, origin, lifecycle and social-account counts are unavailable. A provider-listed contract is not an authenticity or safety endorsement.</p><p class="detail-summary"><a target="_blank" rel="noopener noreferrer" href="https://www.geckoterminal.com/${c.network}/pools/${encodeURIComponent(c.pool)}">View source pool ↗</a></p>`)}
function indexedUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='news.google.com'&&/^\/rss\/articles\/[A-Za-z0-9_-]+$/.test(u.pathname)?u.href:null}catch{return null}}
function savedContextHtml(context){if(!context)return '<p class="detail-note">No saved context lead for this contract.</p>';
 const articles=Array.isArray(context.articles)?context.articles:[];
 if(articles.length)return articles.map(a=>safeURL(a.url)?`<p class="detail-summary"><a href="${esc(safeURL(a.url))}" target="_blank" rel="noopener noreferrer">${esc(a.title||'Read source')} ↗</a><small> · ${context.kind==='verified'?'Exact contract in source':'Related name in source; contract unverified'}</small></p>`:'').join('');
 if(context.profile)return `<p class="detail-note">Token profile linked to the exact contract: ${esc(context.profile.description||'No description provided')}. Profile text is supplied by the token project.</p>`;
 const web=context.web;
 if(web&&safeURL(web.url))return `<p class="detail-summary"><a href="${esc(safeURL(web.url))}" target="_blank" rel="noopener noreferrer">${esc(web.title||'Context source')} ↗</a></p><p class="detail-note">${esc(web.snippet||'')} ${esc(web.attribution||'Connection to this contract is unverified.')}</p>`;
 return '<p class="detail-note">No article lead in saved context.</p>';
}
function rssEvidenceHtml(report){
 if(!report||report.status==='error')return `<p class="detail-note">${esc(report?.message||'RSS sample is unavailable.')}</p>`;
 const posts=(report.posts||[]).filter(p=>indexedUrl(p.url));
 return `<p class="detail-summary"><strong>${esc(report.posts6h)} indexed X posts</strong> in the last 6h · ${esc(report.previousPosts6h)} in the prior 6h · ${report.cacheStatus==='stale'?'stale cache':'sampled '+esc(ago(report.sampledAt))}</p><p class="detail-note">${esc(report.exactPosts6h)} exact contract titles · ${esc(report.leadPosts6h)} alias/name leads. ${esc(report.coverage)}. ${report.status==='partial'?'Some queries failed.':''} Zero means none appeared in this RSS sample.</p>${posts.length?`<ul class="x-factor-posts">${posts.map(p=>`<li><a href="${esc(indexedUrl(p.url))}" target="_blank" rel="noopener noreferrer">${esc(p.title||'Indexed X post')} ↗</a><small>${esc(p.reason||'RSS query')} · ${esc(ago(p.publishedAt))}</small></li>`).join('')}</ul>`:''}`;
}
async function fetchCoinEvidence(id){
 const cached=evidenceCache.get(id);if(cached&&cached.until>Date.now())return cached.value;
 const response=await fetch('/api/coin-evidence',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id}),cache:'no-store',signal:AbortSignal.timeout(115000)});
 if(!response.ok)throw new Error(`RSS request HTTP ${response.status}`);
 const report=await response.json();evidenceCache.set(id,{value:report,until:Number(report.nextRefreshAt)||Date.now()+60_000});return report;
}
async function showCoinEvidence(id){
 const c=dataset.coins.find(coin=>coin.id===id);if(!c)return;
 const links=buildEvidenceLinks(buildTweetView(dataset,state).trends,dataset.coins).filter(link=>link.coin.id===id);
 const news=links.length?links.map(link=>`<article class="evidence-post"><div><span>${link.level==='exact'?'Exact contract':'Related lead'}</span><span>${esc(link.reason)}</span></div><p>${esc(link.narrative.title)}</p>${link.narrative.posts.filter(p=>safeURL(p.url)).slice(0,2).map(p=>`<a href="${esc(safeURL(p.url))}" target="_blank" rel="noopener noreferrer">${esc(p.publisher)} article ↗</a>`).join(' · ')}</article>`).join(''):'<p class="detail-note">No supported match in the current Decrypt and Cointelegraph sample.</p>';
 detail(`$${c.symbol} · evidence`,`<p class="detail-note">${esc(c.name)} · ${esc(c.chain)} · ${esc(c.contract_address)}. Exact contract references and related name leads are kept separate.</p><h3>Publisher news</h3>${news}<h3>Saved context</h3><div id="coin-context-detail"><p class="detail-note">Loading saved context…</p></div><h3>X RSS sample</h3><div id="coin-rss-detail"><p class="detail-note">Checking four-hour server cache…</p></div>`);
 const dialog=$('#detail-dialog');
 dialog.dataset.coinEvidence=id;
 const [context,rss]=await Promise.allSettled([
  fetch(`/api/coin-context?id=${encodeURIComponent(id)}`,{cache:'no-store',signal:AbortSignal.timeout(12000)}).then(async response=>{if(!response.ok)throw new Error('Context unavailable');return (await response.json()).context}),
  fetchCoinEvidence(id)
 ]);
 if(!dialog.open||dialog.dataset.coinEvidence!==id)return;
 $('#coin-context-detail').innerHTML=context.status==='fulfilled'?savedContextHtml(context.value):'<p class="detail-note">Saved context unavailable.</p>';
 $('#coin-rss-detail').innerHTML=rss.status==='fulfilled'?rssEvidenceHtml(rss.value):`<p class="detail-note">${esc(rss.reason?.message||'RSS sample unavailable.')}</p>`;
 if(rss.status==='fulfilled')render();
}
function showXFactor(id){showCoinEvidence(id)}
async function copy(button){const c=dataset.coins.find(c=>c.id===button.dataset.copyCa),result=await copyContract(c,navigator.clipboard);if(result.status==='copied'){button.classList.add('copied');button.setAttribute('aria-label','Contract copied');toast(`${c.symbol} CA copied (${c.chain}).`);setTimeout(()=>{if(!button.isConnected)return;button.classList.remove('copied');button.setAttribute('aria-label',`Copy ${c.symbol} contract address`)},1800)}else if(result.status==='manual'){$('#copy-address').value=result.address;$('#copy-note').textContent=`Copy ${c.symbol} on ${c.chain} below.`;$('#copy-dialog').showModal();$('#copy-address').focus();$('#copy-address').select()}else toast('No contract address is available.')}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-close'))b.closest('dialog').close();if(b.dataset.hours){state.hours=Number(b.dataset.hours);document.querySelectorAll('[data-hours]').forEach(x=>x.setAttribute('aria-pressed',x===b));render()}if(b.dataset.stage){state.stage=b.dataset.stage;document.querySelectorAll('[data-stage]').forEach(x=>x.setAttribute('aria-pressed',x===b));render()}if(b.dataset.evidence)showNarrative(b.dataset.evidence);if(b.dataset.timeline)showNarrative(b.dataset.timeline,true);if(b.dataset.coin)showCoin(b.dataset.coin);if(b.dataset.coinEvidence)showCoinEvidence(b.dataset.coinEvidence);if(b.dataset.xFactor)showXFactor(b.dataset.xFactor);if(b.dataset.copyCa)copy(b);if(b.dataset.match){const match=buildEvidenceLinks(buildTweetView(dataset,state).trends,buildTweetView(dataset,state).coins).find(c=>c.id===b.dataset.match);if(match)showCoinEvidence(match.coin.id)}});
$('#news-topic').onchange=e=>{state.topic=e.target.value;render()};$('#coin-chain').onchange=e=>{state.chain=e.target.value;render()};
$('#coin-chain').innerHTML='<option value="all">All chains</option>'+NETWORKS.map(n=>`<option value="${esc(n.name)}">${esc(n.name)}</option>`).join('');$('#radar-search').oninput=e=>{state.query=e.target.value;render()};
$('#trends-more').onclick=()=>{expandedTrends=!expandedTrends;render()};$('#coins-more').onclick=()=>{expandedCoins=!expandedCoins;render()};$('#refresh-radar').onclick=refresh;
$('#changes-open').onclick=()=>{const changes=current?compareSnapshots(previous,current):[];detail('What changed',!current?'<p class="detail-summary">Waiting for a complete successful refresh before comparing rankings. A failed feed is not counted as disappearing activity.</p>':`<p class="detail-summary">${previous?'Since '+esc(new Date(previous.at).toLocaleString())+'.':'First complete snapshot saved. Return later to compare.'}</p>${changes.length?`<ul class="changes-list">${changes.map(c=>`<li>${esc(c)}</li>`).join('')}</ul>`:previous?'<p>No ranking changes in the returned sample.</p>':''}<p class="detail-note">Uses the unfiltered 24H news view and 24H pool data. History is saved only in this browser.</p>`)};
$('#lifecycle-open').onclick=()=>detail('News coverage','<p class="detail-summary">Single publisher means a story appeared in one publisher feed (LC0). Multiple publishers means matching headlines appeared across publishers (LC1 candidate); syndication may still occur.</p><p class="detail-note">These feeds cannot establish meme formation, conversion, saturation, or decay (LC2–6), so those stages are not offered as filters. Coverage and topic filters affect news only. Coin rankings always use 24H buyers in one selected pool.</p>');
let sources=loadSources();
function renderSources(){$('#source-list').innerHTML=sources.length?sources.map(s=>`<div class="source-row"><div><strong><a href="https://x.com/${encodeURIComponent(s.handle.slice(1))}" target="_blank" rel="noopener noreferrer">${esc(s.handle)} ↗</a></strong><small>${esc(s.category)} · ${esc(s.group)} · weight ${s.weight}/5</small></div><button data-remove-source="${esc(s.handle)}" aria-label="Remove ${esc(s.handle)}">Remove</button></div>`).join(''):empty('No X accounts saved. Public news feeds work independently of this watchlist.')}
$('#sources-open').onclick=()=>{renderSources();$('#sources-dialog').showModal()};
$('#source-form').onsubmit=e=>{e.preventDefault();const handle='@'+$('#source-handle').value.replace(/^@/,'');if(sources.some(s=>s.handle.toLowerCase()===handle.toLowerCase())){$('#source-status').textContent='Account already saved.';return}sources.push({handle,category:$('#source-category').value,group:$('#source-group').value,weight:Number($('#source-weight').value)});const saved=save(SOURCE_KEY,sources);$('#source-status').textContent=saved?'Bookmark saved locally. Account collection is inactive.':'Saved for this session; browser storage is unavailable.';$('#source-handle').value='';renderSources()};
document.addEventListener('click',e=>{const b=e.target.closest('[data-remove-source]');if(b){sources=sources.filter(s=>s.handle!==b.dataset.removeSource);save(SOURCE_KEY,sources);renderSources()}});
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close()}}));
const cached=read('meme-fast-public-articles-v1',[]);
if(Array.isArray(cached))dataset.articles=mergeArticles([],cached.filter(p=>p&&typeof p.id==='string'&&safeURL(p.url)&&typeof p.title==='string'&&typeof p.summary==='string'&&typeof p.publisher==='string'&&Number.isFinite(p.time)&&FEEDS.some(f=>f.id===p.feed)));
render();refresh();setInterval(()=>{if(!document.hidden)refresh()},300000);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastAttempt>300000)refresh()});
