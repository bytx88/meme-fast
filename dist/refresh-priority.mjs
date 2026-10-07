export async function requestRefreshPriority(items){
 const ids=[...new Set(items.filter(item=>['coin','radar','token'].includes(item.type)).map(item=>item.id))]
  .filter(id=>/^(?:solana:[1-9A-HJ-NP-Za-km-z]{32,44}|(?:base|robinhood|bsc):0x[a-fA-F0-9]{40})$/.test(id)).slice(0,300);
 let accepted=0;
 try{
  for(let offset=0;offset<ids.length;offset+=30){
   const response=await fetch('/api/refresh-priority',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ids:ids.slice(offset,offset+30)}),signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new Error('Priority request unavailable');
   accepted+=(await response.json()).accepted||0;
  }
  return {ok:true,accepted};
 }catch{return {ok:false,accepted}}
}
