import {read,write} from './research-store.mjs';

export const SOURCE_KEY='meme-fast-radar-sources-v1';
const SEEDED_KEY='meme-fast-radar-sources-starter-v1';

// These accounts are research targets only. X posts are not collected yet.
export const STARTER_SOURCES=[
 {handle:'@pumpdotfun',category:'Developer',group:'Launchers',weight:3},
 {handle:'@SolanaFloor',category:'News',group:'Solana',weight:3},
 {handle:'@JupiterExchange',category:'Developer',group:'Solana',weight:3},
 {handle:'@solana',category:'Developer',group:'Solana',weight:3},
 {handle:'@base',category:'Developer',group:'Base',weight:3},
];

export function loadSources(){
 const stored=read(SOURCE_KEY,[]);
 const current=Array.isArray(stored)?stored.filter(source=>source&&/^@[A-Za-z0-9_]{1,15}$/.test(source.handle)&&typeof source.category==='string'&&typeof source.group==='string'&&Number.isInteger(source.weight)&&source.weight>=1&&source.weight<=5):[];
 if(read(SEEDED_KEY,false))return current;
 const known=new Set(current.map(source=>source.handle.toLowerCase()));
 const merged=[...current,...STARTER_SOURCES.filter(source=>!known.has(source.handle.toLowerCase()))];
 if(write(SOURCE_KEY,merged))write(SEEDED_KEY,true);
 return merged;
}
