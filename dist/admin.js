import {CLASSES,walletState} from './followed-wallets.mjs';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=value=>Number.isFinite(value)&&value>0?new Date(value).toLocaleString():'—';
let report=null,failed=false,loading=false;
function render(){
 const rows=report?.wallets||[],query=$('query').value.trim().toLowerCase(),code=$('class-filter').value;
 const visible=rows.filter(row=>(!code||row.code===code)&&(!query||`${row.name} ${row.address}`.toLowerCase().includes(query)));
 const fresh=rows.filter(row=>walletState(row)==='fresh').length;
 $('count').textContent=`${visible.length} / ${rows.length} wallets`;
 $('status').textContent=failed?(report?'Status refresh failed. Last observations remain visible as stale.':'Tracked wallets unavailable. Retry Refresh status.'):report?`${rows.length} tracked wallets · ${fresh} fresh · ${rows.length-fresh} stale / unavailable${report.attemptedAt?` · Last collection attempt ${time(report.attemptedAt)}`:''}`:'Loading tracked wallets…';
 $('wallets').innerHTML=visible.length?visible.map(row=>{
  const state=walletState(row),address=esc(row.address),tokens=row.checkedAt&&Array.isArray(row.mints)?new Set(row.mints).size.toLocaleString():'—';
  return `<tr><td><strong>${esc(row.name)}</strong><small>Solana</small></td><td><b class="admin-class">${esc(row.code)}</b><small>${esc(CLASSES[row.code]||'Unknown class')}</small></td><td class="wallet-address"><a href="https://solscan.io/account/${address}" target="_blank" rel="noopener noreferrer"><code>${address}</code> ↗</a><button class="copy-wallet" type="button" data-copy="${address}" aria-label="Copy ${esc(row.name)} wallet address">Copy</button></td><td><span class="admin-state ${state}">${row.checkedAt?state[0].toUpperCase()+state.slice(1):'Awaiting check'}</span></td><td>${esc(time(row.checkedAt))}</td><td>${esc(time(row.attemptedAt))}</td><td>${tokens}${state==='stale'&&tokens!=='—'?'<small>Last complete sample</small>':''}</td></tr>`;
 }).join(''):`<tr><td class="admin-empty" colspan="7">${report?'No tracked wallets match these filters.':failed?'Wallet list unavailable.':'Loading…'}</td></tr>`;
}
async function refresh(){
 if(loading)return;
 loading=true;$('refresh').disabled=true;
 try{
  const response=await fetch('/api/followed-wallets',{cache:'no-store',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error();
  const next=await response.json();if(!Array.isArray(next.wallets))throw new Error();
  report=next;failed=false;
 }catch{failed=true;if(report)report={...report,wallets:report.wallets.map(row=>({...row,status:'unavailable'}))}}
 finally{loading=false;$('refresh').disabled=false;render()}
}
$('class-filter').insertAdjacentHTML('beforeend',Object.entries(CLASSES).map(([code,label])=>`<option value="${code}">${code} · ${esc(label)}</option>`).join(''));
$('legend').innerHTML=Object.entries(CLASSES).map(([code,label])=>`<span><b>${code}</b>${esc(label)}</span>`).join('');
$('refresh').addEventListener('click',refresh);
for(const id of ['query','class-filter'])$(id).addEventListener(id==='query'?'input':'change',render);
$('wallets').addEventListener('click',async event=>{
 const button=event.target.closest('[data-copy]');if(!button)return;
 try{await navigator.clipboard.writeText(button.dataset.copy);button.textContent='Copied ✓'}catch{button.textContent='Select address';$('status').textContent='Copy unavailable. Select and copy the visible address.'}
});
render();void refresh();
setInterval(()=>{if(!document.hidden)void refresh()},60000);

$('wallet-code').innerHTML=Object.entries(CLASSES).map(([code,label])=>`<option value="${code}">${code} · ${esc(label)}</option>`).join('');
$('add-wallet').addEventListener('click',()=>{
 $('add-wallet-form').reset();$('add-wallet-status').textContent='New wallets are checked during the next scheduled collection.';
 $('add-wallet-dialog').showModal();$('wallet-name').focus();
});
for(const id of ['close-wallet','cancel-wallet'])$(id).addEventListener('click',()=>$('add-wallet-dialog').close());
$('add-wallet-form').addEventListener('submit',async event=>{
 event.preventDefault();if($('save-wallet').disabled)return;
 const wallet={name:$('wallet-name').value.trim(),address:$('wallet-address').value.trim(),code:$('wallet-code').value};
 if(report?.wallets.some(row=>row.address===wallet.address)){$('add-wallet-status').textContent='This wallet is already tracked.';return}
 $('save-wallet').disabled=true;$('add-wallet-status').textContent='Saving wallet…';
 try{
  const response=await fetch('/api/followed-wallets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(wallet),signal:AbortSignal.timeout(20000)});
  const result=await response.json();if(!response.ok)throw new Error(result.detail||'Unable to save wallet. Try again.');
  if(!result.wallet?.address)throw new Error('Unable to confirm the saved wallet. Refresh status before retrying.');
  $('query').value='';$('class-filter').value='';$('add-wallet-dialog').close();await refresh();
  $('status').textContent=`${wallet.name} added. Holdings will appear after the next scheduled check.`;
 }catch(error){$('add-wallet-status').textContent=error.name==='TimeoutError'?'Save confirmation timed out. Refresh status before retrying.':error.message||'Unable to save wallet. Try again.'}
 finally{$('save-wallet').disabled=false}
});
