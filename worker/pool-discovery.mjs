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

export async function discoverPools(fetcher,now,feeds,{betweenPasses=async()=>{}}={}){
 const plan=discoveryPlan();
 const request=async({network,kind,page})=>{
  const query=new URLSearchParams({include:'base_token,quote_token',...(kind==='trending_pools'?{duration:'1h'}:{page:String(page)})});
  const response=await fetcher(`https://api.geckoterminal.com/api/v2/networks/${network.id}/${kind}?${query}`,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  return parsePools(await response.json(),network,now);
 };
 const split=plan.findIndex(item=>item.page>1);
 const results=await Promise.allSettled(plan.slice(0,split).map(request));
 await betweenPasses({
  incoming:results.flatMap((r,i)=>plan[i].kind==='new_pools'&&r.status==='fulfilled'?r.value:[]),
  trending:results.flatMap((r,i)=>plan[i].kind==='trending_pools'&&r.status==='fulfilled'?r.value:[]),
 });
 results.push(...await Promise.allSettled(plan.slice(split).map(request)));
 for(const key of new Set(plan.map(item=>item.key))){
  const group=results.filter((_,index)=>plan[index].key===key),failure=group.find(r=>r.status==='rejected');
  const returned=group.flatMap(r=>r.status==='fulfilled'?r.value:[]).length;
  feeds[key]=feedStatus(feeds[key],now,failure?{error:failure.reason.message,returnedRecords:returned}:{records:returned});
 }
 const rows=kind=>results.flatMap((r,i)=>plan[i].kind===kind&&r.status==='fulfilled'?r.value:[]);
 return {incoming:rows('new_pools'),trending:rows('trending_pools'),topPools:rows('pools')};
}

// Launchpad pools remain relevant long after they leave the network new-pools feed.
// Keep page one hot and sweep pages 2–9 over two scheduled collections.
export async function discoverLaunchpads(fetcher,now,feeds){
 const offset=(Math.floor(now/300000)%2)*4;
 const plan=[{dex:'pump-fun',page:1},...Array.from({length:4},(_,i)=>({dex:'pump-fun',page:2+offset+i})),{dex:'meteora-dbc',page:1}];
 const network=NETWORKS.find(n=>n.id==='solana');
 const results=await Promise.allSettled(plan.map(async({dex,page})=>{
  const response=await fetcher(`https://api.geckoterminal.com/api/v2/networks/solana/dexes/${dex}/pools?include=base_token,quote_token&sort=h24_volume_usd_desc&page=${page}`,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`Launchpad pools HTTP ${response.status}`);
  return parsePools(await response.json(),network,now).map(c=>({...c,launchpadSource:dex}));
 }));
 const rows=results.flatMap(r=>r.status==='fulfilled'?r.value:[]),failure=results.find(r=>r.status==='rejected');
 feeds.launchpad_pools=feedStatus(feeds.launchpad_pools,now,failure?{error:failure.reason.message,returnedRecords:rows.length}:{records:rows.length});
 return rows;
}
