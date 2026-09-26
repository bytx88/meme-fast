const clamp=value=>Math.max(0,Math.min(1,value));
const number=value=>value===null||value===undefined||value===''||!Number.isFinite(Number(value))?null:Number(value);
const scale=(value,start,end)=>value===null?null:clamp((value-start)/(end-start));
const completeSample=row=>number(row.volume5m)!==null&&number(row.buys5m)!==null&&number(row.sells5m)!==null;
const sampleActive=row=>number(row.volume5m)>=500&&Number(row.buys5m)+Number(row.sells5m)>=5;
const freshAt=coin=>number(coin.marketUpdatedAt??coin.fetchedAt);
const samples=(coin,key,since,now)=>Array.isArray(coin[key])?coin[key].filter(row=>number(row.at)!==null&&row.at>=since&&row.at<=now).sort((a,b)=>a.at-b.at):[];
const contextValue=coin=>coin.savedContext?.kind==='verified'||coin.savedContext?.kind==='web'&&coin.savedContext.web?.exact?1:coin.savedContext?0.3:null;
const component=(label,weight,value,detail)=>({label,weight,value:value===null?null:clamp(value),detail});

function recentDirection(rows){
 if(rows.length<6)return null;
 const valid=rows.filter(row=>number(row.buys5m)!==null&&number(row.sells5m)!==null);
 if(valid.length<6)return null;
 const buys=valid.reduce((sum,row)=>sum+Number(row.buys5m),0),sells=valid.reduce((sum,row)=>sum+Number(row.sells5m),0);
 return buys+sells?scale(buys/(buys+sells),0.4,0.7):null;
}
function persistence(rows,minimum){
 const valid=rows.filter(completeSample);
 if(valid.length<minimum)return null;
 return valid.filter(sampleActive).length/valid.length;
}
function previousVolume(rows,now){
 return [...rows].reverse().find(row=>row.at<=now-4*60000&&row.at>=now-20*60000&&number(row.volume5m)!==null);
}

export const RADAR_MODES={
 scalp:{title:'Scalp',description:'Minutes · recent turnover, participation, buy pressure, and acceleration.'},
 swing:{title:'Swing',description:'Hours · liquidity, turnover, repeated activity, and buy pressure.'},
 research:{title:'Longer-term',description:'Days · observed persistence and contract-linked context. This is research priority, not an investment assessment.'},
};

export function radarReading(coin,mode='scalp',now=Date.now()){
 const liquidity=number(coin.liquidity),volume5m=number(coin.volume5m),volume24h=number(coin.volume);
 const buys=number(coin.buys5m),sells=number(coin.sells5m),trades=buys===null||sells===null?null:buys+sells;
 const recent=samples(coin,'marketHistory',now-4*3600000,now);
 const hourly=samples(coin,'marketHistoryHourly',now-5*86400000,now);
 const latest=freshAt(coin),stale=latest===null||now-latest>15*60000;
 const previous=previousVolume(recent,now);
 const acceleration=volume5m===null||!previous?null:previous.volume5m>0?scale(volume5m/previous.volume5m,0.8,2.5):volume5m>0?1:0;
 const turnover5m=liquidity>0&&volume5m!==null?volume5m/liquidity:null;
 const turnover24h=liquidity>0&&volume24h!==null?volume24h/liquidity:null;
 const oneHour=recent.filter(row=>row.at>=now-3600000);
 const lastDay=hourly.filter(row=>row.at>=now-86400000);
 const span=hourly.length>1?(hourly.at(-1).at-hourly[0].at)/3600000:null;
 const poolAge=number(coin.poolCreated);
 const context=coin.savedContext?.kind==='verified'||coin.savedContext?.kind==='web'&&coin.savedContext.web?.exact?'Exact contract evidence':coin.savedContext?'Related context only':'Context pending';
 let parts;
 if(mode==='swing')parts=[
  component('Liquidity',20,scale(liquidity,10000,100000),liquidity===null?'Unavailable':'Current pool liquidity'),
  component('24h turnover',20,scale(turnover24h,0.3,3),turnover24h===null?'Unavailable':'24h volume ÷ liquidity'),
  component('Repeated activity',25,persistence(oneHour,6),oneHour.length<6?`${oneHour.length}/6 recent samples; collecting history`:'Share of active samples in the last hour'),
  component('Buy pressure',20,recentDirection(oneHour),oneHour.length<6?'Collecting one-hour history':'Buy share across sampled 5m windows'),
  component('Context',15,contextValue(coin),context),
 ];
 else if(mode==='research')parts=[
  component('Liquidity',25,scale(liquidity,20000,250000),liquidity===null?'Unavailable':'Current pool liquidity'),
  component('Day persistence',25,persistence(lastDay,8),lastDay.length<8?`${lastDay.length}/8 hourly samples; collecting history`:'Share of active hourly samples in the last day'),
  component('Observed history',20,scale(span,6,48),span===null?'Collecting history':`${Math.round(span)}h of sampled history`),
  component('24h turnover',15,scale(turnover24h,0.2,2),turnover24h===null?'Unavailable':'24h volume ÷ liquidity'),
  component('Context',15,contextValue(coin),context),
 ];
 else parts=[
  component('Liquidity',20,scale(liquidity,3000,50000),liquidity===null?'Unavailable':'Current pool liquidity'),
  component('5m turnover',25,scale(turnover5m,0.01,0.15),turnover5m===null?'Unavailable':'5m volume ÷ liquidity'),
  component('5m trades',15,scale(trades,3,40),trades===null?'Unavailable':`${trades} buy/sell transactions`),
  component('Buy pressure',20,trades?scale(buys/trades,0.4,0.75):null,trades?'Share of 5m transactions that are buys':'Unavailable'),
  component('Acceleration',20,acceleration,previous?'5m volume versus an earlier sample':'Collecting a previous 5m sample'),
 ];
 const available=parts.filter(part=>part.value!==null),coverage=available.reduce((sum,part)=>sum+part.weight,0);
 const raw=coverage?available.reduce((sum,part)=>sum+part.value*part.weight,0)/coverage:null;
 const horizonReady=mode==='scalp'||mode==='swing'&&parts[2].value!==null&&parts[3].value!==null||mode==='research'&&parts[1].value!==null&&parts[2].value!==null;
 const score=coverage>=50&&horizonReady?Math.round(raw*100):null;
 return {coin,mode,parts,score,coverage,rankScore:raw===null?null:raw*coverage,stale,updatedAt:latest,
  poolAgeHours:poolAge===null?null:Math.max(0,(now-poolAge)/3600000),
  context,historySamples:mode==='research'?lastDay.length:oneHour.length};
}

export function rankRadar(coins,mode='scalp',now=Date.now()){
 if(!RADAR_MODES[mode])throw new Error('Unknown Radar mode');
 return coins.map(coin=>radarReading(coin,mode,now)).sort((a,b)=>Number(a.stale)-Number(b.stale)||Number(b.score!==null)-Number(a.score!==null)||(b.rankScore??-1)-(a.rankScore??-1)||(b.updatedAt??0)-(a.updatedAt??0));
}
