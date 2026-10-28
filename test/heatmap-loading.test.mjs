import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {fitPriceView,clampPriceView} from '../dist/heatmap-view.mjs';

// Run the actual UI module with a minimal DOM and controlled network/clock.
const source=readFileSync(new URL('../dist/btc-heatmap.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/,'').replaceAll('export function','function');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
 const requests=[],timers=new Map(),intervals=[];let clock=1793193000000,timerId=0;
 class Element{
  constructor(){this.listeners={};this.dataset={};this.style={};this.attrs={};this.hidden=false;this.textContent='';this.clientWidth=900;this.clientHeight=480;this.offsetHeight=64;this.classList={toggle(){},add(){},remove(){},contains(){return false;}};}
  addEventListener(name,fn){this.listeners[name]=fn;}
  emit(name,event={}){return this.listeners[name]?.({preventDefault(){},...event});}
  setAttribute(key,value){this.attrs[key]=value;}
  getAttribute(key){return this.attrs[key];}
  removeAttribute(key){delete this.attrs[key];}
  append(...children){this.children=[...(this.children||[]),...children];} replaceChildren(){} focus(){} hasPointerCapture(){return false;} setPointerCapture(){} releasePointerCapture(){}
  getContext(){return this.context??=new Proxy({fillRect:()=>{this.paints=(this.paints||0)+1;}}, {get:(target,key)=>target[key]??(()=>{})});} getBoundingClientRect(){return {left:0,top:0,width:900,height:480};}
 }
 const elements=new Map(),root=new Element(),symbols=['BTCUSDT','XAUUSDT'].map(symbol=>{const e=new Element();e.dataset.symbol=symbol;return e;});
 const days=[1,3,7,30].map(day=>{const e=new Element();e.dataset.days=String(day);return e;});
 root.querySelector=selector=>{if(!elements.has(selector))elements.set(selector,new Element());return elements.get(selector);};
 root.querySelectorAll=selector=>selector==='[data-symbol]'?symbols:days;
 const document={hidden:false,querySelector:()=>root,createElement:()=>new Element(),addEventListener(){}};
 class ClockDate extends Date{static now(){return clock;}}
 vm.runInNewContext(source,{document,window:{devicePixelRatio:1},Intl,Date:ClockDate,AbortController,DOMException,
  fitPriceView,clampPriceView,ResizeObserver:class{observe(){}},getComputedStyle:()=>({getPropertyValue:()=> '#111820'}),
  setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),setInterval:fn=>intervals.push(fn),
  fetch:(url,{signal})=>new Promise((resolve,reject)=>{requests.push({url,resolve,reject});signal.addEventListener('abort',()=>reject(signal.reason));})});
 const report=symbol=>({symbol,times:[clock-3600000,clock],matrix:[[1,2],[2,1]],ohlc:[[150,155,145,150],[150,155,145,150]],
  nbins:2,price_lo:100,price_hi:200,profile_long:[2,0],profile_short:[0,1],updated:clock,current_price:150,coverageDays:1,exchanges:[],source:'Swolecharts',sourceUrl:'https://swolecharts.com',licenseUrl:'https://swolecharts.com',licenseLabel:'Terms',scope:'Model',cache:{state:'fresh'}});
 const reply=(index,symbol='BTCUSDT',retry='300',ok=true)=>requests[index].resolve({ok,headers:{get:()=>retry},json:async()=>report(symbol)});
 return {requests,timers,symbols,days,reply,elements,root,poll:()=>intervals[0](),advance:ms=>clock+=ms,status:()=>root.querySelector('.heat-status').textContent};
}

test('polling during an unfinished request preserves loading and does not duplicate it',async()=>{
 const h=harness();h.poll();await flush();assert.equal(h.requests.length,1);assert.match(h.status(),/^Loading/);
 h.reply(0);await flush();assert.match(h.status(),/BTCUSDT/);assert.doesNotMatch(h.status(),/unavailable/);
});
test('rapid market changes can return to an aborted selection immediately',async()=>{
 const h=harness();h.symbols[1].emit('click');h.symbols[0].emit('click');await flush();
 assert.equal(h.requests.length,3);assert.match(h.requests[2].url,/symbol=BTCUSDT/);
 h.reply(2);await flush();assert.match(h.status(),/BTCUSDT/);assert.doesNotMatch(h.status(),/unavailable/);
});
test('reselecting the active range cannot leave an aborted request stuck',async()=>{
 const h=harness();h.days[3].emit('click');await flush();assert.equal(h.requests.length,2);
 h.reply(1);await flush();assert.doesNotMatch(h.status(),/Loading|unavailable/);
});
test('a stalled browser request times out visibly and waits before retrying',async()=>{
 const h=harness();[...h.timers.values()].find(timer=>timer.delay===60000).fn();await flush();
 assert.match(h.status(),/timed out/);h.poll();assert.equal(h.requests.length,1);
 h.advance(300001);h.poll();assert.equal(h.requests.length,2);
});
test('real provider retry delays survive polling and cached refresh failures retain data',async()=>{
 const h=harness();h.reply(0,'BTCUSDT','900');await flush();h.advance(300001);h.poll();assert.equal(h.requests.length,1);
 h.advance(600000);h.poll();assert.equal(h.requests.length,2);h.requests[1].reject(new TypeError('Network unavailable'));await flush();
 assert.match(h.status(),/Cached \/ delayed/);assert.match(h.status(),/BTCUSDT/);
});
test('hover only paints the crosshair layer and exposes its price badge near current price',async()=>{
 const h=harness();h.reply(0);await flush();const canvas=h.root.querySelector('canvas'),paints=canvas.paints;
 canvas.emit('pointermove',{clientX:200,clientY:230});
 assert.equal(canvas.paints,paints);
 const [marker,overlay]=h.root.querySelector('.heat-chart').children;
 assert.ok(overlay.paints>0);assert.equal(marker.hidden,true);
 canvas.emit('pointerleave');assert.equal(marker.hidden,false);
});
