import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSearch,bestSearchLead,storyParagraph,sourcesFor,sourceURL} from '../dist/coin-context.mjs';
test('Linked search snippets survive DuckDuckGo wrappers without image metadata',()=>{
 const text='## [Jean Phil origin](http://duckduckgo.com/l/?uddg=https%3A%2F%2Fmeme.com%2Fmemes%2Fjean-phil)\n\n[![Image 1](https://image.test/a)](https://example.com)\n\n[Jean Phil is a viral character whose unusual haircut inspired a meme and community.](http://duckduckgo.com/l/?uddg=https%3A%2F%2Fmeme.com)';
 assert.equal(parseSearch(text)[0].url,'https://meme.com/memes/jean-phil');
 assert.equal(bestSearchLead(text).snippet,'Jean Phil is a viral character whose unusual haircut inspired a meme and community.');
 assert.equal(sourceURL('javascript:alert(1)'),null);
});
test('A price listing alone does not become a narrative',()=>{
 assert.equal(bestSearchLead('## [Price today](https://example.com)\n\n[The live price is $5 and the trading volume is $200000 today.](https://example.com)'),null);
});
test('Source stories match normalized full names and preserve contract identity',()=>{
 assert.equal(sourcesFor({name:'Super Inu',symbol:'SI'})[0].contract,'DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP');
 assert.equal(sourcesFor({name:'Unrelated',symbol:'SI'}).length,0);
 assert.equal(sourcesFor({name:'Jean Phil',symbol:'JEANPHIL'}).length,2);
});
test('Story extraction skips headings and price boilerplate',()=>{
 const paragraph='Jean Phil is an internet persona whose distinctive haircut and formal clothing inspired memes and character comparisons.';
 assert.equal(storyParagraph('Title: a\nMarkdown Content:\n# Jean Phil\n\n'+paragraph),paragraph);
});
