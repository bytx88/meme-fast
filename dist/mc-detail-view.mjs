import {aggregateMC,tierMetric,tierRead} from './mc-detail.mjs';
import {formatUSD} from './core.mjs';
import {candleMarketCaps} from './candle-history.mjs';
const $=id=>document.getElementById(id);
const cell=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el};
const cap=n=>new Intl.NumberFormat('en-US',{notation:'compact',maximumSignificantDigits:4}).format(n);
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
    const metric=$('mc-metric').value,host=$('mc-tiers');host.replaceChildren();
    host.closest('table').setAttribute('aria-label',history===undefined?'Observed flow by estimated market cap':'Historical total value by estimated market cap');
    $('mc-net-heading').textContent=metric==='average'?'Avg Diff':'Net';
    $('mc-detail-pane').setAttribute('aria-busy',String(busy));
    if(history!==undefined){
      const data=candleMarketCaps(history?.candles||[],snapshot);
      const message=!history||history.status==='loading'?'Loading five-day candle history…':history.status==='failed'?`Historical candles unavailable: ${history.message}`:!history.candles?.length?'No historical candles returned for this pool.':!data?'Market-cap estimate unavailable: a reported MC and matching price are required.':null;
      $('mc-detail-note').textContent=message||`5D · 15-minute candles · ${metric==='value'?'Read shows estimated total USD volume (buy + sell), assigned by candle closing MC.':'Trade count and average value per swap are unavailable from candles.'} Net, Buy and Sell are unavailable because candles do not provide the split. — means unknown, not zero.`;
      $('mc-detail-pane').setAttribute('aria-busy',String(!history||history.status==='loading'));
      if(message){const row=document.createElement('tr'),td=cell('td',message);td.colSpan=5;td.className='table-empty';row.append(td);host.append(row);return}
      const max=Math.max(...data.tiers.map(t=>t.volume),1);
      for(const tier of data.tiers){
        const row=document.createElement('tr'),label=cell('th',`${cap(tier.low)}–<${cap(tier.high)}`);label.scope='row';row.append(label);
        for(const key of ['net','buy','sell']){const td=cell('td','—');td.className='numeric mc-'+key+' mc-unavailable';td.title='Buy/sell split unavailable from candles';row.append(td)}
        const read=cell('td',metric!=='value'?(metric==='count'?'Trade count unavailable':'Average per swap unavailable'):tier.count?`Total ${formatUSD(tier.volume)}`:'Range touched · total unknown');
        if(metric==='value'&&tier.count){read.style.backgroundColor=`rgba(125,185,255,${.05+.25*tier.volume/max})`;read.title='Estimated total USD volume assigned by candle close; buy/sell split unknown'}
        row.append(read);host.append(row);
      }
      return;
    }
    const data=aggregateMC(rows,combined?null:snapshot);
    const message=combined?'Select one listing above to see its market-cap tiers.':!loaded?(busy?'Loading swap data…':'Swap data unavailable for this listing.'):!rows.length?'No observed swaps in this time window.':!data.available?'Market-cap estimate unavailable: a reported MC and matching price are required. FDV is not substituted.':!data.included?'No swaps with usable execution prices in this window.':null;
    $('mc-detail-note').textContent=message||`${data.included.toLocaleString()} of ${rows.length.toLocaleString()} observed swap steps included${data.excluded?` · ${data.excluded.toLocaleString()} excluded${data.outliers?` (${data.outliers.toLocaleString()} sparse price outliers)`:''}`:''}. ${metric==='count'?'Count measures swap steps, not unique transactions or wallets.':metric==='average'?'USD per swap step; Avg Diff = average buy − average sell. A missing side stays unavailable.':'Net = buy USD − sell USD.'}`;
    if(message){const row=document.createElement('tr'),td=cell('td',message);td.colSpan=5;td.className='table-empty';row.append(td);host.append(row);return}
    const values=data.tiers.map(t=>tierMetric(t,metric));
    const maxNet=Math.max(...values.map(v=>Math.abs(v.net||0)),1e-12),maxSide=Math.max(...values.flatMap(v=>[v.buy||0,v.sell||0]),1e-12);
    const activities=values.map(v=>(v.buy||0)+(v.sell||0)),maxActivity=Math.max(...activities);
    data.tiers.forEach((tier,i)=>{
      const row=document.createElement('tr'),label=cell('th',`${cap(tier.low)}–<${cap(tier.high)}`);label.scope='row';label.title=`$${tier.low.toLocaleString()} ≤ estimated MC < $${tier.high.toLocaleString()}`;row.append(label);
      for(const key of ['net','buy','sell']){
        const value=values[i][key],formatted=value==null?'—':metric==='count'?value.toLocaleString():formatUSD(value);
        const td=cell('td',key==='net'&&value>0?'+'+formatted:formatted);td.className='numeric mc-'+key;
        if(value!=null&&value!==0){const positive=key==='buy'||key==='net'&&value>0;const alpha=key==='net'?.1+.38*Math.abs(value)/maxNet:.05+.14*value/maxSide;td.style.backgroundColor=`rgba(${positive?'43,223,170':'251,113,133'},${alpha})`}
        row.append(td);
      }
      row.append(cell('td',tierRead(values[i],metric,activities[i],maxActivity)));host.append(row);
    });
  }
  return render;
}
