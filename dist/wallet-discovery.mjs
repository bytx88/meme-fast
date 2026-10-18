import {isSolanaAddress} from './lookup.mjs';
import {formatSmartNumber} from './smart-number.mjs';

export function parseAddressList(text,limit=150){
 const addresses=[...new Set(text.split(/[\s,;]+/).map(value=>value.trim()).filter(Boolean))];
 if(!addresses.length||addresses.length>limit)throw new Error(`Enter 1 to ${limit} distinct Solana addresses.`);
 const invalid=addresses.filter(value=>!isSolanaAddress(value));
 if(invalid.length)throw new Error('Invalid Solana address: '+invalid[0]);
 return addresses;
}

export function createWalletDiscovery({registry,request,refresh}){
 const $=id=>document.getElementById(id),short=value=>value.slice(0,8)+'…'+value.slice(-5);
 const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 let candidates=[],preview=null,busy=false,controller=null;
 function render(){
  const known=new Set(registry().map(row=>row.address));
  $('discover-candidates').innerHTML=candidates.length?candidates.map((row,index)=>`<tr><td><a href="https://solscan.io/account/${esc(row.address)}" target="_blank" rel="noopener noreferrer">${esc(short(row.address))} ↗</a><small>Unverified holder candidate</small></td><td><a href="./order-flow.html?query=${encodeURIComponent(row.discoveryToken)}">${esc(short(row.discoveryToken))} ↗</a></td><td>${formatSmartNumber(row.balance)}<small>Sampled token accounts only</small></td><td><input type="checkbox" data-candidate-interest="${index}" aria-label="Interested: ${esc(row.address)}" ${row.interested?'checked':''} ${known.has(row.address)?'disabled':''}></td><td><button type="button" data-candidate-add="${index}" ${known.has(row.address)||row.saving?'disabled':''}>${known.has(row.address)?'In universe':row.saving?'Adding…':'Add to universe'}</button></td></tr>`).join(''):'<tr><td colspan="5" class="admin-empty">Candidate results appear here after a scan.</td></tr>';
 }
 $('discover-trending').addEventListener('click',async()=>{
  const button=$('discover-trending');button.disabled=true;$('discover-status').textContent='Loading public trending tokens…';
  try{const result=await request('/api/wallet-candidates');const tokens=(result.tokens||[]).map(row=>row.address);if(!tokens.length)throw new Error('No public trending tokens returned. Paste token contracts instead.');$('discover-tokens').value=tokens.join('\n');$('discover-status').textContent=`Loaded ${tokens.length} tokens from ${result.source}. Find holder candidates to review their wallets.`;}
  catch(error){$('discover-status').textContent=error.message;}
  finally{button.disabled=busy;}
 });
 const stop=document.createElement('button');stop.type='button';stop.textContent='Stop scan';stop.hidden=true;$('discover-form').append(stop);
 stop.addEventListener('click',()=>controller?.abort());
 $('discover-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  let tokens;try{tokens=parseAddressList($('discover-tokens').value,15);}catch(error){$('discover-status').textContent=error.message;return;}
  busy=true;controller=new AbortController();candidates=[];render();stop.hidden=false;$('discover-scan').disabled=true;$('discover-trending').disabled=true;
  let succeeded=0,failed=0;const errors=[];
  try{for(const [index,token] of tokens.entries()){
   if(controller.signal.aborted)break;
   $('discover-status').textContent=`Scanning token ${index+1} / ${tokens.length} · ${candidates.length} candidate rows · ${failed} unavailable`;
   try{const result=await request('/api/wallet-candidates?'+new URLSearchParams({token}),{signal:controller.signal});candidates.push(...(result.candidates||[]).map(row=>({...row,checkedAt:result.checkedAt,interested:false})));succeeded++;render();}
   catch(error){if(controller.signal.aborted)break;failed++;errors.push(short(token)+': '+error.message);}
  }}finally{const stopped=controller.signal.aborted;busy=false;stop.hidden=true;$('discover-scan').disabled=false;$('discover-trending').disabled=false;$('discover-status').textContent=`${stopped?'Stopped. ':''}${succeeded} tokens checked · ${candidates.length} candidate rows · ${failed} unavailable. Review before adding. ${errors.join(' ')}`;}
 });
 $('discover-candidates').addEventListener('change',event=>{const index=event.target.dataset.candidateInterest;if(index!==undefined)candidates[Number(index)].interested=event.target.checked;});
 $('discover-candidates').addEventListener('click',async event=>{
  const button=event.target.closest('[data-candidate-add]');if(!button)return;const row=candidates[Number(button.dataset.candidateAdd)];if(!row||row.saving)return;row.saving=true;render();
  try{await request('/api/wallet-universe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({address:row.address,name:'Holder '+short(row.address),source:'Public',label:'Public holder candidate',discoveryToken:row.discoveryToken,code:'',interested:row.interested,notes:'Selected from public largest-account sample; trading skill unverified.'})});await refresh();$('discover-status').textContent='Wallet added. Holdings and trade scans start with scheduled collection.';}
  catch(error){$('discover-status').textContent=error.message;}
  finally{row.saving=false;render();}
 });
 const invalidate=()=>{preview=null;$('import-save').disabled=true;$('import-preview-list').replaceChildren();};
 for(const id of ['import-wallets','import-source','import-money','import-token','import-label','import-interested'])$(id).addEventListener('input',invalidate);
 $('import-preview').addEventListener('click',()=>{
  invalidate();try{
   const addresses=parseAddressList($('import-wallets').value),token=$('import-token').value.trim();if(token&&!isSolanaAddress(token))throw new Error('Invalid discovery token.');
   const known=new Set(registry().map(row=>row.address)),fresh=addresses.filter(address=>!known.has(address));
   preview={addresses,source:$('import-source').value,smartMoney:$('import-money').value==='smart'?true:$('import-money').value==='non-smart'?false:null,discoveryToken:token,label:$('import-label').value.trim(),interested:$('import-interested').checked};
   $('import-status').textContent=`${fresh.length} new wallets · ${addresses.length-fresh.length} already in universe (merge sources; keep reviewed flags and priority labels). Source: ${preview.source}. SmartMoney: ${preview.smartMoney===true?'Yes':preview.smartMoney===false?'No':'Unreviewed'}. Interested: ${preview.interested?'yes':'no'}.`;
   for(const address of fresh){const line=document.createElement('div');line.textContent=address;$('import-preview-list').append(line);}
   $('import-save').disabled=!addresses.length;
  }catch(error){$('import-status').textContent=error.message;}
 });
 $('import-wallet-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!preview||$('import-save').disabled)return;const batch=preview;preview=null;$('import-save').disabled=true;$('import-preview').disabled=true;
  let added=0;const errors=[];
  for(const [index,address] of batch.addresses.entries()){
   $('import-status').textContent=`Adding ${index+1} / ${batch.addresses.length}…`;
   try{await request('/api/wallet-universe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...batch,merge:true,addresses:undefined,address,name:'Research '+short(address),code:'',notes:'Manually supplied research list; source label is not independently verified.'})});added++;}
   catch(error){errors.push(short(address)+': '+error.message);}
  }
  await refresh();render();$('import-preview').disabled=false;$('import-status').textContent=`Added / merged ${added} wallets · ${errors.length} not added. ${errors.join(' ')}`;
 });
 render();return {render};
}
