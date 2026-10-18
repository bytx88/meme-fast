import {formatSmartNumber} from './smart-number.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=value=>value?new Date(value).toLocaleString():'—';
const short=value=>value.slice(0,7)+'…'+value.slice(-5);
export function seedStatus(row,running){
 if(row.mode==='dormant')return 'Dormant · weekly probe';
 if(row.mode==='unavailable')return 'Cohort unavailable';
 if(running?.token===row.token)return 'Collecting · '+running.scope;
 return row.check?.status==='complete'?'Snapshot saved':row.check?.status==='partial'?'Partial · retry queued':row.check?.status==='unavailable'?'Provider unavailable · retry queued':'Queued';
}
export function createSmartSeeding(){
 const $=id=>document.getElementById(id);
 let report=null,error='',loading=false,requested=false;
 function render(){
  const busy=report?.queued;
  $('seeding-refresh').disabled=loading||requested;
  $('seeding-status').textContent=error||report?.error||(!report?'Loading collection queue…':`${report.ranking.length} / ${report.topLimit} automatic priority slots · ${report.tokens.length} monitored tokens · ${report.smartWallets} SmartMoney wallets · Ranking ${stamp(report.rankedAt)} · Trade ledger ${stamp(report.ledgerAt)}${busy?' · Collector queued / running':''}`);
  $('seeding-ranking').innerHTML=report?.ranking.length?report.ranking.map(row=>`<tr><td>${row.rank}</td><td><a href="./order-flow.html?query=${encodeURIComponent(row.token)}">${esc(row.symbol)}</a><small>${esc(short(row.token))}</small></td><td>${formatSmartNumber(row.score)} / 100<small>Buyers ${row.components.buyers} · Interested ${row.components.interested} · Flow ${row.components.flow} · Holders ${row.components.holders} · Recent ${row.components.recency}</small></td><td>${row.buyers} / ${row.interestedBuyers}</td><td>${esc(Object.entries(row.netByQuote).map(([q,v])=>formatSmartNumber(Number(v))+' '+q).join(' · '))}</td><td>${row.newHolders==null?'Unmeasured':row.newHolders}</td><td>${stamp(row.lastActivityAt)}</td></tr>`).join(''):'<tr><td colspan="7">No qualifying SmartMoney swaps in the retained 24-hour sample yet. No tokens are invented to fill the 20 slots.</td></tr>';
  const rows=(report?.tokens||[]).filter(row=>!$('seeding-state').value||row.mode===$('seeding-state').value);
  $('seeding-tokens').innerHTML=rows.length?rows.slice(0,100).map(row=>`<tr><td><a href="./order-flow.html?query=${encodeURIComponent(row.token)}">${esc(row.symbol)}</a><small>${esc(short(row.token))}</small></td><td>${esc(seedStatus(row,busy?report.running:null))}<small>${row.auto?'Top 20 · rank '+row.rank:'Retained monitoring'}</small></td><td>${row.check?.checkedWallets??'—'} / ${row.check?.totalWallets??report.smartWallets}<small>Full snapshot ${stamp(row.lastCompleteAt)}</small></td><td>${row.mode==='dormant'?(row.pausedZeroDays||row.zeroStreak):row.zeroStreak||0}<small>${row.zeroStreak?'Missing dates break the streak.':'No qualifying zero-day run.'}</small></td><td>${row.mode==='dormant'?stamp((row.lastProbeAt||row.dormantAt)+report.policy.probeIntervalMs):row.check?.nextDueAt?stamp(row.check.nextDueAt):'Ready in queue'}<small>Due time; capacity may delay collection.</small></td><td>${esc(row.reason||'Observed SmartMoney activity')}<small>${row.dormantAt?'Paused '+stamp(row.dormantAt):row.wokeAt?'Resumed '+stamp(row.wokeAt):'Enrolled '+stamp(row.enrolledAt)}</small></td></tr>`).join(''):'<tr><td colspan="6">No monitored tokens match this state.</td></tr>';
  $('seeding-count').textContent=rows.length>100?`Showing 100 / ${rows.length}; existing history remains saved.`:`${rows.length} tokens in this state`;
 }
 async function refresh(){
  if(loading)return;loading=true;
  try{const response=await fetch('/api/smart-seeding',{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error();const value=await response.json();if(!Array.isArray(value.ranking)||!Array.isArray(value.tokens))throw new Error();report=value;error='';}
  catch{error='Collection queue unavailable. Last loaded state is retained.'}
  finally{loading=false;render();}
 }
 $('seeding-refresh').addEventListener('click',async()=>{requested=true;render();try{const response=await fetch('/api/smart-seeding/refresh',{method:'POST',signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error();error='';await refresh()}catch{error='Could not request collection. Try again.'}finally{requested=false;render()}});
 $('seeding-state').addEventListener('change',render);
 void refresh();setInterval(()=>{if(!document.hidden&&!$('collection-panel').hidden)void refresh()},30000);
 return {refresh,render};
}
