export const DEFAULT_SCREENER = Object.freeze({volume24h:15000,liquidity:0,volume5m:0,transactions5m:0,chain:'all',lanes:Object.freeze({newPairs:Object.freeze({}),recovery:Object.freeze({}),graduation:Object.freeze({})})});

export function normalizeScreener(value={}){
 const result={...DEFAULT_SCREENER};
 for(const key of ['volume24h','liquidity','volume5m','transactions5m']){
  const number=Number(value[key]);
  if(value[key]!==''&&value[key]!=null&&Number.isFinite(number)&&number>=0)result[key]=Math.floor(number);
 }
 if(['all','solana','base','robinhood'].includes(value.chain))result.chain=value.chain;
 result.lanes={};
 for(const lane of ['newPairs','recovery','graduation']){
  result.lanes[lane]={};
  for(const key of ['volume24h','liquidity','volume5m','transactions5m']){
   const raw=value.lanes?.[lane]?.[key],number=Number(raw);
   if(raw!==''&&raw!=null&&Number.isFinite(number)&&number>0)result.lanes[lane][key]=Math.floor(number);
  }
 }
 return result;
}

export function passesScreener(coin,settings){
 if(settings.chain!=='all'&&String(coin.network||coin.chain).toLowerCase()!==settings.chain)return false;
 for(const [key,minimum] of [['volume',settings.volume24h],['liquidity',settings.liquidity],['volume5m',settings.volume5m]]){
  if(minimum>0&&(!Number.isFinite(Number(coin[key]))||coin[key]==null||Number(coin[key])<minimum))return false;
 }
 if(settings.transactions5m>0){
  if(coin.buys5m==null&&coin.sells5m==null)return false;
  if((Number(coin.buys5m)||0)+(Number(coin.sells5m)||0)<settings.transactions5m)return false;
 }
 return true;
}

export function passesLaneScreener(coin,settings,lane){
 return passesScreener(coin,settings)&&passesScreener(coin,{volume24h:0,liquidity:0,volume5m:0,transactions5m:0,chain:'all',...settings.lanes?.[lane]});
}
