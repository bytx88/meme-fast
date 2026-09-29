import {formatUSD, summarize} from './core.mjs';
import {filterTrades, groupTransactions, flowTimeline, visibleFlowRange} from './analysis.mjs';
import {marketCapTimeline} from './market-cap.mjs';
import {easternDate,easternDateTime,easternRange,easternTime,easternTimeWithSeconds} from './eastern-time.mjs';
const $ = id => document.getElementById(id);
const money = formatUSD;
const short = value => value?.length > 18 ? value.slice(0,7)+'…'+value.slice(-6) : value || '—';
const stamp = easternTime;
const make = (tag, text, className) => {const el=document.createElement(tag);if(text!=null)el.textContent=text;if(className)el.className=className;return el};

export function renderCoverage(view, state, rows) {
  const ok=view.pools.filter(p=>p.status==='loaded').length, capped=view.pools.filter(p=>p.count>=300).length;
  const missing=view.listings.filter(l=>['failed','partial','no-pools'].includes(l.status)).length;
  const partial=missing>0||capped>0||state.loadError;
  $('coverage-badge').textContent=state.busy?'LOADING SAMPLE':!view.loaded?'DATA UNAVAILABLE':partial?'PARTIAL SAMPLE':'RECENT SWAP SAMPLE';
  $('coverage-badge').dataset.partial=String(partial||(!view.loaded&&!state.busy));
  const span=rows.length?` · ${easternRange(rows[rows.length-1].time,rows[0].time)} observed`:'';
  $('coverage-summary').textContent=`${ok}/${view.pools.length} discovered pools loaded · ${rows.length} swap steps${span}`;
}

