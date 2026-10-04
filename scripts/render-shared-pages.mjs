import {readFile,writeFile} from 'node:fs/promises';

// The Inspect page owns the server-rendered masthead. Keep every page's
// initial HTML in sync without waiting for JavaScript to paint navigation.
const lessons=Array.from({length:8},(_,i)=>`meme-101-level-${i+1}`);
const pages=['order-flow','narratives','narrative','new-coins','radar','watchlist','sources','about','model','privacy','terms','meme-101',...lessons,'meme-101-bundles'];
const pattern=/<header class="masthead">[\s\S]*?<\/header>/;
const canonical=(await readFile('dist/order-flow.html','utf8')).match(pattern)?.[0];
if(!canonical)throw new Error('Inspect masthead missing');
let base=canonical.replace('class="brand" href="./"','class="brand" href="./order-flow.html"');
if(!base.includes('href="./meme-101.html"'))base=base.replace(/(<a href="\.\/model\.html"[^>]*>Model<\/a>)/,'$1<a href="./meme-101.html">Meme 101</a>');
const active={model:'model.html',narratives:'narratives.html','new-coins':'new-coins.html',radar:'radar.html','order-flow':'order-flow.html',watchlist:'watchlist.html'};
for(const page of ['meme-101',...lessons,'meme-101-bundles'])active[page]='meme-101.html';
const check=process.argv.includes('--check');
let stale=false;
for(const page of pages){
 const file=`dist/${page}.html`,source=await readFile(file,'utf8');
 if(!pattern.test(source))throw new Error(`${file} masthead missing`);
 const header=base.replace(/ aria-current="page"/g,'').replace(`<a href="./${active[page]}">`,`<a href="./${active[page]}" aria-current="page">`);
 const generated=source.replace(pattern,header);
 if(generated!==source){stale=true;if(!check)await writeFile(file,generated)}
}
const snipe=await readFile('dist/new-coins.html','utf8');
const index=await readFile('dist/index.html','utf8');
if(index!==snipe){stale=true;if(!check)await writeFile('dist/index.html',snipe)}
if(check&&stale)throw new Error('Shared page output is stale. Run node scripts/render-shared-pages.mjs.');
