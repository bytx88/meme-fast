export const MIGRATED_VOLUME_24H=50000;
export const FINAL_STRETCH_PERCENT=80;

export function stageFor(coin){
 const progress=Number(coin?.launchpad?.graduationPercentage);
 if(coin?.launchpad?.completed===true||Number(coin?.volume)>=MIGRATED_VOLUME_24H)return 'migrated';
 if(coin?.launchpad?.completed===false&&Number.isFinite(progress)&&progress>=FINAL_STRETCH_PERCENT&&progress<100)return 'stretch';
 return 'new';
}

export function normalizeLaunchpad(details){
 if(!details||typeof details!=='object')return null;
 if(details.graduation_percentage===null||details.graduation_percentage===undefined||details.graduation_percentage==='')return null;
 const progress=Number(details.graduation_percentage);
 if(typeof details.completed!=='boolean'||!Number.isFinite(progress)||progress<0||progress>100)return null;
 return {graduationPercentage:progress,completed:details.completed};
}
