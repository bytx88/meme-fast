export function clampPriceView(scale,center){
 scale=Math.max(1,Math.min(12,scale));
 return {scale,center:Math.max(.5/scale,Math.min(1-.5/scale,center))};
}

export function fitPriceView(data){
 const full=data.price_hi-data.price_lo;
 const edges=data.price_edges||Array.from({length:data.nbins+1},(_,i)=>data.price_lo+full*i/data.nbins);
 const weights=data.profile_long.map((v,i)=>v+data.profile_short[i]),total=weights.reduce((a,b)=>a+b,0);
 const prices=[];
 if(total>0){
  // Keep whole buckets at the 15th and 85th exposure percentiles.
  let cumulative=0,lower=null;
  for(let i=0;i<weights.length;i++){
   cumulative+=weights[i];
   if(lower===null&&cumulative>=total*.15)lower=edges[i];
   if(cumulative>=total*.85){prices.push(lower,edges[i+1]);break;}
  }
 }
 for(const profile of [data.profile_long,data.profile_short]){
  let index=0;for(let i=1;i<profile.length;i++)if(profile[i]>profile[index])index=i;
  if(profile[index]>0)prices.push(edges[index],edges[index+1]);
 }
 for(const candle of data.ohlc)if(candle)prices.push(candle[2],candle[1]);
 if(Number.isFinite(data.current_price))prices.push(data.current_price);
 if(!prices.length)return {scale:1,center:.5};
 let low=Math.min(...prices),high=Math.max(...prices);
 const padding=Math.max(high-low,full/12)*.05;
 low=Math.max(data.price_lo,low-padding);high=Math.min(data.price_hi,high+padding);
 if(high<=low)return {scale:1,center:.5};
 return clampPriceView(full/(high-low),((low+high)/2-data.price_lo)/full);
}
