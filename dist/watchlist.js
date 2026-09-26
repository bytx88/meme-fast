import {watchlist,removeSaved,write,esc,ago,safeURL} from './research-store.mjs';

const items=document.getElementById('items');
const count=document.getElementById('count');
const refresh=document.getElementById('refresh-stats');
const market=new Map();
let lastRun=null,loading=false,loadError=false;

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
 const daily=number(coin.priceChange),updated=number(coin.marketUpdatedAt)??number(coin.priceUpdatedAt);
 const stale=updated===null||Date.now()-updated>15*60000;
 return `<div class="watch-stats">${metric('Price',price(coin.priceUsd))}${metric('24h change',change(daily),daily===null?'':daily>=0?'watch-up':'watch-down')}${metric(cap[0],money(cap[1]))}${metric('Liquidity',money(coin.liquidity))}${metric('24h volume',money(coin.volume))}${metric('5m volume',money(coin.volume5m))}${metric('5m buys / sells',trades)}${metric('Pool age',age(coin.poolCreated))}</div><p class="watch-data-note ${stale?'watch-stale':''}">${stale?'Market data stale':'Market updated '+age(updated)+' ago'}${lastRun?' · Snapshot collected '+age(lastRun)+' ago':''}</p>`;
}

function tokenCard(item){
 const coin=market.get(key(item.id));
 return `<article class="saved-item watch-token"><div class="watch-token-head"><div class="saved-item-main">${tokenIcon(item,coin)}<div class="saved-item-copy"><span class="kicker">${esc(item.type==='radar'?'Hodl':'Snipe')}</span><h2>${esc(item.title)}</h2><p>${esc(item.subtitle||'Saved token')} · saved ${esc(ago(item.savedAt))}</p></div></div><div class="saved-item-actions"><button type="button" data-remove="${esc(item.id)}" data-type="${esc(item.type)}">Remove</button></div></div>${stats(coin)}</article>`;
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

async function loadStats(){
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
   lastRun=result.lastRun??lastRun;
   for(const coin of result.coins||[])market.set(key(coin.id),coin);
  }
  let changed=false;
  for(const item of saved){
   const image=safeURL(market.get(key(item.id))?.image_url);
   if((item.type==='radar'||item.type==='coin')&&!safeURL(item.image_url)&&image){item.image_url=image;changed=true}
  }
  if(changed)write('meme-fast-watchlist-v1',saved);
 }catch{loadError=true}
 finally{loading=false;draw()}
}

items.onclick=event=>{const button=event.target.closest('[data-remove]');if(button){removeSaved(button.dataset.type,button.dataset.remove);draw()}};
refresh.onclick=loadStats;
document.addEventListener('error',event=>{if(event.target.matches?.('.saved-item-icon img'))event.target.remove()},true);
window.addEventListener('storage',event=>{if(event.key==='meme-fast-watchlist-v1'){draw();loadStats()}});
draw();
loadStats();
