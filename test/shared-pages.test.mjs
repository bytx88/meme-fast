import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('rendered pages have one active navigation link and a stable Inspect brand destination',async()=>{
 const pages=['order-flow','narratives','narrative','new-coins','radar','watchlist','sources'];
 const active={narratives:'narratives.html','new-coins':'new-coins.html',radar:'radar.html','order-flow':'order-flow.html',watchlist:'watchlist.html'};
 for(const page of pages){
  const html=await readFile(new URL(`../dist/${page}.html`,import.meta.url),'utf8');
  const header=html.match(/<header class="masthead">[\s\S]*?<\/header>/)?.[0];
  assert.ok(header,`${page} header`);
  assert.match(header,/class="brand" href="\.\/order-flow\.html"/);
  assert.doesNotMatch(header,/class="brand"[^>]*aria-current/);
  assert.equal((header.match(/aria-current="page"/g)||[]).length,active[page]?1:0,page);
  if(active[page])assert.match(header,new RegExp(`<a href="\\./${active[page]}" aria-current="page">`));
 }
 assert.equal(await readFile(new URL('../dist/index.html',import.meta.url),'utf8'),
  await readFile(new URL('../dist/new-coins.html',import.meta.url),'utf8'));
});
