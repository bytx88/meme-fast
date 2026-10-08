import {isContractAddress,tokenQueryFromSearch} from './recent-contracts.mjs';

export const DEFAULT_INSPECT_QUERY='BTCUSD';
function savedContract(item){
  if(!['token','coin','radar'].includes(item?.type))return '';
  let linked='';
  try{const url=new URL(item.href,'https://meme.oneerp.org');linked=url.searchParams.get('query')||url.searchParams.get('contract')||''}catch{}
  return [item.marketSnapshot?.contract_address,linked,item.id?.split(':').at(-1)].find(isContractAddress)?.trim()||'';
}
export function initialInspectQuery(search,lastAddress,items=[]){
  const explicit=tokenQueryFromSearch(search);
  if(explicit)return explicit;
  if(isContractAddress(lastAddress))return lastAddress.trim();
  const newest=(Array.isArray(items)?items:[]).map((item,index)=>({address:savedContract(item),time:Number(item?.savedAt)||0,index}))
    .filter(item=>item.address).sort((a,b)=>b.time-a.time||a.index-b.index)[0];
  return newest?.address||DEFAULT_INSPECT_QUERY;
}
