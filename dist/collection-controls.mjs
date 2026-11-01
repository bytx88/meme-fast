const features=[
 ['wallets','Wallet analysis','Wallet scans, Smartness, holder rankings and wallet-flow collection.'],
 ['meme','Meme index','Basket quote sampling and historical recovery. Hidden when off; BTC and Alt continue sampling. Default: off.'],
 ['mode','Mode','Background sampling for the Hard–Easy market score. Coverage needs time to rebuild after a pause.'],
 ['robinhood','Robinhood collection','Pool indexing, discovery and market refresh for Robinhood Chain. Default: on.'],
 ['context','Automatic narrative enrichment','Background publisher-news and profile matching to tokens. Saved context and manual research remain available. Default: on.'],
 ['x_rss','X RSS monitoring','Automatic social-badge sampling from indexed X posts. Macro refresh stays available. Default: on.'],
];
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function controlMarkup(state,{busy=false,error=''}={}){
 return `<div class="section-heading"><div><h2>Collection controls</h2><p>Wallet analysis, Meme index and Mode default to off. The other three default to on. Your switches are saved for all browsers.</p></div></div>
 <div class="collection-switches">${features.map(([key,label,description])=>{
  const enabled=state?.features?.[key]?.enabled===true;
  return `<article><div><h3>${label} <span>${state?(enabled?'On':'Off'):'Loading…'}</span></h3><p>${description}</p></div>
   <button type="button" data-collection="${key}" aria-label="${enabled?'Turn off':'Turn on'} ${label}" aria-pressed="${enabled}" ${!state||busy?'disabled':''}>${enabled?'Turn off':'Turn on'}</button></article>`;
 }).join('')}</div><p class="admin-note">Off pauses the selected background collection; Wallet analysis also blocks page-triggered scans. Saved history stays available, and jobs already running may finish. Solana and Base market collection stays on.</p>
 <p class="collection-status" role="status" aria-live="polite">${esc(error||(busy?'Saving…':state?'Settings saved on the server.':'Loading settings…'))}</p>
 <button type="button" data-reload ${busy?'disabled':''}>Refresh settings</button>`;
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
  if(button.hasAttribute('data-reload')){await load();return}
  const feature=button.dataset.collection;
  if(!state||!features.some(([key])=>key===feature))return;
  const enabled=!state.features[feature].enabled;
  busy=true;error='';render();
  try{state=await request({method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({feature,enabled})})}
  catch(e){state=null;error=e.message}
  finally{busy=false;render()}
 });
 render();void load();
 return {reload:load};
}

if(typeof document!=='undefined'){
 const root=document.getElementById('collection-controls');
 if(root)mountCollectionControls(root);
}
