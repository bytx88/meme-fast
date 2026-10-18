import {formatSmartNumber} from './smart-number.mjs';
import {easternDateTime,easternTime} from './eastern-time.mjs';
const $=id=>document.getElementById(id);
const number=formatSmartNumber;
const compact=formatSmartNumber;
const usd=value=>Number.isFinite(value)?'$'+formatSmartNumber(value):'—';
const priceLabel=usd;
const FRESH_MS=10*60000;
const valid=value=>typeof value==='number'&&Number.isFinite(value);
export function completeSamples(report,minutes,now=Date.now()){
  return (report?.samples||[]).filter(row=>row.time>=now-minutes*60000&&row.time<=now&&valid(row.balance)).sort((a,b)=>a.time-b.time);
}
// Missing historical measurements remain unknown. Never use today's balance as a past baseline.
export function balanceChange(report,minutes,index=null,now=Date.now()){
  const current=report?.samples?.at(-1);
  if(!current||now-current.time>FRESH_MS||current.time>now)return null;
  const target=current.time-minutes*60000;
  const baseline=[...report.samples].reverse().find(point=>point.time<=target&&target-point.time<=FRESH_MS);
  if(!baseline)return null;
  if(index==null)return valid(current.balance)&&valid(baseline.balance)?current.balance-baseline.balance:null;
  const before=baseline.walletBalances?.[index],after=current.walletBalances?.[index];
  if(before==null||after==null)return null;
  return Number(BigInt(after)-BigInt(before))/10**report.decimals;
}
export function chartSeries(report,minutes,now=Date.now()){
  return (report?.samples||[]).filter(row=>row.time>=now-minutes*60000&&row.time<=now).sort((a,b)=>a.time-b.time);
}
export function renderHoldingsChart(host,samples,minutes,now=Date.now()){
  host.replaceChildren();
  const ns='http://www.w3.org/2000/svg';
  const svg=(tag,attrs={})=>{const el=document.createElementNS(ns,tag);for(const [key,value]of Object.entries(attrs))el.setAttribute(key,String(value));return el};
  const width=Math.max(360,host.clientWidth||800),height=280,top=27,bottom=230;
  const chart=svg('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':'Observed combined Smart wallet token balance in yellow and token price in grey. Historical account balances and live wallet snapshots use their recorded coverage.'});
  const label=(value,x,y,anchor='start',fill='#9da9b9')=>{const el=svg('text',{x,y,'text-anchor':anchor,fill,'font-size':11});el.textContent=value;chart.append(el)};
  const balanceValues=samples.filter(row=>valid(row.balance)).map(row=>row.balance),priceValues=samples.filter(row=>valid(row.priceUSD)&&row.priceUSD>0).map(row=>row.priceUSD);
  const range=values=>{if(!values.length)return [0,1];const low=Math.min(...values),high=Math.max(...values),pad=Math.max((high-low)*.12,Math.abs(high)*.06,1e-8);return [Math.max(0,low-pad),high+pad]};
  const [low,high]=range(balanceValues),[priceLow,priceHigh]=range(priceValues);
  const left=Math.max(67,compact(high).length*6+14),right=width-Math.max(83,priceLabel(priceHigh).length*6+18);
  const start=now-minutes*60000,end=now,x=time=>left+(time-start)/(end-start)*(right-left);
  for(const fraction of [0,.25,.5,.75,1]){
    const y=bottom-(bottom-top)*fraction;
    chart.append(svg('line',{x1:left,x2:right,y1:y,y2:y,stroke:'#2c3c4e'}));
    label(balanceValues.length?compact(low+(high-low)*fraction):'—',left-10,y+4,'end');
    if(priceValues.length)label(priceLabel(priceLow+(priceHigh-priceLow)*fraction),right+12,y+4);
  }
  label('Token balance',left,14);label('Token price',right,14,'end');
  const axisStamp=minutes>1440?time=>new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric'}).format(time):easternTime;
  label(axisStamp(start),left,257);label(axisStamp(start+(end-start)/2),(left+right)/2,257,'middle');label(axisStamp(end),right,257,'end');
  for(const [field,min,max,color]of [['priceUSD',priceLow,priceHigh,'#718695'],['balance',low,high,'#ffc400']]){
    let previous=null,segment=[];
    // Reconstructed prices are actual hourly closes, not five-minute price estimates.
    const fieldSamples=field==='priceUSD'?samples.filter(row=>row.source!=='rpc-reconstructed'||valid(row.priceUSD)):samples;
    const observed=fieldSamples.filter(row=>valid(row[field])),single=observed.length===1;
    const flush=()=>{if(segment.length>1)chart.append(svg('path',{d:segment.map((point,index)=>`${index?'L':'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' '),fill:'none',stroke:color,'stroke-width':2}));segment=[]};
    for(const point of fieldSamples){
      const value=point[field];
      if(!valid(value)){flush();previous=null;continue}
      const cx=x(point.time),cy=bottom-(value-min)/(max-min)*(bottom-top);
      // Failed checks and long collection gaps are not filled with synthetic balances.
      const gap=field==='priceUSD'&&point.source==='rpc-reconstructed'&&previous?.source==='rpc-reconstructed'?3600000:FRESH_MS;
      if(previous&&point.time-previous.time>gap)flush();
      segment.push({x:cx,y:cy});
      if(observed.length<=100||point===observed.at(-1)){
        const dot=svg('circle',{cx,cy,r:single?(field==='priceUSD'?6:3.5):2.5,fill:single&&field==='priceUSD'?'none':color,stroke:color,'stroke-width':single&&field==='priceUSD'?2:0,tabindex:0});
        const title=svg('title');title.textContent=`${easternDateTime(point.time)} · ${field==='balance'?`${number(value)} tokens`:priceLabel(value)}`;dot.append(title);chart.append(dot);
      }
      previous={x:cx,y:cy,time:point.time,source:point.source};
    }
    flush();
  }
  if(!balanceValues.length)label('Awaiting a complete wallet balance snapshot',(left+right)/2,125,'middle');
  host.append(chart);
}
export function createSmartHoldings({changed=()=>{},request=fetch,now=Date.now}={}){
  let report=null,loading=false,error='',attempted=0,selection=null,generation=0;
  function configure(token,scope,members=[]){
    const key=token+':'+scope+':'+members.join(',');
    if(selection?.key===key)return;
    selection={token,scope,key};generation++;report=null;loading=false;error='';attempted=0;
  }
  async function refresh(){
    if(loading||!selection)return;
    const current=generation,chosen=selection;
    loading=true;attempted=now();error='';changed();
    try{
      const response=await request('/api/smart-wallets?'+new URLSearchParams({token:chosen.token,scope:chosen.scope}),{cache:'no-store',signal:AbortSignal.timeout(165000)});
      if(!response.ok)throw new Error('Wallet balance service is unavailable');
      const value=await response.json();
      if(value.token!==chosen.token||value.network!=='solana'||!Array.isArray(value.wallets)||!Array.isArray(value.samples))throw new Error('Wallet balance response is invalid');
      if(current===generation){report=value;error=value.error||'';}
    }catch{if(current===generation)error='Balance refresh failed. Last collected observations are retained.'}
    finally{if(current===generation){loading=false;changed()}}
  }
  function render(minutes){
    if(!loading&&now()-attempted>=60000){void refresh();return}
    const time=now(),latest=report?.samples?.at(-1),complete=[...(report?.samples||[])].reverse().find(point=>valid(point.balance));
    const fresh=report?.status==='ok'&&complete&&time-complete.time<=FRESH_MS&&!error;
    $('smart-status').textContent=loading&&!report?'Reading balances directly from Solana…':report?`${latest?.checkedWallets??0} / ${report.wallets.length} wallets checked · ${fresh?'Current balances':'Incomplete or stale coverage'}`:'Wallet balances unavailable';
    $('updated').textContent=loading?'Updating wallet balances…':report?.attemptedAt?`Balances ${easternDateTime(report.attemptedAt)}`:'Wallet balances unavailable';
    $('refresh').disabled=loading;
    $('smart-balance').textContent=compact(complete?.balance);
    $('smart-value').textContent=valid(complete?.balance)&&valid(complete?.priceUSD)?usd(complete.balance*complete.priceUSD):'—';
    $('smart-holders').textContent=complete?`${complete.holders} / ${report.wallets.length}`:'—';
    const supply=report?.supply;
    $('smart-ownership').textContent=valid(complete?.balance)&&supply?.value>0?number(complete.balance/supply.value*100)+'%':'—';
    $('smart-ownership').title=supply?`Supply measured ${easternDateTime(supply.checkedAt)}`:'Supply unavailable';
    const change=balanceChange(report,1440,null,time);
    $('smart-change').textContent=change==null?'—':(change>0?'+':'')+compact(change);
    $('smart-change').dataset.tone=change==null?'none':change<0?'sell':'buy';
    $('smart-price').textContent=valid(latest?.priceUSD)?priceLabel(latest.priceUSD):'—';
    $('smart-balance').title=complete?`${number(complete.balance)} tokens · ${easternDateTime(complete.time)}${fresh?'':' · last complete snapshot; stale'}`:'Awaiting complete coverage';
    const samples=chartSeries(report,minutes,time),points=completeSamples(report,minutes,time);
    renderHoldingsChart($('smart-chart'),samples,minutes,time);
    $('smart-chart-note').textContent=error||(loading&&!report?'Collecting selected wallet balances. The chart starts with the first observed point.':!report?'Could not load wallet balances. Use Refresh to try again.':!complete?'Some wallet checks failed. Individual available balances are listed below; a group total requires every wallet in this group.':`${fresh?'':'Last complete total is stale. '}${points.length===1?'One balance snapshot in this window; the line grows as new snapshots arrive.':points.length?`${points.length} complete balance snapshots in this window.`:'No complete balance observations in this window.'} Tracking began ${easternDateTime(report.startedAt||report.samples[0].time)}. Unobserved history is left unfilled.`);
    if(report?.backfill&&!error){
      $('smart-chart-note').textContent=`${fresh?'':'Latest balance coverage is stale. '}History reconstructed from ${report.backfill.transactions} transactions across ${report.backfill.accounts.length} discovered token accounts. Yellow: five-minute balance states. Grey: hourly pool closing prices; missing prices stay unfilled. Live snapshots continue every five minutes.`;
      $('smart-history-scope').textContent=report.backfill.scope;
    }else $('smart-history-scope').textContent='This exact token and wallet membership has its own history. New groups start with observed snapshots; earlier holdings have not been reconstructed.';
    $('smart-wallet-rows').replaceChildren();
    for(const [index,wallet]of (report?.wallets||[]).entries()){
      const row=document.createElement('tr'),name=document.createElement('td'),link=document.createElement('a'),address=document.createElement('small');
      link.href=`https://solscan.io/account/${wallet.address}`;link.target='_blank';link.rel='noopener noreferrer';link.textContent=wallet.name;link.title=wallet.address;
      address.textContent=wallet.address.slice(0,8)+'…'+wallet.address.slice(-5);name.append(link,address);row.append(name);
      const stale=wallet.status!=='ok'||!wallet.checkedAt||time-wallet.checkedAt>FRESH_MS||Boolean(error);
      const values=[supply?.value>0&&wallet.balance!=null?number(wallet.balance/supply.value*100)+'%':'—',number(wallet.balance),valid(latest?.priceUSD)&&wallet.balance!=null?usd(wallet.balance*latest.priceUSD):'—',...[1440,10080,43200].map(window=>{const delta=stale?null:balanceChange(report,window,index,time);return delta==null?'—':(delta>0?'+':'')+number(delta)}),stale?'Stale / unavailable':'Current'];
      for(const value of values){const cell=document.createElement('td');cell.textContent=value;cell.className='numeric';row.append(cell)}
      row.title=wallet.checkedAt?`Balance checked ${easternDateTime(wallet.checkedAt)}`:'Balance not yet available';
      if(stale)row.className='smart-stale';
      $('smart-wallet-rows').append(row);
    }
    $('smart-freshness').textContent=fresh?'All selected balances checked.':complete?'Showing the last complete group balance; check wallet statuses below.':'Group total awaits complete coverage.';
  }
  return {configure,render,refresh,summary:()=>({walletMode:'smart-holdings',token:report?.token,
    groupId:report?.groupId,status:report?.status||'unavailable',wallets:report?.wallets||[],
    latest:report?.samples?.at(-1)||null,snapshotCount:report?.samples?.length||0,loading,error})};
}
