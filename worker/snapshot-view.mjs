import {watchlistView} from './watchlist-view.mjs';
import {compactFlow} from '../dist/snipe-decision.mjs';
import {earlyRampWarning} from '../dist/rug-screen.mjs';
import {readFile,stat} from 'node:fs/promises';

export const RETENTION_MS=5*86400000;
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

export function snapshotView(snapshot,view='',ids=[],now=Date.now()){
 if(view==='watchlist')return watchlistView(snapshot,ids,now);
 const cutoff=now-RETENTION_MS;
 const result={...snapshot,coins:(snapshot.coins||[]).filter(c=>c.firstSeen>cutoff)};
 if(view==='coin'){
  result.coins=result.coins.map(({marketHistory,marketHistoryHourly,priceHistory5m,...coin})=>({...coin,flowSamples:compactFlow(marketHistory),earlyRampWarning:earlyRampWarning({...coin,marketHistory},now)}));
  delete result.radarCoins;
 }else{
  if(view==='radar')result.coins=[];
  result.radarCoins=(snapshot.radarCoins||[]).filter(c=>c.lastSeenRadarAt>cutoff);
 }
 return result;
}
