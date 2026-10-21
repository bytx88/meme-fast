import {isContractAddress} from './recent-contracts.mjs';
const KEY='meme-fast:known-tokens:v1';
const networks={ethereum:'eth',polygon:'polygon_pos',avalanche:'avax',bnb:'bsc'};
export function mergeKnownTokens(...groups){
  const tokens=new Map();
  for(const row of groups.flat()){
    if(!row||row.unverified||row.contract_verified===false)continue;
    const address=String(row.address||row.contract_address||'').trim(),network=networks[row.network]||row.network;
    if(!isContractAddress(address)||typeof network!=='string'||!network)continue;
    const symbol=String(row.symbol||'').trim().slice(0,80),name=String(row.name||symbol).trim().slice(0,160);
    if(!symbol||symbol==='Contract'||!name)continue;
    const key=network+':'+(address.startsWith('0x')?address.toLowerCase():address);
    tokens.set(key,{address,network,symbol,name});
  }
  return [...tokens.values()].slice(-10000);
}
export function matchKnownTokens(tokens,query,limit=12){
  const q=String(query).normalize('NFKC').trim().toLowerCase().replace(/^\$/,'');
  if(!q)return [];
  const score=t=>{const symbol=t.symbol.normalize('NFKC').toLowerCase(),name=t.name.normalize('NFKC').toLowerCase();
    return symbol===q?0:name===q?1:symbol.startsWith(q)?2:name.startsWith(q)?3:symbol.includes(q)?4:name.includes(q)?5:t.address.toLowerCase().includes(q)?6:99};
  return tokens.map(t=>({t,score:score(t)})).filter(r=>r.score<99)
    .sort((a,b)=>a.score-b.score||a.t.symbol.localeCompare(b.t.symbol)||a.t.network.localeCompare(b.t.network)||a.t.address.localeCompare(b.t.address))
    .slice(0,limit).map(r=>r.t);
}
export function setupTokenSuggestions({input,panel,list,status,onSelect,initial=[],fetcher=fetch,storage=()=>localStorage,doc=document}){
  let tokens=[],matches=[],active=-1,loaded=false,loading=false,failed=false,dismissed=false;
  try{tokens=mergeKnownTokens(JSON.parse(storage().getItem(KEY)||'[]'))}catch{}
  function remember(rows){tokens=mergeKnownTokens(tokens,rows);try{storage().setItem(KEY,JSON.stringify(tokens))}catch{}render()}
  const close=()=>{dismissed=true;panel.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1};
  function pick(token){close();onSelect(token)}
  function highlight(){[...list.children].forEach((row,index)=>{row.setAttribute('aria-selected',String(index===active));if(index===active){input.setAttribute('aria-activedescendant',row.id);row.scrollIntoView?.({block:'nearest'})}})}
  function render(){
    if(dismissed||doc.activeElement!==input||!input.value.trim()){close();return}
    matches=matchKnownTokens(tokens,input.value);active=-1;list.replaceChildren();
    for(const [index,token]of matches.entries()){
      const row=doc.createElement('div');row.id=`known-token-${index}`;row.className='token-suggestion';row.setAttribute('role','option');row.setAttribute('aria-selected','false');
      const title=doc.createElement('strong'),name=doc.createElement('span'),meta=doc.createElement('small');
      title.textContent=token.symbol;name.textContent=token.name;meta.textContent=`${token.network} · ${token.address}`;
      row.append(title,name,meta);row.addEventListener('pointerdown',event=>event.preventDefault());row.addEventListener('click',()=>pick(token));list.append(row);
    }
    status.textContent=matches.length?`${matches.length} known match${matches.length===1?'':'es'} · ↑ ↓ to choose · Enter to open`:
      loading?'Loading saved token list…':failed?'Saved list unavailable · press Enter to search': 'No known matches · press Enter to search';
    panel.hidden=false;input.setAttribute('aria-expanded','true');input.removeAttribute('aria-activedescendant');
  }
  async function preload(){
    if(loaded||loading)return;loading=true;render();
    try{const response=await fetcher('/api/new-coins?view=catalog',{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error();const data=await response.json();if(!Array.isArray(data.coins))throw Error();remember(data.coins);loaded=true;failed=false}catch{failed=true}finally{loading=false;render()}
  }
  input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','false');
  input.addEventListener('focus',()=>{dismissed=false;render();void preload()});input.addEventListener('input',()=>{dismissed=false;render()});
  input.addEventListener('keydown',event=>{
    if(event.isComposing)return;
    if(event.key==='Escape'){close();return}
    if(panel.hidden||!matches.length)return;
    if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();active=active<0?(event.key==='ArrowDown'?0:matches.length-1):(active+(event.key==='ArrowDown'?1:-1)+matches.length)%matches.length;highlight()}
    if(event.key==='Enter'){event.preventDefault();pick(matches[active<0?0:active])}
  });
  input.addEventListener('blur',close);doc.addEventListener('pointerdown',event=>{if(!panel.contains(event.target)&&event.target!==input)close()});
  remember(initial);
  return {remember,close};
}
