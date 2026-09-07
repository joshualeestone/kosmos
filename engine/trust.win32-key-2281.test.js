'use strict';
/**
 * #2281: the trust key Kosmos writes must be the spelling Claude Code READS.
 *
 * 🛑 MEASURED ON A REAL WINDOWS BOX (2026-09-07), because this is unfalsifiable
 * from macOS. Two folders, one config, one Claude Code (2.1.263), one variable --
 * the separator in the `projects` key -- with `hasTrustDialogAccepted: true`
 * pre-written for both:
 *
 *     projects["C:/Users/joshu/trust-test-fwd"]   -> no dialog, straight to the prompt
 *     projects["C:\\Users\\joshu\\trust-test-back"] -> THE TRUST DIALOG, "No, exit" preselected
 *
 * The forward-slash arm is the CONTROL and it is what makes this decisive: it
 * proves pre-accepting trust works at all, so the backslash arm's dialog is
 * about the SPELLING and nothing else.
 *
 * ⇒ `trustFolder` keyed on `fs.realpathSync.native`, which returns `C:\...` on
 * Windows. So it wrote an entry Claude Code never reads, returned ok, and left
 * every Kosmos-created agent facing a prompt whose default is `No, exit` -- the
 * agent dying at birth, which is the exact failure #2129 exists to prevent.
 *
 * ⚠️ THESE ARMS CANNOT FAIL ON macOS, and that is stated rather than hidden:
 * `path.sep` is '/' there, so the normalisation is the identity and the win32
 * arm below is asserted against a SYNTHETIC win32-shaped string rather than a
 * real path. They are a pin on the RULE, which is the only thing a Mac can hold.
 *
 *   node --test engine/trust.win32-key-2281.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'trust-win32key-2281-')));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, '.claude.json');

const trust = require('./trust');
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

function readCfg(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

test('#2281 the written key carries NO backslash, whatever the host spells', () => {
  const cfgDir = fs.mkdtempSync(nodePath.join(SANDBOX, 'cfg-'));
  const work = nodePath.join(SANDBOX, 'work', 'workers', 'keyprobe');
  fs.mkdirSync(work, { recursive: true });

  const r = trust.trustFolder(work, { configDir: cfgDir, createIfAbsent: true });
  assert.equal(r.ok, true, r.because || '');

  const keys = Object.keys(readCfg(nodePath.join(cfgDir, '.claude.json')).projects || {});
  assert.equal(keys.length, 1, 'exactly the folder we trusted');
  assert.ok(!keys[0].includes('\\'),
    'a backslashed key is the spelling Claude Code does NOT read on Windows -- measured, '
    + 'with a forward-slash control that went straight to the prompt. Got: ' + JSON.stringify(keys[0]));
  assert.equal(keys[0], work.split(nodePath.sep).join('/'),
    'and it is the same path, separators normalised');
});

test('#2281 the key it RETURNS is the key it WROTE, so a rollback removes the right entry', () => {
  /* forgetFolder deliberately does NOT re-resolve -- it uses the key handed back
     to it, because re-deriving during a rollback would resolve a folder that is
     being deleted underneath it. That contract only holds if the returned key is
     the written one, which the separator change could have broken silently. */
  const cfgDir = fs.mkdtempSync(nodePath.join(SANDBOX, 'cfg-'));
  const work = nodePath.join(SANDBOX, 'work', 'workers', 'rollback');
  fs.mkdirSync(work, { recursive: true });

  const r = trust.trustFolder(work, { configDir: cfgDir, createIfAbsent: true });
  assert.equal(r.ok, true, r.because || '');
  const written = Object.keys(readCfg(nodePath.join(cfgDir, '.claude.json')).projects || {})[0];
  assert.equal(r.key, written, 'the returned key IS the written key');
  assert.ok(nodePath.isAbsolute(r.key),
    'and it still reads as absolute -- forgetFolder refuses a non-absolute path, and '
    + 'C:/Users/x with forward slashes must satisfy that on win32');
});

test('#2281 a missing folder is still REFUSED, not silently accepted', () => {
  /* The refusal rides on realpathSync.native throwing. A cleanup that routed the
     key through canonicalOnDisk (which swallows and falls back to path.resolve)
     would have turned this refusal into an accept while "only" fixing separators. */
  const cfgDir = fs.mkdtempSync(nodePath.join(SANDBOX, 'cfg-'));
  const gone = nodePath.join(SANDBOX, 'no', 'such', 'folder');
  const r = trust.trustFolder(gone, { configDir: cfgDir, createIfAbsent: true });
  assert.equal(r.ok, false, 'a folder that is not there must not be trusted');
  assert.match(String(r.because), /not there/);
});

test('#2281 THE RULE, pinned against a synthetic win32 path (the only arm a Mac can hold)', () => {
  /* On macOS no real path can carry a backslash, so the arms above are identities
     here. This one asserts the rule itself on a win32-shaped string, which is
     what a Mac CAN falsify: if someone removes the normalisation, this still
     describes what the box measured. */
  const winStyle = 'C:\\Users\\joshu\\work\\workers\\agent';
  const normalised = winStyle.split('\\').join('/');
  assert.equal(normalised, 'C:/Users/joshu/work/workers/agent');
  assert.ok(!normalised.includes('\\'));
  assert.ok(nodePath.win32.isAbsolute(normalised),
    'the forward-slash form is still absolute to win32, so every isAbsolute guard '
    + 'on this key keeps passing');
});
