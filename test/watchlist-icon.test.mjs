import test from 'node:test';
import assert from 'node:assert/strict';

test('an existing saved CASHED item shows its icon and stats without opening Hodl',async()=>{
 const contract='0x6249519883b8d7ccf915dfcd6c0442984dae9d24';
 const item={type:'radar',id:`robinhood:${contract}`,title:'$CASHED · Cashed Money',subtitle:`Robinhood Chain · ${contract}`,href:`./radar.html?contract=${contract}`,savedAt:Date.now()};
 const nodes={items:{innerHTML:'',onclick:null},count:{textContent:''},'refresh-stats':{disabled:false,textContent:'',onclick:null}};
 let saved=JSON.stringify([item]);
 globalThis.localStorage={getItem:key=>key==='meme-fast-watchlist-v1'?saved:null,setItem:(key,value)=>{if(key==='meme-fast-watchlist-v1')saved=value}};
 globalThis.document={getElementById:id=>nodes[id],addEventListener:()=>{}};
 globalThis.window={addEventListener:()=>{}};
 const requests=[];
 globalThis.fetch=async url=>{requests.push(url);return {ok:true,json:async()=>({lastRun:Date.now(),coins:[{id:item.id,image_url:'https://cdn.example/cashed.png',priceUsd:0.005,priceChange:12,fdv:4600000,liquidity:200000,volume:1000000,volume5m:10000,buys5m:8,sells5m:3,marketUpdatedAt:Date.now()}]})}};
 await import('../dist/watchlist.js');
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(nodes.items.innerHTML,/class="saved-item-icon"/);
 assert.match(nodes.items.innerHTML,/src="https:\/\/cdn\.example\/cashed\.png"/);
 assert.match(nodes.items.innerHTML,/\$CASHED/);
 assert.match(nodes.items.innerHTML,/Vol 24h/);
 assert.match(nodes.items.innerHTML,/\$1M/);
 assert.equal((nodes.items.innerHTML.match(/class="watch-metric"/g)||[]).length,7);
 assert.doesNotMatch(nodes.items.innerHTML,/watch-token-head|watch-data-note/);
 assert.doesNotMatch(nodes.items.innerHTML,/Open ↗/);
 assert.equal(requests.length,1);
 assert.match(requests[0],/view=watchlist/);
 assert.equal(JSON.parse(saved)[0].image_url,'https://cdn.example/cashed.png');
});
