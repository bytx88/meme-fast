import {RADAR_MODES,rankRadar} from './radar-model.mjs';

const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>value===null||value===undefined?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(value);
const age=timestamp=>{if(!Number.isFinite(timestamp))return 'unknown';const minutes=Math.max(0,Math.floor((Date.now()-timestamp)/60000));return minutes<60?`${minutes}m`:minutes<1440?`${Math.floor(minutes/60)}h`:`${Math.floor(minutes/1440)}d`};
const state={mode:'scalp',chain:'all',query:'',snapshot:null,error:null,loading:false};

function partClass(part){return part.value===null?'unknown':part.value>=.67?'high':part.value>=.34?'mid':'low'}
function reason(part){return `<span class="${partClass(part)}" title="${esc(part.detail)}">${esc(part.label)} ${part.value===null?'unknown':part.value>=.67?'strong':part.value>=.34?'mixed':'weak'}</span>`}
function card(reading,index){
 const {coin,score,coverage,stale,parts}=reading,contract=String(coin.contract_address||''),chain=String(coin.network||'');
 const coinLink=`./?${new URLSearchParams({contract})}`,flowLink=`./order-flow.html?${new URLSearchParams({query:contract})}`;
 const signal=score===null?`<span class="pending">Collecting history</span><small>${coverage}% inputs available</small>`:`${score}<small>Signal / 100 · ${coverage}% coverage</small>`;
 return `<article class="radar-card ${stale?'stale':''}"><span class="radar-rank">${String(index+1).padStart(2,'0')}</span><div class="radar-token"><strong>$${esc(coin.symbol||'?')}</strong><small>${esc(coin.name||'Unknown')} · ${esc(chain==='solana'?'Solana':chain==='base'?'Base':chain)} · pool ${age(coin.poolCreated==null?NaN:Number(coin.poolCreated))} old</small></div><div class="radar-signal"><strong>${signal}</strong><small class="${stale?'stale-note':''}">${stale?'Market data stale':`Updated ${age(reading.updatedAt)} ago`}</small></div><div class="radar-reasons">${parts.map(reason).join('')}</div><div class="radar-actions"><a href="${esc(coinLink)}">Coin context ↗</a><a href="${esc(flowLink)}">Order Flow ↗</a></div><details><summary>Why this rank · liquidity ${money(coin.liquidity)} · 5m volume ${money(coin.volume5m)}</summary><div class="radar-breakdown">${parts.map(part=>`<div><strong>${esc(part.label)} · ${part.value===null?'unknown':Math.round(part.value*100)+'%'} · weight ${part.weight}</strong><small>${esc(part.detail)}</small></div>`).join('')}</div></details></article>`;
}
function render(){
 $('#mode-description').textContent=RADAR_MODES[state.mode].description;
 document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===state.mode)));
 const status=$('#status'),results=$('#radar-results');
 if(state.loading){status.textContent='Loading observed coins…';return}
 if(state.error){status.textContent=state.error;results.innerHTML='<div class="radar-empty">Radar data is unavailable. Try refreshing.</div>';return}
 const snapshot=state.snapshot;if(!snapshot){status.textContent='Waiting for coin collection…';results.innerHTML='';return}
 const q=state.query.toLowerCase(),universe=Array.isArray(snapshot.radarCoins)?snapshot.radarCoins:snapshot.coins||[];
 const coins=universe.filter(coin=>(state.chain==='all'||coin.network===state.chain)&&(!q||`${coin.name} ${coin.symbol} ${coin.contract_address}`.toLowerCase().includes(q)));
 const ranked=rankRadar(coins,state.mode),shown=ranked.slice(0,60);
 const fresh=ranked.filter(row=>!row.stale).length,historyNote=state.mode==='scalp'?'Acceleration needs a previous sample.':state.mode==='swing'?'One-hour signals need at least six samples.':'Day persistence needs at least eight hourly samples.';
 const degraded=Object.values(snapshot.feeds||{}).some(feed=>feed.error);
 status.textContent=`${ranked.length} observed coins · ${fresh} with recent market data · last collection ${snapshot.lastRun?age(Number(snapshot.lastRun))+' ago':'pending'}${degraded?' · some feeds unavailable':''}. ${historyNote}`;
 results.innerHTML=shown.length?shown.map(card).join(''):`<div class="radar-empty">${degraded&&!universe.length?'Market feeds are unavailable. Radar will show coins when collection succeeds.':'No observed coins match these filters. Try another chain or search.'}</div>`;
}
async function load(){
 state.loading=true;state.error=null;render();$('#refresh').disabled=true;
 try{const response=await fetch('/api/new-coins',{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('Coin history unavailable');const snapshot=await response.json();if(!Array.isArray(snapshot.coins))throw new Error('Invalid coin history');state.snapshot=snapshot}
 catch(error){state.error=error.message||'Coin history unavailable'}
 finally{state.loading=false;$('#refresh').disabled=false;render()}
}
document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{state.mode=button.dataset.mode;render()}));
$('#chain').addEventListener('change',event=>{state.chain=event.target.value;render()});
$('#query').addEventListener('input',event=>{state.query=event.target.value.trim();render()});
$('#refresh').addEventListener('click',load);
load();
