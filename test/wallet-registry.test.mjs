import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('added wallets validate, deduplicate and retain registry labels through collection',()=>{
 const result=spawnSync(process.platform==='win32'?'py':'python3',['-c',`
import tempfile
from pathlib import Path
from worker.followed_wallets import validate_wallet, registry_wallets, merge_report, collect
address='11111111111111111111111111111111'
row=validate_wallet(dict(name=' New wallet ',address=address,code='F1'))
assert row['name']=='New wallet' and row['network']=='solana'
for changes in [dict(name=''),dict(name='x'*81),dict(address='not-a-wallet'),dict(address='1'*33),dict(code='F3')]:
 try: validate_wallet(dict(row,**changes))
 except ValueError: pass
 else: raise AssertionError(changes)
rows=registry_wallets([row,row]);assert sum(x['address']==address for x in rows)==1
saved={'wallets':[dict(row,name='Old label',code='N1',checkedAt=123,status='ok',mints=['mint'])]}
merged=merge_report(saved,rows)
new=next(x for x in merged['wallets'] if x['address']==address)
assert new['name']=='New wallet' and new['code']=='F1' and new['checkedAt']==123
assert next(x for x in merged['wallets'] if x['address']!=address)['checkedAt'] is None
calls=[]
def fetch(owner,program):
 calls.append(owner)
 return {'result':{'value':[{'account':{'data':{'parsed':{'info':{'owner':owner,'mint':'mint','tokenAmount':{'amount':'1'}}}}}}]}}
with tempfile.TemporaryDirectory() as folder:
 report=collect(str(Path(folder)/'report.json'),fetcher=fetch,now=456,registry=[row])
 assert report['wallets'][0]['mints']==['mint'] and report['wallets'][0]['checkedAt']==456
 assert calls==[address,address]
`],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr||result.stdout);
});
