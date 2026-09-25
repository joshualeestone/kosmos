'use strict';

/**
 * First-run help and first-visit tips (#3574): which tips are closed, and the off switch.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'tips-test-')));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const tips = require('./tips');

test('a fresh install has seen nothing and tips are on', () => {
  assert.deepEqual(tips.read(), { ok: true, seen: [], off: false });
});

test('closing a tip adds it, never removes one, and survives a re-read', () => {
  assert.equal(tips.set({ seen: ['tour'] }).ok, true);
  assert.equal(tips.set({ seen: ['agents', 'tour'] }).ok, true);
  assert.deepEqual(tips.read().seen, ['tour', 'agents']);
  assert.equal(tips.set({ seen: [] }).ok, true);
  assert.deepEqual(tips.read().seen, ['tour', 'agents'], 'an empty list un-saw what was seen');
});

test('the off switch turns off and back on, without touching what was seen', () => {
  assert.equal(tips.set({ off: true }).off, true);
  assert.equal(tips.read().off, true);
  assert.equal(tips.set({ off: false }).off, false);
  assert.deepEqual(tips.read().seen, ['tour', 'agents']);
});

test('an unknown tip or a mistyped field is refused and changes nothing', () => {
  const before = fs.readFileSync(tips.FILE(), 'utf8');
  for (const bad of [{ seen: ['nope'] }, { seen: 'tour' }, { seen: [1] }, { off: 'yes' }, { seen: ['tour'], off: 1 }]) {
    const r = tips.set(bad);
    assert.equal(r.ok, false, JSON.stringify(bad) + ' was accepted');
    assert.match(r.because, /tips|true or false/);
  }
  assert.equal(fs.readFileSync(tips.FILE(), 'utf8'), before, 'a refused write moved the file');
});

test('a stored unknown id is dropped on read, and an unreadable file says so rather than showing every tip again', () => {
  fs.writeFileSync(tips.FILE(), JSON.stringify({ seen: ['tour', '__proto__', 'nope'], off: 'true' }));
  assert.deepEqual(tips.read(), { ok: true, seen: ['tour'], off: false });
  fs.writeFileSync(tips.FILE(), '{ not json');
  const r = tips.read();
  assert.equal(r.ok, false);
  assert.equal(tips.set({ seen: ['agents'] }).ok, false, 'a write over an unreadable file would forget what was seen');
});

/* Two lists name the tips: this allowlist and the page's TIPS table. A page tip missing here would be
   refused as seen and re-show forever, so the two are pinned equal. */
test('every tip the page shows is on the board\'s allowlist, and nothing else is', () => {
  const page = fs.readFileSync(nodePath.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const start = page.indexOf('const TIPS = [');
  assert.ok(start > 0, 'the page has no TIPS table');
  const table = page.slice(start, page.indexOf('\n];', start));
  const ids = [...table.matchAll(/^  \{ id: '([a-z]+)'/gm)].map((m) => m[1]);
  assert.ok(ids.length >= 5, 'read too few tip ids from the page: ' + ids.join(','));
  assert.deepEqual([...ids].sort(), [...tips.TIP_IDS].sort());
});
