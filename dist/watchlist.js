import {watchlist,removeSaved,addSaved,isSaved,write,esc,ago,safeURL} from './research-store.mjs';
import {NETWORKS,parsePools} from './public-radar.mjs';

const items=document.getElementById('items');
const count=document.getElementById('count');
const refresh=document.getElementById('refresh-stats');
const addButton=document.getElementById('add-token');
const addDialog=document.getElementById('add-token-dialog');
const addForm=document.getElementById('add-token-form');
const addQuery=document.getElementById('add-token-query');
const addStatus=document.getElementById('add-token-status');
const addResults=document.getElementById('add-token-results');
const market=new Map();
let matches=[];
let loading=false,loadError=false;

const key=id=>String(id).startsWith('solana:')?String(id):String(id).toLowerCase();
const number=value=>value===null||value===undefined||!Number.isFinite(Number(value))?null:Number(value);
const money=value=>number(value)===null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(Number(value));
const price=value=>number(value)===null?'—':`$${new Intl.NumberFormat('en-US',{maximumSignificantDigits:6,maximumFractionDigits:10}).format(Number(value))}`;
const change=value=>number(value)===null?'—':`${Number(value)>0?'+':''}${new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(Number(value))}%`;
function age(value){const time=number(value);if(time===null)return '—';const minutes=Math.max(0,Math.floor((Date.now()-time)/60000));return minutes<60?`${minutes}m`:minutes<1440?`${Math.floor(minutes/60)}h`:`${Math.floor(minutes/1440)}d`}

function tokenIcon(item,coin){
 const image=safeURL(coin?.image_url)||safeURL(item.image_url);
 const initial=String(item.title||'?').replace(/^\$+/,'').trim().slice(0,1).toUpperCase()||'?';
 return `<span class="saved-item-icon" aria-hidden="true"><span>${esc(initial)}</span>${image?`<img src="${esc(image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:''}</span>`;
}

function metric(label,value,extra=''){
 return `<div class="watch-metric"><span>${esc(label)}</span><strong class="${extra}">${esc(value)}</strong></div>`;
}

function stats(coin){
 if(!coin)return `<p class="watch-no-data">${loading?'Loading the latest collected snapshot…':loadError?'Market snapshot unavailable right now.':'No current market snapshot for this saved token.'}</p>`;
 const cap=number(coin.mc)>0?['Market cap',coin.mc]:number(coin.fdv)>0?['FDV',coin.fdv]:['Market cap',null];
 const buys=number(coin.buys5m),sells=number(coin.sells5m),trades=buys===null||sells===null?'—':`${buys.toLocaleString()} / ${sells.toLocaleString()}`;
 const daily=number(coin.priceChange);
 return `<div class="watch-stats">${metric('Price',price(coin.priceUsd))}${metric('24h',change(daily),daily===null?'':daily>=0?'watch-up':'watch-down')}${metric(cap[0],money(cap[1]))}${metric('Liquidity',money(coin.liquidity))}${metric('Vol 24h',money(coin.volume))}${metric('Vol 5m',money(coin.volume5m))}${metric('5m B / S',trades)}</div>`;
}

function tokenCard(item){
 const coin=market.get(key(item.id))||item.marketSnapshot;
 const contract=String(coin?.contract_address||item.id.split(':').slice(1).join(':'));
 const short=contract.length>14?`${contract.slice(0,6)}…${contract.slice(-4)}`:contract;
 const [chain,horizon]=String(item.subtitle||'').split(' · ');
 const updated=number(coin?.marketUpdatedAt)??number(coin?.priceUpdatedAt);
 const stale=updated===null||Date.now()-updated>15*60000;
 const detail=[chain||coin?.chain||'Token',horizon,short,coin?.poolCreated?`pool ${age(coin.poolCreated)}`:null,coin?(stale?'stale':`updated ${age(updated)}`):null].filter(Boolean).join(' · ');
 return `<article class="saved-item watch-token ${coin&&stale?'watch-stale':''}" title="${esc(contract)}"><div class="saved-item-main">${tokenIcon(item,coin)}<div class="saved-item-copy"><span class="kicker">${esc(item.type==='radar'?'Hodl':'Snipe')}</span><h2>${esc(item.title)}</h2><p>${esc(detail)}</p></div></div>${stats(coin)}<div class="saved-item-actions"><button type="button" data-remove="${esc(item.id)}" data-type="${esc(item.type)}">Remove</button></div></article>`;
}

function otherCard(item){
 return `<article class="saved-item"><div><span class="kicker">${esc(item.type)}</span><h2>${esc(item.title)}</h2><p>${esc(item.subtitle||'Saved research item')} · saved ${esc(ago(item.savedAt))}</p></div><div class="saved-item-actions"><a href="${esc(item.href)}">Open ↗</a><button type="button" data-remove="${esc(item.id)}" data-type="${esc(item.type)}">Remove</button></div></article>`;
}

function draw(){
 const saved=watchlist();
 count.textContent=`Watchlist · ${saved.length}`;
 refresh.disabled=loading||!saved.some(item=>item.type==='radar'||item.type==='coin');
 refresh.textContent=loading?'Refreshing…':'Refresh stats ↻';
 items.innerHTML=saved.length?saved.map(item=>item.type==='radar'||item.type==='coin'?tokenCard(item):otherCard(item)).join(''):'<div class="empty-workspace"><strong>Your research queue is empty.</strong>Save a token from Hodl or a narrative from Tweet to follow it here.</div>';
}

