import test from 'node:test';
import assert from 'node:assert/strict';
import {fitPriceView,clampPriceView} from '../dist/heatmap-view.mjs';

const data={price_lo:100,price_hi:200,nbins:10,price_edges:Array.from({length:11},(_,i)=>100+10*i),
 profile_long:[1,1,5,10,20,0,0,0,0,0],profile_short:[0,0,0,0,0,20,10,5,1,1],
 current_price:150,ohlc:[null,[145,155,140,150]]};
function bounds(view){return [100+100*(view.center-.5/view.scale),100+100*(view.center+.5/view.scale)];}

test('auto fit trims low-exposure tails while retaining candles, current price and both peaks',()=>{
 const view=fitPriceView(data),[low,high]=bounds(view);
 assert.ok(low>100&&high<200);
 assert.ok(low<=140&&high>=160);
 assert.ok(high-low<100);
});
test('auto fit preserves an extreme candle and peak outside the central exposure mass',()=>{
 const report={...data,ohlc:[[110,197,105,190]],profile_short:[0,0,0,0,0,20,0,0,0,0]};
 const [low,high]=bounds(fitPriceView(report));
 assert.ok(low<=105&&high>=197);
 const peaks={...data,profile_short:[9,0,0,0,0,0,0,0,0,0]};
 assert.ok(bounds(fitPriceView(peaks))[0]<=100);
});
test('empty profiles still fit available candle prices and missing candles are safe',()=>{
 const report={...data,profile_long:Array(10).fill(0),profile_short:Array(10).fill(0)};
 const [low,high]=bounds(fitPriceView(report));assert.ok(low<=140&&high>=155);
 assert.deepEqual(fitPriceView({...report,ohlc:[],current_price:undefined}),{scale:1,center:.5});
});
test('manual scaling and panning cannot extend beyond provider bounds',()=>{
 for(const scale of [.1,1,2,12,100])for(const center of [-100,0,.5,1,100]){
  const view=clampPriceView(scale,center),[low,high]=bounds(view);
  assert.ok(view.scale>=1&&view.scale<=12);
  assert.ok(low>=100-1e-9&&high<=200+1e-9);
 }
});
