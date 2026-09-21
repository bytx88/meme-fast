import {formatUSD, summarize} from './core.mjs';
import {filterTrades, groupTransactions, flowTimeline} from './analysis.mjs';
const $ = id => document.getElementById(id);
const money = formatUSD;
const short = value => value?.length > 18 ? value.slice(0,7)+'…'+value.slice(-6) : value || '—';
const stamp = value => new Date(value).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
const make = (tag, text, className) => {const el=document.createElement(tag);if(text!=null)el.textContent=text;if(className)el.className=className;return el};

export function renderCoverage(view, state, rows) {
  const ok=view.pools.filter(p=>p.status==='loaded').length, capped=view.pools.filter(p=>p.count>=300).length;
  const missing=view.listings.filter(l=>['failed','partial','no-pools'].includes(l.status)).length;
  const partial=missing>0||capped>0||state.loadError;
  $('coverage-badge').textContent=state.busy?'LOADING SAMPLE':!view.loaded?'DATA UNAVAILABLE':partial?'PARTIAL SAMPLE':'RECENT SWAP SAMPLE';
  $('coverage-badge').dataset.partial=String(partial||(!view.loaded&&!state.busy));
  const span=rows.length?` · ${stamp(rows[rows.length-1].time)}–${stamp(rows[0].time)} observed`:'';
  $('coverage-summary').textContent=`${ok}/${view.pools.length} discovered pools loaded · ${rows.length} swap steps${span}`;
}

export function renderTimeline(rows, minutes, now, loaded) {
  const host=$('timeline');host.replaceChildren();
  const {bins,stepMinutes,start,end}=flowTimeline(rows,minutes,now);
  $('timeline-interval').textContent=`${stepMinutes===1?'1-minute':'1-hour'} intervals`;
  const defaultDetail=rows.length?`Window ${stamp(start)}–${stamp(end)} · Net buy volume ${money(bins.at(-1).cumulative)} · Hover or focus an interval for details.`:loaded?'No observed swaps in this window.':'Waiting for pool data.';
  $('timeline-detail').textContent=defaultDetail;
  if(!rows.length){host.append(make('div',loaded?'No observed swaps to chart':'Loading the flow timeline…','timeline-empty'));return}
  const ns='http://www.w3.org/2000/svg';
  const svgEl=(tag,attributes={})=>{const el=document.createElementNS(ns,tag);for(const [key,value]of Object.entries(attributes))el.setAttribute(key,String(value));return el};
  const chartWidth=Math.max(280,host.clientWidth);
  const svg=svgEl('svg',{viewBox:`0 0 ${chartWidth} 350`,role:'group','aria-label':'Observed buy and sell volume by interval, and cumulative net buy volume'});
  const label=(text,x,y,anchor='start')=>{const el=svgEl('text',{x,y,'text-anchor':anchor,fill:'#9da9b9','font-size':14});el.textContent=text;svg.append(el)};
  const left=70,right=chartWidth-8,width=right-left,unit=width/bins.length,top=28,bottom=148;
  const max=Math.max(...bins.flatMap(b=>[b.buy,b.sell]),1e-8);
  const axisMoney=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:2}).format(v);
  for(const fraction of [0,.5,1]){const y=bottom-(bottom-top)*fraction;svg.append(svgEl('line',{x1:left,x2:right,y1:y,y2:y,stroke:'#283140'}));label(axisMoney(max*fraction),left-10,y+5,'end')}
  label('Swap volume · USD',left,18);
  const low=Math.min(0,...bins.map(b=>b.cumulative)),high=Math.max(0,...bins.map(b=>b.cumulative)),range=high-low||1;
  const cy=v=>302-(v-low)/range*93;
  label('Cumulative net · USD',left,193);
  for(const value of [...new Set([low,0,high])]){const y=cy(value);svg.append(svgEl('line',{x1:left,x2:right,y1:y,y2:y,stroke:'#283140','stroke-dasharray':value===0?'4 4':'none'}));label(axisMoney(value),left-10,y+5,'end')}
  let points=`${left},${cy(0)}`;
  bins.forEach((bin,i)=>{points+=` ${left+(i+1)*unit},${cy(bin.cumulative)}`});
  svg.append(svgEl('polyline',{points,fill:'none',stroke:'#d7f778','stroke-width':2,'vector-effect':'non-scaling-stroke'}));
  bins.forEach((bin,i)=>{
    const x=left+i*unit,g=svgEl('g',{tabindex:0,role:'img'}),barWidth=Math.max(1,unit*.34);
    for(const [side,offset,color]of [['buy',.12,'#2bdfaa'],['sell',.52,'#fb7185']]){const h=bin[side]/max*(bottom-top);g.append(svgEl('rect',{x:x+unit*offset,y:bottom-h,width:barWidth,height:h,fill:color}))}
    const description=`${stamp(bin.start)}–${stamp(bin.end)} · Buys ${money(bin.buy)} · Sells ${money(bin.sell)} · ${bin.count} steps · Cumulative net ${money(bin.cumulative)}`;
    g.setAttribute('aria-label',description);
    const title=svgEl('title');title.textContent=description;g.append(title);
    const target=svgEl('rect',{x,y:top,width:unit,height:302-top,fill:'transparent',class:'interval-hit'});g.append(target);
    g.addEventListener('mouseenter',()=>$('timeline-detail').textContent=description);g.addEventListener('focus',()=>$('timeline-detail').textContent=description);
    g.addEventListener('mouseleave',()=>$('timeline-detail').textContent=defaultDetail);g.addEventListener('blur',()=>$('timeline-detail').textContent=defaultDetail);
    svg.append(g);
  });
  label(stamp(start),left,332);label(stamp(start+(end-start)/2),left+width/2,332,'middle');label(stamp(end),right,332,'end');
  host.append(svg);
}