export function renderTimeline(rows, minutes, now, loaded, busy=true, valuation=null, combined=false) {
  const host=$('timeline');host.replaceChildren();
  const {bins,stepMinutes,start,end}=flowTimeline(rows,minutes,now);
  const {firstShown,bins:visibleBins}=visibleFlowRange(bins),visibleStart=visibleBins[0]?.start??start;
  const caps=marketCapTimeline(rows,bins,combined?null:valuation).slice(firstShown),values=caps.filter(v=>v!=null),hasMC=values.length>0;
  $('market-cap-value').textContent=combined?'MC · select one listing':valuation?`Latest MC ${money(valuation.value)}`:busy?'Loading MC…':'MC unavailable';
  $('market-cap-value').title=valuation?`Latest reported snapshot retrieved ${easternDateTime(valuation.fetchedAt)}`:'';
  $('market-cap-note').textContent=combined?'Select one listing to see its market cap; caps are not added across contracts.':values.length?'Estimated MC uses trade price × supply implied by the latest reported MC and price, assuming unchanged supply. Gaps mean no observed price.':valuation?'Latest reported MC is shown above. No usable trade prices in this window to estimate the line.':busy?'Checking market cap…':'Market cap was not supplied for this listing. FDV is not substituted for MC.';
  $('mc-legend').hidden=!hasMC;
  $('timeline-interval').textContent=`${stepMinutes===1?'1-minute':'1-hour'} intervals · ET`;
  const defaultDetail=rows.length?`${minutes===1440?'24h':minutes===60?'1h':minutes+'m'} selected · ${firstShown>0?'Chart starts near first returned swap at '+easternDateTime(visibleStart)+'; earlier intervals have no returned swaps. ':''}Net ${money(bins.at(-1).cumulative)} · Hover or focus for details.`:loaded?'No observed swaps in this window.':busy?'Waiting for pool data.':'Swap data unavailable. Refresh to try again.';
  $('timeline-detail').textContent=defaultDetail;
  if(!rows.length){host.append(make('div',loaded?'No observed swaps to chart':busy?'Loading the flow timeline…':'Flow timeline unavailable','timeline-empty'));return}
  const ns='http://www.w3.org/2000/svg';
  const svgEl=(tag,attributes={})=>{const el=document.createElementNS(ns,tag);for(const [key,value]of Object.entries(attributes))el.setAttribute(key,String(value));return el};
  const chartWidth=Math.max(320,host.clientWidth);
  const svg=svgEl('svg',{viewBox:`0 0 ${chartWidth} 135`,role:'group','aria-label':'Observed buy and sell volume by interval, with estimated market cap when available'});
  const defs=svgEl('defs');
  for(const [id,colors]of [['flow-buy',['#8cf9d9','#2bdfaa','#159e7b']],['flow-sell',['#ffbacb','#fb7185','#c64266']]]){
    const gradient=svgEl('linearGradient',{id,x1:0,y1:0,x2:0,y2:1});
    colors.forEach((color,i)=>gradient.append(svgEl('stop',{offset:`${i*50}%`,'stop-color':color})));
    defs.append(gradient);
  }
  svg.append(defs);
  const label=(text,x,y,anchor='start')=>{const el=svgEl('text',{x,y,'text-anchor':anchor,fill:'#9da9b9','font-size':11});el.textContent=text;svg.append(el)};
  const left=chartWidth<500?54:70,right=chartWidth-(hasMC?(chartWidth<500?68:82):8),width=right-left,unit=width/visibleBins.length,top=23,bottom=101;
  const max=Math.max(...visibleBins.flatMap(b=>[b.buy,b.sell]),1e-8);
  const axisMoney=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:2}).format(v);
  for(const fraction of [0,.5,1]){const y=bottom-(bottom-top)*fraction;svg.append(svgEl('line',{x1:left,x2:right,y1:y,y2:y,stroke:'#283140'}));label(axisMoney(max*fraction),left-10,y+5,'end')}
  label('Swap volume · USD',left,14);
  if(hasMC){
    let minCap=Math.min(...values),maxCap=Math.max(...values);const padding=Math.max((maxCap-minCap)*.1,maxCap*.01);minCap=Math.max(0,minCap-padding);maxCap+=padding;
    const capY=v=>bottom-(v-minCap)/(maxCap-minCap)*(bottom-top);
    label('MC · est.',right+10,14);
    for(const fraction of [0,.5,1]){const value=minCap+(maxCap-minCap)*fraction,y=capY(value);const tick=svgEl('line',{x1:right,x2:right+5,y1:y,y2:y,stroke:'#7db9ff'});svg.append(tick);label(axisMoney(value),right+10,y+5)}
    let segment=[];const flush=()=>{if(segment.length>1)svg.append(svgEl('polyline',{points:segment.join(' '),fill:'none',stroke:'#7db9ff','stroke-width':2,'vector-effect':'non-scaling-stroke'}));segment=[]};
    caps.forEach((value,i)=>{if(value==null){flush();return}const x=left+(i+.5)*unit,y=capY(value);segment.push(`${x},${y}`);svg.append(svgEl('circle',{cx:x,cy:y,r:2.5,fill:'#7db9ff'}))});flush();
  }
  visibleBins.forEach((bin,i)=>{
    const x=left+i*unit,g=svgEl('g',{tabindex:0,role:'img'}),barWidth=Math.max(1,Math.min(18,unit*.34));
    for(const [side,offset]of [['buy',-.5],['sell',.5]]){const h=bin[side]/max*(bottom-top);g.append(svgEl('rect',{x:x+unit*.5+offset*barWidth,y:bottom-h,width:barWidth,height:h,fill:`url(#flow-${side})`}))}
    const description=`${easternRange(bin.start,bin.end)} · Buys ${money(bin.buy)} · Sells ${money(bin.sell)} · ${bin.count} steps · Cumulative net ${money(bin.cumulative)}${hasMC?caps[i]!=null?` · Est. MC ${money(caps[i])}`:' · MC not observed':''}`;
    g.setAttribute('aria-label',description);
    const title=svgEl('title');title.textContent=description;g.append(title);
    const target=svgEl('rect',{x,y:top,width:unit,height:bottom-top,fill:'transparent',class:'interval-hit'});g.append(target);
    g.addEventListener('mouseenter',()=>$('timeline-detail').textContent=description);g.addEventListener('focus',()=>$('timeline-detail').textContent=description);
    g.addEventListener('mouseleave',()=>$('timeline-detail').textContent=defaultDetail);g.addEventListener('blur',()=>$('timeline-detail').textContent=defaultDetail);
    svg.append(g);
  });
  label(stamp(visibleStart),left,125);label(stamp(visibleStart+(end-visibleStart)/2),left+width/2,125,'middle');label(stamp(end),right,125,'end');
  host.append(svg);
}

