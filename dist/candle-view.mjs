import {candleMarketCaps,CANDLE_MS,HISTORY_MS} from './candle-history.mjs';
import {easternRange,easternDateTime,easternDate} from './eastern-time.mjs';
import {formatUSD} from './core.mjs';
const $=id=>document.getElementById(id);
const compact=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:2}).format(n);
const el=(tag,text)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;return node};

export function renderCandleHistory(history,snapshot,now=Date.now()){
  const host=$('timeline'),tiers=$('historical-tiers');host.replaceChildren();tiers.replaceChildren();
  const candles=history?.candles||[],data=candleMarketCaps(candles,snapshot);
  const message=!history||history.status==='loading'?'Loading five-day candle history…':history.status==='failed'?`Historical candles unavailable: ${history.message}`:!candles.length?'No historical candles returned for this pool.':!data?'Historical prices loaded; market-cap estimate needs a reported MC and matching price.':null;
  const method='15-minute OHLCV from the most liquid discovered pool. Estimated MC = candle price × supply implied by the latest reported MC and price, assuming unchanged supply. Each candle’s total volume is assigned to its closing MC tier as an approximation; its high/low identifies other tiers touched, with no volume assigned there. No buy/sell split or trade count is available from candles. Gaps are unknown; only completed candles within the requested window are included.';
  $('coverage-tooltip').textContent=method;document.querySelector('.coverage-help summary').title=method;
  $('timeline-title').textContent='Historical market cap · 15m candles';
  $('timeline-detail').textContent=message||`${easternRange(candles[0].time,candles.at(-1).time+CANDLE_MS)} · ${candles.length} candles · MC range ${compact(data.low)}–${compact(data.high)} · total volume ${compact(data.volume)}`;
  $('historical-note').textContent=message||`${candles.length} completed candles · ${history.pool.name||history.pool.address} · range ${compact(data.low)}–${compact(data.high)}. Volume below is an estimate by closing MC, not exact volume traded at each tier. Buy/sell flow below remains an observed swap sample.`;
  $('historical-method').textContent=method;
  if(message){host.append(el('p',message));return}
  for(const tier of data.tiers){
    const row=el('tr'),label=el('th',`${compact(tier.low)}–<${compact(tier.high)}`);label.scope='row';row.append(label);
    for(const value of [tier.count?formatUSD(tier.volume):'—',tier.count||'—',tier.count?'Volume assigned by candle close':'High/low touched this tier; volume allocation unknown'])row.append(el('td',value));
    tiers.append(row);
  }
  const ns='http://www.w3.org/2000/svg',svg=(tag,attrs={})=>{const node=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))node.setAttribute(k,String(v));return node};
  const width=Math.max(320,host.clientWidth),left=65,right=width-20,top=22,bottom=146,volumeBottom=196;
  const chart=svg('svg',{viewBox:`0 0 ${width} 224`,role:'img','aria-label':`Five-day estimated market cap from 15-minute candles, high ${compact(data.high)}. Total volume bars shown below.`});
  const start=now-HISTORY_MS,end=now,x=t=>left+(t-start)/(end-start)*(right-left);
  const min=data.low*.95,max=data.high*1.05,y=v=>bottom-(v-min)/(max-min)*(bottom-top),maxVolume=Math.max(...data.rows.map(c=>c.volume),1);
  const text=(value,x,y,anchor='start')=>{const node=svg('text',{x,y,fill:'#9da9b9','font-size':11,'text-anchor':anchor});node.textContent=value;chart.append(node)};
  for(const fraction of [0,.5,1]){const value=min+(max-min)*fraction,at=y(value);chart.append(svg('line',{x1:left,x2:right,y1:at,y2:at,stroke:'#283140'}));text(compact(value),left-8,at+4,'end')}
  text('Estimated MC · candle high/low + close',left,12);text('Total volume',left,163);text(compact(maxVolume),right,163,'end');
  let previous=null;
  for(const c of data.rows){
    const cx=x(c.time+CANDLE_MS/2),group=svg('g'),title=svg('title');title.textContent=`${easternDateTime(c.time)} · MC ${compact(c.low)}–${compact(c.high)} · close ${compact(c.close)} · total volume ${formatUSD(c.volume)}`;group.append(title);
    if(previous&&c.time-previous.time===CANDLE_MS)group.append(svg('line',{x1:x(previous.time+CANDLE_MS/2),x2:cx,y1:y(previous.close),y2:y(c.close),stroke:'#7db9ff','stroke-width':1.3}));
    group.append(svg('line',{x1:cx,x2:cx,y1:y(c.low),y2:y(c.high),stroke:'#7db9ff','stroke-width':1}));
    const height=c.volume/maxVolume*27;group.append(svg('rect',{x:cx-1,y:volumeBottom-height,width:Math.max(1,(right-left)/480*.65),height,fill:'#b6a1ff'}));chart.append(group);previous=c;
  }
  for(const [t,anchor]of [[start,'start'],[(start+end)/2,'middle'],[end,'end']])text(easternDate(t),x(t),216,anchor);
  host.append(chart);
}