export function setupTape() {
  let current=[],loaded=false,limit=20,expanded=new Set(),scope='';
  function stepRow(trade, child=false) {
    const tr=make('tr',null,child?'swap-step':''),time=make('td',new Date(trade.time).toLocaleTimeString());
    time.title=new Date(trade.time).toLocaleString();
    const side=make('td');side.append(make('span',trade.side==='buy'?'Buy':'Sell',`side-badge ${trade.side}`));
    const pool=make('td',`${trade.pool} · ${trade.network}`,'pool-detail');
    pool.append(make('small',`Wallet ${short(trade.wallet)}`));pool.lastChild.title=trade.wallet||'Wallet unavailable';
    if(trade.quantity!=null){const quantity=new Intl.NumberFormat('en-US',{maximumSignificantDigits:7}).format(trade.quantity);const price=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumSignificantDigits:7}).format(trade.price);pool.append(make('small',`${quantity} tokens · ${price} / token`))}
    const tx=make('td',short(trade.hash),'transaction');tx.title=trade.hash;
    tr.append(time,side,make('td',money(trade.usd),'numeric'),pool,tx);return tr;
  }
  function draw() {
    const rows=filterTrades(current,{side:$('trade-side').value,min:$('trade-min').value,wallet:$('trade-wallet').value});
    const grouped=$('trade-group').checked,items=grouped?groupTransactions(rows):rows;
    const body=$('tape');body.replaceChildren();
    for(const item of items.slice(0,limit)){
      if(!grouped){body.append(stepRow(item));continue}
      if(item.rows.length===1){body.append(stepRow(item.rows[0]));continue}
      const tr=make('tr',null,'transaction-group'),time=make('td'),button=make('button',`${expanded.has(item.key)?'▾':'▸'} ${stamp(item.time)} · ${item.rows.length} steps`,'expand-trade');
      button.type='button';button.setAttribute('aria-expanded',String(expanded.has(item.key)));button.setAttribute('aria-label',`Expand transaction ${short(item.hash)}, ${item.rows.length} matching swap steps`);
      time.append(button);const side=make('td'),mixed=item.buy>0&&item.sell>0;side.append(make('span',mixed?'Buy + sell':item.buy?'Buy':'Sell',`side-badge ${mixed?'mixed':item.buy?'buy':'sell'}`));
      const value=make('td',null,'numeric group-values');if(item.buy)value.append(make('span',`Buy ${money(item.buy)}`,'buy-text'));if(item.sell)value.append(make('span',`Sell ${money(item.sell)}`,'sell-text'));
      const pool=make('td',`${new Set(item.rows.map(t=>t.poolAddress)).size} pools · ${item.network}`,'pool-detail');pool.append(make('small','Grouped swap steps'));
      const tx=make('td',short(item.hash),'transaction');tx.title=item.hash;tr.append(time,side,value,pool,tx);body.append(tr);
      const children=item.rows.map(row=>stepRow(row,true));for(const child of children){child.hidden=!expanded.has(item.key);body.append(child)}
      button.addEventListener('click',()=>{const open=!expanded.has(item.key);if(open)expanded.add(item.key);else expanded.delete(item.key);for(const child of children)child.hidden=!open;button.setAttribute('aria-expanded',String(open));button.textContent=`${open?'▾':'▸'} ${stamp(item.time)} · ${item.rows.length} steps`});
    }
    if(!items.length){const tr=make('tr'),td=make('td',!loaded?'Waiting for swap data.':current.length?'No swaps match these filters. Reset filters to see the sample.':'No observed swaps in this window.','table-empty');td.colSpan=5;tr.append(td);body.append(tr)}
    $('tape-count').textContent=`${Math.min(limit,items.length)} / ${items.length} ${grouped?'GROUPS':'STEPS'} · ${rows.length} / ${current.length} STEPS MATCH`;
    $('load-more').hidden=limit>=items.length;$('load-more').textContent=`Load more (${Math.min(20,items.length-limit)})`;
  }
  for(const id of ['trade-side','trade-min','trade-wallet','trade-group'])$(id).addEventListener(id==='trade-side'||id==='trade-group'?'change':'input',()=>{limit=20;draw()});
  $('trade-reset').addEventListener('click',()=>{$('trade-side').value='all';$('trade-min').value='';$('trade-wallet').value='';$('trade-group').checked=true;limit=20;draw()});
  $('load-more').addEventListener('click',()=>{limit+=20;draw()});
  return (rows,isLoaded,scopeKey)=>{if(scopeKey!==scope){scope=scopeKey;limit=20;expanded.clear()}current=rows;loaded=isLoaded;draw()};
}