export function setupTape() {
  let current=[],loaded=false,busy=true,limit=20,expanded=new Set(),scope='';
  function stepRow(trade, child=false) {
    const tr=make('tr',null,child?'swap-step':''),time=make('td',`${easternDate(trade.time)}, ${easternTimeWithSeconds(trade.time)} ET`);
    time.title=easternDateTime(trade.time);
    const side=make('td');side.append(make('span',trade.side==='buy'?'Buy':'Sell',`side-badge ${trade.side}`));
    const pool=make('td',`${trade.pool} · ${trade.network}`,'pool-detail');pool.title=`${trade.pool} · ${trade.network}`;
    const wallet=make('td',short(trade.wallet),'wallet-detail');wallet.title=trade.wallet||'Wallet unavailable';
    const execution=make('td','—','execution-detail');
    if(trade.quantity!=null){const quantity=new Intl.NumberFormat('en-US',{maximumSignificantDigits:7}).format(trade.quantity);const price=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumSignificantDigits:7}).format(trade.price);execution.textContent=`${quantity} @ ${price}`;execution.title=`${trade.quantity} tokens at $${trade.price} per token`}
    const tx=make('td',short(trade.hash),'transaction');tx.title=trade.hash;
    const value=make('td',money(trade.usd),'numeric');
    for(const [cell,label]of [[time,'Time'],[side,'Side'],[value,'Value'],[pool,'Pool'],[wallet,'Wallet'],[execution,'Quantity @ price'],[tx,'Transaction']])cell.dataset.label=label;
    tr.append(time,side,value,pool,wallet,execution,tx);return tr;
  }
  function draw() {
    const rows=filterTrades(current,{side:$('trade-side').value,min:$('trade-min').value,wallet:$('trade-wallet').value});
    const grouped=$('trade-group').checked,items=grouped?groupTransactions(rows):rows;
    const body=$('tape');body.replaceChildren();
    for(const item of items.slice(0,limit)){
      if(!grouped){body.append(stepRow(item));continue}
      if(item.rows.length===1){body.append(stepRow(item.rows[0]));continue}
      const tr=make('tr',null,'transaction-group'),time=make('td'),button=make('button',`${expanded.has(item.key)?'▾':'▸'} ${easternDateTime(item.time)} · ${item.rows.length} steps`,'expand-trade');
      time.title=easternDateTime(item.time);
      button.type='button';button.setAttribute('aria-expanded',String(expanded.has(item.key)));button.setAttribute('aria-label',`Expand transaction ${short(item.hash)}, ${item.rows.length} matching swap steps`);
      time.append(button);const side=make('td'),mixed=item.buy>0&&item.sell>0;side.append(make('span',mixed?'Buy + sell':item.buy?'Buy':'Sell',`side-badge ${mixed?'mixed':item.buy?'buy':'sell'}`));
      const value=make('td',null,'numeric group-values');if(item.buy)value.append(make('span',`Buy ${money(item.buy)}`,'buy-text'));if(item.sell)value.append(make('span',`Sell ${money(item.sell)}`,'sell-text'));
      const pool=make('td',`${new Set(item.rows.map(t=>t.poolAddress)).size} pools · ${item.network}`,'pool-detail');
      const wallet=make('td','See steps','wallet-detail'),execution=make('td','See steps','execution-detail');
      const tx=make('td',short(item.hash),'transaction');tx.title=item.hash;
      for(const [cell,label]of [[time,'Time'],[side,'Side'],[value,'Value'],[pool,'Pool'],[wallet,'Wallet'],[execution,'Quantity @ price'],[tx,'Transaction']])cell.dataset.label=label;
      tr.append(time,side,value,pool,wallet,execution,tx);body.append(tr);
      const children=item.rows.map(row=>stepRow(row,true));for(const child of children){child.hidden=!expanded.has(item.key);body.append(child)}
      button.addEventListener('click',()=>{const open=!expanded.has(item.key);if(open)expanded.add(item.key);else expanded.delete(item.key);for(const child of children)child.hidden=!open;button.setAttribute('aria-expanded',String(open));button.textContent=`${open?'▾':'▸'} ${easternDateTime(item.time)} · ${item.rows.length} steps`});
    }
    if(!items.length){const tr=make('tr'),td=make('td',!loaded?(busy?'Waiting for swap data.':'Swap data unavailable. Refresh to try again.'):current.length?'No swaps match these filters. Reset filters to see the sample.':'No observed swaps in this window.','table-empty');td.colSpan=7;tr.append(td);body.append(tr)}
    $('tape-count').textContent=`${Math.min(limit,items.length)} / ${items.length} ${grouped?'GROUPS':'STEPS'} · ${rows.length} / ${current.length} STEPS MATCH`;
    $('load-more').hidden=limit>=items.length;$('load-more').textContent=`Load more (${Math.min(20,items.length-limit)})`;
  }
  for(const id of ['trade-side','trade-min','trade-wallet','trade-group'])$(id).addEventListener(id==='trade-side'||id==='trade-group'?'change':'input',()=>{limit=20;draw()});
  $('trade-reset').addEventListener('click',()=>{$('trade-side').value='all';$('trade-min').value='';$('trade-wallet').value='';$('trade-group').checked=true;limit=20;draw()});
  $('load-more').addEventListener('click',()=>{limit+=20;draw()});
  return (rows,isLoaded,scopeKey,isBusy=true)=>{if(scopeKey!==scope){scope=scopeKey;limit=20;expanded.clear()}current=rows;loaded=isLoaded;busy=isBusy;draw()};
}
