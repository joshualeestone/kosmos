'use strict';
/**
 * #3955: when the "Kosmos has been updated" window opens. It opens once per version, after the new
 * version is on screen: not on a fresh install (installed, not updated), not over an old page (the
 * chip says Reload first), not for a version already seen. The window itself is drawn by a real
 * browser in docs/browser-checks/render-update-notices-3955.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

async function check({ current = '0.6.98', seen = '0.6.97', baked = '0.6.98', highlights = null } = {}) {
  const posts = [];
  const opened = [];
  const fetchStub = async (url, opts) => {
    if (opts && opts.method === 'POST') { posts.push([url, opts.body]); return { ok: true, text: async () => '' }; }
    return { ok: true, json: async () => ({ current, seen, highlights }) };
  };
  const run = new Function('fetch', 'bakedVersion', 'wnOpen', page.liftAll(SCRIPT, ['whatsNewCheck']) + '\nreturn whatsNewCheck();');
  await run(fetchStub, () => baked, (v, h) => opened.push([v, h]));
  await new Promise((r) => setImmediate(r));
  return { posts, opened };
}

test('#3955: a new version on a fresh page opens the window, with the board\'s highlights', async () => {
  const h = [{ icon: 'swarm', title: 'Swarms', line: 'Helpers.' }];
  const r = await check({ highlights: h });
  assert.deepEqual(r.opened, [['0.6.98', h]]);
  assert.deepEqual(r.posts, [], 'seen was recorded before the person saw the window');
});

test('#3955: a fresh install records its version silently (installed, not updated)', async () => {
  const r = await check({ seen: null });
  assert.deepEqual(r.opened, []);
  assert.deepEqual(r.posts, [['/api/whats-new/seen', JSON.stringify({ version: '0.6.98' })]]);
});

test('#3955: a version already seen, or an old page, opens nothing', async () => {
  assert.deepEqual((await check({ seen: '0.6.98' })).opened, []);
  assert.deepEqual((await check({ baked: '0.6.97' })).opened, [], 'the window opened over an old page');
  assert.deepEqual((await check({ baked: null })).opened.length, 1, 'CONTROL: a source checkout (no baked version) still shows it');
});

test('#3955: the lingering "Kosmos updated to X" line and the "Updated." note are gone', () => {
  assert.doesNotMatch(PAGE, /function newsbarCheck|function updatedNoteOnce|kosmos-updated-from/);
  assert.match(PAGE, /\nwhatsNewCheck\(\);\n/, 'nothing runs the check at load');
});

test('#3955: closing records the version as seen, and the window is the pack\'s dialog shape', () => {
  const close = page.liftAll(SCRIPT, ['wnClose']);
  assert.match(close, /fetch\('\/api\/whats-new\/seen'/);
  assert.match(close, /JSON\.stringify\(\{ version: v \}\)/);
  assert.match(PAGE, /role="dialog" aria-modal="true" aria-labelledby="wn-title"/);
  assert.match(PAGE, /target="_blank" rel="noreferrer noopener">See everything that changed</);
});
