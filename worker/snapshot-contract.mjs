import {SAMPLE_LIMITS} from '../dist/core.mjs';
export {feedStatus} from '../dist/source-coverage.mjs';
export const PIPELINE_LIMITS=Object.freeze({retentionMs:5*86400000,radarPerChain:200,newPoolPages:3});

export function coverageFor(feeds){
 return {
  sources:Object.fromEntries(Object.entries(feeds).map(([name,feed])=>[name,{
   status:feed.status??(feed.error?'failed':'unknown'),lastAttempt:feed.lastAttempt??null,lastSuccess:feed.lastSuccess??null,
   error:feed.error??null,records:feed.records??null,returnedRecords:feed.returnedRecords??null,
  }])),
  sampling:{coinRetentionDays:PIPELINE_LIMITS.retentionMs/86400000,radarLimitPerChain:PIPELINE_LIMITS.radarPerChain,newPoolPagesPerChain:PIPELINE_LIMITS.newPoolPages,swapPoolsPerListing:SAMPLE_LIMITS.poolsPerListing,swapTradesPerPool:SAMPLE_LIMITS.tradesPerPool},
 };
}

export function validateSnapshot(snapshot){
 if(snapshot.version!==2||!Array.isArray(snapshot.coins)||!Array.isArray(snapshot.radarCoins)||!Number.isFinite(snapshot.lastRun)||!snapshot.feeds||typeof snapshot.feeds!=='object')throw new Error('Invalid coin snapshot');
 for(const coin of [...snapshot.coins,...snapshot.radarCoins]){
  // Older snapshots can contain retained records without the newer identity fields.
  const fresh=coin.firstSeen===snapshot.lastRun||coin.firstSeenRadarAt===snapshot.lastRun;
  if(typeof coin.id!=='string'||fresh&&(!coin.network||!coin.contract_address)||coin.network&&coin.contract_address&&coin.id!==`${coin.network}:${coin.contract_address}`)throw new Error('Invalid coin identity');
 }
 return snapshot;
}
