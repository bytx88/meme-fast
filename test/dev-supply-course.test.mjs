import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import app from '../dist/server/index.js';
const load=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('101C is one reachable course with practical instruction for every core supply question',async()=>{
 const course=JSON.parse(await load('content/meme-101c/course.json'));
 assert.equal(course.lessons.length,13);
 const hub=await load('dist/learn.html');
 assert.match(hub,/href="\.\/meme-101c.html"/);
 assert.doesNotMatch(hub,/href="\.\/meme-303b.html"/);
 const overview=await load('dist/meme-101c.html');
 for(const [index,lesson] of course.lessons.entries()){
  const filename=`meme-101c-lesson-${index+1}.html`;
  assert.ok(overview.includes(`href="./${filename}"`));
  const page=await load('dist/'+filename);
  assert.match(page,/101C · Dev &amp; Supply/);
  assert.match(page,/How to investigate/);
  assert.match(page,/Practical case — illustrative/);
  assert.match(page,/Check your understanding — answered/);
  assert.ok(!page.includes('[[TOKEN'));
  assert.ok((await load(lesson.body_file)).includes('## '));
 }
 const expected={1:['What is a bundle?','Why is it risky?','What the bubble map cannot show'],3:['Who receives the first tokens?','Who sets the starting price?'],4:['How many more can they mint?','Freeze accounts'],5:['What does locked mean?','Next release'],7:['Does the creator need to sell tokens','Pay Dev','accrued or actually received'],8:['first-30-minute surge','retail may not see'],10:['dev-buyer-cycle','Buyer side','Dev side','What the dev and buyers do'],11:['Destructive distribution','disclosure'],12:['History is evidence','Reasons each side may change'],13:['demand thesis','Supply hygiene','Unknowns']};
 for(const [number,terms] of Object.entries(expected)){
  const page=await load(`dist/meme-101c-lesson-${number}.html`);
  for(const term of terms)assert.ok(page.includes(term),`${number}: ${term}`);
 }
 const response=await app.fetch(new Request('https://example.test/meme-101c'));
 assert.equal(response.status,200);assert.match(await response.text(),/13 chapters/);
});

test('consolidation preserves old destinations without duplicate active courses',async()=>{
 const aliases={'meme-101-bundles':'meme-101c-lesson-1','meme-101b-lesson-9':'meme-101c-lesson-2','meme-303b':'meme-101c'};
 for(const [index,target] of [9,10,11,7,7,2].entries())aliases[`meme-303b-lesson-${index+1}`]=`meme-101c-lesson-${target}`;
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
