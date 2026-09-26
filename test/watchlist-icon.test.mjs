import test from 'node:test';
import assert from 'node:assert/strict';

test('an existing saved CASHED item receives its icon from the Radar snapshot',async()=>{
 const contract='0x6249519883b8d7ccf915dfcd6c0442984dae9d24';
 const item={type:'radar',id:`robinhood:${contract}`,title:'$CASHED · Cashed Money',subtitle:`Robinhood Chain · ${contract}`,href:`./radar.html?contract=${contract}`,savedAt:Date.now()};
 const nodes={items:{innerHTML:'',onclick:null},count:{textContent:''}};
 let saved=JSON.stringify([item]);
 globalThis.localStorage={getItem:key=>key==='meme-fast-watchlist-v1'?saved:null,setItem:(key,value)=>{if(key==='meme-fast-watchlist-v1')saved=value}};
 globalThis.document={getElementById:id=>nodes[id],addEventListener:()=>{}};
 globalThis.window={addEventListener:()=>{}};
 globalThis.fetch=async()=>({ok:true,json:async()=>({radarCoins:[{id:item.id,image_url:'https://cdn.example/cashed.png'}]})});
 await import('../dist/watchlist.js');
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(nodes.items.innerHTML,/class="saved-item-icon"/);
 assert.match(nodes.items.innerHTML,/src="https:\/\/cdn\.example\/cashed\.png"/);
 assert.match(nodes.items.innerHTML,/\$CASHED/);
 assert.equal(JSON.parse(saved)[0].image_url,'https://cdn.example/cashed.png');
});
