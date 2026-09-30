import {candleMarketCaps,CANDLE_MS} from './candle-history.mjs';
import {easternRange} from './eastern-time.mjs';
import {formatUSD} from './core.mjs';
import {flowTimeline} from './analysis.mjs';
const $=id=>document.getElementById(id);
const compact=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:2}).format(n);
const el=(tag,text)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;return node};

export function renderCandleHistory(history,snapshot,now=Date.now()){
  const host=$('timeline');host.replaceChildren();
  const candles=history?.candles||[],data=candleMarketCaps(candles,snapshot);
  const message=!history||history.status==='loading'?'Loading five-day candle history…':history.status==='failed'?`Historical candles unavailable: ${history.message}`:!candles.length?'No historical candles returned for this pool.':!data?'Historical prices loaded; market-cap estimate needs a reported MC and matching price.':null;
  const method='15-minute OHLCV from the most liquid discovered pool. Estimated MC = candle price × supply implied by the latest reported MC and price, assuming unchanged supply. Each candle’s total volume is assigned to its closing MC tier as an approximation; its high/low identifies other tiers touched, with no volume assigned there. No buy/sell split or trade count is available from candles. Gaps are unknown; only completed candles within the requested window are included.';
  $('coverage-tooltip').textContent=method;document.querySelector('.coverage-help summary').title=method;
  $('timeline-title').textContent='Flow trend';
  $('timeline-detail').textContent='';
  if(!message){$('coverage-tooltip').textContent+=` ${easternRange(candles[0].time,candles.at(-1).time+CANDLE_MS)} · ${candles.length} candles. Bars group total USD volume into four-hour intervals; the line uses the last candle close and whiskers preserve the high/low. MC range ${compact(data.low)}–${compact(data.high)}.`;document.querySelector('.coverage-help summary').title=$('coverage-tooltip').textContent;}
  if(message){const empty=el('div',message);empty.className='timeline-empty';host.append(empty);return}
  const ns='http://www.w3.org/2000/svg',svg=(tag,attrs={})=>{const node=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))node.setAttribute(k,String(v));return node};
  const {bins,start,end}=flowTimeline([],7200,now);
  const groups=bins.map(bin=>{
    const rows=data.rows.filter(c=>c.time>=bin.start&&c.time<bin.end);
    return {...bin,rows,volume:rows.reduce((sum,c)=>sum+c.volume,0),close:rows.at(-1)?.close,low:rows.length?Math.min(...rows.map(c=>c.low)):null,high:rows.length?Math.max(...rows.map(c=>c.high)):null};
  });
  const maxVolume=Math.max(...groups.map(g=>g.volume),1),chartWidth=Math.max(320,host.clientWidth);
  const left=Math.max(48,compact(maxVolume).length*6+14),right=chartWidth-Math.max(86,compact(data.high).length*6+42),width=right-left,unit=width/groups.length,top=23,bottom=101;
  const chart=svg('svg',{viewBox:`0 0 ${chartWidth} 135`,role:'group','aria-label':'Five-day total volume by four-hour interval, with estimated market cap and candle high/low ranges'});
  const defs=svg('defs'),gradient=svg('linearGradient',{id:'flow-total',x1:0,y1:0,x2:0,y2:1});
  ['#ded3ff','#b6a1ff','#7560b8'].forEach((color,i)=>gradient.append(svg('stop',{offset:`${i*50}%`,'stop-color':color})));defs.append(gradient);chart.append(defs);
  const text=(value,x,y,anchor='start')=>{const node=svg('text',{x,y,fill:'#9da9b9','font-size':11,'text-anchor':anchor});node.textContent=value;chart.append(node)};
  const pad=Math.max((data.high-data.low)*.1,data.high*.01),min=Math.max(0,data.low-pad),max=data.high+pad,y=v=>bottom-(v-min)/(max-min)*(bottom-top);
  for(const fraction of [0,.5,1]){
    const at=bottom-(bottom-top)*fraction;
    chart.append(svg('line',{x1:left,x2:right,y1:at,y2:at,stroke:'#283140'}));
    text(compact(maxVolume*fraction),left-10,at+5,'end');text(compact(min+(max-min)*fraction),right+20,at+5);
  }
  text('Total volume · USD',left,14);text('MC · est.',right+20,14);
  let previous=null;
  groups.forEach((g,i)=>{
    const cx=left+(i+.5)*unit;
    if(!g.rows.length){previous=null;return}
    const group=svg('g',{tabindex:0,role:'img'}),height=g.volume/maxVolume*(bottom-top),barWidth=Math.max(1,Math.min(18,unit*.34));
    group.append(svg('rect',{x:cx-barWidth/2,y:bottom-height,width:barWidth,height,fill:'url(#flow-total)'}));
    group.append(svg('line',{x1:cx,x2:cx,y1:y(g.low),y2:y(g.high),stroke:'#7db9ff','stroke-opacity':.5}));
    if(previous)group.append(svg('line',{x1:previous.x,x2:cx,y1:y(previous.close),y2:y(g.close),stroke:'#7db9ff','stroke-width':2}));
    group.append(svg('circle',{cx,cy:y(g.close),r:2.5,fill:'#7db9ff'}));previous={x:cx,close:g.close};
    const description=`${easternRange(g.start,g.end)} · Total volume ${formatUSD(g.volume)} · Est. MC ${formatUSD(g.close)} · Range ${compact(g.low)}–${compact(g.high)} · ${g.rows.length} candles · Buy/sell split unavailable`;
    group.setAttribute('aria-label',description);const title=svg('title');title.textContent=description;group.append(title);
    group.append(svg('rect',{x:left+i*unit,y:top,width:unit,height:bottom-top,fill:'transparent',class:'interval-hit'}));
    for(const event of ['mouseenter','focus'])group.addEventListener(event,()=>$('timeline-detail').textContent=description);
    for(const event of ['mouseleave','blur'])group.addEventListener(event,()=>$('timeline-detail').textContent='');
    chart.append(group);
  });
  const stamp=time=>new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric'}).format(time);
  text(stamp(start),left,125);text(stamp((start+end)/2),left+width/2,125,'middle');text(stamp(end),right,125,'end');
  host.append(chart);
}
