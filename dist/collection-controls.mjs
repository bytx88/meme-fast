const groups=[
 {id:'markets',label:'Market engines',description:'Find markets, track the basket and measure runner conditions.',features:[
  ['markets','Token markets','Discovery and quote refresh for Tweet, Snipe and Swing. Pauses the shared collector, including Robinhood and automatic narrative matching.','new-coins.html','Open Snipe'],
  ['robinhood','Robinhood collection','Robinhood Chain pool indexing and market refresh. Runs inside Token markets; both controls must be on.','radar.html','Open Swing'],
  ['meme','Meme index','Saved basket quotes and historical recovery for the header’s Meme reading. BTC / Alt sampling continues when off.','meme-basket.html','Manage basket'],
  ['mode','Mode','Independent sampling for the Hard–Easy score. Pausing creates coverage gaps; reliable history needs time to rebuild.','model.html','View method'],
 ]},
 {id:'research',label:'Research signals',description:'Build news, social and broader market evidence around tokens.',features:[
  ['macro','Macro background review','Automatic cycle and liquidity review every 30 minutes. Opening Macro can still refresh it. Independent of X RSS.','macro.html','Open Macro'],
  ['context','Automatic narrative enrichment','Publisher news and token-profile matching inside Token markets. Both controls must be on. Saved context and manual research remain available.','sources.html','Manage sources'],
  ['x_rss','X RSS monitoring','Background sampling of indexed X posts for token social badges. Does not measure all X activity or engagement.','sources.html','Review sources'],
 ]},
 {id:'wallets',label:'Wallet intelligence',description:'Collect wallet observations and analyze holders and flows.',features:[
  ['wallets','Wallet analysis','Wallet scans, Smartness, holder rankings and wallet-flow collection. Off also blocks page-triggered wallet scans.','smart-wallets.html','Manage wallets'],
 ]},
];
const features=groups.flatMap(group=>group.features);
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function controlMarkup(state,{busy=false,error=''}={}){
 const known=features.filter(([key])=>typeof state?.features?.[key]?.enabled==='boolean');
 const on=known.filter(([key])=>state.features[key].enabled).length;
 return `<div class="collection-heading"><div><span class="control-eyebrow">OPERATIONS / COLLECTION</span><h2>Core function controls</h2><p>One switch for each engine. Settings apply across all browsers.</p></div><span class="control-summary">${known.length===features.length?`${on} / ${features.length} switched on`:'Loading settings…'}</span></div>
 ${groups.map((group,index)=>`<section class="control-group" aria-labelledby="group-${group.id}"><header><span class="control-number">0${index+1}</span><div><h3 id="group-${group.id}">${group.label}</h3><p>${group.description}</p></div></header><div class="collection-switches">${group.features.map(([key,label,description,href,link])=>{
  const available=typeof state?.features?.[key]?.enabled==='boolean';
  const enabled=state?.features?.[key]?.enabled===true;
  const blocked=enabled&&['robinhood','context'].includes(key)&&state?.features?.markets?.enabled===false;
  return `<article class="control-card" data-state="${available?(enabled?'on':'off'):'unknown'}"><div class="control-card-top"><h4>${label}</h4><button type="button" data-collection="${key}" aria-label="${enabled?'Turn off':'Turn on'} ${label}" aria-pressed="${enabled}" aria-describedby="description-${key}" ${!available||busy?'disabled':''}><span class="toggle-track" aria-hidden="true"><span></span></span><span>${available?(enabled?'On':'Off'):'…'}</span></button></div><p id="description-${key}">${description}</p>${blocked?'<p class="control-dependency">Waiting for Token markets to be turned on</p>':''}<a href="./${href}">${link} ↗</a><small>Default: ${['wallets','meme','mode'].includes(key)?'off':'on'}</small></article>`;
 }).join('')}</div></section>`).join('')}
 <aside class="collection-footnote"><strong>What stays available</strong><p>Saved history, manual research, BTC / Alt benchmarks and on-demand Stock data. Jean Phil automatic monitoring remains disabled. Jobs already running may finish after a switch is turned off.</p></aside>
 <div class="collection-footer"><p class="collection-status" role="status" aria-live="polite">${esc(error||(busy?'Saving…':state?'Settings saved on the server.':'Loading settings…'))}</p><button type="button" data-reload ${busy?'disabled':''}>Refresh settings</button></div>`;
}

export function mountCollectionControls(root,{fetcher=fetch}={}){
 let state=null,busy=false,error='';
 const render=()=>{root.innerHTML=controlMarkup(state,{busy,error})};
 async function request(options={}){
  const response=await fetcher('/api/collection-controls',{cache:'no-store',signal:AbortSignal.timeout(15000),...options});
  const value=await response.json();
  if(!response.ok)throw new Error(value.detail||'Could not save settings. Refresh before retrying.');
  if(!features.every(([key])=>typeof value.features?.[key]?.enabled==='boolean'))throw new Error('Settings are unavailable. Refresh before retrying.');
  return value;
 }
 async function load(){
  busy=true;error='';render();
  try{state=await request()}catch(e){state=null;error=e.message}
  finally{busy=false;render()}
 }
 root.addEventListener('click',async event=>{
  const button=event.target.closest('button');
  if(!button||busy)return;
  if(button.hasAttribute('data-reload')){await load();root.querySelector?.('[data-reload]')?.focus({preventScroll:true});return}
  const feature=button.dataset.collection;
  if(!state||!features.some(([key])=>key===feature))return;
  const enabled=!state.features[feature].enabled;
  busy=true;error='';render();
  try{state=await request({method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({feature,enabled})})}
  catch(e){state=null;error=e.message}
  finally{busy=false;render();root.querySelector?.(`[data-collection="${feature}"]`)?.focus({preventScroll:true})}
 });
 render();void load();
 return {reload:load};
}

if(typeof document!=='undefined'){
 const root=document.getElementById('collection-controls');
 if(root)mountCollectionControls(root);
}
