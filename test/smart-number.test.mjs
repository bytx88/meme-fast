import test from 'node:test';
import assert from 'node:assert/strict';
import {formatSmartNumber as format} from '../dist/smart-number.mjs';

test('requested examples use ordinary rounding and exact e-N suffixes',()=>{
 for(const [input,expected]of [[12.345678,'12.3457'],[1.2345678,'1.23457'],[0.012345678,'0.012346'],[0.0012345678,'0.012346e-1'],[0.00012345678,'0.012346e-2']]){
  assert.equal(format(input),expected);
  assert.equal(format(-input),'-'+expected);
 }
});
test('Smartness totals retain grouping and trim trailing decimal zeros',()=>{
 assert.equal(format(49.67466376),'49.6747');
 assert.equal(format(24.87310495),'24.8731');
 assert.equal(format(24.80155881),'24.8016');
 assert.equal(format(12345.678987),'12,345.679');
 for(const [value,expected]of [[10,'10'],[1,'1'],[0.01,'0.01'],[0.001,'0.01e-1'],[0,'0'],[-0,'0'],[12.34001,'12.34']])assert.equal(format(value),expected);
});
test('rounding handles half ties, carries and thresholds using absolute value',()=>{
 for(const [input,expected]of [[12.34565,'12.3457'],[1.234565,'1.23457'],[0.0123455,'0.012346'],[0.00123455,'0.012346e-1'],[9.999999,'10'],[0.9999999,'1'],[0.0099999999,'0.1e-1']]){
  assert.equal(format(input),expected);
  assert.equal(format(-input),'-'+expected);
 }
});
test('missing and extremely small values remain readable without overflow',()=>{
 assert.equal(format(NaN),'—');assert.equal(format(Infinity),'—');assert.equal(format(-Infinity),'—');
 assert.equal(format(1e-30),'0.01e-28');
 assert.equal(format(Number.MIN_VALUE),'0.05e-322');
 assert.ok(!format(Number.MAX_VALUE).includes('Infinity'));
});
