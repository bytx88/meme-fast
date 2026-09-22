import {canonical,listingKey,uniqueListings,scopeTrades,summarize,sampleAvailability,formatUSD} from './core.mjs';
import {loadListings} from './data.mjs';
import {lookupTokens} from './lookup.mjs';
import {createRequestClient} from './requests.mjs';
import {renderCoverage,renderTimeline,setupTape} from './views.mjs';
import {toggleSaved,isSaved} from './research-store.mjs';
const renderTape=setupTape();
const $=id=>document.getElementById(id),api=createRequestClient();
const dexApi=createRequestClient({base:'https://api.dexscreener.com',interval:500,concurrency:2,timeout:8000,decode:value=>({data:Array.isArray(value)?value:value.pairs})});
const money=formatUSD;
const compact=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(n);
const short=s=>s.length>18?s.slice(0,7)+'…'+s.slice(-6):s;
const state={token:{address:'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',network:'solana',symbol:'BONK',name:'Bonk'},minutes:60,trades:[],pools:[],fetched:0,busy:false,generation:0,searchGeneration:0,searchBusy:false};
state.tokens=[state.token];state.scope='all';state.matches=[];state.draft=new Set();state.listings=[];state.searchResult='ready';state.searchedQuery='';
function error(message){$('error').textContent=message;$('error').hidden=!message}
function safeUrl(network,address,type='tokens'){return `https://www.geckoterminal.com/${encodeURIComponent(network)}/${type}/${encodeURIComponent(address)}`}
async function search(query){
  query=query.trim();if(query.length<2||query.length>160)throw new Error('Enter at least 2 characters of a ticker or contract address.');
  state.generation++;state.loadController?.abort();state.busy=false;state.searchResult='searching';state.searchedQuery=query;state.matches=[];state.draft.clear();$('dashboard').hidden=true;$('match-chooser').hidden=true;$('charts').setAttribute('aria-busy','false');$('refresh').disabled=false;state.searchController?.abort();const controller=new AbortController();state.searchController=controller;const generation=++state.searchGeneration;state.searchBusy=true;$('search-button').disabled=true;$('search-status').textContent='Finding matching tokens…';$('results').hidden=true;$('combine-controls').hidden=true;error('');
  try{const found=await lookupTokens(query,{gecko:api,dex:dexApi,signal:controller.signal,onStatus:message=>{if(generation===state.searchGeneration)$('search-status').textContent=message}});if(generation!==state.searchGeneration)return [];
    state.matches=uniqueListings(found);state.draft=new Set(state.matches.map(listingKey));
    $('results').replaceChildren();for(const token of state.matches){const row=document.createElement('div');row.className='result-choice';const label=document.createElement('label'),check=document.createElement('input'),copy=document.createElement('span');check.type='checkbox';check.value=listingKey(token);check.checked=state.draft.has(check.value);check.addEventListener('change',()=>{if(check.checked)state.draft.add(check.value);else state.draft.delete(check.value);updateSelection()});copy.className='result-copy';const main=document.createElement('strong');main.textContent=`${token.symbol} · ${token.name} · ${token.network}`;const meta=document.createElement('small');meta.textContent=`${token.unverified?'Unverified address':compact(token.liquidity)+' indexed liquidity'}`;const address=document.createElement('small');address.textContent=token.address;copy.append(main,meta,address);label.append(check,copy);const view=document.createElement('button');view.type='button';view.textContent='View only';view.setAttribute('aria-label',`View only ${token.symbol} on ${token.network} ${short(token.address)}`);view.addEventListener('click',()=>selectToken(token));row.append(label,view);$('results').append(row)}
    updateSelection();
    if(state.matches.length){
      state.searchResult='ready';
      $('results').hidden=false;$('combine-controls').hidden=state.matches.length<2;
      $('match-chooser').hidden=state.matches.length<2;$('match-chooser').open=false;
      $('match-chooser-label').textContent=`Change included listings (${state.matches.length} found)`;
      void selectListings(state.matches);
    }else{
      state.searchResult='empty';$('search-status').textContent=`No indexed result for “${query}”. Try the exact contract address or another ticker.`;
    }
    return state.matches.map(({symbol,name,network,address})=>({symbol,name,network,address}));
  }catch(e){if(generation===state.searchGeneration){state.searchResult='failed';$('search-status').textContent=`Search unavailable for “${query}”. Please try again.`;error(e.message)}return []}finally{if(generation===state.searchGeneration){state.searchBusy=false;$('search-button').disabled=false}}

}
function updateSelection(){for(const check of $('results').querySelectorAll('input'))check.checked=state.draft.has(check.value);$('combine-selected').textContent=`${state.draft.size>1?'Combine selected':'View selected'} (${state.draft.size})`;$('combine-selected').disabled=!state.draft.size}
function viewData(){const tokens=state.scope==='all'?state.tokens:state.tokens.filter(t=>listingKey(t)===state.scope),keys=new Set(tokens.map(listingKey));const pools=state.pools.filter(p=>p.targets.some(t=>keys.has(listingKey(t)))),listings=state.listings.filter(l=>keys.has(l.key));return {tokens,pools,listings,trades:scopeTrades(state.trades,tokens,state.scope),loaded:state.fetched>0&&pools.some(p=>p.status==='loaded'),missing:listings.filter(l=>l.status!=='loaded').length}}
function updateIdentity(){const tokens=viewData().tokens,t=tokens[0]||state.token,combined=tokens.length>1,symbols=[...new Set(tokens.map(t=>t.symbol.toUpperCase()))];$('symbol').textContent=combined?(symbols.length===1?symbols[0]:'Combined flow'):t.symbol;$('network').textContent=combined?`${tokens.length} listings · ${new Set(tokens.map(t=>t.network)).size} chains`:t.network;$('token-name').textContent=combined?'Combined USD flow of selected listings':t.name;$('address').textContent=combined?'Included contracts are listed below.':t.address;$('avatar').textContent=combined?'Σ':t.symbol.slice(0,1).toUpperCase();$('token-link').hidden=combined;$('token-link').href=safeUrl(t.network,t.address);document.title=`${combined?'Combined':t.symbol} Flow · Meme Fast`;
  $('save-token').hidden=combined;$('save-token').textContent=isSaved('token',listingKey(t))?'Saved ✓':'Save token';
  $('search-result-summary').hidden=!state.searchedQuery;
  $('result-mode').textContent=t.unverified?'CONTRACT NOT VERIFIED':combined?'COMBINED VIEW':'SINGLE LISTING';
  $('result-title').textContent=t.unverified?'Contract entered · Solana format':combined?`Showing ${tokens.length} listings together`:`Showing ${t.symbol} on ${t.network}`;
  $('result-note').textContent=t.unverified?t.lookupWarning:combined?'USD flow is combined across the listings below. Matching names may represent different tokens.':state.matches.length===1?'One matching listing found. The full contract address is shown below.':`One listing selected from ${state.matches.length} search matches.`;

  $('scope-tabs').hidden=state.tokens.length<2;$('scope-tabs').replaceChildren();if(state.tokens.length>1)for(const entry of [{key:'all',label:`All combined (${state.tokens.length})`},...state.tokens.map(t=>({key:listingKey(t),label:`${t.symbol} · ${t.network} · ${short(t.address)}`}))]){const button=document.createElement('button');button.type='button';button.textContent=entry.label;button.setAttribute('aria-pressed',String(state.scope===entry.key));button.addEventListener('click',()=>{state.scope=entry.key;updateIdentity();render()});$('scope-tabs').append(button)}
}
async function selectToken(token){return selectListings([token])}
async function selectListings(tokens){const selected=uniqueListings(tokens);if(!selected.length)throw new Error('Select at least one listing.');state.generation++;state.tokens=selected;state.draft=new Set(selected.map(listingKey));updateSelection();state.token=selected[0];state.scope='all';state.trades=[];state.pools=[];state.listings=[];state.skipped=0;state.loadError=false;state.fetched=0;state.searchResult='ready';$('dashboard').hidden=false;$('match-chooser').open=false;$('search-status').textContent=state.searchedQuery?`${state.matches.length} matching listing${state.matches.length===1?'':'s'} found for “${state.searchedQuery}”.`:'';updateIdentity();render();return load()}
async function load(){
  if(state.tokens.some(t=>t.unverified)){
    state.busy=false;state.fetched=Date.now();state.listings=state.tokens.map(t=>({...t,key:listingKey(t),status:'failed',error:t.lookupWarning}));
    $('search-status').textContent='Address received; token could not be verified.';render();error(state.token.lookupWarning);return currentSummary();
  }
  state.loadController?.abort();const controller=new AbortController();state.loadController=controller;
  const generation=++state.generation,tokens=[...state.tokens],hadData=state.pools.some(p=>p.status==='loaded');state.busy=true;state.loadError=false;state.progress='Fetching swaps…';$('refresh').disabled=true;$('charts').setAttribute('aria-busy','true');$('updated').textContent='Fetching swaps…';error('');render();
  try{const result=await loadListings(tokens,(path,options)=>api(path,{...options,signal:controller.signal}),message=>{if(generation===state.generation){state.progress=message;$('updated').textContent=message}},()=>generation===state.generation,snapshot=>{if(generation===state.generation&&(!hadData||snapshot.pools.some(p=>p.status==='loaded'))){Object.assign(state,snapshot);state.fetched=Date.now();render()}});
    if(!result||generation!==state.generation)return;
    if(hadData&&!result.pools.some(p=>p.status==='loaded')){state.loadError=true;error('Refresh failed. Showing the previous sample with its original update time.');return currentSummary()}
    Object.assign(state,result);state.fetched=Date.now();render();if(!result.pools.some(p=>p.status==='loaded')){const reason=result.listings.find(l=>l.error)?.error||result.pools.find(p=>p.error)?.error;if(reason)error(reason)}
    return currentSummary();
  }catch(e){if(generation===state.generation){state.loadError=true;render();error(e.message==='Failed to fetch'?'Cannot reach the data feed. It may be temporarily unavailable or rate-limited. Try again in a minute.':e.message)}return null}
  finally{if(generation===state.generation){state.busy=false;render();$('refresh').disabled=false;$('charts').setAttribute('aria-busy','false')}}
}
function emptyRow(text){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.className='table-empty';td.textContent=text;tr.append(td);return tr}
function currentSummary(){if(state.searchResult!=='ready')return {query:state.searchedQuery,listings:[],dataStatus:state.searchResult,buyUSD:null,sellUSD:null,netUSD:null,swapCount:0};const view=viewData(),now=state.fetched||Date.now(),s=summarize(view.trades,state.minutes,now),availability=sampleAvailability(view.trades,state.minutes,now);return {listings:view.tokens,view:state.scope,windowMinutes:state.minutes,buyUSD:s.rows.length?s.buy:null,sellUSD:s.rows.length?s.sell:null,netUSD:s.rows.length?s.net:null,swapCount:s.rows.length,dataStatus:view.loaded?availability.status:'unavailable',incompleteListings:view.missing,lastReturnedSwap:availability.lastTrade?new Date(availability.lastTrade.time).toISOString():null,coverage:'Recent swap sample, up to 300 swaps per pool from up to 3 pools per listing',updatedAt:state.fetched?new Date(state.fetched).toISOString():null}}
function render(){
  const view=viewData(),now=state.fetched||Date.now(),s=summarize(view.trades,state.minutes,now),loaded=view.loaded,available=loaded&&s.rows.length>0,availability=sampleAvailability(view.trades,state.minutes,now);
  $('empty-notice').hidden=!loaded||available;$('show-all').hidden=availability.status!=='outside-window';
  $('empty-title').textContent=availability.status==='outside-window'?'No swaps in this window':'No usable swaps returned';
  $('empty-detail').textContent=availability.lastTrade?`The feed returned ${availability.totalReturned} swaps in the past 24 hours. Latest: ${new Date(availability.lastTrade.time).toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone}). None is inside this window. This does not establish that the whole market was inactive.`:`The feed has no usable recent swaps for these pools. Market flow is unavailable; this is not evidence of zero trading.${state.skipped?` ${state.skipped} records could not be classified.`:''}`;
  document.querySelectorAll('[data-window]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.window)===state.minutes)));
  $('net-label').textContent=s.net<0?'Net sell volume':'Net buy volume';$('net-value').textContent=loaded?(Math.abs(s.net)>=100000?compact(Math.abs(s.net)):money(Math.abs(s.net))):'—';$('net-value').title=loaded?money(Math.abs(s.net)):'';$('swap-count').textContent=loaded?`${s.rows.length.toLocaleString()} observed swaps`:'Fetching actual swaps';
  $('net-value').dataset.empty=String(loaded&&!available);if(loaded&&!available){$('net-label').textContent='Selected window';$('net-value').textContent='No swaps';$('net-value').title='No observed trades from which to calculate flow';$('swap-count').textContent=availability.totalReturned?`${availability.totalReturned} returned across 24h`:'Feed has no usable data'}
  $('buy-value').textContent=available?money(s.buy):'—';$('sell-value').textContent=available?money(s.sell):'—';
  for(const side of ['buy','sell'])$(''+side+'-share').textContent=available?`${s[side+'Count'].toLocaleString()} swaps · ${s.total?(s[side]/s.total*100).toFixed(1):'0.0'}%`:loaded?'No observed swaps':'—';
  $('buy-ring').setAttribute('stroke-dasharray',`${s.total?s.buy/s.total*100:0} ${s.total?100-s.buy/s.total*100:100}`);$('sell-ring').style.opacity=s.total?'1':'0';$('donut').setAttribute('aria-label',loaded?`Observed buys ${money(s.buy)}, sells ${money(s.sell)}, net ${money(s.net)}.`:'Waiting for swap data');
  if(loaded&&!available)$('donut').setAttribute('aria-label','No observed swaps in the selected time window; market flow is unavailable.');
  const max=Math.max(...s.bands.flatMap(b=>[b.buy,b.sell]),Number.EPSILON);$('size-bars').replaceChildren();
  for(const band of s.bands){const row=document.createElement('div');row.className='size-row';for(const side of ['buy','label','sell']){const el=document.createElement('div');if(side==='label'){el.className='size-label';el.textContent=band.name;const small=document.createElement('small');small.textContent=band.label;el.append(small)}else{el.className='size-side';el.textContent=available?money(band[side]):'—';const track=document.createElement('div'),fill=document.createElement('div');track.className='bar-track';fill.className=`bar-fill ${side}`;fill.style.width=`${100*band[side]/max}%`;track.append(fill);el.append(track)}row.append(el)}$('size-bars').append(row)}
  if(loaded){const ok=view.pools.filter(p=>p.status==='loaded').length,capped=view.pools.filter(p=>p.count>=300).length;const stamp=t=>new Date(t).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});const span=s.rows.length?` Observed ${stamp(s.rows[s.rows.length-1].time)}–${stamp(s.rows[0].time)}.`:'';$('coverage-text').textContent=`${view.tokens.length} listing${view.tokens.length>1?'s':''} · ${ok} of ${view.pools.length} pools loaded · up to 3 pools per listing, 300 recent swaps per pool.${span} ${view.missing?`Partial coverage: ${view.missing} listing(s) have missing data. `:''}${capped?`${capped} pool${capped>1?'s':''} reached the 300-swap limit. `:''}Totals cover the returned sample, not the whole market.`;$('updated').textContent=`Updated ${new Date(state.fetched).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`}
  else{$('coverage-text').textContent='Loading indexed pools for selected listings.';$('updated').textContent='Loading swaps…'}
  $('pool-list').replaceChildren();for(const pool of view.pools){const a=document.createElement('a');a.href=safeUrl(pool.network,pool.address,'pools');a.target='_blank';a.rel='noopener noreferrer';a.textContent=`${pool.name} · ${pool.network} · ${pool.dex}${pool.failed?' · unavailable':''} ↗`;$('pool-list').append(a)}
  $('listing-coverage').hidden=state.tokens.length<2;$('listing-coverage').replaceChildren();for(const token of state.tokens){const result=state.listings.find(l=>l.key===listingKey(token)),a=document.createElement('a');a.href=safeUrl(token.network,token.address);a.target='_blank';a.rel='noopener noreferrer';a.title=token.address;const status=result?.status||'loading';a.className=status==='loaded'?'':'incomplete';const label={loaded:`${result?.successCount} pools loaded`,partial:`${result?.successCount}/${result?.poolCount} pools loaded`,failed:'Data unavailable','no-pools':'No indexed pools',loading:'Loading…'}[status];a.textContent=`${token.symbol} · ${token.network} · ${short(token.address)} — ${label} ↗`;$('listing-coverage').append(a)}
  if(state.fetched&&!loaded&&!state.busy){$('net-label').textContent='Flow unavailable';$('swap-count').textContent='No usable pool data';$('donut').setAttribute('aria-label','No usable pool data for this selection');$('updated').textContent='Data unavailable';$('coverage-text').textContent='No usable pool data returned for this selection. Missing data is not zero trading.';$('tape').replaceChildren(emptyRow('No usable pool data for this selection.'))}
  if(state.loadError){$('updated').textContent=loaded?'Refresh failed · previous snapshot':'Data unavailable';if(!loaded){$('net-label').textContent='Flow unavailable';$('swap-count').textContent='Could not load swaps';$('coverage-text').textContent='The latest request failed. No market-flow conclusion is available.';$('tape').replaceChildren(emptyRow('Data unavailable.'))}}
  renderCoverage(view,state,s.rows);
  renderTimeline(s.rows,state.minutes,now,loaded,state.busy);
  renderTape(s.rows,loaded,state.tokens.map(listingKey).join('|')+state.scope+state.minutes,state.busy);
  if(state.busy)$('updated').textContent=state.progress||'Loading swaps…';

}
$('search-form').addEventListener('submit',e=>{e.preventDefault();search($('query').value).catch(e=>error(e.message))});$('refresh').addEventListener('click',()=>state.tokens.some(t=>t.unverified)?search(state.searchedQuery):load());document.querySelectorAll('[data-window]').forEach(b=>b.addEventListener('click',()=>{state.minutes=Number(b.dataset.window);render()}));
$('show-all').addEventListener('click',()=>{state.minutes=1440;render()});
$('select-matches').addEventListener('click',()=>{state.draft=new Set(state.matches.map(listingKey));updateSelection()});
$('clear-matches').addEventListener('click',()=>{state.draft.clear();updateSelection()});
$('combine-selected').addEventListener('click',()=>selectListings(state.matches.filter(t=>state.draft.has(listingKey(t)))));
$('find-listings').addEventListener('click',()=>{const token=viewData().tokens[0]||state.token;$('query').value=token.symbol;search(token.symbol).catch(e=>error(e.message))});
$('save-token').addEventListener('click',()=>{const token=viewData().tokens[0]||state.token;if(state.tokens.length!==1)return;toggleSaved({type:'token',id:listingKey(token),title:`$${token.symbol} · ${token.name}`,subtitle:`${token.network} · ${short(token.address)}`,href:`./?query=${encodeURIComponent(token.address)}`});updateIdentity()});
setInterval(()=>{if(!document.hidden&&!state.busy&&!state.searchBusy&&state.searchResult==='ready'&&!state.tokens.some(t=>t.unverified)&&Date.now()-state.fetched>=60000)load()},60000);
const context=document.modelContext;
if(context?.registerTool){const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});for(const tool of [
  {name:'search_tokens',description:'Search indexed tokens and automatically show one match or the combined flow of multiple matches.',inputSchema:{type:'object',properties:{query:{type:'string',minLength:2,maxLength:160}},required:['query'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:async input=>{if(typeof input?.query!=='string'||input.query.trim().length<2||input.query.length>160)throw new Error('Enter a ticker or contract address between 2 and 160 characters.');$('query').value=input.query;return search(input.query)}},
  {name:'combine_listings',description:'Combine chosen current search results by chain:contract keys and show their USD flow.',inputSchema:{type:'object',properties:{listingKeys:{type:'array',items:{type:'string'},minItems:1,maxItems:12,uniqueItems:true}},required:['listingKeys'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:async input=>{const keys=input?.listingKeys;if(!Array.isArray(keys)||!keys.length||keys.length>12||keys.some(k=>typeof k!=='string'||!state.matches.some(t=>listingKey(t)===k)))throw new Error('Choose one or more listings from the current search results.');return selectListings(state.matches.filter(t=>keys.includes(listingKey(t))))}},
  {name:'read_observed_flow',description:'Read the currently displayed token swap sample and coverage.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>currentSummary()}
]){try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{})}catch{}}}
window.addEventListener('resize',()=>render());
updateIdentity();render();
const initialQuery=new URLSearchParams(location.search).get('query');
if(initialQuery){$('query').value=initialQuery;search(initialQuery).catch(e=>error(e.message))}else load();
