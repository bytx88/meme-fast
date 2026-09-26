export const DEFAULT_ENTRY = Object.freeze({sizeUsd:250,maxPoolAgeMinutes:30,maxMarketAgeMinutes:6,minLiquidityUsd:10000,minBuys5m:5,maxSellBuyRatio:1,maxSizeLiquidityPercent:2});

const number=value=>value==null||value===''||!Number.isFinite(Number(value))?null:Number(value);

export function normalizeEntry(value={}){
 const settings={...DEFAULT_ENTRY};
 for(const key of Object.keys(settings)){
  const parsed=number(value[key]);
  if(parsed!==null&&parsed>=0)settings[key]=parsed;
 }
 return settings;
}

export function compactFlow(history){
 const samples=(Array.isArray(history)?history:[]).filter(row=>Number.isFinite(Number(row?.at))&&Number(row.at)>0).sort((a,b)=>a.at-b.at).slice(-2);
 return samples.map(row=>({at:Number(row.at),volume5m:number(row.volume5m),buys5m:number(row.buys5m),sells5m:number(row.sells5m),liquidity:number(row.liquidity)}));
}

export function assessEntry(coin,settings=DEFAULT_ENTRY,now=Date.now()){
 const poolCreated=number(coin.poolCreated),firstSeen=number(coin.firstSeen),marketUpdatedAt=number(coin.marketUpdatedAt??coin.fetchedAt);
 const poolAgeMinutes=poolCreated===null?null:Math.max(0,(now-poolCreated)/60000);
 const marketAgeMinutes=marketUpdatedAt===null?null:Math.max(0,(now-marketUpdatedAt)/60000);
 const detectionLagMinutes=poolCreated===null||firstSeen===null?null:Math.max(0,(firstSeen-poolCreated)/60000);
 const liquidity=number(coin.liquidity),buys=number(coin.buys5m),sells=number(coin.sells5m);
 const sizeLiquidityPercent=liquidity>0?100*settings.sizeUsd/liquidity:null;
 const sellBuyRatio=buys>0&&sells!==null?sells/buys:null;
 const reasons=[];
 if(poolAgeMinutes===null||poolAgeMinutes>settings.maxPoolAgeMinutes)reasons.push('Pool age');
 if(marketAgeMinutes===null||marketAgeMinutes>settings.maxMarketAgeMinutes)reasons.push('Market stale');
 if(liquidity===null||liquidity<settings.minLiquidityUsd)reasons.push('Liquidity');
 if(buys===null||buys<settings.minBuys5m)reasons.push('Buy activity');
 if(sellBuyRatio===null||sellBuyRatio>settings.maxSellBuyRatio)reasons.push('Sell pressure');
 if(sizeLiquidityPercent===null||sizeLiquidityPercent>settings.maxSizeLiquidityPercent)reasons.push('Size / liquidity');
 const flow=Array.isArray(coin.flowSamples)?coin.flowSamples:[];
 const previous=flow.length>=2?flow.at(-2):null;
 const volumeChange=previous&&number(previous.volume5m)!==null&&number(coin.volume5m)!==null?number(coin.volume5m)-number(previous.volume5m):null;
 const buysChange=previous&&number(previous.buys5m)!==null&&buys!==null?buys-number(previous.buys5m):null;
 const sellsChange=previous&&number(previous.sells5m)!==null&&sells!==null?sells-number(previous.sells5m):null;
 const liquidityChange=previous&&number(previous.liquidity)!==null&&liquidity!==null?liquidity-number(previous.liquidity):null;
 return {passesScreen:reasons.length===0,reasons,poolAgeMinutes,marketAgeMinutes,detectionLagMinutes,sizeLiquidityPercent,sellBuyRatio,volumeChange,buysChange,sellsChange,liquidityChange,
  executionVerified:false,contractRiskVerified:false};
}
