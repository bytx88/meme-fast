const format=(n,unit='%')=>Number.isFinite(n)?`${n>=0?'+':''}${n.toFixed(2)}${unit}`:'—';
const color=n=>n>=0?'positive':'negative';
const shortNames={XLE:'Energy',XLP:'Staples',XLV:'Health',XLU:'Utilities',XLB:'Materials',XLRE:'Real estate',XLY:'Discretionary',XLF:'Financials',XLI:'Industrials',XLC:'Communications',XLK:'Technology',GLD:'Gold Shares',COPX:'Copper Miners'};

export function rankingRows(rows,measure='ret',sort='current'){
 const previousKey=measure==='relative'?'previousRelative':'previousRet';
 const currentOrder=rows.filter(r=>Number.isFinite(r[measure])).sort((a,b)=>b[measure]-a[measure]);
 const previousOrder=rows.filter(r=>Number.isFinite(r[previousKey])).sort((a,b)=>b[previousKey]-a[previousKey]);
 const ranked=rows.map(r=>{
  const current=r[measure],previous=r[previousKey],currentRank=Number.isFinite(current)?currentOrder.findIndex(x=>x.symbol===r.symbol)+1:null;
  const previousRank=Number.isFinite(previous)?previousOrder.findIndex(x=>x.symbol===r.symbol)+1:null;
  const comparable=currentRank!==null&&previousRank!==null;
  return {...r,current,previous,currentRank,previousRank,change:comparable?current-previous:null,movement:comparable?previousRank-currentRank:null};
 });
 const key={current:'current',previous:'previous',change:'change',rank:'movement'}[sort]||'current';
 return ranked.sort((a,b)=>{
  const aValid=Number.isFinite(a[key]),bValid=Number.isFinite(b[key]);
  if(aValid!==bValid)return aValid?-1:1;
  return (aValid?b[key]-a[key]:0)||(a.currentRank??rows.length+1)-(b.currentRank??rows.length+1);
 });
}

export function rankingMarkup(model,{measure='ret',sort='current',view='current'}={}){
 const rows=rankingRows(model.rows,measure,sort),unit=measure==='relative'?' pp':'%';
 const previousLabel=model.windows.previous?.label||'Unavailable',currentLabel=model.windows.current.label;
 const heading=label=>label.replace(/\s20\d\d/g,'');
 const fund=r=>`<button class="ranking-sector" data-sector="${r.symbol}" title="Explore ${r.name}"><b>${r.symbol}</b><small>${shortNames[r.symbol]??r.name}</small></button>`;
 const sideLimit=Math.max(...rows.flatMap(r=>[Math.abs(r.current??0),Math.abs(r.previous??0)]),.01);
 const cell=(value,limit)=>`<div class="ranking-cell" aria-label="${format(value,unit)}"><div class="ranking-track"><span style="width:${Number.isFinite(value)?Math.min(100,Math.abs(value)/limit*100):0}%;background:${value>=0?'#15a77c':'#ca4b6e'}"></span></div><span class="ranking-value ${Number.isFinite(value)?color(value):''}">${format(value,unit)}</span></div>`;
 if(view==='current'||view==='previous'){
  const previous=view==='previous',label=previous?previousLabel:currentLabel;
  return `<div class="ranking-single ranking-head"><span>ETF</span><span title="${label}">${previous?'PREV':'NOW'} · ${heading(label)}</span></div>`+rows.map(r=>`<div class="ranking-single ranking-line">${fund(r)}${cell(previous?r.previous:r.current,sideLimit)}</div>`).join('');
 }
 if(view==='side')return `<div class="ranking-side ranking-head"><span>ETF</span><span title="${previousLabel}">PREV · ${heading(previousLabel)}</span><span title="${currentLabel}">NOW · ${heading(currentLabel)}</span></div>`+rows.map(r=>`<div class="ranking-side ranking-line">${fund(r)}${cell(r.previous,sideLimit)}${cell(r.current,sideLimit)}</div>`).join('');
 const limit=Math.max(...rows.map(r=>Math.abs(r.change??0)),.01);
 return `<div class="ranking-change ranking-head"><span>ETF</span><span>CHANGE · pp</span><span>Rank</span></div>`+rows.map(r=>{
  const width=Math.abs(r.change??0)/limit*50,movement=r.movement===null?'—':r.movement>0?'↑'+r.movement:r.movement<0?'↓'+Math.abs(r.movement):'↔';
  return `<div class="ranking-change ranking-line">${fund(r)}<div class="ranking-change-cell"><div class="ranking-delta-track"><span style="left:${(r.change??0)>=0?50:50-width}%;width:${width}%;background:${(r.change??0)>=0?'#15a77c':'#ca4b6e'}"></span></div><strong class="${r.change===null?'':color(r.change)}">${format(r.change,' pp')}</strong><small>${format(r.previous,unit)} → ${format(r.current,unit)}</small></div><span class="ranking-rank" title="${r.movement===null?'Rank comparison unavailable':'Previous #'+r.previousRank+' → current #'+r.currentRank}">${movement}<small>${r.movement===null?'—':'#'+r.previousRank+' → #'+r.currentRank}</small></span></div>`;
 }).join('');
}
