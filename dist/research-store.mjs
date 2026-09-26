const WATCHLIST='meme-fast-watchlist-v1';
export function read(key,fallback=[]){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}}
export function write(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true}catch{return false}}
export function watchlist(){const items=read(WATCHLIST,[]);return Array.isArray(items)?items:[]}
export function isSaved(type,id){return watchlist().some(item=>item.type===type&&item.id===id)}
export function toggleSaved(item){const items=watchlist(),index=items.findIndex(x=>x.type===item.type&&x.id===item.id);if(index>=0)items.splice(index,1);else items.unshift({...item,savedAt:Date.now()});write(WATCHLIST,items);return index<0}
export function addSaved(item){const items=watchlist();if(items.some(x=>x.type===item.type&&x.id===item.id))return false;items.unshift({...item,savedAt:Date.now()});return write(WATCHLIST,items)}
export function removeSaved(type,id){write(WATCHLIST,watchlist().filter(item=>!(item.type===type&&item.id===id)))}
export function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
export function ago(time){if(!Number.isFinite(time))return 'Unknown';const delta=Math.max(0,Date.now()-time),minutes=Math.round(delta/60000);return minutes<60?`${minutes}m ago`:delta<86400000?`${Math.floor(delta/3600000)}h ago`:`${Math.floor(delta/86400000)}d ago`}
export function safeURL(value){try{const url=new URL(value);return url.protocol==='https:'?url.href:null}catch{return null}}
