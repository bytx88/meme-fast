import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('rendered pages have one active navigation link and a stable Inspect brand destination',async()=>{
 const counts={'meme-101b':9,'meme-202a':11,'meme-202b':11,'meme-303':17};
 const learning=['learn','meme-101','meme-101-level-1','meme-101-level-2','meme-101-bundles',...Object.entries(counts).flatMap(([track,count])=>[track,...Array.from({length:count},(_,i)=>`${track}-lesson-${i+1}`)])];
 const pages=['model','order-flow','narratives','narrative','new-coins','radar','watchlist','sources',...learning];
 const active={model:'model.html',narratives:'narratives.html','new-coins':'new-coins.html',radar:'radar.html','order-flow':'order-flow.html',watchlist:'watchlist.html',...Object.fromEntries(learning.map(page=>[page,'learn.html']))};
 for(const page of pages){
  const html=await readFile(new URL(`../dist/${page}.html`,import.meta.url),'utf8');
  const header=html.match(/<header class="masthead">[\s\S]*?<\/header>/)?.[0];
  assert.ok(header,`${page} header`);
  assert.match(header,/class="brand" href="\.\/order-flow\.html"/);
  assert.match(header,/<a href="\.\/model\.html"/);
  assert.ok(header.indexOf('href="./learn.html"')<header.indexOf('href="./model.html"'),`${page} learning entry first`);
  assert.doesNotMatch(header,/class="brand"[^>]*aria-current/);
  assert.equal((header.match(/aria-current="page"/g)||[]).length,active[page]?1:0,page);
  if(active[page])assert.match(header,new RegExp(`<a href="\\./${active[page]}" aria-current="page">`));
 }
 assert.equal(await readFile(new URL('../dist/index.html',import.meta.url),'utf8'),
  await readFile(new URL('../dist/new-coins.html',import.meta.url),'utf8'));
});

test('applied learning links complete both course paths and hand back to the tools',async()=>{
 const load=page=>readFile(new URL(`../dist/${page}.html`,import.meta.url),'utf8');
 const hub=await load('learn');
 assert.ok(hub.includes('START HERE / 101A'));
 assert.ok((await load('meme-101')).includes('Meme 101A · Foundations'));
 for(const course of ['meme-101b','meme-202a','meme-202b','meme-303']){
  const overview=await load(course);
  assert.ok(hub.includes(`href="./${course}.html"`));
  const count=course==='meme-303'?17:course.startsWith('meme-202')?11:9;
  for(let i=1;i<=count;i++){
   const page=`${course}-lesson-${i}`,html=await load(page);
   const tabs=html.match(/<nav class="learning-tracks"[\s\S]*?<\/nav>/)?.[0];
   assert.ok(tabs.includes(`href="./${course}.html" aria-current="page"`),`${page} active course`);
   assert.match(html,/ILLUSTRATIVE · NOT A LIVE TOKEN/);
   assert.match(html,/<details class="applied-deeper"><summary>Go deeper<\/summary>/);
   assert.ok(overview.includes(`href="./${page}.html"`),`${page} reachable from overview`);
   const pager=html.match(/<nav class="lesson-pager"[\s\S]*?<\/nav>/)?.[0];
   assert.ok(pager.includes(`href="./${i<count?`${course}-lesson-${i+1}`:course}.html"`),`${page} next destination`);
   assert.ok(pager.includes(`href="./${i>1?`${course}-lesson-${i-1}`:course}.html"`),`${page} previous destination`);
   for(const [,file,anchor] of html.matchAll(/href="\.\/([^"#?]+)\.html(?:#([^"?]+))?"/g)){
    const destination=await load(file);
    if(anchor)assert.ok(destination.includes(`id="${anchor}"`),`${page} prerequisite ${anchor}`);
   }
  }
 }
 assert.ok((await load('new-coins')).includes('href="./meme-202a.html"'));
 assert.ok((await load('radar')).includes('href="./meme-202b.html"'));
});
