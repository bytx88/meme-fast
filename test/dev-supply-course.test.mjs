import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import app from '../dist/server/index.js';
import vm from 'node:vm';
const load=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('101C is one reachable course with practical instruction for every core supply question',async()=>{
 const course=JSON.parse(await load('content/meme-101c/course.json'));
 assert.equal(course.lessons.length,13);
 assert.equal(course.sections.length,10);
 assert.deepEqual(course.sections.flatMap(s=>s.topics).sort((a,b)=>a-b),Array.from({length:13},(_,i)=>i+1));
 const hub=await load('dist/learn.html');
 assert.match(hub,/href="\.\/meme-101c.html"/);
 assert.doesNotMatch(hub,/href="\.\/meme-303b.html"/);
 const overview=await load('dist/meme-101c.html');
 for(const [index,lesson] of course.sections.entries()){
  const filename=`meme-101c-section-${index+1}.html`;
  assert.ok(overview.includes(`href="./${filename}"`));
  const page=await load('dist/'+filename);
  assert.match(page,/101C · Dev &amp; Supply/);
  assert.match(page,/How to investigate/);
  assert.match(page,/Practical case — illustrative/);
  assert.match(page,/Check your understanding — answered/);
  assert.ok(!page.includes('[[TOKEN'));
  if(lesson.body_file)assert.ok((await load(lesson.body_file)).includes('## '));
 }
 const expected={5:['What is a bundle?','Why is it risky?','What the bubble map cannot show'],4:['Who receives the first tokens?','Who sets the starting price?'],6:['How many more can they mint?','Freeze accounts','What does locked mean?','Next release'],8:['Does the creator need to sell tokens','Pay Dev','accrued or actually received','first-30-minute surge','retail may not see'],3:['dev-buyer-cycle','Buyer side','Dev side','What the dev and buyers do'],9:['Destructive distribution','disclosure','History is evidence','Reasons each side may change'],10:['demand thesis','Supply hygiene','Unknowns']};
 for(const [number,terms] of Object.entries(expected)){
  const page=await load(`dist/meme-101c-section-${number}.html`);
  for(const term of terms)assert.ok(page.includes(term),`${number}: ${term}`);
 }
 const response=await app.fetch(new Request('https://example.test/meme-101c'));
 assert.equal(response.status,200);assert.match(await response.text(),/10 sections/);
});

test('presentation v2 retains every original topic explanation, case and visible answer',async()=>{
 const course=JSON.parse(await load('content/meme-101c/course.json'));
 const mapping=Object.fromEntries(course.sections.flatMap((s,i)=>s.topics.map(t=>[t,i+1])));
 const decode=text=>text.replace(/&(amp|lt|gt|quot|#x27|#39);/g,(_,entity)=>({amp:'&',lt:'<',gt:'>',quot:'"','#x27':"'",'#39':"'"})[entity]);
 const normalize=text=>decode(text).replace(/\s+/g,' ').trim();
 for(const [index,section] of course.sections.entries()){
  const page=await load(`dist/meme-101c-section-${index+1}.html`);
  const text=normalize(page.replace(/<\/(?:p|h[1-6]|li|td|th|section|div)>/g,' ').replace(/<[^>]+>/g,''));
  const ids=[...page.matchAll(/ id="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size,`section ${index+1}: unique anchors`);
  assert.doesNotMatch(page,/<details/,'answers and original content stay visible');
  for(const topic of section.topics){
   const source=await load(course.lessons[topic-1].body_file);
   for(let line of source.split(/\r?\n/)){
    line=line.replace('Chapters 1–12','Sections 1–9').replace(/Chapter (\d+)/g,(_,n)=>`Section ${mapping[n]}`).replace('Later chapters','Later sections');
    line=line.replace(/^#{1,3} /,'').replace(/^\d+\. /,'').replace(/\*\*/g,'').trim();
    if(!line || /^\|[\s|:-]+\|$/.test(line))continue;
    for(const cell of line.startsWith('|')?line.split('|').filter(c=>c.trim()):[line]){
     assert.ok(text.includes(normalize(cell)),`topic ${topic}: retained ${cell}`);
    }
   }
  }
 }
 const redirect=await load('dist/meme-101c-lesson-13.html');
 const script=redirect.match(/<script>([\s\S]*?)<\/script>/)[1];
 for(const hash of ['', '#review-inventory', '#a-useful-conclusion']){
  let target;
  vm.runInNewContext(script,{location:{hash,replace(value){target=value;}}});
  assert.equal(target,`./meme-101c-section-10.html${hash==='#a-useful-conclusion'?'#topic-13-a-useful-conclusion':hash||'#topic-13'}`);
 }
});

test('consolidation preserves old destinations without duplicate active courses',async()=>{
 const aliases={'meme-101-bundles':'meme-101c-section-5','meme-101b-lesson-9':'meme-101c-section-5','meme-303b':'meme-101c'};
 for(const [index,target] of [9,3,9,8,8,5].entries())aliases[`meme-303b-lesson-${index+1}`]=`meme-101c-section-${target}`;
 for(const [topic,section] of Object.entries({1:5,2:5,3:4,4:6,5:6,6:7,7:8,8:8,9:9,10:3,11:9,12:9,13:10}))aliases[`meme-101c-lesson-${topic}`]=`meme-101c-section-${section}`;
 const sitemap=await load('dist/sitemap.xml');
 for(const [old,target] of Object.entries(aliases)){
  const html=await load(`dist/${old}.html`);
  assert.ok(html.includes(`content="0;url=./${target}.html"`));
  assert.ok(html.includes(`href="https://meme.oneerp.org/${target}.html"`));
  assert.ok(sitemap.includes(`/${target}.html</loc>`));
  assert.ok(!sitemap.includes(`/${old}.html</loc>`));
 }
 assert.ok(!(await load('dist/meme-101.html')).includes('Bundle deep dive</h2>'));
});
