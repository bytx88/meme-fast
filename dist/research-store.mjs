import {requestRefreshPriority} from './refresh-priority.mjs';
const WATCHLIST='meme-fast-watchlist-v1';
export function read(key,fallback=[]){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}}
export function write(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true}catch{return false}}
export function watchlist(){const items=read(WATCHLIST,[]);if(!Array.isArray(items))return [];const unique=[];for(const item of items){if(item&&typeof item==='object'&&!unique.some(existing=>sameItem(existing,item)))unique.push(item)}return unique}
const tokenTypes=new Set(['radar','coin','token']);
const sameItem=(a,b)=>a.id===b.id&&(a.type===b.type||tokenTypes.has(a.type)&&tokenTypes.has(b.type));
export function isSaved(type,id){return watchlist().some(item=>sameItem(item,{type,id}))}
export function toggleSaved(item){const items=watchlist(),exists=items.some(x=>sameItem(x,item));const next=exists?items.filter(x=>!sameItem(x,item)):[{...item,savedAt:Date.now()},...items];write(WATCHLIST,next);if(!exists)void requestRefreshPriority([item]);return !exists}
export function addSaved(item){const items=watchlist();if(items.some(x=>sameItem(x,item)))return false;items.unshift({...item,savedAt:Date.now()});const saved=write(WATCHLIST,items);if(saved)void requestRefreshPriority([item]);return saved}
export function removeSaved(type,id){const target={type,id};write(WATCHLIST,watchlist().filter(item=>!sameItem(item,target)))}
export function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
export function ago(time){if(!Number.isFinite(time))return 'Unknown';const delta=Math.max(0,Date.now()-time),minutes=Math.round(delta/60000);return minutes<60?`${minutes}m ago`:delta<86400000?`${Math.floor(delta/3600000)}h ago`:`${Math.floor(delta/86400000)}d ago`}
export function safeURL(value){try{const url=new URL(value);return url.protocol==='https:'?url.href:null}catch{return null}}
