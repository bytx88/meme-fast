import {stageFor} from '../dist/coin-stages.mjs';
import {watchlistView} from './watchlist-view.mjs';
import {compactFlow} from '../dist/snipe-decision.mjs';
import {earlyRampWarning} from '../dist/rug-screen.mjs';
import {readFile,stat} from 'node:fs/promises';

export const RETENTION_MS=5*86400000;
const COMPETITION_FIELDS=['id','network','chain','contract_address','contract_verified','name','symbol','image_url','poolCreated','volume','firstSeen','firstSeenRadarAt','liquidity','volume5m','buys5m','sells5m','marketUpdatedAt','fetchedAt'];
const nameKey=value=>String(value??'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
const tickerKey=value=>nameKey(String(value??'').replace(/^\$/,''));
export const snapshotRevision=snapshot=>snapshot.revision||String(snapshot.lastRun||0);
export const versionFile=filename=>filename.replace(/\.json$/,'')+'.version.json';

export function snapshotVersion(snapshot){
 return {revision:snapshotRevision(snapshot),lastRun:snapshot.lastRun??null};
}

export async function readSnapshotVersion(filename,readSnapshot){
 const sidecar=versionFile(filename);
 try{
  const [mainInfo,versionInfo]=await Promise.all([stat(filename),stat(sidecar)]);
  if(versionInfo.mtimeMs>=mainInfo.mtimeMs)return JSON.parse(await readFile(sidecar,'utf8'));
 }catch{ /* A missing or damaged sidecar falls back to the authoritative snapshot. */ }
 return snapshotVersion(await readSnapshot(filename));
}

export function snapshotView(snapshot,view='',ids=[],now=Date.now(),name='',hours=120){
 if(view==='watchlist')return watchlistView(snapshot,ids,now);
 const cutoff=now-RETENTION_MS;
 if(view==='health')return Object.fromEntries(['revision','lastRun','feeds'].map(field=>[field,snapshot[field]??null]));
 if(view==='name'){
  const key=nameKey(name);
  if(!key||key.length>100)throw new Error('Request a token name up to 100 characters');
  const result=Object.fromEntries(['version','revision','lastRun','coverage','feeds'].filter(field=>field in snapshot).map(field=>[field,snapshot[field]]));
  result.coins=(snapshot.coins||[]).filter(c=>c.firstSeen>cutoff&&nameKey(c.name)===key).map(({marketHistory,marketHistoryHourly,priceHistory5m,...coin})=>({...coin,flowSamples:compactFlow(marketHistory),earlyRampWarning:earlyRampWarning({...coin,marketHistory},now)}));
  result.competitionCoins=(snapshot.radarCoins||[]).filter(c=>c.lastSeenRadarAt>cutoff&&nameKey(c.name)===key).map(c=>Object.fromEntries(COMPETITION_FIELDS.filter(field=>field in c).map(field=>[field,c[field]])));
  return result;
 }
 if(view==='coin'){
  if(![1,6,12,36,120].includes(hours))throw new Error('Choose a supported Snipe time window');
  const retained=(snapshot.coins||[]).filter(c=>(c.firstSeen||0)>cutoff),windowCutoff=now-hours*3600000;
  const visible=retained.filter(c=>(c.firstSeen||0)>=windowCutoff||(c.graduationObservedAt||0)>=windowCutoff||stageFor(c)==='stretch'),visibleIds=new Set(visible.map(c=>c.id));
  const result=Object.fromEntries(['version','revision','lastRun','coverage','feeds'].filter(field=>field in snapshot).map(field=>[field,snapshot[field]]));
  result.retainedTotal=retained.length;
  result.retainedAddressLinked=retained.filter(c=>c.savedContext?.kind==='verified'||c.savedContext?.kind==='web'&&c.savedContext.web?.exact).length;
  result.coins=visible.map(({marketHistory,marketHistoryHourly,priceHistory5m,...coin})=>({...coin,flowSamples:compactFlow(marketHistory),earlyRampWarning:earlyRampWarning({...coin,marketHistory},now)}));
  const names=new Set(visible.map(c=>nameKey(c.name)).filter(Boolean)),tickers=new Set(visible.map(c=>tickerKey(c.symbol)).filter(Boolean));
  result.competitionCoins=[...retained,...(snapshot.radarCoins||[]).filter(c=>(c.lastSeenRadarAt||0)>cutoff)]
   .filter(c=>!visibleIds.has(c.id)&&(names.has(nameKey(c.name))||tickers.has(tickerKey(c.symbol))))
   .map(c=>Object.fromEntries(COMPETITION_FIELDS.filter(key=>key in c).map(key=>[key,c[key]])));
  return result;
 }
 const result={...snapshot,coins:view==='radar'?[]:(snapshot.coins||[]).filter(c=>c.firstSeen>cutoff)};
 result.radarCoins=(snapshot.radarCoins||[]).filter(c=>c.lastSeenRadarAt>cutoff).map(coin=>{
  if(view!=='radar')return coin;
  const {marketHistory,marketHistoryHourly,priceHistory5m,...fields}=coin;
  const sample=row=>Object.fromEntries(['at','volume5m','buys5m','sells5m','liquidity'].filter(key=>key in row).map(key=>[key,row[key]]));
  return {...fields,marketHistory:(marketHistory||[]).filter(row=>row.at>=now-4*3600000).slice(-48).map(sample),marketHistoryHourly:(marketHistoryHourly||[]).filter(row=>row.at>=now-RETENTION_MS).slice(-120).map(sample)};
 });
 return result;
}
