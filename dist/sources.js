import {write,esc} from './research-store.mjs';
import {SOURCE_KEY,loadSources} from './source-watchlist.mjs';
const key=SOURCE_KEY,$=id=>document.getElementById(id);let sources=loadSources();
function draw(){$('list').innerHTML=sources.length?sources.map(s=>`<div class="source-card"><div><strong><a href="https://x.com/${encodeURIComponent(s.handle.slice(1))}" target="_blank" rel="noopener noreferrer">${esc(s.handle)} ↗</a></strong><small>${esc(s.category)} · ${esc(s.group)} · weight ${Number(s.weight)}/5</small></div><div><span class="source-badge">NOT CONNECTED</span> <button type="button" data-remove="${esc(s.handle)}">Remove</button></div></div>`).join(''):'<div class="empty-workspace"><strong>No X accounts saved.</strong>Add accounts to define the collector’s future coverage.</div>'}
$('form').onsubmit=e=>{e.preventDefault();const handle='@'+$('handle').value.replace(/^@/,'');if(sources.some(s=>s.handle.toLowerCase()===handle.toLowerCase())){$('status').textContent='That account is already saved.';return}sources.push({handle,category:$('category').value,group:$('group').value,weight:Number($('weight').value)});write(key,sources);$('handle').value='';$('status').textContent='Account saved locally. Direct X account collection is not connected; X RSS mentions run separately.';draw()};
$('list').onclick=e=>{const button=e.target.closest('[data-remove]');if(button){sources=sources.filter(s=>s.handle!==button.dataset.remove);write(key,sources);draw()}};draw();

async function loadHealth(){
 const summary=$('health-summary'),feeds=$('health-feeds'),button=$('refresh-health');
 button.disabled=true;summary.textContent='Checking the latest server snapshot…';
 try{
  const response=await fetch('/api/new-coins?view=health',{cache:'no-store',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('Snapshot unavailable');
  const snapshot=await response.json(),entries=Object.entries(snapshot.feeds||{});
  if(!entries.length){summary.textContent='No feed attempts have been recorded yet.';feeds.innerHTML='';return}
  const updated=Number(snapshot.lastRun),failed=entries.filter(([,feed])=>feed.error).length;
  summary.textContent=`Last server collection: ${Number.isFinite(updated)?new Date(updated).toLocaleString():'pending'} · ${failed} feed${failed===1?'':'s'} degraded`;
  feeds.innerHTML=entries.map(([name,feed])=>{
   const label=name.replaceAll('_',' '),attempt=Number(feed.lastAttempt),success=Number(feed.lastSuccess),status=feed.status||'unknown';
   return `<div class="source-health-item"><strong>${esc(label)}</strong><span class="source-health-state ${esc(status)}">${esc(status)}</span><small>Last attempt ${Number.isFinite(attempt)&&attempt>0?esc(new Date(attempt).toLocaleTimeString()):'—'} · last success ${Number.isFinite(success)&&success>0?esc(new Date(success).toLocaleTimeString()):'—'}${feed.error?` · ${esc(String(feed.error).slice(0,120))}`:''}</small></div>`;
  }).join('');
 }catch{summary.textContent='Collection health is unavailable right now. Check Tweet or Swing for recent feed status.';feeds.innerHTML=''}
 finally{button.disabled=false}
}
$('refresh-health').addEventListener('click',loadHealth);
loadHealth();
