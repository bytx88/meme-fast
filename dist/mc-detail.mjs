import {credibleMarketCapTrades,marketCapTier} from './market-cap.mjs';
// These rows are the already deduplicated, scoped, time-filtered chart sample.
export const mcTier=marketCapTier;
export function aggregateMC(rows,snapshot){
  const {trades,outliers,available}=credibleMarketCapTrades(rows,snapshot);
  if(!available)return {tiers:[],included:0,excluded:rows.length,outliers:0,available:false};
  const buckets=new Map();let included=0;
  for(const {row,mc} of trades){
    if(!['buy','sell'].includes(row.side))continue;
    const {low,high}=mcTier(mc);
    if(!buckets.has(low))buckets.set(low,{low,high,buy:0,sell:0,buyCount:0,sellCount:0});
    const tier=buckets.get(low);tier[row.side]+=row.usd;tier[row.side+'Count']++;included++;
  }
  let tiers=[...buckets.values()].sort((a,b)=>a.low-b.low);
  // Keep extreme price ranges readable without discarding activity or totals.
  while(tiers.length>12){
    let index=0,smallest=Infinity;
    for(let i=0;i<tiers.length-1;i++){
      const count=tiers[i].buyCount+tiers[i].sellCount+tiers[i+1].buyCount+tiers[i+1].sellCount;
      if(count<smallest){smallest=count;index=i}
    }
    const a=tiers[index],b=tiers[index+1];
    tiers.splice(index,2,{low:a.low,high:b.high,buy:a.buy+b.buy,sell:a.sell+b.sell,buyCount:a.buyCount+b.buyCount,sellCount:a.sellCount+b.sellCount});
  }
  return {tiers:tiers.reverse(),included,excluded:rows.length-included,outliers,available:true};
}
export function tierMetric(tier,metric='value'){
  const buy=metric==='count'?tier.buyCount:metric==='average'?(tier.buyCount?tier.buy/tier.buyCount:null):tier.buy;
  const sell=metric==='count'?tier.sellCount:metric==='average'?(tier.sellCount?tier.sell/tier.sellCount:null):tier.sell;
  return {buy,sell,net:buy==null||sell==null?null:buy-sell};
}
export function tierRead(values,metric,activity,maxActivity){
  const {buy,sell,net}=values;
  if(net==null)return 'One-sided sample; no average comparison';
  if(buy===0&&sell===0)return 'No observed activity';
  const imbalance=net/(buy+sell);
  if(metric==='average')return Math.abs(imbalance)<=.1?'Similar average sizes':net>0?'Larger average buys':'Larger average sells';
  if(Math.abs(imbalance)<=.1)return activity>=maxActivity*.5?'Heavy two-way activity; nearly balanced':'Nearly balanced';
  if(Math.abs(imbalance)<.3)return net>0?'Mild buy dominance':'Mild sell dominance';
  return net>0?'Buy dominant':'Sell dominant';
}
