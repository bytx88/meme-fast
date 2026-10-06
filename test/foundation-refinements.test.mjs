import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const page=async path=>(await readFile(new URL('../dist/'+path,import.meta.url),'utf8')).replace(/<[^>]+>/g,' ');

test('foundation examples distinguish valuation, account identity, and execution limits',async()=>{
 const numbers=await page('meme-101-level-1.html');
 assert.match(numbers,/Market cap: \$200,000/);
 assert.match(numbers,/FDV: \$1,000,000/);
 assert.match(numbers,/20m circulating units/);
 assert.match(numbers,/100m fully diluted units/);
 const launch=await page('meme-101-level-2.html');
 for(const phrase of ['Your wallet address','The token address','Your token account','recovery phrase','Signing approves','minimum received to $96.03','Network fees are separate'])assert.ok(launch.includes(phrase),phrase);
 assert.doesNotMatch(launch,/\bCEX\b|\bcentralized exchange\b|order-book depth/);
 const attention=await page('meme-101-level-6.html');
 for(const phrase of ['Meta','Hype cycle','Alpha','primary source','exact token address'])assert.ok(attention.includes(phrase),phrase);
});

test('bundle instruction preserves the difference between early purchases, allocations, and control',async()=>{
 const bundle=await page('meme-101c-section-5.html');
 for(const phrase of ['coordinated genesis/very-early buying','Constructive','Neutral / speculative','Predatory','Common funding','Bubble-map linkage','Synchronized selling','map may repeat evidence already counted','Coordination alone does not prove common ownership','initial purchases or remaining holdings','These are allocations','Combined cost is $1,000 before fees','mark at $10,000'])assert.ok(bundle.includes(phrase),phrase);
 assert.match(bundle,/12m, or 12%/);
 assert.match(bundle,/8% of the 150m/);
 assert.ok((await page('meme-101b-lesson-3.html')).includes('reconstruct purchase costs and fees'));
});
