'use strict';
/**
 * #805: every category row on Connections said "Nothing connected" as static
 * words while the doors under it said Connected. The rows now say what the
 * doors say, from one read, with three arms and never two. Driven through
 * the real painter against a fake fetch and a small DOM stand-in built from
 * the page's own category markup.
 *
 *   node --test web.conn-shelf.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = require('./test-support/page');
const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = page.scriptOf(PAGE);

/* The categories and their buttons, read from the markup so the test
   follows the shelf as it grows. */
function catsFromMarkup() {
  const sec = PAGE.slice(PAGE.indexOf('id="s-sec-connect"'), PAGE.indexOf('id="s-sec-gskills"'));
  const out = [];
  for (const m of sec.matchAll(/<details class="con-cat" data-cat="([a-z]+)">([\s\S]*?)<\/details>/g)) {
    const names = [...m[2].matchAll(/class="boardname[^"]*"[^>]*>([^<]+)</g)].map((x) => x[1].trim());
    const stateText = /<span class="con-state">([^<]*)<\/span>/.exec(m[2]);
    out.push({ cat: m[1], names, stateText: stateText ? stateText[1] : null });
  }
  return out;
}

function world(fetchImpl) {
  const cats = catsFromMarkup().map((c) => {
    const state = { textContent: '' };
    return { cat: c.cat, state, names: c.names,
      querySelector: (sel) => (sel === '.con-state' ? state : null),
      querySelectorAll: (sel) => (sel === 'button.boardname' ? c.names.map((n) => ({ textContent: n })) : []) };
  });
  const ctx = { document: { querySelectorAll: (sel) => (sel === '#s-sec-connect .con-cat' ? cats : []) }, fetch: fetchImpl, console };
  const svcAt = SCRIPT.indexOf('const SVC_BUILT = {');
  const svcEnd = SCRIPT.indexOf('};', svcAt) + 2;
  const start = SCRIPT.indexOf('const CON_SHELF = {');
  const end = SCRIPT.indexOf('/* The connect tab\'s one computed sentence');
  assert.ok(svcAt > 0 && start > 0 && end > start, 'the shelf script moved; re-anchor');
  vm.runInNewContext(SCRIPT.slice(svcAt, svcEnd) + '\n' + SCRIPT.slice(start, end), ctx);
  const row = (cat) => cats.find((c) => c.cat === cat).state.textContent;
  return { ctx, cats, row };
}

test('the static markup claims nothing: no row says connected or not before the painter has looked', () => {
  for (const c of catsFromMarkup()) {
    assert.notEqual(c.stateText, 'Nothing connected', c.cat + ' still asserts Nothing connected as static words');
  }
  assert.match(SCRIPT, /if \(sec === 'connect'\) \{ paintConnLive\(\); paintConnShelf\(\); \}/, 'the shelf does not paint on arrival');
});

test('rows say what the doors say: names when connected, Nothing when every door said no, and a row with nothing built says so', async () => {
  const w = world(async () => ({ ok: true, json: async () => ({ doors: {
    '/api/github': { connected: true, who: 'joshualeestone' },
    '/api/cloudflare': { connected: true, who: null },
    '/api/svc/hetzner': { connected: true, who: null },
    '/api/svc/netlify': { connected: false }, '/api/vercel': { connected: false }, '/api/svc/fly': { connected: false }, '/api/svc/render': { connected: false },
    '/api/svc/discord': { connected: false },
  } }) }));
  await w.ctx.paintConnShelf();
  assert.equal(w.row('code'), '1 connected: GitHub');
  assert.equal(w.row('dns'), '1 connected: Cloudflare');
  assert.equal(w.row('servers'), '1 connected: Hetzner');
  assert.equal(w.row('deploy'), 'Nothing connected', 'every deploy door answered no and the row should say so');
  assert.equal(w.row('chat'), 'Nothing connected', 'Discord answered no and the row should say so');
  assert.equal(w.row('payments'), 'Nothing to connect yet', 'a row whose doors are all coming soon said Nothing connected, which reads as a failed connect');
});

test('a door the engine could not check is said as could-not-check, never as nothing; a read that failed says so on every built row', async () => {
  const w = world(async () => ({ ok: true, json: async () => ({ doors: { '/api/github': { connected: null, because: 'could not check: gh hung' } } }) }));
  await w.ctx.paintConnShelf();
  assert.equal(w.row('code'), 'Could not check');
  assert.equal(w.row('chat'), 'Could not check', 'a door missing from the read was called nothing');
  const w2 = world(async () => { throw new Error('ECONNREFUSED'); });
  await w2.ctx.paintConnShelf();
  assert.equal(w2.row('code'), 'Could not check');
  assert.equal(w2.row('payments'), 'Nothing to connect yet');
});

test('a door that just answered changes its own row at once, on either GitHub road, and a door that failed to answer is not called nothing', () => {
  const w = world(async () => ({ ok: true, json: async () => ({ doors: {} }) }));
  w.ctx.conShelfDoor('/api/svc/hetzner', { connected: true, who: null });
  assert.equal(w.row('servers'), '1 connected: Hetzner');
  w.ctx.conShelfDoor('/api/github', { connected: false, gh: 'missing', device: { connected: true, login: 'joshualeestone' } });
  assert.equal(w.row('code'), '1 connected: GitHub', 'the device road counts as connected for the shelf as it does for the door');
  w.ctx.conShelfDoor('/api/svc/hetzner', null);
  assert.equal(w.row('servers'), 'Could not check');
  w.ctx.conShelfDoor('/api/svc/hetzner', { connected: false });
  w.ctx.conShelfDoor('/api/svc/digitalocean', { connected: false });
  assert.equal(w.row('servers'), 'Nothing connected');
  w.ctx.conShelfDoor('/api/vercel', { connected: true, login: 'josh' });
  assert.equal(w.row('deploy'), '1 connected: Vercel');
});
