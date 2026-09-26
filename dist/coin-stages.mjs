export const MIGRATED_VOLUME_24H=50000;
export const FINAL_STRETCH_PERCENT=80;

export function isUnderObservation(coin,now=Date.now()){
 const start=Number(coin?.graduationObservedAt);
 return coin?.launchpad?.completed===true&&!coin.ruggedAt&&!coin.sustainedAt&&Number.isFinite(start)&&start>0&&now>=start&&now-start<=45*60000;
}

export function stageFor(coin,now=Date.now()){
 const progress=Number(coin?.launchpad?.graduationPercentage);
 const start=coin?.launchpad?.completed===true?coin.graduationObservedAt:coin?.poolCreated;
 if(coin?.laterRecoveryAt||coin?.sustainedAt&&(!Number.isFinite(Number(start))||now-Number(start)<=6*3600000))return 'sustained';
 if(coin?.launchpad?.completed===true)return 'migrated';
 if(coin?.launchpad?.completed===false){
  if(Number.isFinite(progress)&&progress>=FINAL_STRETCH_PERCENT&&progress<100)return 'stretch';
  return 'new';
 }
 if(Number(coin?.volume)>=MIGRATED_VOLUME_24H)return 'migrated';
 return 'new';
}

export function normalizeLaunchpad(details){
 if(!details||typeof details!=='object')return null;
 if(details.graduation_percentage===null||details.graduation_percentage===undefined||details.graduation_percentage==='')return null;
 const progress=Number(details.graduation_percentage);
 if(typeof details.completed!=='boolean'||!Number.isFinite(progress)||progress<0||progress>100)return null;
 const completedAt=Date.parse(details.completed_at);
 return {graduationPercentage:progress,completed:details.completed,completedAt:Number.isFinite(completedAt)?completedAt:null};
}
