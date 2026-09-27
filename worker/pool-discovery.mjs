import {NETWORKS,RADAR_NETWORKS,parsePools} from '../dist/public-radar.mjs';
import {PIPELINE_LIMITS,feedStatus} from './snapshot-contract.mjs';

export function discoveryPlan(){
 const request=(network,kind,page=1)=>({network,kind,page,
  key:kind==='new_pools'?network.id:`${network.id}_${kind==='pools'?'top_pools':'trending'}`});
 const top=RADAR_NETWORKS.filter(network=>network.id==='solana'||network.id==='robinhood');
 // Cover every chain and research view before spending requests on deeper pages.
 const plan=[...NETWORKS.map(n=>request(n,'new_pools')),
  ...RADAR_NETWORKS.map(n=>request(n,'trending_pools')),...top.map(n=>request(n,'pools'))];
 for(let page=2;page<=PIPELINE_LIMITS.newPoolPages;page++){
  plan.push(...NETWORKS.map(n=>request(n,'new_pools',page)),...top.map(n=>request(n,'pools',page)));
 }
 return plan;
}

export async function discoverPools(fetcher,now,feeds){
 const plan=discoveryPlan();
 const results=await Promise.allSettled(plan.map(async({network,kind,page})=>{
  const query=new URLSearchParams({include:'base_token,quote_token',...(kind==='trending_pools'?{duration:'1h'}:{page:String(page)})});
  const response=await fetcher(`https://api.geckoterminal.com/api/v2/networks/${network.id}/${kind}?${query}`,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  return parsePools(await response.json(),network,now);
 }));
 for(const key of new Set(plan.map(item=>item.key))){
  const group=results.filter((_,index)=>plan[index].key===key),failure=group.find(r=>r.status==='rejected');
  const returned=group.flatMap(r=>r.status==='fulfilled'?r.value:[]).length;
  feeds[key]=feedStatus(feeds[key],now,failure?{error:failure.reason.message,returnedRecords:returned}:{records:returned});
 }
 const rows=kind=>results.flatMap((r,i)=>plan[i].kind===kind&&r.status==='fulfilled'?r.value:[]);
 return {incoming:rows('new_pools'),trending:rows('trending_pools'),topPools:rows('pools')};
}
