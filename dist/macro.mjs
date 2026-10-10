const chart=document.getElementById('comparison-chart');
function mount(range){
 const container=document.createElement('div');container.className='tradingview-widget-container';
 const frame=document.createElement('div');frame.className='tradingview-widget-container__widget';
 const attribution=document.createElement('div');attribution.className='tradingview-widget-copyright';
 const link=document.createElement('a');link.href='https://www.tradingview.com/';link.target='_blank';link.rel='noopener noreferrer';link.textContent='Market comparison by TradingView';attribution.append(link);
 const script=document.createElement('script');script.src='https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';script.async=true;
 script.textContent=JSON.stringify({autosize:true,symbol:'NASDAQ:QQQ',interval:range==='ALL'||range==='60M'?'W':'D',range,timezone:'Etc/UTC',theme:'dark',style:'2',locale:'en',allow_symbol_change:true,hide_side_toolbar:false,hide_top_toolbar:false,hide_legend:false,hide_volume:true,withdateranges:true,save_image:true,calendar:false,backgroundColor:'#0d1117',gridColor:'rgba(142,158,174,0.08)',compareSymbols:[{symbol:'BITSTAMP:BTCUSD',position:'SameScale'},{symbol:'OANDA:XAUUSD',position:'SameScale'}],studies:[]});
 script.addEventListener('error',()=>{const p=document.createElement('p');p.className='chart-loading';p.textContent='The market-data widget could not load. Use Open chart / fallback below.';frame.replaceChildren(p)});
 container.append(frame,attribution,script);chart.replaceChildren(container);
}
mount('12M');
document.querySelectorAll('[data-range]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-range]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));mount(button.dataset.range)}));
