import {canonical} from './core.mjs';
import {isSolanaAddress} from './lookup.mjs';
export const RECENT_CONTRACTS_KEY='meme-fast:recent-contracts:v1';
export const LAST_CONTRACT_KEY='meme-fast:last-contract:v1';
export const isContractAddress=value=>typeof value==='string'&&(/^0x[0-9a-f]{40}$/i.test(value.trim())||isSolanaAddress(value.trim()));
export function tokenQueryFromSearch(search){
  const params=new URLSearchParams(search),named=params.get('query')?.trim();
  if(named)return named;
  const bare=[...params.keys()][0];
  return params.size===1&&isContractAddress(bare)?bare:'';
}
export function normalizeHistory(value){
  if(!Array.isArray(value))return [];
  const seen=new Set(),result=[];
  for(const item of value){
    if(!isContractAddress(item?.address))continue;
    const symbol=typeof item.symbol==='string'?item.symbol.trim().slice(0,16):'';
    if(!symbol||isContractAddress(symbol))continue;
    const address=item.address.trim(),key=canonical(address);if(seen.has(key))continue;seen.add(key);
    result.push({address,symbol});if(result.length===4)break;
  }
  return result;
}
export function createRecentContracts(getStorage=()=>window.localStorage){
  let entries=[],lastAddress='',persistent=true;
  try{const saved=getStorage().getItem(LAST_CONTRACT_KEY);if(isContractAddress(saved))lastAddress=saved.trim()}catch{persistent=false}
  try{const storage=getStorage(),raw=JSON.parse(storage.getItem(RECENT_CONTRACTS_KEY)||'[]');entries=normalizeHistory(raw);if(JSON.stringify(raw)!==JSON.stringify(entries))storage.setItem(RECENT_CONTRACTS_KEY,JSON.stringify(entries))}catch{persistent=false}
  function save(){try{getStorage().setItem(RECENT_CONTRACTS_KEY,JSON.stringify(entries));persistent=true}catch{persistent=false}}
  return {
    get entries(){return entries.map(item=>({...item}))},get persistent(){return persistent},
    get lastAddress(){return lastAddress||entries[0]?.address||''},
    remember(value){if(!isContractAddress(value))return false;lastAddress=value.trim();try{getStorage().setItem(LAST_CONTRACT_KEY,lastAddress);persistent=true}catch{persistent=false}const old=entries.find(item=>canonical(item.address)===canonical(lastAddress));if(!old)return false;entries=normalizeHistory([old,...entries]);save();return true},
    label(address,symbol){if(!isContractAddress(address)||typeof symbol!=='string'||!symbol.trim())return false;this.remember(address);entries=normalizeHistory([{address:address.trim(),symbol},...entries]);save();return true},
    clear(){entries=[];lastAddress='';try{getStorage().removeItem(RECENT_CONTRACTS_KEY);getStorage().removeItem(LAST_CONTRACT_KEY);persistent=true}catch{persistent=false}}
  };
}
