'use strict';
/**
 * #3955: when the "Kosmos has been updated" window opens. It opens once per version, after the new
 * version is on screen: not on a fresh install (installed, not updated), not over an old page (the
 * chip says Reload first), not for a version already seen, and not for a move DOWN (a rollback).
 * The window itself is drawn by a real browser in docs/browser-checks/render-reload-toast.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

const H1 = [{ icon: 'spark', title: 'A thing', line: 'It does a thing.' }];
async function check({ current = '0.6.98', seen = '0.6.97', baked = '0.6.98', highlights = H1 } = {}) {
  const posts = [];
  const opened = [];
  const fetchStub = async (url, opts) => {
    if (opts && opts.method === 'POST') { posts.push([url, opts.body]); return { ok: true, text: async () => '' }; }
    return { ok: true, json: async () => ({ current, seen, highlights }) };
  };
  const run = new Function('fetch', 'bakedVersion', 'wnOpen', page.liftAll(SCRIPT, ['wnNewer', 'whatsNewCheck']) + '\nreturn whatsNewCheck();');
  await run(fetchStub, () => baked, (v, h) => opened.push([v, h]));
  await new Promise((r) => setImmediate(r));
  return { posts, opened };
}

test('#3955: a new version on a fresh page opens the window, with the board\'s highlights', async () => {
  const h = [{ icon: 'swarm', title: 'Swarms', line: 'Helpers.' }];
  const r = await check({ highlights: h });
  assert.deepEqual(r.opened, [['0.6.98', h]]);
  // Recorded when it opens (round 6), so a second tab reloaded by the same update does not show it again.
  assert.deepEqual(r.posts, [['/api/whats-new/seen', JSON.stringify({ version: '0.6.98' })]]);
});

test('#3955: a fresh install records its version silently (installed, not updated)', async () => {
  const r = await check({ seen: null });
  assert.deepEqual(r.opened, []);
  assert.deepEqual(r.posts, [['/api/whats-new/seen', JSON.stringify({ version: '0.6.98' })]]);
});

test('#3955: a version already seen, or an old page, opens nothing', async () => {
  assert.deepEqual((await check({ seen: '0.6.98' })).opened, []);
  const old = await check({ baked: '0.6.97' });
  assert.deepEqual(old.opened, [], 'the window opened over an old page');
  assert.deepEqual(old.posts, [], 'the old page recorded the version as seen, so the reloaded page would never show it (round 5)');
  assert.deepEqual((await check({ baked: null })).opened.length, 1, 'CONTROL: a source checkout (no baked version) still shows it');
});

test('#3955: the lingering "Kosmos updated to X" line and the "Updated." note are gone', () => {
  assert.doesNotMatch(PAGE, /function newsbarCheck|function updatedNoteOnce|kosmos-updated-from/);
  assert.match(PAGE, /\nwhatsNewCheck\(\);\n/, 'nothing runs the check at load');
});

test('#3955: the window records the version as seen when it opens (not on close), and is the pack\'s dialog shape', () => {
  const check = page.liftAll(SCRIPT, ['whatsNewCheck']);
  assert.ok(check.indexOf('record();\n    wnOpen(') !== -1, 'seen is not recorded as the window opens');
  assert.doesNotMatch(page.liftAll(SCRIPT, ['wnClose']), /whats-new\/seen/, 'closing records seen a second time');
  assert.match(PAGE, /role="dialog" aria-modal="true" aria-labelledby="wn-title"/);
  assert.match(PAGE, /target="_blank" rel="noreferrer noopener">See everything that changed/);
});

test('#3955: a rollback (or a switch to an older version) is recorded quietly, never announced as new', async () => {
  const r = await check({ current: '0.6.97', seen: '0.6.98' });
  assert.deepEqual(r.opened, [], 'a rollback was announced as "Kosmos has been updated"');
  assert.deepEqual(r.posts, [['/api/whats-new/seen', JSON.stringify({ version: '0.6.97' })]]);
  assert.deepEqual((await check({ current: '0.6.10', seen: '0.6.9', baked: '0.6.10' })).opened.length, 1, 'CONTROL: 0.6.10 is newer than 0.6.9 (numbers, not text)');
});

test('#3955 round 3: a release with no highlights (a hotfix) shows no window and records the version quietly', async () => {
  for (const none of [null, []]) {
    const r = await check({ highlights: none });
    assert.deepEqual(r.opened, [], 'a hotfix interrupted people with a window saying nothing new');
    assert.deepEqual(r.posts, [['/api/whats-new/seen', JSON.stringify({ version: '0.6.98' })]], 'the hotfix was not recorded, so the next release would compare against the wrong version');
  }
});

test('#3955 round 5 (Mona Lisa): the window waits while the first-run tour is on screen, then opens', { timeout: 5000 }, async () => {
  const opened = [];
  const fetchStub = async (url, opts) => ((opts && opts.method === 'POST') ? { ok: true, text: async () => '' }
    : { ok: true, json: async () => ({ current: '0.6.98', seen: '0.6.97', highlights: H1 }) });
  const api = new Function('fetch', 'bakedVersion', 'wnOpen', 'setTimeout',
    'let TIP_OPEN = { step: 1 };\n' + page.liftAll(SCRIPT, ['wnNewer', 'whatsNewCheck'])
    + '\nreturn { run: whatsNewCheck, close: () => { TIP_OPEN = null; } };')(
    fetchStub, () => '0.6.98', (v) => opened.push(v), (f) => setImmediate(f));
  const done = api.run();
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  assert.deepEqual(opened, [], 'the window opened over the tour');
  api.close();
  await done;
  assert.deepEqual(opened, ['0.6.98'], 'the window never opened once the tour closed');
});

test('#3955 round 6: a tour still open after the wait records the version quietly and opens nothing', { timeout: 5000 }, async () => {
  const opened = [];
  const posts = [];
  const fetchStub = async (url, opts) => {
    if (opts && opts.method === 'POST') { posts.push(url); return { ok: true, text: async () => '' }; }
    return { ok: true, json: async () => ({ current: '0.6.98', seen: '0.6.97', highlights: H1 }) };
  };
  /* The wait is a real deadline (round 7), so this test's clock moves a minute per reading: the hour
     passes in 60 turns instead of an hour of real time. */
  let t = 0;
  const clock = { now: () => (t += 60000) };
  const run = new Function('fetch', 'bakedVersion', 'wnOpen', 'setTimeout', 'Date',
    'let TIP_OPEN = { step: 1 };\n' + page.liftAll(SCRIPT, ['wnNewer', 'whatsNewCheck']) + '\nreturn whatsNewCheck();');
  await run(fetchStub, () => '0.6.98', (v) => opened.push(v), (f) => setImmediate(f), clock);
  assert.ok(t >= 3600000, 'CONTROL: the wait ran to its hour');
  assert.deepEqual(opened, [], 'the window opened over a tour that never closed');
  assert.deepEqual(posts, ['/api/whats-new/seen'], 'the version was not recorded, so it would try again every load');
});

