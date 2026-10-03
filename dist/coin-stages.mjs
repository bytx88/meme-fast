export const MIGRATED_VOLUME_24H=50000;
export const FINAL_STRETCH_PERCENT=80;
export const SUCCESS_LIQUIDITY_USD=3000;

export function hasLiveSuccessMarket(coin,now=Date.now()){
 const updatedAt=Number(coin?.marketUpdatedAt);
 return Number(coin?.liquidity)>=SUCCESS_LIQUIDITY_USD&&Number(coin?.recentVolume1h??coin?.volume5m)>0&&Number.isFinite(updatedAt)&&updatedAt>0&&updatedAt<=now&&now-updatedAt<=15*60000;
}

export function isUnderObservation(coin,now=Date.now()){
 const start=Number(coin?.graduationObservedAt);
 return coin?.launchpad?.completed===true&&!coin.ruggedAt&&!coin.sustainedAt&&Number.isFinite(start)&&start>0&&now>=start&&now-start<=45*60000;
}

// Launch lifecycle is independent of price patterns and volume.
export function stageFor(coin){
 if(coin?.launchpad?.completed===true)return 'migrated';
 const progress=coin?.launchpad?.graduationPercentage;
 if(coin?.launchpad?.completed===false&&progress!=null&&Number.isFinite(Number(progress))){
  if(Number(progress)>=FINAL_STRETCH_PERCENT&&Number(progress)<=100)return 'stretch';
  if(Number(progress)>=0&&Number(progress)<FINAL_STRETCH_PERCENT)return 'new';
 }
 return 'unknown';
}

export function recoveryFor(coin,now=Date.now()){
 const start=coin?.launchpad?.completed===true?coin.graduationObservedAt:coin?.poolCreated;
 if(hasLiveSuccessMarket(coin,now)&&(coin?.laterRecoveryAt||coin?.sustainedAt&&!coin.ruggedAt&&(!Number.isFinite(Number(start))||now-Number(start)<=6*3600000)))return 'sustained';
 return null;
}

export function graduationSplit(coin,now=Date.now()){
 if(stageFor(coin)!=='migrated')return null;
 if(recoveryFor(coin,now))return coin.laterRecoveryAt?'later':coin.successScenario==='continuation'?'continuation':'rebound';
 if(isUnderObservation(coin,now))return 'tracking';
 return 'other';
}

export function normalizeLaunchpad(details){
 if(!details||typeof details!=='object')return null;
 if(details.graduation_percentage===null||details.graduation_percentage===undefined||details.graduation_percentage==='')return null;
 const progress=Number(details.graduation_percentage);
 if(typeof details.completed!=='boolean'||!Number.isFinite(progress)||progress<0||progress>100)return null;
 const completedAt=Date.parse(details.completed_at);
 return {graduationPercentage:progress,completed:details.completed,completedAt:Number.isFinite(completedAt)?completedAt:null};
}
