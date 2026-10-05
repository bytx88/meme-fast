import {readFile,writeFile} from 'node:fs/promises';

// The Inspect page owns the server-rendered masthead. Keep every page's
// initial HTML in sync without waiting for JavaScript to paint navigation.
const lessons=Array.from({length:8},(_,i)=>`meme-101-level-${i+1}`);
const courseSources=['content/meme-101b/course.json','content/meme-101c/course.json','content/meme-202/202a.json','content/meme-202/202b.json','content/meme-303/303a.json'];
const courses=await Promise.all(courseSources.map(async path=>JSON.parse(await readFile(path,'utf8'))));
const applied=courses.flatMap(course=>[course.slug,...(course.sections||course.lessons).map((_,i)=>`${course.slug}-${course.sections?'section':'lesson'}-${i+1}`)]);
const learning=['learn','meme-101',...lessons,'meme-303',...applied];
const pages=['order-flow','narratives','narrative','new-coins','radar','watchlist','sources','about','model','privacy','terms',...learning];
const pattern=/<header class="masthead">[\s\S]*?<\/header>/;
const canonical=(await readFile('dist/order-flow.html','utf8')).match(pattern)?.[0];
if(!canonical)throw new Error('Inspect masthead missing');
let base=canonical.replace('class="brand" href="./"','class="brand" href="./order-flow.html"');
base=base.replace(/<a href="\.\/(?:meme-101|learn)\.html"[^>]*>(?:Meme 101|Learn)<\/a>/g,'');
base=base.replace(/(<a href="\.\/model\.html"[^>]*>Model<\/a>)/,'<a href="./learn.html">Learn</a>$1');
const active={model:'model.html',narratives:'narratives.html','new-coins':'new-coins.html',radar:'radar.html','order-flow':'order-flow.html',watchlist:'watchlist.html'};
for(const page of learning)active[page]='learn.html';
const check=process.argv.includes('--check');
let stale=false;
for(const page of pages){
 const file=`dist/${page}.html`,source=await readFile(file,'utf8');
 if(!pattern.test(source))throw new Error(`${file} masthead missing`);
 const header=base.replace(/ aria-current="page"/g,'').replace(`<a href="./${active[page]}">`,`<a href="./${active[page]}" aria-current="page">`);
 let generated=source.replace(pattern,header);
 if(['new-coins','radar'].includes(page)){
  const course=page==='new-coins'?'meme-202a':'meme-202b',label=page==='new-coins'?'Snipe':'Swing';
  if(!generated.includes(`href="./${course}.html"`))generated=generated.replace(`<h1>${label}</h1>`,`<h1>${label}</h1><a class="course-help" href="./${course}.html">Learn ${label} →</a>`);
  if(!generated.includes('href="./learning.css'))generated=generated.replace('</head>','<link rel="stylesheet" href="./learning.css?v=1"></head>');
 }
 if(generated!==source){stale=true;if(!check)await writeFile(file,generated)}
}
const snipe=await readFile('dist/new-coins.html','utf8');
const index=await readFile('dist/index.html','utf8');
if(index!==snipe){stale=true;if(!check)await writeFile('dist/index.html',snipe)}
if(check&&stale)throw new Error('Shared page output is stale. Run node scripts/render-shared-pages.mjs.');
