'use strict';
/**
 * kosmos#8735 slice 4: `kosmos post --how` prints engine/postguide.js guideText on both CLIs, as `kosmos claim --how`
 * (engine/claimguide.test.js, which this mirrors). The working rules keep the rule and the two silent failures, and
 * point at it for the render list. The render-list asserts moved here from engine/defaults.test.js (Mona Lisa's read).
 *
 *   node --test engine/postguide.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { skipOnWin32 } = require('../test-support/skip-on-win32');
const guide = require('./postguide');
const defaults = require('./defaults');

test('kosmos#8735: install/kosmos prints the post guide with post --how, and lists it', { skip: skipOnWin32('install/kosmos is the Mac and Linux CLI, a bash script run by its shebang') }, () => {
  const root = path.join(__dirname, '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'post-how-'));
  const env = { PATH: process.env.PATH, HOME: tmp, TMPDIR: tmp, KOSMOS_HOME: root, AGENT_WORKFORCE_DATA: path.join(tmp, 'data'), KOSMOS_PORT: '9' };
  const run = (args) => spawnSync(path.join(root, 'install', 'kosmos'), args, { env, encoding: 'utf8', timeout: 30000 });
  try {
    const how = run(['post', '--how']);
    assert.equal(how.status, 0, how.stderr + how.stdout.slice(0, 300));
    assert.equal(how.stdout, guide.guideText() + '\n');
    const more = run(['post', '--how', 'more']);
    assert.equal(more.status, 2);
    assert.match(more.stderr + more.stdout, /Usage: kosmos post --how/);
    const list = run(['no-such-verb-8735']);
    assert.match(list.stdout + list.stderr, /kosmos post +post in a project room \(--how: what a room shows\)/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('kosmos#8735: the Windows CLI prints the same post guide and the same refusal', async () => {
  const cli = require('../tools/windows/kosmos-cli');
  const out = []; const err = [];
  assert.equal(await cli.main(['post', '--how'], { env: {}, out: (x) => out.push(x), err: (x) => err.push(x) }), 0, err.join(' '));
  assert.equal(out.join('\n'), guide.guideText());
  const refused = [];
  assert.equal(await cli.main(['post', '--how', 'more'], { env: {}, out: () => {}, err: (x) => refused.push(x) }), 2);
  assert.match(refused.join('\n'), /Usage: kosmos post --how/);
});

test('kosmos#8735: the post guide requires nothing, carries the render list, and the working rules keep the rule', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'postguide.js'), 'utf8'), /require\(/);
  const g = guide.guideText();
  // Moved from engine/defaults.test.js: the supported subset the room renderer actually renders.
  assert.match(g, /headings written with/, 'the supported subset is not listed');
  assert.match(g, /~~strikethrough~~/, 'the subset list dropped a supported element');
  assert.match(g, /\[label\]\(address\)/, 'the label-only link caveat is missing');
  for (const line of ['headings written with `#` to `######`, **bold**, *italic*, ~~strikethrough~~,',
    '`[label](address)` link shows its address after the label.']) {
    assert.ok(g.includes(line), 'the post guide lost: ' + line);
    for (const p of defaults.PLATFORMS) assert.ok(!defaults.blockFor(p).includes(line), p + ': back in the working rules: ' + line);
  }
  for (const p of defaults.PLATFORMS) {
    const flat = defaults.blockFor(p).replace(/\s+/g, ' ');
    assert.match(flat, /What a room shows you is listed by `kosmos post --how`\./, p + ': the pointer to the guide is missing');
    assert.match(flat, /raw HTML is shown as you typed it/, p + ': the HTML case, which fails silently at the moment of writing, left the working rules');
    assert.match(flat, /becomes a quote in your dialogue with the person but stays literal text in a project room/, p + ': the > case left the working rules');
    assert.match(flat, /from your first message/, p + ': the from-first-message rule left the working rules');
  }
  assert.doesNotMatch(g, /\u2014|&mdash;|&#8212;|&#x2014;/i, 'an em dash in the guide');
});
