// Identity and name overlap are separate: never merge market metrics across contracts.
const normalize=value=>String(value??'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
const label=(value,ticker=false)=>{
 const key=normalize(ticker?String(value??'').replace(/^\s*\$/,''):value);
 return !key||['unknown','unnamed','n/a','?','-','token'].includes(key)?'':key;
};
const positive=value=>Number.isFinite(value)&&value>0?value:null;
const marketTime=coin=>positive(coin.marketUpdatedAt)??positive(coin.fetchedAt)??0;
export const nameSearchHref=name=>`./new-coins.html?name=${encodeURIComponent(String(name??'').trim())}`;
export function competitionKey(coin){
 const [idNetwork,...idAddress]=String(coin?.id||'').split(':');
 const network=normalize(coin?.network||idNetwork),address=String(coin?.contract_address||idAddress.join(':')).trim();
 if(!network||!address)return null;
 return `${network}:${network==='solana'?address:address.toLowerCase()}`;
}
function savedCoin(item){
 if(!['coin','radar','token'].includes(item?.type))return null;
 const [symbol,...name]=String(item.title||'').split(' · ');
 return {id:item.id,symbol:symbol.replace(/^\$/,''),name:name.join(' · '),...item.marketSnapshot};
}
export function createCompetitionIndex(coins=[],saved=[]){
 const records=new Map(),names=new Map(),tickers=new Map();
 function add(coin,isSaved=false){
  const key=competitionKey(coin);if(!key)return;
  const old=records.get(key),firstSeen=[old?.firstSeen,positive(coin.firstSeen),positive(coin.firstSeenRadarAt)].filter(Boolean);
  // Use one whole market snapshot, including its unknowns, rather than mixing pools or dates.
  const current=!old||marketTime(coin)>marketTime(old.coin)?coin:old.coin;
  const [network,contract_address]=key.split(':');
  records.set(key,{key,coin:{...current,id:current.id||key,network,contract_address:current.contract_address||contract_address,chain:current.chain||({solana:'Solana',base:'Base',robinhood:'Robinhood Chain'}[network]||network)},firstSeen:firstSeen.length?Math.min(...firstSeen):null,saved:Boolean(old?.saved||isSaved)});
 }
 coins.forEach(coin=>add(coin));
 saved.forEach(item=>{const coin=savedCoin(item);if(coin)add(coin,true)});
 for(const record of records.values()){
  for(const [index,key] of [[names,label(record.coin.name)],[tickers,label(record.coin.symbol,true)]]){
   if(!key)continue;if(!index.has(key))index.set(key,new Set());index.get(key).add(record.key);
  }
 }
 return {
  get:coin=>records.get(competitionKey(coin)),
  nameCount:name=>names.get(label(name))?.size||0,
  sameName(name){
   return [...(names.get(label(name))||[])].map(key=>{
    const record=records.get(key);
    return {...record.coin,firstSeen:record.firstSeen};
   });
  },
  matches(coin){
   const own=competitionKey(coin),name=label(coin.name),ticker=label(coin.symbol,true);
   const keys=new Set([...(names.get(name)||[]),...(tickers.get(ticker)||[])]);
   keys.delete(own);
   return [...keys].map(key=>{
    const record=records.get(key),sameName=Boolean(name&&name===label(record.coin.name)),sameTicker=Boolean(ticker&&ticker===label(record.coin.symbol,true));
    return {...record,match:sameName&&sameTicker?'Same name & ticker':sameName?'Same name':'Same ticker'};
   }).sort((a,b)=>(a.firstSeen??Infinity)-(b.firstSeen??Infinity)||a.key.localeCompare(b.key));
  }
 };
}
