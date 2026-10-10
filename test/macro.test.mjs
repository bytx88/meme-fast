import test from 'node:test';
import assert from 'node:assert/strict';
import {calculate} from '../dist/macro.mjs';
const ids=['fed','yields','oil','etf','regulation','outlook','geo','equities','breadth','leverage','support'];
test('unrated is zero coverage, distinct from a fully neutral tree',()=>{
 assert.equal(calculate({}).coverage,0);
 const neutral=calculate(Object.fromEntries(ids.map(id=>[id,0])));
 assert.equal(neutral.coverage,100);assert.equal(neutral.score,0);
});
test('four branch budgets bound the score and prevent a larger branch dominating',()=>{
 for(const direction of [-2,2])assert.equal(calculate(Object.fromEntries(ids.map(id=>[id,direction]))).score,direction*50);
 assert.equal(calculate({fed:2,yields:2,oil:2}).score,25);
 assert.equal(calculate({leverage:2,support:2}).score,25);
});
test('unknown and invalid readings do not renormalize into false conviction',()=>{
 const result=calculate({fed:2,yields:99,oil:null,etf:'2'});
 assert.equal(result.score,25*3/8);assert.equal(result.coverage,25*3/8);
});
