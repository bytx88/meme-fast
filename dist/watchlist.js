import {watchlist,removeSaved,write,esc,ago,safeURL} from './research-store.mjs';

const items=document.getElementById('items'),count=document.getElementById('count');
const recoveredIcons=new Map();

function tokenIcon(item){
 const image=safeURL(item.image_url)||recoveredIcons.get(String(item.id).toLowerCase());
 const initial=String(item.title||'?').replace(/^\$+/,'').trim().slice(0,1).toUpperCase()||'?';
 return `<span class="saved-item-icon" aria-hidden="true"><span>${esc(initial)}</span>${image?`<img src="${esc(image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:''}</span>`;
}

function draw(){
 const saved=watchlist();
 count.textContent=`Watchlist · ${saved.length}`;
 items.innerHTML=saved.length?saved.map(item=>`<article class="saved-item"><div class="saved-item-main">${item.type==='radar'||item.type==='coin'?tokenIcon(item):''}<div class="saved-item-copy"><span class="kicker">${esc(item.type)}</span><h2>${esc(item.title)}</h2><p>${esc(item.subtitle||'Saved research item')} · saved ${esc(ago(item.savedAt))}</p></div></div><div class="saved-item-actions"><a href="${esc(item.href)}">Open ↗</a><button type="button" data-remove="${esc(item.id)}" data-type="${esc(item.type)}">Remove</button></div></article>`).join(''):'<div class="empty-workspace"><strong>Your research queue is empty.</strong>Open a narrative from Tweet and save it here for follow-up.<br><br><a href="./narratives.html">Browse incoming narratives ↗</a></div>';
}

async function recoverSavedIcons(){
 const missing=watchlist().filter(item=>item.type==='radar'&&!safeURL(item.image_url));
 if(!missing.length)return;
 try{
  const response=await fetch('/api/new-coins?view=radar',{cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!response.ok)return;
  const snapshot=await response.json();
  const wanted=new Set(missing.map(item=>String(item.id).toLowerCase()));
  for(const coin of snapshot.radarCoins||[]){
   const id=String(coin.id||'').toLowerCase(),image=safeURL(coin.image_url);
   if(wanted.has(id)&&image)recoveredIcons.set(id,image);
  }
  const saved=watchlist();
  let changed=false;
  for(const item of saved){
   const image=recoveredIcons.get(String(item.id).toLowerCase());
   if(item.type==='radar'&&!safeURL(item.image_url)&&image){item.image_url=image;changed=true}
  }
  if(changed)write('meme-fast-watchlist-v1',saved);
  draw();
 }catch{}
}

items.onclick=e=>{const button=e.target.closest('[data-remove]');if(button){removeSaved(button.dataset.type,button.dataset.remove);draw()}};
document.addEventListener('error',event=>{if(event.target.matches?.('.saved-item-icon img'))event.target.remove()},true);
window.addEventListener('storage',event=>{if(event.key==='meme-fast-watchlist-v1'){draw();recoverSavedIcons()}});
draw();
recoverSavedIcons();
