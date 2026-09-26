const FIELDS=['id','name','symbol','network','chain','contract_address','image_url','priceUsd','priceChange','mc','fdv','liquidity','volume','volume5m','buys5m','sells5m','recentVolume1h','poolCreated','marketUpdatedAt','priceUpdatedAt'];
const key=id=>String(id).startsWith('solana:')?String(id):String(id).toLowerCase();

export function watchlistView(snapshot,ids,now=Date.now()){
 if(!Array.isArray(ids)||ids.length<1||ids.length>30||ids.some(id=>typeof id!=='string'||id.length>160||!id.includes(':')))throw new RangeError('Request 1 to 30 saved token IDs');
 const cutoff=now-5*86400000;
 const available=new Map();
 for(const coin of snapshot.radarCoins||[]){
  if(coin.lastSeenRadarAt>cutoff)available.set(key(coin.id),coin);
 }
 for(const coin of snapshot.coins||[]){
  if(coin.firstSeen>cutoff&&!available.has(key(coin.id)))available.set(key(coin.id),coin);
 }
 return {version:1,lastRun:snapshot.lastRun??null,coins:ids.map(id=>available.get(key(id))).filter(Boolean).map(coin=>Object.fromEntries(FIELDS.map(field=>[field,coin[field]??null])))};
}
