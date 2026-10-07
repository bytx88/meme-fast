import {aggregateMC,tierMetric,tierRead} from './mc-detail.mjs';
import {formatUSD} from './core.mjs';
import {candleMarketCaps} from './candle-history.mjs';
const $=id=>document.getElementById(id);
const cell=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el};
const cap=n=>new Intl.NumberFormat('en-US',{notation:'compact',maximumSignificantDigits:4}).format(n);
function addBar(td,value,max,tone,share=null){
  const text=cell('span',td.textContent);text.className='mc-bar-value';td.textContent='';
  if(share!==null){const label=cell('span',`${share.toFixed(1)}%`);label.className='mc-share';text.append(label)}
  td.append(text);
  if(value==null)return;
  const track=cell('div',''),fill=cell('div','');track.className='mc-bar-track';track.setAttribute('aria-hidden','true');
  fill.className=`mc-bar-fill ${tone}`;fill.style.width=`${Math.min(100,Math.max(0,value/max*100))}%`;track.append(fill);td.append(track);
}
function markCurrent(row,label,tier,snapshot){
  if(snapshot?.value>=tier.low&&snapshot.value<tier.high){row.className='mc-current';const badge=cell('span','Current MC');badge.className='mc-tier-badge';label.append(badge)}
}
function markBusiest(read,busiest){
  if(busiest){const badge=cell('span','Busiest by volume');badge.className='mc-busiest';read.prepend(badge)}
}
export function setupMCDetail(){
  const tabs=[...document.querySelectorAll('[data-breakdown]')];
  const select=tab=>{for(const button of tabs){const active=button===tab;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;$(button.getAttribute('aria-controls')).hidden=!active}};
  tabs.forEach((tab,index)=>{
    tab.addEventListener('click',()=>select(tab));
    tab.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=tabs[(index+1)%tabs.length];if(event.key==='ArrowLeft')next=tabs[(index+tabs.length-1)%tabs.length];if(event.key==='Home')next=tabs[0];if(event.key==='End')next=tabs.at(-1);if(next){event.preventDefault();select(next);next.focus()}});
  });
  let latest;
  $('mc-metric').addEventListener('change',()=>{if(latest)render(...latest)});
  function render(rows,snapshot,combined,loaded,busy,history=undefined){
    latest=[rows,snapshot,combined,loaded,busy,history];
    const historical=history!==undefined,selector=$('mc-metric');
    for(const option of selector.options){option.disabled=historical&&option.value!=='value';if(option.value==='value')option.textContent=historical?'Total Volume':'Total Value'}
    if(historical)selector.value='value';
    const metric=selector.value,host=$('mc-tiers');host.replaceChildren();
    $('mc-detail-pane').classList.toggle('mc-history',historical);
    $('mc-buy-heading').hidden=historical;$('mc-sell-heading').hidden=historical;
    host.closest('table').setAttribute('aria-label',history===undefined?'Observed flow by estimated market cap':'Historical total value by estimated market cap');
    $('mc-net-heading').textContent=metric==='average'?'Avg Diff':'Net';
    $('mc-detail-pane').setAttribute('aria-busy',String(busy));
    if(history!==undefined){
      $('mc-net-heading').textContent='Total volume';
      const data=candleMarketCaps(history?.candles||[],snapshot);
      const message=!history||history.status==='loading'?'Loading five-day candle history…':history.status==='failed'?`Historical candles unavailable: ${history.message}`:!history.candles?.length?'No historical candles returned for this pool.':!data?'Market-cap estimate unavailable: a reported MC and matching price are required.':null;
      $('mc-detail-note').textContent=message||'5D · 15-minute candles from one pool · Total volume assigned by candle closing MC; not net flow. Percentages show share of candle volume. Buy/sell split unavailable. Current MC marks the latest reported valuation; — means unknown, not zero.';
      $('mc-detail-pane').setAttribute('aria-busy',String(!history||history.status==='loading'));
      if(message){const row=document.createElement('tr'),td=cell('td',message);td.colSpan=3;td.className='table-empty';row.append(td);host.append(row);return}
      const max=Math.max(...data.tiers.map(t=>t.volume),0);
      for(const tier of data.tiers){
        const row=document.createElement('tr'),label=cell('th',`${cap(tier.low)}–<${cap(tier.high)}`);label.scope='row';row.append(label);
        markCurrent(row,label,tier,snapshot);
        const available=metric==='value'&&tier.count>0,total=cell('td',available?formatUSD(tier.volume):'—');
        total.className='numeric mc-net'+(available?'':' mc-unavailable');
        total.title=available?'Estimated total USD volume assigned by candle close; not net flow':'Value unavailable';
        if(available)addBar(total,tier.volume,max||1,'total',data.volume>0?tier.volume/data.volume*100:null);
        row.append(total);
        const read=cell('td',tier.count?'Estimated candle volume':'Range touched · total unknown');
        markBusiest(read,tier.count>0&&tier.volume>0&&tier.volume===max);
        row.append(read);host.append(row);
      }
      return;
    }
    const data=aggregateMC(rows,combined?null:snapshot);
    const message=combined?'Select one listing above to see its market-cap tiers.':!loaded?(busy?'Loading swap data…':'Swap data unavailable for this listing.'):!rows.length?'No observed swaps in this time window.':!data.available?'Market-cap estimate unavailable: a reported MC and matching price are required. FDV is not substituted.':!data.included?'No swaps with usable execution prices in this window.':null;
    $('mc-detail-note').textContent=message||`${data.included.toLocaleString()} of ${rows.length.toLocaleString()} observed swap steps included${data.excluded?` · ${data.excluded.toLocaleString()} excluded${data.outliers?` (${data.outliers.toLocaleString()} sparse price outliers)`:''}`:''}. ${metric==='count'?'Count measures swap steps; percentages show share of included steps.':metric==='average'?'USD per swap step; Avg Diff = average buy − average sell. A missing side stays unavailable.':'Net = buy USD − sell USD. Percentages show share of included buy + sell volume.'} Current MC marks the latest reported valuation.`;
    if(message){const row=document.createElement('tr'),td=cell('td',message);td.colSpan=5;td.className='table-empty';row.append(td);host.append(row);return}
    const values=data.tiers.map(t=>tierMetric(t,metric));
    const maxNet=Math.max(...values.map(v=>Math.abs(v.net||0)),1e-12),maxSide=Math.max(...values.flatMap(v=>[v.buy||0,v.sell||0]),1e-12);
    const activities=values.map(v=>(v.buy||0)+(v.sell||0)),maxActivity=Math.max(...activities);
    const totalActivity=activities.reduce((sum,v)=>sum+v,0),maxVolume=Math.max(...data.tiers.map(t=>t.buy+t.sell));
    data.tiers.forEach((tier,i)=>{
      const row=document.createElement('tr'),label=cell('th',`${cap(tier.low)}–<${cap(tier.high)}`);label.scope='row';label.title=`$${tier.low.toLocaleString()} ≤ estimated MC < $${tier.high.toLocaleString()}`;row.append(label);
      markCurrent(row,label,tier,snapshot);
      for(const key of ['net','buy','sell']){
        const value=values[i][key],formatted=value==null?'—':metric==='count'?value.toLocaleString():formatUSD(value);
        const td=cell('td',key==='net'&&value>0?'+'+formatted:formatted);td.className='numeric mc-'+key;
        if(key==='net'&&value!=null&&value!==0){td.style.backgroundColor=`rgba(${value>0?'43,223,170':'251,113,133'},${.1+.38*Math.abs(value)/maxNet})`}
        if(key!=='net')addBar(td,value,maxSide,key,metric!=='average'&&value!=null&&totalActivity>0?value/totalActivity*100:null);
        row.append(td);
      }
      const read=cell('td',tierRead(values[i],metric,activities[i],maxActivity));
      markBusiest(read,maxVolume>0&&tier.buy+tier.sell===maxVolume);row.append(read);host.append(row);
    });
  }
  return render;
}
