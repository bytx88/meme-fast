import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../dist/101c-review.js', import.meta.url), 'utf8');
function boot(saved = null, brokenStorage = false) {
  const element = (extra = {}) => ({textContent: '', events: {},
    addEventListener(name, callback) {this.events[name] = callback;},
    setAttribute(name, value) {this[name] = value;}, ...extra});
  const field = element({name: 'inventory', id: 'review-inventory', value: ''});
  const form = element({querySelectorAll: () => [field], querySelector: () => ({textContent: 'Wallets and holdings'})});
  const elements = {'#token-review': form, '#review-status': element(), '#review-save': element(),
    '#review-download': element(), '#review-example': element(), '#review-sample': element({hidden: true})};
  const state = {saved, downloads: [], blob: null};
  const anchor = {click() {state.downloads.push(this.download);}, remove() {}};
  vm.runInNewContext(source, {
    document: {querySelector: name => elements[name], createElement: () => anchor, body: {appendChild() {}}},
    localStorage: {getItem() {if (brokenStorage) throw Error(); return state.saved;},
      setItem(key, value) {if (brokenStorage) throw Error(); state.saved = value;}},
    URL: {createObjectURL(blob) {state.blob = blob; return 'blob:test';}, revokeObjectURL() {}},
    Blob, Date, setTimeout: callback => callback(),
  });
  return {field, form, elements, state};
}

test('worksheet saves, reloads and downloads literal notes while examples leave personal notes alone', async () => {
  const app = boot();
  app.field.value = '<script>literal research note</script>\nSource: tx-1, UTC 09:00';
  app.form.events.input();
  assert.match(app.elements['#review-status'].textContent, /unsaved/);
  app.elements['#review-save'].events.click();
  const saved = JSON.parse(app.state.saved);
  assert.equal(saved.notes.inventory, app.field.value);
  const restored = boot(app.state.saved);
  assert.equal(restored.field.value, app.field.value);
  restored.elements['#review-example'].events.click();
  assert.equal(restored.elements['#review-sample'].hidden, false);
  assert.equal(restored.elements['#review-example']['aria-expanded'], 'true');
  assert.equal(restored.field.value, app.field.value);
  restored.elements['#review-example'].events.click();
  assert.equal(restored.elements['#review-sample'].hidden, true);
  restored.elements['#review-download'].events.click();
  assert.deepEqual(restored.state.downloads, ['101c-token-review.txt']);
  assert.ok((await restored.state.blob.text()).includes(app.field.value));
  let prevented = false;
  app.form.events.submit({preventDefault() {prevented = true;}});
  assert.equal(prevented, true);
});

test('worksheet reports unavailable storage and malformed saved data without losing typed notes', () => {
  const blocked = boot(null, true);
  blocked.field.value = 'keep these notes';
  blocked.elements['#review-save'].events.click();
  assert.match(blocked.elements['#review-status'].textContent, /Download/);
  assert.equal(blocked.field.value, 'keep these notes');
  const malformed = boot('{broken');
  assert.match(malformed.elements['#review-status'].textContent, /could not be loaded/);
});

test('all chapter worksheet links resolve to labelled fields and answers stay visible', async () => {
  const final = await readFile(new URL('../dist/meme-101c-section-10.html', import.meta.url), 'utf8');
  for (let i = 1; i <= 10; i++) {
    const page = await readFile(new URL(`../dist/meme-101c-section-${i}.html`, import.meta.url), 'utf8');
    for (const match of page.matchAll(/meme-101c-section-10\.html#(review-[a-z]+)/g)) {
      assert.ok(final.includes(`id="${match[1]}"`), `${i}: missing ${match[1]}`);
    }
    const checks = page.slice(page.indexOf('check-your-understanding-answered'));
    assert.ok(checks.includes('<strong>'));
    assert.ok(!checks.includes('<details'));
  }
  for (const field of final.matchAll(/<textarea id="([^"]+)"/g)) {
    assert.ok(final.includes(`label for="${field[1]}"`));
  }
  assert.match(final, /8m available after 5m sold and 1m bought/);
  assert.match(final, /12m group \/ 104m available/);
  assert.match(final, /noscript/);
});