async function loadStats(refreshMissing=false){
 const saved=watchlist();
 const ids=[...new Set(saved.filter(item=>item.type==='radar'||item.type==='coin').map(item=>item.id))];
 if(!ids.length){draw();return}
 loading=true;loadError=false;draw();
 try{
  const batches=Array.from({length:Math.ceil(ids.length/30)},(_,index)=>ids.slice(index*30,index*30+30));
  const results=await Promise.all(batches.map(async batch=>{
   const params=new URLSearchParams({view:'watchlist'});
   batch.forEach(id=>params.append('id',id));
   const response=await fetch(`/api/new-coins?${params}`,{cache:'no-store',signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new Error('Market snapshot unavailable');
   return response.json();
  }));
  market.clear();
  for(const result of results){
   for(const coin of result.coins||[])market.set(key(coin.id),coin);
  }
  if(refreshMissing){
   const missing=saved.filter(item=>item.marketSnapshot&&!market.has(key(item.id)));
   const queue=[...missing];
   await Promise.all(Array.from({length:Math.min(3,queue.length)},async()=>{
    while(queue.length){
     const item=queue.shift(),[networkId,contract]=item.id.split(':');
     const network=NETWORKS.find(entry=>entry.id===networkId);
     if(!network||!contract)continue;
     try{
      const response=await fetch(`/api/market/networks/${encodeURIComponent(networkId)}/tokens/${encodeURIComponent(contract)}/pools`,{signal:AbortSignal.timeout(15000)});
      if(!response.ok)continue;
      const coin=parsePools(await response.json(),network).find(entry=>key(entry.id)===key(item.id));
      if(coin){market.set(key(item.id),coin);item.marketSnapshot=coin}
     }catch{}
    }
   }));
  }
  let changed=false;
  for(const item of saved){
   const image=safeURL(market.get(key(item.id))?.image_url);
   if((item.type==='radar'||item.type==='coin')&&!safeURL(item.image_url)&&image){item.image_url=image;changed=true}
   if(item.marketSnapshot&&market.has(key(item.id))){item.marketSnapshot=market.get(key(item.id));changed=true}
  }
  if(changed)write('meme-fast-watchlist-v1',saved);
 }catch{loadError=true}
 finally{loading=false;draw()}
}

items.onclick=event=>{const button=event.target.closest('[data-remove]');if(button){removeSaved(button.dataset.type,button.dataset.remove);draw()}};
refresh.onclick=()=>loadStats(true);
function drawMatches(){
 addResults.innerHTML=matches.map((coin,index)=>`<div class="add-result"><div class="add-result-copy"><strong>${esc(coin.symbol)} · ${esc(coin.name)}</strong><small>${esc(coin.chain)} · ${esc(coin.contract_address)} · Liq ${esc(money(coin.liquidity))}</small></div><button type="button" data-add-index="${index}" ${isSaved('radar',coin.id)?'disabled':''}>${isSaved('radar',coin.id)?'Saved':'Add'}</button></div>`).join('');
}
addButton.onclick=()=>{addDialog.showModal();addQuery.focus()};
document.getElementById('close-add-token').onclick=()=>addDialog.close();
addForm.onsubmit=async event=>{
 event.preventDefault();const query=addQuery.value.trim();if(!query)return;
 addStatus.textContent='Searching trading pools…';addResults.innerHTML='';matches=[];
 try{
  const response=await fetch(`/api/market/search/pools?query=${encodeURIComponent(query)}`,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Search unavailable');
  const payload=await response.json();
  const normalized=query.toLowerCase().replace(/[^a-z0-9]/g,'');
  const exact=coin=>[coin.symbol,coin.name,coin.contract_address].some(value=>String(value).toLowerCase().replace(/[^a-z0-9]/g,'')===normalized);
  matches=NETWORKS.flatMap(network=>parsePools({...payload,data:(payload.data||[]).filter(pool=>String(pool.id||'').startsWith(`${network.id}_`))},network)).sort((a,b)=>Number(exact(b))-Number(exact(a))||(b.liquidity||0)-(a.liquidity||0)).slice(0,12);
  addStatus.textContent=matches.length?`Choose the exact token and chain (${matches.length} matches).`:'No trading pool found on Solana, Base, or Robinhood Chain.';
  drawMatches();
 }catch{addStatus.textContent='Search is unavailable. Try again in a moment.'}
};
addResults.onclick=event=>{
 const button=event.target.closest('[data-add-index]');if(!button)return;
 const coin=matches[Number(button.dataset.addIndex)];if(!coin)return;
 const item={type:'radar',id:coin.id,title:`$${coin.symbol} · ${coin.name}`,subtitle:`${coin.chain} · Manual`,image_url:coin.image_url,marketSnapshot:coin};
 if(addSaved(item)){market.set(key(coin.id),coin);draw();addStatus.textContent=`${coin.symbol} added to Watchlist.`}
 drawMatches();
};
document.addEventListener('error',event=>{if(event.target.matches?.('.saved-item-icon img'))event.target.remove()},true);
window.addEventListener('storage',event=>{if(event.key==='meme-fast-watchlist-v1'){draw();loadStats()}});
draw();
loadStats();
