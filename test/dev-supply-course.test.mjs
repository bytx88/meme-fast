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
 const expected={5:['What is a bundle?','Why is it risky?','Check the map and its gaps'],4:['Who receives the first tokens?','Who sets the starting price?'],6:['How many more can they mint?','freezing stops affected accounts','Read the lock and release schedule','next release'],8:['Does the creator need to sell tokens','Pay Dev','earned-but-waiting','first-30-minute surge','Private promotion payments'],3:['dev-buyer-cycle','Buyer side','Dev side','What the dev and buyers do'],9:['Destructive distribution','disclosure','Check previous launches','declining fee receipts'],10:['demand thesis','Supply hygiene','Unknowns']};
 for(const [number,terms] of Object.entries(expected)){
  const page=await load(`dist/meme-101c-section-${number}.html`);
  for(const term of terms)assert.ok(page.includes(term),`${number}: ${term}`);
 }
 const response=await app.fetch(new Request('https://example.test/meme-101c'));
 assert.equal(response.status,200);assert.match(await response.text(),/10 sections/);
});

test('the ten-section edit preserves mechanisms and examples with one complete lesson per section',async()=>{
 const course=JSON.parse(await load('content/meme-101c/course.json'));
 const expected={
  1:['token address','allocation','Cost basis','bundle','Linked wallets','liquidity pool','price impact','Permissions','Vesting','unlock','creator fee','Dumping','150m','30m','20m','100m'],
  2:['Dumping risk','completed swaps','upcoming unlocks','liquidity','weak demand'],
  3:['trading fees','sell its own tokens','returning users','equal periods','competing token','11:00 UTC'],
  4:['decimals','Creator/team','Treasury','Pool','Buyers','launch curve','ratio of paired assets','auctions or order books','Market cap','holder paid'],
  5:['ordered execution','launch purchases','top ten','creator or deployer','token accounts','Exchange custody','private agreements','3%','linked available units','12m','12%','recipient'],
  6:['Token-2022','freeze authorities','enforced cap','permanently revoked','metadata/update','exemptions','activation delays','circulating supply','float','cliff','claimable','cancellation','recipient-change','Streamflow','15.4%'],
  7:['position NFTs','protocol-controlled','expiry','withdrawal/admin rights','migration rules','completion transaction','secondary pool','100,000','18%'],
  8:['Token sales','Creator fee share','Token fees','Liquidity fees','Treasury funding','Product revenue','Pay Dev','DEX Paid','Axiom','Pump','Padre','KOL','raid','first-30-minute surge','$100,000 × 1% × 30% = $300','$200 received and $100 waiting','bought 4m tokens and sold 4m','bought 2m'],
  9:['Cost basis','Internal transfers','outside inflows','outside outflows','Destructive distribution','Alignment','Divergence','disclosure','treasury','previous launches','successful and unsuccessful','failed migration','new creator launch','missed releases','verified token','12m','8%','20m locked','two delivered updates and one missed promise'],
  10:['demand thesis','Supply hygiene','8m available after 5m sold and 1m bought','12m group / 104m available','11.5%','3%','Unknowns','Your token review worksheet']
 };
 for(const [index,section] of course.sections.entries()){
  const page=await load(`dist/meme-101c-section-${index+1}.html`);
  const text=page.replace(/<[^>]+>/g,'');
  for(const phrase of expected[index+1])assert.ok(text.toLowerCase().includes(phrase.toLowerCase()),`section ${index+1}: ${phrase}`);
  const ids=[...page.matchAll(/ id="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size,`section ${index+1}: unique anchors`);
  assert.doesNotMatch(page,/<details/,'required teaching and answers stay visible');
  for(const heading of ['How to investigate it','Practical case — illustrative','Keep this record','Check your understanding — answered']){
   assert.equal([...page.matchAll(new RegExp(`<h2[^>]*>${heading}[^<]*</h2>`,'g'))].length,1,`${index+1}: one ${heading}`);
  }
  const body=page.match(/<article class="lesson-body">([\s\S]*?)<\/article>/)[1];
  if([5,9].includes(index+1))assert.ok(body.replace(/<[^>]+>/g,' ').split(/\s+/).length<1150,`${index+1}: manageable reading load`);
  assert.ok((await load(section.body_file)).includes('## '));
 }
 const first=await load('dist/meme-101c-section-1.html');
 assert.doesNotMatch(first,/<table|\[\[TOKEN_LAUNCH/);
 for(const figure of ['One launch, three steps','Where SAMPLE’s 150m tokens go','Follow what someone paid and received'])assert.ok(first.includes(figure));
 const relationship=await load('dist/meme-101c-section-3.html');
 assert.doesNotMatch(relationship,/after Section 9|8m|12m/,'early example stands on its own');
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
