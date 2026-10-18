import {formatSmartNumber} from './smart-number.mjs';
import {filterUniverse} from './wallet-universe.mjs';
export function summarizeSmartness(report,registry,{minutes=1440,quote='SOL',interested='',source='',wallet='',token='',rank='buy'}={},now=Date.now()){
 const members=filterUniverse(registry,{interested,source}).filter(row=>!wallet||row.address===wallet),known=new Map(members.map(row=>[row.address,row]));
 const seen=new Set(),events=[];
 for(const event of report?.events||[]){
  const amount=Number(event.quoteAmount),quantity=Number(event.quantity);
  if(!known.has(event.address)||event.quote!==quote||(token&&event.mint!==token)||!['buy','sell'].includes(event.side)||!Number.isFinite(event.time)||event.time<now-minutes*60000||event.time>now||!Number.isFinite(amount)||amount<=0||!Number.isFinite(quantity)||quantity<=0||typeof event.id!=='string'||seen.has(event.id))continue;
  seen.add(event.id);events.push({...event,amount});
 }
 const empty=()=>({buy:0,sell:0,net:0,buyCount:0,sellCount:0});
 const wallets=new Map(members.map(row=>[row.address,{...row,...empty()}])),tokens=new Map(),total=empty();
 for(const event of events){
  if(!tokens.has(event.mint))tokens.set(event.mint,{mint:event.mint,...empty(),buyers:new Set(),sellers:new Set()});
  for(const row of [wallets.get(event.address),tokens.get(event.mint),total]){row[event.side]+=event.amount;row[event.side+'Count']++;row.net=row.buy-row.sell;}
  tokens.get(event.mint)[event.side==='buy'?'buyers':'sellers'].add(event.address);
 }
 const compare=(a,b)=>rank==='out'?a.net-b.net:rank==='net'?b.net-a.net:b[rank]-a[rank];
 return {wallets:[...wallets.values()].filter(row=>!token||row.buyCount+row.sellCount>0).sort((a,b)=>Number(b.buyCount+b.sellCount>0)-Number(a.buyCount+a.sellCount>0)||compare(a,b)||a.name.localeCompare(b.name)),tokens:[...tokens.values()].sort((a,b)=>compare(a,b)||a.mint.localeCompare(b.mint)),events:events.sort((a,b)=>b.time-a.time),total};
}
export function createSmartness({registry=()=>[]}={}){
 const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),short=v=>v.slice(0,6)+'…'+v.slice(-5),stamp=v=>v?new Date(v).toLocaleString():'Not scanned';
 let report=null,error='',loading=false,requested=0,view='universe',wallet='',token='';
 const format=formatSmartNumber;
 function panel(next){
  view=next;
  document.querySelectorAll('[data-smartness-tab]').forEach(button=>{button.setAttribute('aria-selected',String(button.dataset.smartnessTab===view));button.tabIndex=button.dataset.smartnessTab===view?0:-1});
  document.querySelectorAll('[data-smartness-panel]').forEach(section=>section.hidden=section.dataset.smartnessPanel!==view);
  $('smartness-analysis').hidden=!['wallets','tokens'].includes(view);
  render();
 }
 function render(){
  const quote=$('smartness-quote').value;
  const rows=registry().length?registry():report?.wallets||[];
  const result=summarizeSmartness(report,rows,{minutes:Number($('smartness-window').value),quote,interested:$('smartness-interest').value,source:$('smartness-source').value,wallet,token,rank:$('smartness-rank').value});
  const scans=new Map((report?.wallets||[]).map(row=>[row.address,row.scan]));
  const scanned=rows.filter(row=>scans.get(row.address)?.checkedAt).length;
  const pending=report?.scanning||(requested&&(!report?.attemptedAt||report.attemptedAt<requested-5000));
  $('scan-smartness').disabled=loading||Boolean(pending);
  $('scan-smartness').textContent=pending?'Scan in progress…':'Refresh trade scans ↻';
  $('smartness-status').textContent=error||(!report?'Loading trade samples…':`${result.events.length} recorded swap steps in this selection · ${scanned} / ${rows.length} wallets have signature checks · ${report.attemptedAt?'Last scan '+stamp(report.attemptedAt):'Awaiting first scan'}${pending?' · Scanning…':''}`);
  for(const key of ['buy','sell','net']){
   $('smartness-'+key+'-label').textContent=(key==='net'?'Net':key==='buy'?'Buy':'Sell')+' flow ('+quote+')';
   $('smartness-'+key).title=result.events.length?String(result.total[key]):'';
   $('smartness-'+key).textContent=result.events.length?(key==='net'&&result.total[key]>0?'+':'')+format(result.total[key]):'—';
  }
  $('smartness-focus').hidden=!wallet&&!token;
  $('smartness-focus-label').textContent=wallet?'Wallet: '+(rows.find(row=>row.address===wallet)?.name||short(wallet)):token?'Token: '+(report?.tokens?.[token]?.symbol||short(token)):'';
  $('smartness-wallets').innerHTML=result.wallets.length?result.wallets.map((row,index)=>{
   const active=row.buyCount+row.sellCount>0,scan=scans.get(row.address);
   const coverage=!scan?'Not scanned':scan.status==='unavailable'?'Unavailable':scan.status==='partial'?'Partial sample':'Latest signature sample';
   return `<tr><td>${active?index+1:'—'}</td><td><button type="button" class="flow-drill" data-flow-wallet="${esc(row.address)}">${esc(row.name)}</button><small>${esc(short(row.address))}</small></td><td>${row.interested?'★ Interested':'—'}</td><td>${active?format(row.buy):'—'}</td><td>${active?format(row.sell):'—'}</td><td class="${row.net<0?'flow-negative':'flow-positive'}">${active?(row.net>0?'+':'')+format(row.net):'—'}</td><td>${active||scan?.checkedAt?row.buyCount+' / '+row.sellCount:'—'}</td><td>${coverage}<small>${esc(stamp(scan?.checkedAt))}</small>${scan?'<small>'+Number(scan.returned||0)+' signatures · '+Number(scan.pending||0)+' pending'+(scan.signatureCapped?' · capped':'')+'</small><small>'+Number(scan.historyPages||0)+' history pages · '+Number(scan.historyPending||0)+' pending'+(scan.historyFinishedAt?' · RPC boundary reached':scan.historyOldestAt?' · oldest '+esc(stamp(scan.historyOldestAt)):' · awaiting history')+'</small>':''}${scan?.error?'<small>'+esc(scan.error)+'</small>':''}${scan?.historyError?'<small>'+esc(scan.historyError)+'</small>':''}</td></tr>`;
  }).join(''):'<tr><td colspan="8" class="admin-empty">No wallets match this selection.</td></tr>';
  $('smartness-tokens').innerHTML=result.tokens.length?result.tokens.map((row,index)=>`<tr><td>${index+1}</td><td><button type="button" class="flow-drill" data-flow-token="${esc(row.mint)}">${esc(report?.tokens?.[row.mint]?.symbol||short(row.mint))}</button><small>${esc(short(row.mint))}</small></td><td>${format(row.buy)}</td><td>${format(row.sell)}</td><td class="${row.net<0?'flow-negative':'flow-positive'}">${row.net>0?'+':''}${format(row.net)}</td><td>${row.buyers.size} / ${row.sellers.size}</td><td>${row.buyCount+row.sellCount}</td><td><a href="./order-flow.html?query=${encodeURIComponent(row.mint)}">Inspect ↗</a></td></tr>`).join(''):'<tr><td colspan="8" class="admin-empty">No supported swaps recorded for these filters. Other activity may be outside the sample or decoder coverage.</td></tr>';
  const names=new Map(rows.map(row=>[row.address,row.name]));
  $('smartness-trades').innerHTML=result.events.length?result.events.slice(0,100).map(event=>`<tr><td>${esc(stamp(event.time))}</td><td><button type="button" class="flow-drill" data-flow-wallet="${esc(event.address)}">${esc(names.get(event.address)||short(event.address))}</button></td><td class="${event.side==='sell'?'flow-negative':'flow-positive'}">${event.side==='sell'?'Sell':'Buy'}</td><td><span title="${esc(event.quantity)}">${format(Number(event.quantity))}</span> <button type="button" class="flow-drill" data-flow-token="${esc(event.mint)}">${esc(report?.tokens?.[event.mint]?.symbol||short(event.mint))}</button></td><td>${format(event.amount)} ${quote}</td><td>${esc(event.program)}</td><td><a href="https://solscan.io/tx/${esc(event.signature)}" target="_blank" rel="noopener noreferrer">View transaction ↗</a></td></tr>`).join(''):'<tr><td colspan="7" class="admin-empty">No classified trade evidence in this selection.</td></tr>';
  $('smartness-coverage').textContent=(report?.coverage||'Only observed, supported swap instructions enter these rankings.')+` ${result.events.length>100?'Showing the latest 100 evidence rows. ':''}${report?.eventCapped?'The 50,000-event retention cap was reached. ':''}Current source and Interested flags define the selected cohort. Missing activity is unknown, not zero. Small-number suffixes: e-1 = ×10⁻¹; e-2 = ×10⁻².`;
 }
 async function refresh(){
  if(loading)return;loading=true;
  try{const response=await fetch('/api/smartness',{cache:'no-store',signal:AbortSignal.timeout(25000)});if(!response.ok)throw new Error();const next=await response.json();if(!Array.isArray(next.events)||!Array.isArray(next.wallets))throw new Error();report=next;error='';if(requested&&report.scanning&&report.scanStartedAt)requested=report.scanStartedAt;if(requested&&report.attemptedAt>=requested-5000&&!report.scanning)requested=0;}
  catch{error='Trade ledger unavailable. Previously loaded evidence remains visible.';}
  finally{loading=false;render();}
 }
 $('scan-smartness').addEventListener('click',async()=>{
  if(requested)return;
  requested=Date.now();render();
  try{const response=await fetch('/api/smartness/refresh',{method:'POST',signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error();const result=await response.json();if(!result.requested)requested=0;else if(result.startedAt)requested=result.startedAt;await refresh()}
  catch{requested=0;error='Could not request a scan. Try again.';render()}
 });
 for(const id of ['smartness-window','smartness-quote','smartness-interest','smartness-source','smartness-rank'])$(id).addEventListener('change',render);
 document.querySelectorAll('[data-smartness-tab]').forEach(button=>button.addEventListener('click',()=>panel(button.dataset.smartnessTab)));
 document.querySelector('.smartness-tabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const buttons=[...document.querySelectorAll('[data-smartness-tab]')],index=buttons.indexOf(event.target);const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowLeft'?buttons.length-1:1))%buttons.length;buttons[next].click();buttons[next].focus()});
 $('smartness-analysis').addEventListener('click',event=>{const button=event.target.closest('[data-flow-wallet],[data-flow-token]');if(!button)return;if(button.dataset.flowWallet){wallet=button.dataset.flowWallet;token='';panel('tokens')}else{token=button.dataset.flowToken;wallet='';panel('wallets')}});
 $('smartness-clear-focus').addEventListener('click',()=>{wallet='';token='';render()});
 const params=new URLSearchParams(location.search),initial=params.get('view');if(['60','1440','10080','43200'].includes(params.get('window'))) $('smartness-window').value=params.get('window');if(['SOL','USDC','USDT'].includes(params.get('quote'))) $('smartness-quote').value=params.get('quote');panel(['wallets','tokens','discover'].includes(initial)?initial:'universe');
 void refresh();setInterval(()=>{if(!document.hidden)void refresh()},15000);
 return {render,selectWallet(address){wallet=address;token='';panel('tokens');$('smartness-analysis').scrollIntoView({behavior:'smooth',block:'start'})}};
}
