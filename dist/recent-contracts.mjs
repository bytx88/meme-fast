import {canonical} from './core.mjs';
import {isSolanaAddress} from './lookup.mjs';
export const RECENT_CONTRACTS_KEY='meme-fast:recent-contracts:v1';
export const isContractAddress=value=>typeof value==='string'&&(/^0x[0-9a-f]{40}$/i.test(value.trim())||isSolanaAddress(value.trim()));
export function normalizeHistory(value){
  if(!Array.isArray(value))return [];
  const seen=new Set(),result=[];
  for(const item of value){
    if(!isContractAddress(item?.address))continue;
    const address=item.address.trim(),key=canonical(address);if(seen.has(key))continue;seen.add(key);
    result.push({address,symbol:typeof item.symbol==='string'?item.symbol.slice(0,32):'',name:typeof item.name==='string'?item.name.slice(0,80):''});if(result.length===7)break;
  }
  return result;
}
export function createRecentContracts(getStorage=()=>window.localStorage){
  let entries=[],persistent=true;
  try{entries=normalizeHistory(JSON.parse(getStorage().getItem(RECENT_CONTRACTS_KEY)||'[]'))}catch{persistent=false}
  function save(){try{getStorage().setItem(RECENT_CONTRACTS_KEY,JSON.stringify(entries));persistent=true}catch{persistent=false}}
  return {
    get entries(){return entries.map(item=>({...item}))},get persistent(){return persistent},
    remember(value){if(!isContractAddress(value))return false;const address=value.trim(),old=entries.find(item=>canonical(item.address)===canonical(address));entries=normalizeHistory([{address,symbol:old?.symbol||'',name:old?.name||''},...entries]);save();return true},
    label(address,symbol,name){entries=entries.map(item=>canonical(item.address)===canonical(address)?{...item,symbol,name}:item);entries=normalizeHistory(entries);save()},
    clear(){entries=[];try{getStorage().removeItem(RECENT_CONTRACTS_KEY);persistent=true}catch{persistent=false}}
  };
}