test('#3955 round 12: a newer Kosmos landing during the tour wait opens nothing and records nothing', { timeout: 5000 }, async () => {
  const opened = []; const posts = [];
  const fetchStub = async (url, opts) => {
    if (opts && opts.method === 'POST') { posts.push(url); return { ok: true, text: async () => '' }; }
    return { ok: true, json: async () => ({ current: '0.6.98', seen: '0.6.97', highlights: H1 }) };
  };
  const api = new Function('fetch', 'bakedVersion', 'wnOpen', 'setTimeout',
    'let TIP_OPEN = { step: 1 }; let SERVED_VERSION = "0.6.98";\n'
    + page.liftAll(SCRIPT, ['wnNewer', 'whatsNewCheck'])
    + '\nreturn { run: whatsNewCheck, close: () => { TIP_OPEN = null; }, newer: () => { SERVED_VERSION = "0.6.99"; } };')(
    fetchStub, () => '0.6.98', (v) => opened.push(v), (f) => setImmediate(f));
  const done = api.run();
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  api.newer(); api.close();
  await done;
  assert.deepEqual(opened, [], 'the window opened on a page a newer Kosmos has made old');
  assert.deepEqual(posts, [], 'the superseded version was recorded as seen');
});

test('#3955 round 12: the window takes Escape and Tab first (capture) and stops them, so a dialog under it keeps its own', () => {
  const at = SCRIPT.indexOf('function wnCovered()');
  const block = SCRIPT.slice(at, SCRIPT.indexOf("document.addEventListener('focusin'", at));
  assert.match(block, /e\.key === 'Escape'\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); wnClose\(\);/, 'Escape is not stopped, so it also closes the dialog under the window');
  assert.match(block, /if \(e\.key !== 'Tab'\) return;\n\s*e\.stopPropagation\(\);/, 'Tab is not stopped, so two traps fight over it');
  assert.match(block, /\n\}, true\);\s*$/, 'the key listener is not in the capture phase, so the dialog under it hears the key first');
});

test('#3955 round 15: the window also waits while first run is on screen, then opens', { timeout: 5000 }, async () => {
  const opened = [];
  const fetchStub = async (url, opts) => ((opts && opts.method === 'POST') ? { ok: true, text: async () => '' }
    : { ok: true, json: async () => ({ current: '0.6.98', seen: '0.6.97', highlights: H1 }) });
  const api = new Function('fetch', 'bakedVersion', 'wnOpen', 'setTimeout',
    'let TIP_OPEN = null; let firstRun = true; const wnCovered = () => firstRun;\n' + page.liftAll(SCRIPT, ['wnNewer', 'whatsNewCheck'])
    + '\nreturn { run: whatsNewCheck, close: () => { firstRun = false; } };')(
    fetchStub, () => '0.6.98', (v) => opened.push(v), (f) => setImmediate(f));
  const done = api.run();
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  assert.deepEqual(opened, [], 'the window opened under first run and took its focus');
  api.close();
  await done;
  assert.deepEqual(opened, ['0.6.98'], 'CONTROL: it opens once first run closes');
});
