import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('rendered pages have one active navigation link and a stable Inspect brand destination',async()=>{
 const counts={'meme-101b':8,'meme-101c':10,'meme-202a':11,'meme-202b':11,'meme-303a':11};
 const learning=['learn','meme-101','meme-101-level-1','meme-101-level-2','meme-303',...Object.entries(counts).flatMap(([track,count])=>[track,...Array.from({length:count},(_,i)=>`${track}-${track==='meme-101c'?'section':'lesson'}-${i+1}`)])];
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
 for(const course of ['meme-101b','meme-101c','meme-202a','meme-202b','meme-303a']){
  const overview=await load(course);
  assert.ok(hub.includes(`href="./${course}.html"`));
  const count=course==='meme-101c'?10:course==='meme-101b'?8:11;
  const unit=course==='meme-101c'?'section':'lesson';
  for(let i=1;i<=count;i++){
   const page=`${course}-${unit}-${i}`,html=await load(page);
   const tabs=html.match(/<nav class="learning-tracks"[\s\S]*?<\/nav>/)?.[0];
   assert.ok(tabs.includes(`href="./${course}.html" aria-current="page"`),`${page} active course`);
   if(course==='meme-101c'){assert.match(html,/Practical case — illustrative/);assert.match(html,/Check your understanding — answered/);}else{
    assert.match(html,/ILLUSTRATIVE · NOT A LIVE TOKEN/);
    assert.match(html,/<details class="applied-deeper"><summary>Go deeper<\/summary>/);
   }
   assert.ok(overview.includes(`href="./${page}.html"`),`${page} reachable from overview`);
   const pager=html.match(/<nav class="lesson-pager"[\s\S]*?<\/nav>/)?.[0];
   assert.ok(pager.includes(`href="./${i<count?`${course}-${unit}-${i+1}`:course}.html"`),`${page} next destination`);
   assert.ok(pager.includes(`href="./${i>1?`${course}-${unit}-${i-1}`:course}.html"`),`${page} previous destination`);
   for(const [,file,anchor] of html.matchAll(/href="\.\/([^"#?]+)\.html(?:#([^"?]+))?"/g)){
    const destination=await load(file);
    if(anchor)assert.ok(destination.includes(`id="${anchor}"`),`${page} prerequisite ${anchor}`);
   }
  }
 }
 assert.ok((await load('new-coins')).includes('href="./meme-202a.html"'));
 assert.ok((await load('radar')).includes('href="./meme-202b.html"'));
});


test('303 split preserves every chapter and redirects existing bookmarks',async()=>{
 const load=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
 const original=JSON.parse(await load('content/meme-303/course.json'));
 const seen=[];
 const sitemap=await load('dist/sitemap.xml');
 for(const track of ['a','b']){
  const course=JSON.parse(await load(`content/meme-303/303${track}.json`));
  for(const [index,chapter] of course.lessons.entries()){
   const {legacy_lesson,...content}=chapter;
   assert.deepEqual(content,original.lessons[legacy_lesson-1]);
   seen.push(legacy_lesson);
   const target=track==='b'?`meme-101c-section-${[9,3,9,8,8,5][index]}.html`:`${course.slug}-lesson-${index+1}.html`;
   const redirect=await load(`dist/meme-303-lesson-${legacy_lesson}.html`);
   assert.ok(redirect.includes(`content="0;url=./${target}"`));
   assert.ok(redirect.includes(`rel="canonical" href="https://meme.oneerp.org/${target}"`));
   assert.ok(redirect.includes(`href="./${target}"`));
   assert.ok(sitemap.includes(`/${target}</loc>`));
  }
 }
 assert.deepEqual(seen.sort((a,b)=>a-b),Array.from({length:17},(_,i)=>i+1));
 assert.doesNotMatch(sitemap,/meme-303-lesson-\d+\.html/);
 const chooser=await load('dist/meme-303.html');
 assert.ok(chooser.includes('href="./meme-303a.html"'));
 assert.ok(chooser.includes('href="./meme-101c.html"'));
 assert.ok(!chooser.includes('href="./meme-303b.html"'));
});
