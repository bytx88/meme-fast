import {createWalletDiscovery} from './wallet-discovery.mjs';
import {createSmartness} from './smartness.mjs';
import {CLASSES,walletState} from './followed-wallets.mjs';
import {filterUniverse,moneyStatus} from './wallet-universe.mjs';
const $=id=>document.getElementById(id),short=v=>v.slice(0,7)+'…'+v.slice(-5);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=v=>Number.isFinite(v)&&v>0?new Date(v).toLocaleString():'—';
let report=null,failed=false,loading=false,editing=null;
const smartness=createSmartness({registry:()=>report?.wallets||[]});
async function api(path,options={}){
 const response=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(120000),...options});
 const value=await response.json();if(!response.ok)throw new Error(value.detail||'Request failed. Try again.');return value;
}
function render(){
 discovery?.render();
 const rows=report?.wallets||[],fresh=rows.filter(r=>walletState(r)==='fresh').length;
 $('total-stat').textContent=rows.length;$('interested-stat').textContent=rows.filter(r=>r.interested).length;$('fresh-stat').textContent=fresh;
 const visible=filterUniverse(rows,{query:$('query').value,source:$('source-filter').value,money:$('money-filter').value,interested:$('interest-filter').value,code:$('class-filter').value,status:$('state-filter').value,sort:$('sort').value});
 $('count').textContent=`${visible.length} / ${rows.length} wallets`;
 $('status').textContent=failed?'Registry refresh failed. Previously loaded entries may be outdated.':report?`${rows.length} wallets · ${rows.filter(r=>r.interested).length} Interested · ${fresh} fresh holdings checks`:'Loading wallet universe…';
 $('wallets').innerHTML=visible.length?visible.map(row=>{
  const address=esc(row.address),state=failed?'stale':walletState(row);
  return `<tr><td><strong>${esc(row.name)}</strong><a href="https://solscan.io/account/${address}" target="_blank" rel="noopener noreferrer"><code title="${address}">${esc(short(row.address))} ↗</code></a><small>${esc(row.notes)}</small></td><td><button type="button" data-interest="${address}" aria-pressed="${row.interested}" aria-label="Interested: ${esc(row.name)}">${row.interested?'★ Interested':'☆ Flag Interested'}</button></td><td>${esc(row.source)}<small>Sources: ${esc((row.sources||[row.source]).join(', '))}</small><small>${esc(row.label||'No source label')}</small>${row.discoveryToken?`<a class="discovery-token" href="./order-flow.html?query=${encodeURIComponent(row.discoveryToken)}">Discovery token ↗</a>`:''}</td><td><small>SmartMoney: ${row.smartMoney===true?'Yes':row.smartMoney===false?'No':'Unreviewed'}</small>${row.code?`<b class="admin-class">${esc(row.code)}</b><small>${esc(CLASSES[row.code])}</small>`:'Unclassified'}</td><td><span class="admin-state ${state}">${state==='fresh'?'Fresh':state==='stale'?'Stale':'Awaiting / unavailable'}</span><small>${esc(time(row.checkedAt))}</small></td><td>${row.checkedAt?row.mints.length:'—'}</td><td><button type="button" data-edit="${address}">Edit</button> <button type="button" data-analyze="${address}">Analyze</button></td></tr>`;
 }).join(''):`<tr><td colspan="7" class="admin-empty">${report?'No wallets match these filters.':failed?'Wallet universe unavailable.':'Loading…'}</td></tr>`;
 smartness.render();
}
async function refresh(){
 if(loading)return;loading=true;$('refresh').disabled=true;
 try{const next=await api('/api/wallet-universe');if(!Array.isArray(next.wallets))throw new Error();report=next;failed=false}catch{failed=true}
 finally{loading=false;$('refresh').disabled=false;render()}
}
function editor(row=null){
 editing=row?.address||null;$('add-wallet-form').reset();$('add-wallet-title').textContent=row?'Edit wallet':'Add wallet';
 for(const [id,key]of [['name','name'],['address','address'],['source','source'],['label','label'],['token','discoveryToken'],['code','code'],['notes','notes']])$('wallet-'+id).value=row?.[key]||((id==='source')?'Manual':'');
 $('wallet-money').value=moneyStatus(row||{});$('wallet-address').readOnly=Boolean(row);$('wallet-interested').checked=Boolean(row?.interested);$('add-wallet-status').textContent='SmartMoney, classification, sources and Interested are independent. Changing class or source does not change SmartMoney.';
 $('add-wallet-dialog').showModal();$('wallet-name').focus();
}
for(const id of ['class-filter','wallet-code'])$(id).insertAdjacentHTML('beforeend',Object.entries(CLASSES).filter(([code])=>code!=='I').map(([code,label])=>`<option value="${code}">${code} · ${esc(label)}</option>`).join(''));
for(const id of ['query','source-filter','interest-filter','money-filter','class-filter','state-filter','sort'])$(id).addEventListener(id==='query'?'input':'change',render);
$('reset-filters').addEventListener('click',()=>{for(const id of ['query','source-filter','interest-filter','money-filter','class-filter','state-filter'])$(id).value='';$('sort').value='name';render()});
$('refresh').addEventListener('click',refresh);$('add-wallet').addEventListener('click',()=>editor());
for(const id of ['close-wallet','cancel-wallet'])$(id).addEventListener('click',()=>$('add-wallet-dialog').close());
$('wallets').addEventListener('click',async event=>{
 const button=event.target.closest('button');if(!button)return;
 const address=button.dataset.edit||button.dataset.interest||button.dataset.analyze,row=report?.wallets.find(r=>r.address===address);if(!row)return;
 if(button.dataset.edit){editor(row);return}
 if(button.dataset.analyze){smartness.selectWallet(address);return}
 button.disabled=true;
 try{const saved=await api('/api/wallet-universe',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({address,interested:!row.interested})});Object.assign(row,saved.wallet);render();await refresh()}
 catch(error){$('status').textContent=error.message;button.disabled=false}
});
$('add-wallet-form').addEventListener('submit',async event=>{
 event.preventDefault();if($('save-wallet').disabled)return;$('save-wallet').disabled=true;
 const value={};for(const [id,key]of [['name','name'],['address','address'],['source','source'],['label','label'],['token','discoveryToken'],['code','code'],['notes','notes']])value[key]=$('wallet-'+id).value.trim();value.smartMoney=$('wallet-money').value==='smart'?true:$('wallet-money').value==='non-smart'?false:null;value.interested=$('wallet-interested').checked;
 try{await api('/api/wallet-universe',{method:editing?'PATCH':'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});$('add-wallet-dialog').close();await refresh()}
 catch(error){$('add-wallet-status').textContent=error.message}
 finally{$('save-wallet').disabled=false}
});

const discovery=createWalletDiscovery({registry:()=>report?.wallets||[],request:api,refresh});
void refresh();setInterval(()=>{if(!document.hidden)void refresh()},60000);
