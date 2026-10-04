export const DEFAULT_SCREENER = Object.freeze({volume24h:15000,liquidity:0,volume5m:0,transactions5m:0,transactionsLifetime:0,poolAgeMinSeconds:0,poolAgeMaxSeconds:0,chain:'all',lanes:Object.freeze({newPairs:Object.freeze({poolAgeMaxSeconds:108000}),recovery:Object.freeze({}),graduation:Object.freeze({})})});

export function normalizeScreener(value={}){
 const result={...DEFAULT_SCREENER};
 for(const key of ['volume24h','liquidity','volume5m','transactions5m','transactionsLifetime','poolAgeMinSeconds','poolAgeMaxSeconds']){
  const number=Number(value[key]);
  if(value[key]!==''&&value[key]!=null&&Number.isFinite(number)&&number>=0)result[key]=Math.floor(number);
 }
 if(['all','solana','base','robinhood'].includes(value.chain))result.chain=value.chain;
 result.lanes={};
 for(const lane of ['newPairs','recovery','graduation']){
  result.lanes[lane]={...DEFAULT_SCREENER.lanes[lane]};
  for(const key of ['volume24h','liquidity','volume5m','transactions5m','transactionsLifetime','poolAgeMinSeconds','poolAgeMaxSeconds']){
   const raw=value.lanes?.[lane]?.[key],number=Number(raw);
   if(raw!==''&&raw!=null&&Number.isFinite(number)&&number>=0){
    if(number>0||key in DEFAULT_SCREENER.lanes[lane])result.lanes[lane][key]=Math.floor(number);
   }
  }
 }
 return result;
}

export function passesScreener(coin,settings,now=Date.now()){
 if(settings.chain!=='all'&&String(coin.network||coin.chain).toLowerCase()!==settings.chain)return false;
 for(const [key,minimum] of [['volume',settings.volume24h],['liquidity',settings.liquidity],['volume5m',settings.volume5m]]){
  if(minimum>0&&(!Number.isFinite(Number(coin[key]))||coin[key]==null||Number(coin[key])<minimum))return false;
 }
 if(settings.transactions5m>0){
  if(coin.buys5m==null&&coin.sells5m==null)return false;
  if((Number(coin.buys5m)||0)+(Number(coin.sells5m)||0)<settings.transactions5m)return false;
 }
 if(settings.transactionsLifetime>0){
  const total=lifetimeTransactions(coin,now);
  if(total===null||total<settings.transactionsLifetime)return false;
 }
 if(settings.poolAgeMinSeconds>0||settings.poolAgeMaxSeconds>0){
  const created=Number(coin.poolCreated);
  if(!Number.isFinite(created)||created<=0||created>now)return false;
  const seconds=(now-created)/1000;
  if(settings.poolAgeMinSeconds>0&&seconds<settings.poolAgeMinSeconds)return false;
  if(settings.poolAgeMaxSeconds>0&&seconds>settings.poolAgeMaxSeconds)return false;
 }
 return true;
}

export function passesLaneScreener(coin,settings,lane,now=Date.now()){
 return passesScreener(coin,settings,now)&&passesScreener(coin,{volume24h:0,liquidity:0,volume5m:0,transactions5m:0,transactionsLifetime:0,poolAgeMinSeconds:0,poolAgeMaxSeconds:0,chain:'all',...settings.lanes?.[lane]},now);
}

// A 24h pool count covers its lifetime only while the pool itself is younger than 24h.
export function lifetimeTransactions(coin,now=Date.now()){
 const created=Number(coin.poolCreated);
 if(!Number.isFinite(created)||created<=0||created>now||now-created>=86400000)return null;
 if(coin.buys==null||coin.sells==null)return null;
 const buys=Number(coin.buys),sells=Number(coin.sells);
 return Number.isFinite(buys)&&Number.isFinite(sells)&&buys>=0&&sells>=0?buys+sells:null;
}
