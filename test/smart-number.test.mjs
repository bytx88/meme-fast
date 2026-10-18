import test from 'node:test';
import assert from 'node:assert/strict';
import {formatSmartNumber as format} from '../dist/smart-number.mjs';
test('Smartness numbers follow the requested precision caps without rounding up',()=>{
 assert.equal(format(49.67466376),'49.6746');
 assert.equal(format(24.87310495),'24.8731');
 assert.equal(format(1.23456789),'1.23456');
 assert.equal(format(0.012345678),'0.012345');
 assert.equal(format(12345.678987),'12,345.6789');
 assert.equal(format(10),'10');assert.equal(format(1),'1');
});
test('small values use the requested inverse-power suffix and preserve flow signs',()=>{
 assert.equal(format(0.0012345),'0.012345 e1');
 assert.equal(format(0.00012345678),'0.012345 e2');
 assert.equal(format(0.01),'0.01');assert.equal(format(0.001),'0.01 e1');
 assert.equal(format(-0.00012345678),'-0.012345 e2');
 assert.equal(format(-24.80155881),'-24.8015');
 assert.equal(format(0),'0');assert.equal(format(-0),'0');
});
test('missing and extremely small values remain readable',()=>{
 assert.equal(format(NaN),'—');assert.equal(format(Infinity),'—');
 assert.equal(format(1e-30),'0.01 e28');
 assert.equal(format(Number.MIN_VALUE),'0.05 e322');
});
