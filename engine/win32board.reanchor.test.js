'use strict';
/**
 * win32-installer-native, round 1 finding 3: a board booting from a real Kosmos build points the
 * engine pointer at ITSELF, whatever state the board's logon task is in, and registers nothing.
 *
 * 🛑 THE DEFECT. The pointer moved only inside `install()`, which ensureInstalled reaches only for a
 * task it registers or refreshes. With the task switched off, removed or unreadable, a moved or newly
 * extracted Kosmos booted while every agent's task kept starting the OLD folder.
 *
 * No real schtasks and no real anchor: the runner and the anchorer are stubs, and the anchor's own
 * folder is a scratch folder.
 *
 *   node --test engine/win32board.reanchor.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const board = require('./win32board');

const ANCHOR = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-reanchor-'));
test.after(() => fs.rmSync(ANCHOR, { recursive: true, force: true }));

const MOVED = 'C:\\Users\\sam\\AppData\\Local\\Programs\\Kosmos';
const REAL_BUILD = () => ({ product: 'kosmos', platform: 'win32', version: '0.6.60' });

function definition(enabled) {
  return { ok: true, out: '<?xml version="1.0"?><Task><Settings>' + (enabled ? '' : '<Enabled>false</Enabled>') + '</Settings></Task>' };
}

/** Boot ensureInstalled from the moved bundle with the task answering `xml`; record every command and anchor. */
function boot(xml, extra) {
  const calls = [];
  const anchored = [];
  board.setRunner((args) => {
    calls.push(args.join(' '));
    if (args[0] === '/Query' && args.includes('/XML')) return xml;
    if (args[0] === '/Query' && !args.includes('/TN')) return xml.ok ? { ok: true, out: '"\\Kosmos\\board","N/A","Ready"\r\n' } : xml;
    if (args[0] === '/Query') return { ok: false, out: 'ERROR: The system cannot find the file specified.' };
    return { ok: true, out: 'SUCCESS' };
  });
  board.setAnchorer((spec) => {
    anchored.push(spec);
    return extra && extra.anchorFails
      ? { ok: false, because: 'the disk is full' }
      : { ok: true, node: path.join(ANCHOR, 'node.exe'), boot: path.join(ANCHOR, 'supervisor-boot.js'), dir: ANCHOR, pointer: path.join(ANCHOR, 'engine-path') };
  });
  try {
    const r = board.ensureInstalled({
      platform: 'win32', root: MOVED, exists: () => true, readManifest: REAL_BUILD,
      env: { USERNAME: 'sam', USERDOMAIN: 'BOX', LOCALAPPDATA: path.join(ANCHOR, 'Local') }, home: 'C:\\Users\\sam',
      ...(extra && extra.opts),
    });
    return { r, calls, anchored };
  } finally { board.setRunner(null); board.setAnchorer(null); }
}

test('🛑 a board task the person switched off: the moved copy still takes the pointer, and the task stays off', () => {
  const { r, calls, anchored } = boot(definition(false));
  assert.equal(r.action, 'left-disabled');
  assert.equal(anchored.length, 1, 'a switched-off task left the pointer on the old folder');
  assert.ok(!calls.some((c) => /^\/(Create|Change|Run|Delete)/.test(c)), 'anchoring registered or changed the task: ' + calls.join(' | '));
});

test('a board task that cannot be read: nothing is registered, and the pointer still follows this folder', () => {
  const { r, calls, anchored } = boot({ ok: false, out: 'ERROR: Access is denied.' });
  assert.equal(r.action, 'unknown');
  assert.equal(anchored.length, 1);
  assert.ok(!calls.some((c) => /^\/(Create|Change)/.test(c)));
});

test('a board task switched on is refreshed as before, and the pointer follows this folder', () => {
  const { r, anchored } = boot(definition(true));
  assert.equal(r.action, 'refreshed', JSON.stringify(r));
  assert.ok(anchored.length >= 1);
  assert.equal(r.anchor, undefined, 'a successful anchor changed ensureInstalled\'s answer');
});

test('an anchor that fails is reported on the answer, and the task\'s own state is still reported', () => {
  const { r } = boot(definition(false), { anchorFails: true });
  assert.equal(r.action, 'left-disabled');
  assert.deepEqual(r.anchor, { ok: false, action: 'failed', because: 'the disk is full' });
});

test('🛑 a Mac, a source checkout, and a folder with no Kosmos manifest never anchor', () => {
  assert.equal(boot(definition(false), { opts: { platform: 'darwin' } }).anchored.length, 0, 'a Mac anchored');
  assert.equal(boot(definition(false), { opts: { exists: () => false } }).anchored.length, 0, 'a source checkout anchored');
  assert.equal(boot(definition(false), { opts: { readManifest: () => { throw new Error('ENOENT'); } } }).anchored.length, 0, 'a folder with no manifest anchored');
  assert.equal(boot(definition(false), { opts: { readManifest: () => ({ product: 'kosmos', platform: 'darwin' }) } }).anchored.length, 0, 'a Mac build\'s manifest anchored');
});
