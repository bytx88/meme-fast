import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHolderInfo} from '../dist/holder-info.mjs';

const address='0x6249519883b8d7ccf915dfcd6c0442984dae9d24';
const payload={data:{id:`robinhood_${address}`,attributes:{address,holders:{count:4282,distribution_percentage:{top_10:'33.7324'},last_updated:'2026-09-26T19:07:35Z'}}}};

test('holder info uses only the exact chain and token contract',()=>{
 assert.deepEqual(parseHolderInfo(payload,'robinhood',address),{count:4282,top10:33.7324,updatedAt:Date.parse('2026-09-26T19:07:35Z')});
 assert.equal(parseHolderInfo(payload,'base',address),null);
 assert.equal(parseHolderInfo(payload,'robinhood','0x'+'a'.repeat(40)),null);
 assert.equal(parseHolderInfo({data:{...payload.data,attributes:{...payload.data.attributes,holders:{count:null}}}},'robinhood',address),null);
});
