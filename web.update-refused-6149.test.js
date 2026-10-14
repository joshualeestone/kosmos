'use strict';

/**
 * kosmos#6149 point 8: when an update was refused before anything was removed (a locked part, or a folder this
 * account may not change), the "The update did not take" sentence says what is in the way and how to clear it.
 * Lifted from web/index.html and driven directly. The Mac sentence with no refusal stays byte-identical.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const page = require('./test-support/page');
const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);

function lifted() {
  // eslint-disable-next-line no-new-func
  return new Function(
    page.liftAll(SCRIPT, [...page.PLATFORM_COPY_FNS, 'esc', 'updateRefusedText', 'updateSettleText'])
    + '\nreturn { updateSettleText, updateRefusedText };')();
}

const LOG = '/k/logs/install.log';
const PLAIN = '<b>The update did not take.</b>The installer stopped (code 1). Kosmos is still on 0.7.48.'
  + ' The installer\'s notes are at <code>/k/logs/install.log</code>.';

test('CONTROL: a failed update with no refusal reads exactly as before', () => {
  const { updateSettleText } = lifted();
  assert.equal(updateSettleText('failed', '0.7.48', { code: 1 }, LOG, 'darwin'), PLAIN);
});

test('a locked refusal names the locked path and gives the unlock line for every locked part', () => {
  const { updateSettleText } = lifted();
  const t = updateSettleText('failed', '0.7.48', { code: 1, refused: {
    why: 'locked', at: '/k/app/engine/x.js', parts: ['app', 'runtime'], paths: ['/k/app', '/k/runtime'], ts: 'x' } }, LOG, 'darwin');
  assert.ok(t.startsWith('<b>The update did not take.</b>The installer stopped (code 1). Kosmos is still on 0.7.48.'), t);
  assert.match(t, /Part of it is locked: <code>\/k\/app\/engine\/x\.js<\/code>\. Nothing was removed\./);
  assert.match(t, /<code>chflags -R nouchg,nouappnd '\/k\/app' '\/k\/runtime'<\/code>/);
  assert.match(t, /If it is still refused, the lock was set by an administrator, who can clear it with: <code>sudo chflags -R noschg,nosappnd '\/k\/app' '\/k\/runtime'<\/code>/,
    'the administrator line for the two flags a person cannot clear, as the installer prints it');
  assert.ok(t.endsWith(' The installer\'s notes are at <code>/k/logs/install.log</code>.'), 'the notes stay last');
});

test('a permissions refusal names the folder and says to give it back, with no unlock line', () => {
  const { updateSettleText } = lifted();
  const t = updateSettleText('failed', '0.7.48', { code: 1, refused: { why: 'permissions', at: '/k/app/engine', parts: [], paths: [], ts: 'x' } }, LOG, 'darwin');
  assert.match(t, /This account may not change <code>\/k\/app\/engine<\/code>\. Nothing was removed\. Give that folder back/);
  assert.doesNotMatch(t, /chflags/);
});

test('a path is escaped for the page, and a quote in it is closed and reopened for the pasted line', () => {
  const { updateRefusedText } = lifted();
  const t = updateRefusedText({ refused: { why: 'locked', at: "/k/a<b>/it's", paths: ["/k/it's"], parts: ['app'] } });
  assert.match(t, /<code>\/k\/a&lt;b&gt;\/it's<\/code>/, 'the path is escaped');
  assert.doesNotMatch(t, /<b>\//, 'no raw markup from the path');
  assert.ok(t.includes("chflags -R nouchg,nouappnd '/k/it'\\''s'"), "the quote becomes '\\'' inside the quoted path: " + t);
});

test('no paths falls back to the stuck path itself', () => {
  const { updateRefusedText } = lifted();
  assert.match(updateRefusedText({ refused: { why: 'locked', at: '/k/bin/kosmos', paths: [] } }), /nouappnd '\/k\/bin\/kosmos'/);
});

test('damage or absence adds nothing', () => {
  const { updateRefusedText } = lifted();
  for (const a of [null, {}, { refused: null }, { refused: 'locked' }, { refused: { why: 'locked' } }, { refused: { why: 'other', at: '/k' } }]) {
    assert.equal(updateRefusedText(a), '', JSON.stringify(a));
  }
});

test('Windows and the came-back-on-the-same-version case are untouched', () => {
  const { updateSettleText } = lifted();
  const refused = { why: 'locked', at: '/k/app/x', paths: ['/k/app'], parts: ['app'] };
  assert.doesNotMatch(updateSettleText('failed', '0.7.48', { code: 1, refused }, LOG, 'win32'), /locked|chflags/);
  assert.doesNotMatch(updateSettleText('did-not-take', '0.7.48', { code: 1, refused }, LOG, 'darwin'), /locked|chflags/);
});

test('an immutable refusal (Linux) names the path and gives the administrator chattr line', () => {
  const { updateRefusedText } = lifted();
  const t = updateRefusedText({ refused: { why: 'immutable', at: '/k/app/engine/x.js', parts: ['app'], paths: ['/k/app'] } });
  assert.match(t, /Part of it is marked immutable: <code>\/k\/app\/engine\/x\.js<\/code>\. Nothing was removed\./);
  assert.match(t, /<code>sudo chattr -R -i -a '\/k\/app'<\/code>/);
  assert.doesNotMatch(t, /chflags/, 'not the macOS line');
});
