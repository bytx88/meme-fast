export const MAX_MEMBERS=30;
export const NETWORKS=['solana','robinhood','ethereum','base','bsc','arbitrum','polygon','avalanche','optimism'];
const EVM_ADDRESS=/^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function memberIdentity(member){
  const network=String(member?.network??member?.chain??'').trim().toLowerCase();
  let address=String(member?.contract_address??member?.address??'').trim();
  if(network!=='solana')address=address.toLowerCase();
  return `${network}:${address}`;
}
export function normalizeMember(input){
  const network=String(input?.network??input?.chain??'').trim().toLowerCase();
  let contract_address=String(input?.contract_address??input?.address??'').trim();
  if(!NETWORKS.includes(network))throw Error('Choose a supported chain.');
  if(!(network==='solana'?SOLANA_ADDRESS:EVM_ADDRESS).test(contract_address))throw Error(`Enter a valid ${network==='solana'?'Solana token':'EVM token'} contract address.`);
  if(network!=='solana')contract_address=contract_address.toLowerCase();
  const symbol=String(input?.symbol??'').trim(),name=String(input?.name??'').trim();
  if(!symbol||!name||symbol.length>32||name.length>100||/[\x00-\x1f\x7f]/.test(symbol+name))throw Error('Enter a symbol (1–32 characters) and name (1–100 characters).');
  return {network,contract_address,symbol,name};
}
export class BasketDraft{
  constructor(config){this.load(config)}
  load(config){
    if(!config||!Array.isArray(config.members)||!config.revision)throw Error('The saved basket response is incomplete. Reload the page to try again.');
    const members=config.members.map(normalizeMember);
    if(!members.length||members.length>MAX_MEMBERS||new Set(members.map(memberIdentity)).size!==members.length)throw Error('The saved basket is invalid.');
    this.saved=members;this.members=members.map(member=>({...member}));this.revision=config.revision;this.updatedAt=config.updatedAt??null;
  }
  get dirty(){return JSON.stringify(this.members)!==JSON.stringify(this.saved)}
  get weight(){return this.members.length?100/this.members.length:0}
  has(member){return this.members.some(row=>memberIdentity(row)===memberIdentity(member))}
  add(input){
    const member=normalizeMember(input);
    if(this.has(member))throw Error('That exact token is already in the draft basket.');
    if(this.members.length>=MAX_MEMBERS)throw Error(`The basket supports up to ${MAX_MEMBERS} members. Remove a member before adding another.`);
    this.members.push(member);return member;
  }
  remove(identity){
    if(!this.members.some(member=>memberIdentity(member)===identity))return;
    if(this.members.length===1)throw Error('Keep at least one member. Add a replacement before removing the last token.');
    this.members=this.members.filter(member=>memberIdentity(member)!==identity);
  }
  reset(){this.members=this.saved.map(member=>({...member}))}
  payload(){return {revision:this.revision,members:this.members.map(member=>({...member}))}}
}
const count=value=>finite(value)&&value>=0?new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(value):'Not provided by FOMO';
const percent=value=>finite(value)?`${value>=0?'+':''}${value.toFixed(2)}%`:'Unavailable';
const date=value=>finite(value)?new Date(value).toLocaleString():'Awaiting observation';
const points=value=>finite(value)?`${value>=0?'+':''}${value.toFixed(2)} pp`:'Delta unavailable';
const warmRemaining=(until,now)=>{
  if(!finite(until))return 'Awaiting a recorded activation time';
  const minutes=Math.ceil((until-now)/60000);
  if(minutes<=0)return 'Awaiting the next recorded 24H comparison';
  const hours=Math.floor(minutes/60),remainder=minutes%60;
  return `${hours?`${hours}h `:''}${remainder||!hours?`${remainder}m `:''}remaining`;
};
const reasonLabel=value=>({missing_quote:'No matching quote',source_unavailable:'Quote source unavailable',missing_pool:'No exact pool identity',missing_pool_age:'Pool age unavailable',unknown_pool_age:'Pool age unavailable',immature_pool:'Pool has less than one hour of history',missing_change:'1H return unavailable',missing_return:'1H return unavailable',extreme_change:'1H return outside accepted range',stale_quote:'Quote is stale',stale:'Quote is stale',invalid_change:'Invalid 1H return'}[value]??String(value??'Awaiting qualified quote').replaceAll('_',' '));
export function quoteState(row,now=Date.now()){
  if(!row)return {state:'pending',label:'Awaiting quote',note:'Collected after the basket is saved'};
  const observed=row.observedAt??row.marketObservedAt??row.priceObservedAt;
  if(row.exclusionReason==='awaiting_collection'||row.reason==='awaiting_collection')return {state:'pending',label:'Awaiting quote',note:'Collected after the basket is saved'};
  const eligible=row.eligible??row.qualified;
  if(eligible!==true||!finite(row.priceChange1h))return {state:'unavailable',label:'Unavailable',note:reasonLabel(row.exclusionReason??row.reason)};
  return {state:'qualified',label:percent(row.priceChange1h),note:`Qualified at last reading${finite(observed)?` · ${date(observed)}`:''}`};
}
export function renderComparison(comparison,now=Date.now(),saved=true){
  if(!saved)return '<span class="basket-comparison-state" data-state="pending">Not saved</span><small>Reference begins after Save changes</small>';
  if(!comparison)return '<span class="basket-comparison-state" data-state="pending">Awaiting collection</span>';
  if(comparison.status==='awaiting_history'){
    return '<span class="basket-comparison-state" data-state="pending">Recovering 24H history</span><small>Existing member · no new-member warmup</small>';
  }
  if(comparison.status==='pending'){
    return '<span class="basket-comparison-state" data-state="pending">Awaiting initial qualified quote</span><small>Comparison weight: 0%</small><small>24H warmup starts with the first qualified quote</small>';
  }
  if(comparison.status==='warming'){
    if(comparison.kind!=='added')return '<span class="basket-comparison-state" data-state="pending">Refreshing comparison status</span><small>Existing members do not restart a 24H warmup</small>';
    return `<span class="basket-comparison-state" data-state="warming">Warming</span><small>Neutral contribution: 0 pp · comparison weight: 0%</small><small>Initial 1H reference: ${finite(comparison.initialReturn)?escapeHTML(percent(comparison.initialReturn)):'awaiting quote'}</small><small${finite(comparison.warmUntil)?` title="Until ${escapeHTML(date(comparison.warmUntil))}"`:''}>${escapeHTML(warmRemaining(comparison.warmUntil,now))}</small>`;
  }
  if(comparison.status==='active'){
    return `<span class="basket-comparison-state" data-state="active">Active · ${escapeHTML(points(comparison.delta))}</span>${finite(comparison.weight)?`<small>Comparison weight: ${(comparison.weight*100).toFixed(2)}%</small>`:''}${finite(comparison.baselineReturn)?`<small>24H reference: ${escapeHTML(percent(comparison.baselineReturn))}</small>`:''}${comparison.baselineSource?`<small>${escapeHTML(String(comparison.baselineSource).replaceAll('_',' '))}</small>`:''}`;
  }
  return `<span class="basket-comparison-state" data-state="unavailable">Unavailable</span><small>${escapeHTML(comparison.reason?reasonLabel(comparison.reason):'Awaiting a qualified current quote and reference')}</small>`;
}
export function renderMembers(draft,quotes=new Map(),now=Date.now(),comparisons=new Map()){
  return draft.members.map(member=>{
    const identity=memberIdentity(member),quote=quoteState(quotes.get(identity),now);
    const saved=draft.saved.some(row=>memberIdentity(row)===identity);
    return `<tr><td><strong>${escapeHTML(member.symbol||member.name||'Unnamed token')}</strong>${member.name&&member.name!==member.symbol?`<small class="basket-token-name">${escapeHTML(member.name)}</small>`:''}<code>${escapeHTML(member.contract_address)}</code></td><td>${escapeHTML(member.network)}</td><td>${draft.weight.toFixed(2)}%</td><td><span class="basket-quote" data-state="${quote.state}">${escapeHTML(quote.label)}</span><small class="basket-quote-note">${escapeHTML(quote.note)}</small></td><td class="basket-comparison" data-comparison-member="${escapeHTML(identity)}">${renderComparison(comparisons.get(identity),now,saved)}</td><td><button type="button" data-remove-member="${escapeHTML(identity)}" aria-label="Remove ${escapeHTML(member.symbol||member.name||member.contract_address)} from draft">Remove</button></td></tr>`;
  }).join('');
}
export function renderSuggestions(rows,draft,now=Date.now()){
  return rows.map((row,index)=>{
    const included=draft.has(row),observed=row.observedAt??row.marketObservedAt;
    const quote=finite(row.priceChange1h)?percent(row.priceChange1h):'Not collected';
    const rank=Number.isInteger(row.rank)&&row.rank>0?`#${row.rank}`:'Unavailable';
    return `<article class="basket-suggestion"><header><h3>${escapeHTML(row.symbol||row.name||'Token candidate')}</h3><span>${escapeHTML(row.network)}</span></header>${row.name&&row.name!==row.symbol?`<p class="admin-note">${escapeHTML(row.name)}</p>`:''}<code class="suggestion-contract">${escapeHTML(row.contract_address)}</code><dl><div><dt>FOMO source rank</dt><dd>${escapeHTML(rank)}</dd></div><div><dt>Holders</dt><dd>${count(row.holders)}</dd></div><div><dt>Source</dt><dd>${escapeHTML(row.source||'FOMO most-held')}</dd></div><div><dt>1H quote</dt><dd>${escapeHTML(quote)}</dd></div></dl><p class="suggestion-observed">FOMO observed ${escapeHTML(date(observed))}</p><button type="button" data-add-suggestion="${index}"${included?' disabled':''}>${included?'In draft basket':'Add to draft'}</button></article>`;
  }).join('');
}
async function request(fetcher,url,options){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
  try{
    const response=await fetcher(url,{...options,signal:controller.signal});
    let body;try{body=await response.json()}catch{throw Error(`The server returned an unreadable response (${response.status}).`)}
    if(!response.ok){
      const detail=typeof body?.detail==='string'?body.detail:typeof body?.error==='string'?body.error:`Request failed (${response.status}).`;
      if(response.status===409)throw Error(`${detail} Your draft is preserved. Reload this page to review the latest saved basket before saving again.`);
      throw Error(detail);
    }
    return body;
  }catch(error){
    if(controller.signal.aborted)throw Error('The request timed out. Reload this page to check the latest saved status before retrying.');
    throw error;
  }finally{clearTimeout(timer)}
}
export function mountBasket(document,fetcher=globalThis.fetch.bind(globalThis)){
  const root=document.querySelector('.meme-basket-page');if(!root)return null;
  const get=id=>document.getElementById(id);
  let draft=null,quotes=new Map(),comparisons=new Map(),suggestions=[],busy=false,suggesting=false,refreshing=false;
  const status=(message,error=false)=>{get('basket-status').textContent=message;get('basket-status').dataset.error=String(error)};
  const render=()=>{
    if(!draft)return;
    get('basket-members').innerHTML=renderMembers(draft,quotes,Date.now(),comparisons);
    get('basket-count').textContent=String(draft.members.length);
    get('basket-weight').textContent=`${draft.weight.toFixed(2)}%`;
    const qualified=draft.members.filter(member=>quoteState(quotes.get(memberIdentity(member))).state==='qualified').length;
    get('basket-coverage').textContent=`${qualified}/${draft.members.length} qualified`;
    get('basket-title').textContent=draft.dirty?'Draft basket':'Saved basket';
    get('basket-draft-state').hidden=!draft.dirty;
    get('basket-version').textContent=`${draft.updatedAt?`Saved ${date(draft.updatedAt)} · `:''}Revision ${String(draft.revision).slice(0,12)}`;
    get('basket-save-note').textContent=draft.dirty?'Unsaved edits. Existing comparisons continue. Additions without a historical baseline contribute 0 pp for 24 hours, using their first 1H quote as the initial reference.':'The saved basket stays active while you edit.';
    get('basket-save').disabled=busy||refreshing||!draft.dirty;
    get('basket-reset').disabled=busy||!draft.dirty;
    get('basket-add').disabled=busy;
    get('basket-suggest').disabled=busy||suggesting;
    get('basket-refresh').disabled=busy||refreshing;
    for(const button of root.querySelectorAll('[data-remove-member]'))button.disabled=busy;
    get('basket-suggestions').innerHTML=renderSuggestions(suggestions,draft);
    if(busy)for(const button of get('basket-suggestions').querySelectorAll('button'))button.disabled=true;
  };
  get('basket-add-form').addEventListener('submit',event=>{
    event.preventDefault();if(!draft||busy)return;
    try{
      const member=draft.add({network:get('basket-network').value,contract_address:get('basket-contract').value,symbol:get('basket-symbol').value,name:get('basket-name').value});
      get('basket-contract').value='';get('basket-symbol').value='';get('basket-name').value='';
      status(`Added ${member.symbol||member.name||member.contract_address} to the draft. Press Save changes to apply it.`);render();
    }catch(error){status(error.message,true)}
  });
  get('basket-members').addEventListener('click',event=>{
    const button=event.target.closest?.('[data-remove-member]');if(!button||!draft||busy)return;
    try{draft.remove(button.dataset.removeMember);status('Member removed from the draft. Press Save changes to apply it.');render()}catch(error){status(error.message,true)}
  });
  get('basket-reset').addEventListener('click',()=>{if(!draft||busy)return;draft.reset();status('Draft reset to the saved basket.');render()});
  get('basket-refresh').addEventListener('click',async()=>{
    if(!draft||busy||refreshing)return;
    refreshing=true;get('basket-refresh').textContent='Refreshing…';status('Refreshing quote and comparison status…');render();
    try{
      const config=await request(fetcher,'/api/meme-preset');
      if(config.revision!==draft.revision)throw Error('The saved basket changed in another session. Your draft is preserved. Reload this page to review the latest membership.');
      new BasketDraft(config);
      quotes=new Map(config.members.filter(member=>member.quote).map(member=>[memberIdentity(member),member.quote]));
      comparisons=new Map(config.members.filter(member=>member.comparison).map(member=>[memberIdentity(member),member.comparison]));
      status(draft.dirty?'Latest quote and comparison status loaded. Your unsaved draft is preserved.':'Latest quote and comparison status loaded.');
    }catch(error){status(error.message,true)}finally{refreshing=false;get('basket-refresh').textContent='Refresh status';render()}
  });
  get('basket-save').addEventListener('click',async()=>{
    if(!draft||!draft.dirty||busy||refreshing)return;
    busy=true;status('Saving basket…');render();
    try{
      const saved=await request(fetcher,'/api/meme-preset',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(draft.payload())});
      draft.load(saved);quotes=new Map(saved.members.filter(member=>member.quote).map(member=>[memberIdentity(member),member.quote]));comparisons=new Map(saved.members.filter(member=>member.comparison).map(member=>[memberIdentity(member),member.comparison]));
      status(saved.refreshRequested===false?'Basket saved. An immediate refresh could not be requested; the next hourly collection will use this basket.':'Basket saved. A fresh collection has been requested. Existing comparisons continue; additions without a historical baseline stay neutral for 24 hours.');
    }catch(error){status(error.message,true)}finally{busy=false;render()}
  });
  get('basket-suggest').addEventListener('click',async()=>{
    if(!draft||busy||suggesting)return;
    suggesting=true;get('basket-suggest').textContent='Pulling FOMO…';get('basket-suggestion-status').textContent='Loading the FOMO most-held ranking…';render();
    try{
      const reply=await request(fetcher,'/api/meme-preset/suggest',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
      suggestions=(Array.isArray(reply.suggestions)?reply.suggestions:[]).flatMap(row=>{try{return [{source:reply.source||'FOMO most-held',observedAt:reply.observedAt,...row,...normalizeMember(row)}]}catch{return []}});
      get('basket-suggestion-status').textContent=suggestions.length?`${suggestions.length} candidates from ${reply.source||'FOMO most-held'}, observed ${date(reply.observedAt)}. Source order preserved. Add any to the draft, then Save changes.${reply.note?' '+reply.note:''}`:`FOMO returned no candidates. Your basket is unchanged.${reply.note?' '+reply.note:''}`;
    }catch(error){get('basket-suggestion-status').textContent=error.message}finally{suggesting=false;get('basket-suggest').textContent='Suggest';render()}
  });
  get('basket-suggestions').addEventListener('click',event=>{
    const button=event.target.closest?.('[data-add-suggestion]');if(!button||!draft||busy)return;
    const candidate=suggestions[Number(button.dataset.addSuggestion)];if(!candidate)return;
    try{draft.add(candidate);status(`Added ${candidate.symbol||candidate.name||candidate.contract_address} to the draft. Press Save changes to apply it.`);render()}catch(error){status(error.message,true)}
  });
  document.defaultView?.addEventListener('beforeunload',event=>{if(draft?.dirty){event.preventDefault();event.returnValue=''}});
  document.defaultView?.setInterval?.(()=>{
    if(!draft||document.hidden)return;
    for(const cell of root.querySelectorAll('[data-comparison-member]')){
      const identity=cell.dataset.comparisonMember,saved=draft.saved.some(member=>memberIdentity(member)===identity);
      cell.innerHTML=renderComparison(comparisons.get(identity),Date.now(),saved);
    }
  },60000);
  const ready=(async()=>{
    try{
      const config=await request(fetcher,'/api/meme-preset');
      draft=new BasketDraft(config);
      quotes=new Map(config.members.filter(member=>member.quote).map(member=>[memberIdentity(member),member.quote]));
      comparisons=new Map(config.members.filter(member=>member.comparison).map(member=>[memberIdentity(member),member.comparison]));
      status('Saved basket loaded. Add or remove members in a draft, then save when ready.');render();
    }catch(error){status(error.message,true)}
  })();
  return {ready,getDraft:()=>draft};
}
if(typeof document!=='undefined')mountBasket(document);
