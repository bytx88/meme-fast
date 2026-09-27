import {watchlistView} from './watchlist-view.mjs';
import {compactFlow} from '../dist/snipe-decision.mjs';
import {earlyRampWarning} from '../dist/rug-screen.mjs';
import {readFile,stat} from 'node:fs/promises';

export const RETENTION_MS=5*86400000;
const COMPETITION_FIELDS=['id','network','chain','contract_address','contract_verified','name','symbol','image_url','poolCreated','volume','firstSeen','firstSeenRadarAt','liquidity','volume5m','buys5m','sells5m','marketUpdatedAt','fetchedAt'];
const nameKey=value=>String(value??'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
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

export function snapshotView(snapshot,view='',ids=[],now=Date.now(),name=''){
 if(view==='watchlist')return watchlistView(snapshot,ids,now);
 const cutoff=now-RETENTION_MS;
 if(view==='name'){
  const key=nameKey(name);
  if(!key||key.length>100)throw new Error('Request a token name up to 100 characters');
  const result=Object.fromEntries(['version','revision','lastRun','coverage','feeds'].filter(field=>field in snapshot).map(field=>[field,snapshot[field]]));
  result.coins=(snapshot.coins||[]).filter(c=>c.firstSeen>cutoff&&nameKey(c.name)===key).map(({marketHistory,marketHistoryHourly,priceHistory5m,...coin})=>({...coin,flowSamples:compactFlow(marketHistory),earlyRampWarning:earlyRampWarning({...coin,marketHistory},now)}));
  result.competitionCoins=(snapshot.radarCoins||[]).filter(c=>c.lastSeenRadarAt>cutoff&&nameKey(c.name)===key).map(c=>Object.fromEntries(COMPETITION_FIELDS.filter(field=>field in c).map(field=>[field,c[field]])));
  return result;
 }
 const result={...snapshot,coins:(snapshot.coins||[]).filter(c=>c.firstSeen>cutoff)};
 if(view==='coin'){
  result.coins=result.coins.map(({marketHistory,marketHistoryHourly,priceHistory5m,...coin})=>({...coin,flowSamples:compactFlow(marketHistory),earlyRampWarning:earlyRampWarning({...coin,marketHistory},now)}));
  delete result.radarCoins;
  result.competitionCoins=(snapshot.radarCoins||[]).filter(c=>c.lastSeenRadarAt>cutoff).map(c=>Object.fromEntries(COMPETITION_FIELDS.filter(key=>key in c).map(key=>[key,c[key]])));
 }else{
  if(view==='radar')result.coins=[];
  result.radarCoins=(snapshot.radarCoins||[]).filter(c=>c.lastSeenRadarAt>cutoff);
 }
 return result;
}
