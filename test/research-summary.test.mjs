import test from 'node:test';
import assert from 'node:assert/strict';
import {researchSummary} from '../dist/research-summary.mjs';

test('research summary hides source metadata and generic page boilerplate',()=>{
 assert.equal(researchSummary({web:{snippet:'Origin Entry: Mass Effect File type: gif Resolution: (759px x 495px) View All 446 Images'}},'found'),'Unverified lead · inspect source in Details');
 assert.equal(researchSummary({web:{snippet:'Enjoy the videos and music you love, upload original content, and share it all with friends.'}},'found'),'Unverified lead · inspect source in Details');
});

test('research summary keeps a concise useful lead and distinguishes pending states',()=>{
 assert.equal(researchSummary({web:{snippet:'Kabocoin is the meme coin of Kabochan, doge’s loyal plushie companion.'}},'found'),'Kabocoin is the meme coin of Kabochan, doge’s loyal plushie companion.');
 assert.equal(researchSummary(null,'empty'),'Context pending');
 assert.equal(researchSummary(null,'searching'),'Checking context…');
});
