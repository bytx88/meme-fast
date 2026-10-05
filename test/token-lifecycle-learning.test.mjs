import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('launch lesson teaches mechanisms, inventory, signals and event price responses',async()=>{
 const page=await readFile(new URL('../dist/meme-101-level-2.html',import.meta.url),'utf8');
 assert.match(page,/href="#technical-token-lifecycle-token-lc"/);
 const diagram=page.match(/<figure class="lc-diagram">[\s\S]*?<\/figure>/)?.[0];
 assert.ok(diagram);
 assert.equal((diagram.match(/<li>/g)||[]).length,6);
 assert.match(diagram,/Direct-to-DEX path/);
 assert.doesNotMatch(page,/\[\[TOKEN_LC_DIAGRAM\]\]/);
 const tables=[...page.matchAll(/<table class="lc-table">([\s\S]*?)<\/table>/g)].map(m=>m[1]);
 assert.equal(tables.length,3);
 for(const table of tables){
  assert.match(table,/<th scope="col">/);
  assert.match(table,/<th scope="row">/);
 }
 for(const stage of ['Created','Trading / Bonding','Final Stretch','Migrating','Migrated / Graduated','Post-Migration Trading'])assert.ok(tables[0].includes(stage));
 assert.match(tables[0],/Possible price behavior and why/);
 assert.match(tables[1],/Pay Dev \/ creator-payment signal/);
 assert.match(tables[1],/definition is not verified/);
 assert.match(tables[2],/10:46 \(\+5m\)/);
 assert.match(tables[2],/\$73K/);
 assert.match(tables[2],/10:56 \(\+15m\)/);
 assert.match(page,/Migration → pump → dump/);
 assert.match(page,/Migration → dump → recovery/);
 assert.match(page,/initially bundled purchases/);
 assert.match(page,/Missing samples stay unknown/);
});
