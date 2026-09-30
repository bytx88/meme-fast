// These rows are the already deduplicated, scoped, time-filtered chart sample.
const marks=[1,1.2,1.5,2,2.5,3,4,5,6,8,10];
export function mcTier(value){
  const scale=10**Math.floor(Math.log10(value));
  const i=marks.findIndex((m,j)=>j<marks.length-1&&value<marks[j+1]*scale);
  const index=i<0?marks.length-2:i;
  return {low:marks[index]*scale,high:marks[index+1]*scale};
}
export function aggregateMC(rows,snapshot){
  const supply=snapshot?.value/snapshot?.price;
  if(!Number.isFinite(supply)||supply<=0)return {tiers:[],included:0,excluded:rows.length,available:false};
  const buckets=new Map();let included=0;
  for(const row of rows){
    const mc=row.price*supply;
    if(row.tokenKey!==snapshot.tokenKey||!Number.isFinite(row.price)||row.price<=0||!Number.isFinite(mc)||mc<=0||!['buy','sell'].includes(row.side)||!Number.isFinite(row.usd)||row.usd<=0)continue;
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
  return {tiers:tiers.reverse(),included,excluded:rows.length-included,available:true};
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
