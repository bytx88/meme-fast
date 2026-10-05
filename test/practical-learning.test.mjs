import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const load=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('every applied chapter visibly teaches an investigation before handing readers to a tool',async()=>{
 const paths={'meme-101b':'content/meme-101b/course.json','meme-202a':'content/meme-202/202a.json','meme-202b':'content/meme-202/202b.json','meme-303a':'content/meme-303/303a.json','meme-303b':'content/meme-303/303b.json'};
 let total=0;
 for(const [slug,path] of Object.entries(paths)){
  const course=JSON.parse(await load(path));
  const practical=JSON.parse(await load(`content/curriculum/practical/${slug}.json`));
  assert.equal(Object.keys(practical).length,course.lessons.length);
  for(const [index,lesson] of course.lessons.entries()){
   const guide=practical[index+1];assert.equal(guide.title,lesson.title);
   const page=await load(`dist/${slug}-lesson-${index+1}.html`);
   const investigation=page.match(/<section class="practical-investigation"[\s\S]*?<\/section>/)?.[0];
   assert.ok(investigation,`${slug}.${index+1}`);
   for(const heading of ['Mechanism and worked case','How to investigate it','Check your reasoning — answered'])assert.ok(investigation.includes(heading));
   assert.ok(page.indexOf(investigation)<page.indexOf('<section class="applied-handoff"'));
   assert.ok(page.indexOf(investigation)<page.indexOf('<details class="applied-deeper"'));
   total++;
  }
 }
 assert.equal(total,48);
});

test('foundation cases and the bundle ledger teach the reasoning behind their questions',async()=>{
 for(let i=1;i<=8;i++){
  const page=await load(`dist/meme-101-level-${i}.html`);
  assert.match(page,/href="#work-through-the-evidence"/);
  assert.match(page,/How to investigate it/);
  assert.match(page,/Check your reasoning — answered/);
 }
 const bundle=await load('dist/meme-101-bundles.html');
 assert.equal((bundle.match(/<table\b/g)||[]).length,5);
 for(const term of ['Worked inventory ledger','56m supported inventory','$14,736.84','C1 and C2 are alternative cases','Practice, with worked answers','Your research output'])assert.ok(bundle.includes(term),term);
 assert.ok(bundle.indexOf('Worked inventory ledger')<bundle.indexOf('Turn the checklist into an investigation'));
});
