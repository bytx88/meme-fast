import test from 'node:test';
import assert from 'node:assert/strict';

test('Ethereum watchlist loads an exact Gecko pool, caches it and retains it on a failed refresh',async()=>{
 const address='0x'+'a'.repeat(40),other='0x'+'b'.repeat(40);
 let saved=JSON.stringify([{type:'token',id:`eth:${address}`,title:'STOCKER',subtitle:`eth · ${address}`,savedAt:Date.now()}]);
 const nodes=Object.fromEntries(['items','count','refresh-stats','add-token','add-token-dialog','add-token-form','add-token-query','add-token-status','add-token-results','close-add-token','priority-status'].map(id=>[id,{textContent:'',innerHTML:''}]));
 globalThis.localStorage={getItem:()=>saved,setItem:(_,value)=>{saved=value}};
 globalThis.document={getElementById:id=>nodes[id],addEventListener:()=>{}};
 globalThis.window={addEventListener:()=>{}};
 const requests=[];
 let limited=false;
 const pool=(contract,liquidity)=>({id:`eth_${contract}`,attributes:{address:'0x'+'c'.repeat(64),reserve_in_usd:String(liquidity),base_token_price_usd:'0.12',fdv_usd:'1200000',volume_usd:{h24:'9000',m5:'500'},transactions:{m5:{buys:4,sells:2}},price_change_percentage:{h24:'5'}},relationships:{base_token:{data:{id:`eth_${contract}`}}}});
 globalThis.fetch=async(url)=>{
  requests.push(url);
  if(url.includes('view=watchlist'))return {ok:true,json:async()=>({coins:[]})};
  assert.equal(url,`/api/market/networks/eth/tokens/${address}/pools`);
  return {ok:!limited,status:limited?429:200,json:async()=>({data:[pool(other,1000000),pool(address,25000)],included:[other,address].map(contract=>({type:'token',id:`eth_${contract}`,attributes:{address:contract,symbol:contract===address?'STOCKER':'WRONG',name:contract===address?'Stockereum.fun':'Wrong token'}}))})};
 };
 await import('../dist/watchlist.js');
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(nodes.items.innerHTML,/\$0\.12/);
 assert.match(nodes.items.innerHTML,/\$25K/);
 assert.doesNotMatch(nodes.items.innerHTML,/WRONG|No current market snapshot/);
 assert.equal(JSON.parse(saved)[0].marketSnapshot.contract_address,address);
 assert.equal(requests.some(url=>url==='/api/refresh-priority'),false);
 assert.match(nodes['priority-status'].textContent,/Ethereum uses Gecko lookup/);
 limited=true;
 await nodes['refresh-stats'].onclick();
 assert.match(nodes.items.innerHTML,/\$0\.12/);
 assert.equal(JSON.parse(saved)[0].marketSnapshot.contract_address,address);
});
