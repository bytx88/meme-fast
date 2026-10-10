import snapshot from './macro-data.mjs';
import {assess,driverContext,usable,rotationRows,catalystSelection} from './macro-analysis.mjs';
import {compareSeries,visibleRows,symbols,periodReturn,executionReview,assetPeriods,seasonalFrames,frameReturns} from './macro-series.mjs';
const host=document.getElementById('comparison-chart');
const colours={QQQ:'#63a9ff',BTC:'#ffad55',XAU:'#6bdbb2'};
const names={QQQ:'Equity risk',BTC:'Crypto risk',XAU:'Spot gold'};
const pct=n=>n===null?'Unavailable':`${n>=0?'+':''}${n.toFixed(2)}%`;
const price=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:2,minimumFractionDigits:2}).format(n);
const niceDate=d=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(d));
const el=(name,cls,text)=>{const n=document.createElement(name);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const set=(id,text)=>document.getElementById(id).textContent=text;
const svgEl=(name,attrs,text)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;};
const sourceLinks={FED:'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',YIELD:'https://finance.yahoo.com/quote/%5ETNX/',BRENT:'https://finance.yahoo.com/quote/BZ%3DF/'};
let previousVisit=null,lastFetchAt=0;
try{const saved=JSON.parse(localStorage.getItem('meme-macro-last-visit')||'null');if(saved&&/^\d{4}-\d{2}-\d{2}$/.test(saved.date)&&Number.isFinite(saved.btc)&&saved.btc>0)previousVisit=saved;}catch{}
let report={...snapshot,drivers:{},news:[],feeds:{}},c,review,rows,svg,cursor,dots,x,y,from,to,tip,badge,windowDays=0,chartMode='performance',chartSymbols=symbols,assessment,renderTimer,selectedDate=null,selectedPoint=null;
const slider=document.getElementById('chart-date'),readout=document.getElementById('chart-readout');
function card(label,value,detail,tone=''){const n=el('article',tone);n.append(el('span','metric-label',label),el('strong','',value),el('p','',detail));return n;}
function driverRead(key){
 const list=report.drivers?.[key]||[],latest=list.at(-1),fresh=usable(report,key,assessment?.asOf||new Date().toISOString().slice(0,10));
 if(!latest)return {value:'Unavailable',detail:'No current observation; this channel cannot confirm the thesis.',tone:'amber',date:null};
 const retained=!fresh?' · unavailable / delayed; retained level':'';
 if(key==='FED'){
  let change=null;
  for(let i=list.length-1;i>0;i--)if(list[i].high!==list[i-1].high||list[i].low!==list[i-1].low){change={date:list[i].date,bp:(list[i].high-list[i-1].high)*100};break;}
  const next=report.feeds?.FEDCAL?.status==='ok'&&report.calendar?.find(row=>row.date>=assessment.asOf);
  return {value:`${latest.low.toFixed(2)}–${latest.high.toFixed(2)}%`,detail:(change?`Last rate change ${change.bp>0?'+':''}${change.bp.toFixed(0)} bp (${niceDate(change.date)}). `:'No change within the available statements. ')+(fresh?(next?`Next scheduled meeting end: ${niceDate(next.date)}. `:'Upcoming policy calendar unavailable. ')+'Market-implied path and policy surprise are unmeasured.':'Policy source unavailable or delayed; current interpretation withheld.'),tone:!fresh?'amber':'',date:latest.date,retained};
 }
 const context=driverContext(list),prior=list.at(-2),week=list.at(-6),day=prior?(key==='YIELD'?(latest.close-prior.close)*100:100*(latest.close/prior.close-1)):null;
 const five=week?(key==='YIELD'?(latest.close-week.close)*100:100*(latest.close/week.close-1)):null;
 const movement=n=>n===null?'Unavailable':key==='YIELD'?`${n>=0?'+':''}${n.toFixed(1)} bp`:pct(n);
 const direction=five===null?'unknown':five>0?'rising':five<0?'falling':'unchanged';
 const scale=context?.significant===null?'Insufficient volatility history.':context.significant?'Move exceeds one recent five-session volatility scale.':'Move is within the recent five-session fluctuation scale.';
 const percentile=context?.percentile===null?'':` Level: ${context.percentile.toFixed(0)}th percentile of ${context.sample} prior sessions.`;
 const effect=!fresh?'Source unavailable / delayed; directional conclusion withheld.':context.significant?(key==='YIELD'?(five>0?'Material yield rise challenges risk expansion.':'Material yield decline eases the rate hurdle; demand still needs to confirm.'):(five>0?'Material oil rise challenges inflation relief.':'Material oil decline supports energy relief.')):'Small directional change does not establish a macro regime shift.';
 return {value:key==='YIELD'?`${latest.close.toFixed(3)}%`:`$${price(latest.close)} / bbl`,detail:`1 session ${movement(day)} · 5 sessions ${movement(five)} (${direction}). ${scale}${percentile} ${effect}`,tone:!fresh?'amber':context.significant?(five>0?'negative':'positive'):'',date:latest.date,retained};
}
function showDrivers(){
 const panel=document.getElementById('driver-monitor');panel.replaceChildren();
 for(const [key,label] of [['FED','FED TARGET'],['YIELD','US 10Y YIELD / CBOE INDEX'],['BRENT','BRENT / FRONT-MONTH FUTURES']]){
  const r=driverRead(key),n=card(label,r.value,r.detail,r.tone);
  const a=el('a','driver-source',r.date?`Price / policy date: ${niceDate(r.date)}${r.retained||''} ↗`:'Source / retry status ↗');a.href=report.drivers?.[key]?.at(-1)?.sourceUrl||sourceLinks[key];a.target='_blank';a.rel='noopener noreferrer';n.append(a);panel.append(n);
 }
 set('rate-transmission',`Fed: ${driverRead('FED').value}. 10Y: ${driverRead('YIELD').value}. ${driverRead('YIELD').detail}`);
 set('feed-checked',report.attemptedAt?'Sources checked '+new Date(report.attemptedAt).toLocaleString('en-GB')+'. Scheduled every 30 minutes. Observation dates are separate from collection time; unavailable sources retain dated values.':'Published reference data shown while current sources are checked.');
 set('oil-transmission',`Brent: ${driverRead('BRENT').value}. ${driverRead('BRENT').detail}`);
}
function showLiquidity(){
 const a=assessment,p=report.positioning||{},panel=document.getElementById('liquidity-readings'),expanded=panel.querySelector('.liquidity-extra')?.open||false;panel.replaceChildren();
 const source=(n,key,label,url)=>{const latest=p[key]?.at(-1),link=el('a','driver-source',`${label}${latest?' · '+niceDate(latest.date):''}${!usable(report,key,a.asOf)?' · unavailable / delayed':''} ↗`);link.href=url;link.target='_blank';link.rel='noopener noreferrer';n.append(link);return n;};
 const oi=p.OI?.at(-1),f=p.FUNDING?.at(-1),etf=p.ETF?.at(-1);
 const positioningRead=a.clearing?'Price and OI contracted together. This supports position unwinding, not measured liquidations.':a.oi5>0&&a.oiPrice<0?'Positions grew while price fell: this does not support a completed leverage reset. Long / short attribution is unknown.':a.oi5>0&&a.oiPrice>0?'Price and positions expanded together; funding and spot demand determine whether leverage is becoming a constraint.':'Joint price / position contraction is not established.';
 panel.append(source(card('OPEN INTEREST / BTC CONTRACT SIZE',oi?`${Math.round(oi.btc).toLocaleString()} BTC`:'Unavailable',oi?`5 daily observations ${pct(a.oi5)} in BTC units; aligned BTC price ${pct(a.oiPrice)}. ${!a.oiFresh?'Interpretation withheld: source unavailable / delayed.':positioningRead}`:'No completed exchange OI observations.',!a.oiFresh?'amber':''),'OI','OKX BTC-USDT-SWAP','https://www.okx.com/docs-v5/en/#trading-statistics-rest-api-get-open-interest-history'));
 panel.append(source(card('SETTLED FUNDING / PER PAYMENT',f?`${(f.rate*100).toFixed(4)}%`:'Unavailable',f?`${new Date(f.timestamp).toLocaleString('en-GB')} · positive: longs pay shorts. ${!a.fundFresh?'Interpretation withheld: source unavailable / delayed.':a.rank===null?'Insufficient settlement history for comparison.':`${a.rank.toFixed(0)}th percentile of ${p.FUNDING.length} observed settlements. ${a.crowded?'Positive funding is in this sample’s upper decile.':'No upper-decile positive funding flag.'}`}`:'No settled funding observations.',!a.fundFresh?'amber':a.crowded?'negative':''),'FUNDING','OKX settled rates','https://www.okx.com/docs-v5/en/#public-data-rest-api-get-funding-rate-history'));
 panel.append(source(card('US SPOT BTC ETF / NET FLOWS',etf?`${etf.millionUsd>=0?'+':''}$${etf.millionUsd.toFixed(1)}m`:'Unavailable',etf?`Latest complete report; 5 reports ${a.flow5===null?'unavailable':`${a.flow5>=0?'+':''}$${a.flow5.toFixed(1)}m`}. ${!a.etfFresh?'Source unavailable / delayed; demand confirmation withheld.':'Flows measure this ETF channel, not all spot demand.'}`:'Provider did not supply complete accessible totals. ETF demand is unmeasured; the separate spot-taker channel keeps its exchange-only scope.',!a.etfFresh?'amber':a.flow5>0?'positive':'negative'),'ETF','Farside / complete totals','https://farside.co.uk/bitcoin-etf-flow-all-data/'));
 const etfNode=panel.lastElementChild;panel.removeChild(etfNode);
 panel.append(source(card('EXECUTED SPOT / TAKER BUY SHARE',a.spotBuyShare5===null?'Unavailable':`${a.spotBuyShare5.toFixed(1)}% buy`,!a.spotFresh?'Spot source unavailable / delayed; interpretation withheld.':a.spotBuyShare5===null?'Five contiguous completed daily buckets are unavailable; interpretation withheld.':`Five complete daily buckets. Latest taker sell share ${a.spotSellShare.toFixed(1)}%. ${a.absorptionCandidate?'Sell share ≥55% with a higher BTC/USDT daily low and close: a daily absorption candidate.':'The daily sell-pressure / held-price absorption pattern is not established.'} Participation rule: five-day buy share ≥55%; exchange coverage only.`,!a.spotFresh?'amber':a.spotBuyShare5>=55?'positive':a.spotBuyShare5!==null&&a.spotBuyShare5<50?'negative':''),'SPOT','OKX BTC spot','https://www.okx.com/docs-v5/en/#trading-statistics-rest-api-get-taker-volume'));
 const liq=p.LIQ||[],fresh=usable(report,'LIQ',a.asOf),longs=liq.filter(r=>r.side==='long').length,shorts=liq.filter(r=>r.side==='short').length;
 const detail=el('details','liquidity-extra');detail.open=expanded;detail.append(el('summary','','ETF source availability / observed liquidation sample'));const extra=el('div','driver-monitor two-channel');extra.append(etfNode,source(card('FILLED LIQUIDATIONS / BOUNDED SAMPLE',liq.length?`${liq.length} records`:'Unavailable',liq.length?`${longs} long / ${shorts} short records. ${new Date(liq[0].timestamp).toLocaleString('en-GB')} → ${new Date(liq.at(-1).timestamp).toLocaleString('en-GB')}. ${fresh?'Provider cap: 100 filled records; not a 24-hour total or market-wide liquidation volume.':'Source unavailable / delayed; retained sample is not current evidence.'}`:'No accessible recent filled-liquidation sample.',fresh?'':'amber'),'LIQ','OKX BTC-USDT-SWAP sample','https://www.okx.com/trade-market/liquidation-orders'));detail.append(extra);panel.append(detail);
 set('liquidity-scope','OI / funding / liquidations cover one OKX perpetual. Spot taker volumes cover OKX BTC spot activity; the daily price-response proxy uses OKX BTC/USDT candles. A ≥55% taker-sell share alongside a higher daily low and close is a candidate, not proof of passive absorption. No aggregate liquidation totals, order-book attribution or broad-alt breadth are inferred. A direct advance does not require a prior crash.');
}
function showJournal(){
 const history=[...(report.history||[])].sort((a,b)=>b.date.localeCompare(a.date)),body=document.getElementById('journal-body');body.replaceChildren();
 const get=row=>row.assessment||assess(row,row.observedAt.slice(0,10));
 for(const row of history.slice(0,10)){
  const a=get(row),tr=el('tr');tr.append(el('td','',niceDate(row.date)),el('td','',a.phase),el('td','',pct(a.q?.value??null)),el('td','',pct(a.g?.value??null)),el('td','',new Date(row.observedAt).toLocaleString('en-GB')));body.append(tr);
 }
 const previous=history.find(row=>row.date<assessment.date);
 set('journal-change',previous?`Since ${niceDate(previous.date)}: ${get(previous).phase} → ${assessment.phase}. ${assessment.phase===get(previous).phase?'No phase transition; check the individual evidence changes.':assessment.next}`:'First recorded session. Future sessions will show whether the evidence advances, stalls or fails; prior assessments are not backfilled.');
 set('journal-note',history.length?`${history.length} recorded session${history.length===1?'':'s'} · up to 120 retained · latest ten displayed. Current-session inputs update as sources arrive; earlier sessions retain their dated observations and saved assessment. All records are descriptive evidence rules, not probabilities.`:'Awaiting the first successful scheduled price collection. The journal does not infer a history from the bundled example.');
}
function showNews(previousVisit){
 const list=document.getElementById('daily-news-list');list.replaceChildren();
 const relevant=(report.news||[]).filter(row=>row.topic||/\b(fed|inflation|cpi|interest rates?|treasury|yields?|iran|oil|etf|volatility|steadies)\b/i.test(row.title));
 const news=catalystSelection(relevant);
 if(!news.length)list.append(el('p','news-empty','No recent relevant publisher headlines available. This does not establish that no catalysts occurred.'));
 for(const row of news){
  const n=el('article'),time=el('span','news-time',`${row.source}${row.topic?" / "+row.topic:""} · ${new Date(row.publishedAt).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}`);
  if(previousVisit&&Date.parse(row.publishedAt)>previousVisit.visitedAt)time.append(el('b','news-new',' NEW SINCE LAST VISIT'));
  const link=el('a','',row.title);if(/^https:\/\/(www\.)?(coindesk|cnbc)\.com\//.test(row.url)){link.href=row.url;link.target='_blank';link.rel='noopener noreferrer';}
  n.append(time,link);list.append(n);
 }
 const status=['CNBC','CoinDesk'].map(s=>`${s}: ${report.feeds?.[s]?.status==='ok'?'checked':'unavailable / retained'}`).join(' · ');
 set('news-freshness',`${status}. Headline feed covers the past seven days; individual stories have not been independently verified here. These are investigation leads. Price returns are not an event-response test; no bullish / bearish attribution is assigned automatically.`);
}
function showReview(saveVisit=false){
 review=executionReview(report.series);assessment=assess(report);
 try{c=compareSeries(report.series,'2025-10-01','2025-09-01');c.rows=c.rows.filter(r=>r.date>=c.anchor);}catch{c=null;host.replaceChildren(el('p','chart-loading','Three-asset comparison unavailable; the BTC / QQQ review continues independently.'));}
 const last=c?.rows.at(-1),r=review,feeds=report.feeds||{},failures=Object.entries(feeds).filter(([,v])=>v.status==='error').map(([k])=>k);
 set('review-date',niceDate(assessment.date||r.date).toUpperCase());
 set('review-freshness',`BTC daily candle ${niceDate(assessment.date)} · benchmark close ${niceDate(r.date)}${failures.length?' · unavailable: '+failures.join(', '):''}${!assessment.priceFresh?' · assessment withheld':''}`);
 set('review-headline',assessment.phase);
 set('review-verdict',`BTC $${price(report.series.BTC.at(-1).close)} · ${niceDate(assessment.date)}. ${assessment.summary}`);
 set('phase-next',assessment.next);set('phase-fail',assessment.invalidation);set('phase-next-level',assessment.referenceHigh===null?'Unavailable':`$${price(assessment.referenceHigh)}`);set('phase-fail-level',assessment.accepted?`$${price(assessment.referenceHigh)}`:assessment.low===null?'Unavailable':`$${price(assessment.low)}`);
 const support=[],pressure=[];
 if(assessment.priceFresh&&usable(report,'QQQ',assessment.asOf)&&r.metrics.BTC[20]>0)support.push(`BTC ${pct(r.metrics.BTC[20])} over 20 shared QQQ sessions; the five-session move is ${pct(r.metrics.BTC[5])}. Longer and shorter horizons differ.`);
 if(assessment.priceFresh&&assessment.high!==null&&!assessment.broken)support.push(assessment.accepted?'Price acceptance above the earlier daily range.':assessment.reclaimed?'One daily upper-range reclaim.':`Daily range remains intact above $${price(assessment.low)}; expansion is not established.`);
 if(assessment.clearing)support.push('OKX positions and aligned BTC price contracted together.');
 if(assessment.etfFresh&&assessment.flow5>0)support.push(`Five complete ETF reports: +$${assessment.flow5.toFixed(1)}m net demand.`);
 if(assessment.spotFresh&&assessment.spotBuyShare5>=55)support.push(`OKX five-day spot taker-buy share ${assessment.spotBuyShare5.toFixed(1)}% corroborates exchange participation.`);
 if(assessment.absorptionCandidate)support.push('OKX taker-sell imbalance accompanied a higher BTC/USDT daily low and close: absorption candidate, not proof.');
 if(assessment.spotFresh&&assessment.spotBuyShare5!==null&&assessment.spotBuyShare5<50)pressure.push(`OKX spot five-day taker-buy share ${assessment.spotBuyShare5.toFixed(1)}%: sell aggressors dominated the sample.`);
 for(const [key,label,value] of [['QQQ','QQQ',assessment.q],['XAU','gold',assessment.g]])if(value&&usable(report,key,assessment.asOf)){
  (value.value>0?support:pressure).push(`BTC / ${label} ${pct(value.value)} over five shared sessions (${niceDate(value.date)}).`);
 }
 if(assessment.oiFresh&&assessment.oi5>0&&assessment.oiPrice<0)pressure.push(`OKX OI +${assessment.oi5.toFixed(2)}% while aligned BTC price ${pct(assessment.oiPrice)}: positions grew during weakness.`);
 if(assessment.broken)pressure.push('Daily close below the prior range low.');
 for(const [key,label,value] of [['YIELD','10Y yield',assessment.yield],['BRENT','Brent',assessment.oil]])if(value&&usable(report,key,assessment.asOf)){
  if(value.percentile>=80)pressure.push(`${label} level is in the upper fifth of its last ${value.sample} sessions; ${value.significant?'the five-session move also exceeds the recent fluctuation scale.':'the five-session move remains within the recent fluctuation scale.'}`);
  if(value.significant&&value.change5<0)support.push(`${label} fell beyond the recent five-session fluctuation scale.`);
 }
 const balance=document.getElementById('thesis-balance');balance.replaceChildren();
 for(const [label,items,tone] of [['SUPPORTING EVIDENCE',support,'support'],['COUNTER-EVIDENCE',pressure,'pressure']]){const n=el('article',tone);n.append(el('b','',label));if(!items.length)n.append(el('p','','No fresh corroborating evidence in the measured channels.'));else for(const item of items)n.append(el('p','',item));balance.append(n);}
 const checks=document.getElementById('phase-checks');checks.replaceChildren();
 for(const row of assessment.checks){const n=el('article',row.status);n.append(el('b','',row.label),el('span','',row.status==='unknown'?'UNMEASURED / INCOMPLETE':row.status.toUpperCase()),el('p','',row.detail));checks.append(n);}
 const stateRead=assessment.summary;
 const signals=document.getElementById('review-signals');signals.replaceChildren(
  card('BTC / QQQ · 5-SESSION RELATIVE RETURN',pct(r.relative),!assessment.priceFresh||!usable(report,'QQQ',assessment.asOf)?`Retained closes dated ${niceDate(r.date)}; current benchmark confirmation unavailable.`:r.relative===null?'Insufficient shared history.':r.relative>0?'Crypto is gaining relative strength.':r.relative<0?'Crypto is losing relative strength.':'No relative change.',!assessment.priceFresh||!usable(report,'QQQ',assessment.asOf)?'amber':r.relative>0?'positive':r.relative<0?'negative':''),
  card('BTC · RECLAIM REFERENCE',assessment.referenceHigh===null?'Unavailable':`$${price(assessment.referenceHigh)}`,assessment.accepted?'Retained high of the 20-day range preceding two-close acceptance.':assessment.failedAcceptance?'Earlier accepted range high; acceptance has been lost.':'Highest daily high of the preceding 20 BTC days. Current candle excluded.'),
  card('BTC · DAILY RANGE LOW',assessment.low===null?'Unavailable':`$${price(assessment.low)}`,'Lowest daily low of the preceding 20 BTC days. A close below challenges the range.')
 );
 const body=document.getElementById('return-body');body.replaceChildren();
 for(const s of ['BTC','QQQ','XAU']){
  const actual=assetPeriods(report.series[s]||[],report.series.QQQ.map(row=>row.date)),tr=el('tr');tr.append(el('th','',s),el('td','',actual?niceDate(actual.date):'Unavailable'));for(const n of [1,5,20]){const value=actual?.returns[n]??null;tr.append(el('td',value>0?'positive':value<0?'negative':'',pct(value)));}tr.append(el('td','',actual?`$${price(actual.close)}`:'Unavailable'));body.append(tr);
 }
 const bitcoin=assetPeriods(report.series.BTC);set('btc-weekend',bitcoin.date>r.date?'Newer BTC daily close: $'+price(bitcoin.close)+' on '+niceDate(bitcoin.date)+' ('+pct(bitcoin.returns[1])+' over one UTC day). The equity-relative review remains dated '+niceDate(r.date)+'.':'');
 const leadership=`As of ${niceDate(r.date)}: 5-session BTC / QQQ relative return ${pct(r.relative)}. ${stateRead}`;
 set('comparison-read',leadership);set('map-market-read',leadership);set('flow-transmission',`BTC 5 sessions: ${pct(r.metrics.BTC[5])}; QQQ: ${pct(r.metrics.QQQ[5])}. ${r.relative>0?'BTC is gaining':'BTC is losing'} relative strength. This measures price participation, not ETF-flow volume.`);
 let previous=null;
 try{
  previous=previousVisit;
  const driverValues=Object.fromEntries(Object.entries(report.drivers||{}).map(([key,value])=>[key,value.at(-1)]));
  const driverChanges=[];
  for(const key of ['FED','YIELD','BRENT']){const a=previous?.drivers?.[key],b=driverValues[key];if(!a||!b||b.date<a.date||report.feeds?.[key]?.status==='error')continue;const delta=key==='FED'?(b.high-a.high)*100:key==='YIELD'?(b.close-a.close)*100:100*(b.close/a.close-1);if(Math.abs(delta)>.001)driverChanges.push(key==='BRENT'?'Brent '+pct(delta):(key==='FED'?'Fed ':'10Y ')+(delta>=0?'+':'')+delta.toFixed(1)+' bp');}
  if(previous?.date&&previous.date<r.date)set('visit-change',`Since your last visit (${niceDate(previous.date)}): BTC close ${pct(100*(r.price/previous.btc-1))}; setup ${previous.state} → ${r.state}. ${driverChanges.length?driverChanges.join(' · ')+'.':''}`);
  else set('visit-change',previous?.date>r.date?'Current shared closes are older than the previous visit; change comparison withheld.':previous?.date===r.date?'No new shared closing session since your last visit. '+(driverChanges.length?driverChanges.join(' · ')+'. ':'')+'Check newly published headlines.':'First visit here. On return, this line compares the closing price and setup with your previous visit.');
  if(saveVisit&&(!previous?.date||r.date>=previous.date))localStorage.setItem('meme-macro-last-visit',JSON.stringify({date:r.date,btc:r.price,state:r.state,drivers:driverValues,visitedAt:Date.now()}));
 }catch{set('visit-change','Previous-visit comparison is unavailable because this browser cannot store local history.');}
 showDrivers();showLiquidity();showJournal();showNews(previous);
 document.getElementById('download-comparison').disabled=!c;
 if(!c)return;
 const summary=document.getElementById('comparison-summary');summary.replaceChildren();
 for(const s of symbols){const n=el('article');n.style.setProperty('--series',colours[s]);n.append(el('span','series-name',`${s} / ${names[s]}`),el('strong','',`$${price(last.prices[s])}`),el('small','',`5 shared sessions ${pct(periodReturn(c.rows,s,5))} · ${niceDate(last.date)}`));summary.append(n);}
 const frames=seasonalFrames('2025-10-01',last.date),scores=document.getElementById('season-scorecard');scores.replaceChildren();
 for(const frame of frames){const actual=frameReturns(c.rows,frame),n=el('article',frame.complete?'':'current-season');n.append(el('b','',`${frame.label} ${frame.start.slice(0,4)}${frame.end.slice(0,4)!==frame.start.slice(0,4)?'–'+frame.end.slice(2,4):''}`),el('small','',frame.complete?'COMPLETED WINDOW':'CURRENT WINDOW / IN PROGRESS'));
  if(actual){for(const s of symbols){const line=el('span','',`${s} ${pct(actual.returns[s])}`);line.style.color=colours[s];n.append(line);}n.append(el('small','',`Baseline ${niceDate(actual.anchor)} → ${niceDate(actual.last)}`));}else n.append(el('span','','Awaiting enough closes'));scores.append(n);}
 const completed=frames.filter(f=>f.complete&&f.label==='Oct–Jan').map(f=>frameReturns(c.rows,f)).filter(Boolean);
 if(completed.length&&completed.at(-1).returns.BTC<0){const note=el('p','season-test',`Thesis test: BTC fell ${Math.abs(completed.at(-1).returns.BTC).toFixed(2)}% in the previous observed Oct–Jan window. The calendar alone did not produce expansion; the current window needs price and participation confirmation.`);scores.append(note);}
 set('chart-method',`Full-view line return = close / ${c.anchor} close − 1. Seasonal cards include the return from the last available shared close before each frame; current returns are partial. The 90-day view and BTC leadership ratios rebase at the first displayed close. Daily returns use each asset’s available QQQ dates; the technical range uses 20 preceding UTC BTC daily highs / lows. Daily candles can identify a sweep-and-recovery pattern, not absorption, trader intent or an intraday held retest. Macro significance uses one standard deviation of the last 60 daily returns scaled by √5; this is a descriptive rule, not a statistical forecast.`);
 set('chart-freshness',`Observed through ${niceDate(last.date)}. Shading marks seasonal windows; the future portion has no price path.`);
 render();
}
function inspect(index,point){
 index=Math.max(0,Math.min(rows.length-1,index));slider.value=index;const r=rows[index];
 if(point){selectedDate=r.date;selectedPoint=point;}
 const date=niceDate(r.date);readout.textContent=`${date} · ${chartSymbols.map(s=>chartMode==='rotation'?`BTC / ${s} ${pct(r.returns[s])}`:`${s} $${price(r.prices[s])} (${pct(r.returns[s])})`).join(' · ')}`;
 cursor.setAttribute('x1',x(Date.parse(r.date)));cursor.setAttribute('x2',x(Date.parse(r.date)));
 for(const s of chartSymbols){dots[s].setAttribute('cx',x(Date.parse(r.date)));dots[s].setAttribute('cy',y(r.returns[s]));}
 badge.textContent=date;
 tip.replaceChildren(el('strong','',date),el('small','',chartMode==='rotation'?'BTC relative performance / current view reference':'Price / change from current view reference'));
 for(const s of chartSymbols){const line=el('div','tooltip-line'+(chartMode==='rotation'?' ratio-line':''));line.style.color=colours[s];if(chartMode==='rotation')line.append(el('b','',`BTC / ${s}`),el('span','',pct(r.returns[s])));else line.append(el('b','',s),el('span','',`$${price(r.prices[s])}`),el('span','',pct(r.returns[s])));tip.append(line);}
 if(point){tip.hidden=false;const width=host.clientWidth,tipWidth=Math.min(330,width-16);tip.style.width=tipWidth+'px';tip.style.left=Math.max(8,Math.min(width-tipWidth-8,point.x+18))+'px';tip.style.top=Math.max(8,Math.min(host.clientHeight-150,point.y-90))+'px';}
}
function render(){
 rows=visibleRows(c,windowDays).filter(r=>r.date>='2025-10-01');document.getElementById('season-scorecard').hidden=!!windowDays;chartSymbols=chartMode==='rotation'?['QQQ','XAU']:symbols;if(chartMode==='rotation')rows=rotationRows(rows);else if(windowDays){const first=rows[0];rows=rows.map(r=>({...r,returns:Object.fromEntries(symbols.map(s=>[s,100*(r.prices[s]/first.prices[s]-1)]))}));}set('chart-reference',`${chartMode==='rotation'?'BTC / QQQ · BTC / XAU ratios':'QQQ · BTC · XAU performance'} · zero reference ${niceDate(chartMode==='rotation'||windowDays?rows[0].date:c.anchor)}`);const last=c.rows.at(-1),frames=seasonalFrames('2025-10-01',last.date);
 const w=Math.max(360,host.clientWidth),h=w<600?300:370,left=w<600?44:64,right=24,top=44,bottom=50;
 from=Date.parse(windowDays?rows[0].date:'2025-10-01');to=Date.parse(windowDays?last.date:frames.at(-1).end);if(to<=from)to=from+86400000;
 const legend=document.getElementById('chart-legend');legend.replaceChildren();for(const s of chartSymbols){const label=el('b','',chartMode==='rotation'?`BTC / ${s}`:s);label.style.color=colours[s];legend.append(label);}
 const values=rows.flatMap(r=>chartSymbols.map(s=>r.returns[s]));let low=Math.floor(Math.min(0,...values)/10)*10-5,high=Math.ceil(Math.max(0,...values)/10)*10+5;
 x=t=>left+(t-from)/(to-from)*(w-left-right);y=v=>top+(high-v)/(high-low)*(h-top-bottom);
 svg=svgEl('svg',{viewBox:`0 0 ${w} ${h}`,role:'img','aria-label':`${chartMode==='rotation'?'BTC leadership versus QQQ and gold':'QQQ, BTC and gold performance'} through ${niceDate(last.date)}`});
 for(let i=0;i<frames.length;i++){
  const frame=frames[i],a=Math.max(from,Date.parse(frame.start)),b=Math.min(to,Date.parse(frame.end));if(a>=b)continue;
  svg.append(svgEl('rect',{x:x(a),y:0,width:x(b)-x(a),height:h-bottom,fill:i%2?'#142431':'#101b24',opacity:.8}),svgEl('line',{x1:x(a),x2:x(a),y1:0,y2:h-bottom,stroke:'#496278','stroke-dasharray':'3 4'}));
  if(x(b)-x(a)>95)svg.append(svgEl('text',{x:(x(a)+x(b))/2,y:21,'text-anchor':'middle',fill:frame.complete?'#b6c4d0':'#d5b57a','font-size':w<600?11:13},`${frame.label} ${frame.complete?'':' / current'}`));
 }
 for(let i=0;i<=4;i++){const v=low+(high-low)*i/4;svg.append(svgEl('line',{x1:left,x2:w-right,y1:y(v),y2:y(v),stroke:'#2a3947'}),svgEl('text',{x:left-8,y:y(v)+4,'text-anchor':'end',fill:'#a9bac9','font-size':w<600?11:13},`${v.toFixed(0)}%`));}
 svg.append(svgEl('line',{x1:left,x2:w-right,y1:y(0),y2:y(0),stroke:'#74808b','stroke-dasharray':'4 4'}));
 let tick=new Date(from);tick.setUTCDate(1);if(tick.getTime()<from)tick.setUTCMonth(tick.getUTCMonth()+1);
 const tickStep=w<600&&!windowDays?3:!windowDays?2:1;
 while(tick.getTime()<=to){const t=tick.getTime();svg.append(svgEl('text',{x:x(t),y:h-20,'text-anchor':'middle',fill:'#c5d3df','font-size':w<600?12:14},new Intl.DateTimeFormat('en-GB',{month:'short',year:'2-digit',timeZone:'UTC'}).format(tick)));tick.setUTCMonth(tick.getUTCMonth()+tickStep);}
 for(const s of chartSymbols){svg.append(svgEl('polyline',{points:rows.map(r=>`${x(Date.parse(r.date))},${y(r.returns[s])}`).join(' '),fill:'none',stroke:colours[s],'stroke-width':2.2,'stroke-linejoin':'round','vector-effect':'non-scaling-stroke'}));}
 if(!windowDays){const current=x(Date.parse(last.date));svg.append(svgEl('line',{x1:current,x2:current,y1:top,y2:h-bottom,stroke:'#cfb782','stroke-dasharray':'4 4'}));if(w-right-current>95)svg.append(svgEl('text',{x:current+(w-right-current)/2,y:h/2,fill:'#9daeba','text-anchor':'middle','font-size':w<600?10:12},'No shared data yet'));}
 cursor=svgEl('line',{y1:top,y2:h-bottom,stroke:'#dae1e7','stroke-dasharray':'3 3'});svg.append(cursor);dots={};
 for(const s of chartSymbols){dots[s]=svgEl('circle',{r:4,fill:colours[s]});svg.append(dots[s]);}
 tip=el('div','chart-tooltip');tip.hidden=true;badge=el('div','chart-date-badge');
 svg.addEventListener('pointermove',event=>{const rect=svg.getBoundingClientRect(),t=from+((event.clientX-rect.left)/rect.width*w-left)/(w-left-right)*(to-from);let nearest=0;rows.forEach((r,i)=>{if(Math.abs(Date.parse(r.date)-t)<Math.abs(Date.parse(rows[nearest].date)-t))nearest=i;});inspect(nearest,{x:event.clientX-rect.left,y:event.clientY-rect.top});if(t>Date.parse(last.date)+86400000){const date=niceDate(new Date(Math.min(to,t)));badge.textContent=date;cursor.setAttribute('x1',x(Math.min(to,t)));cursor.setAttribute('x2',x(Math.min(to,t)));tip.replaceChildren(el('strong','',date),el('p','','No shared closing observation for this date. Last plotted close: '+niceDate(last.date)+'. No projected price path.'));}});
 svg.addEventListener('pointerleave',()=>{tip.hidden=true;selectedPoint=null;});
 host.replaceChildren(svg,tip,badge);slider.max=rows.length-1;inspect(selectedDate&&rows.some(r=>r.date===selectedDate)?rows.findIndex(r=>r.date===selectedDate):rows.length-1,selectedPoint);
}
document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));chartMode=button.dataset.mode;render();}));
slider.addEventListener('input',()=>inspect(Number(slider.value),{x:host.clientWidth/2,y:80}));
document.querySelectorAll('[data-window]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-window]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));windowDays=Number(button.dataset.window);render();}));
document.getElementById('download-comparison').addEventListener('click',()=>{const lines=['date,QQQ_close,BTC_USD_close,XAU_USD_per_oz,QQQ_return_pct,BTC_return_pct,XAU_return_pct',...c.rows.map(r=>[r.date,...symbols.map(s=>r.prices[s]),...symbols.map(s=>r.returns[s])].join(','))];const url=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/csv'})),a=el('a');a.href=url;a.download='macro-seasonal-comparison.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
new ResizeObserver(()=>{clearTimeout(renderTimer);renderTimer=setTimeout(()=>{if(c)render();},100);}).observe(host);
async function refresh(){
 const button=document.getElementById('refresh-review');if(button.disabled)return;lastFetchAt=Date.now();button.disabled=true;button.textContent='Checking sources…';
 try{
  const response=await fetch('/api/macro-review',{cache:'no-store',signal:AbortSignal.timeout(40000)});
  if(!response.ok)throw Error('Source request unavailable');
  const next=await response.json();executionReview(next.series);report=next;showReview(true);
 }catch{
  showReview(false);set('review-freshness',`Refresh unavailable · retained observations through ${niceDate(assessment.date)}`);
 }finally{button.disabled=false;button.textContent='Refresh observations';}
}
document.getElementById('refresh-review').addEventListener('click',refresh);
const refreshIfDue=()=>{if(document.visibilityState==='visible'&&Date.now()-lastFetchAt>=1800000)refresh();};
document.addEventListener('visibilitychange',refreshIfDue);setInterval(refreshIfDue,60000);
try{showReview(false);}catch(error){host.replaceChildren(el('p','chart-loading',`Comparison unavailable: ${error.message}`));}
refresh();
