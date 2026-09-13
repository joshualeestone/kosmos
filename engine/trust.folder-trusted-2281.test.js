'use strict';
/**
 * #2281 review r1: trust.folderTrusted -- the POSITIVE signal the supervisor uses
 * to tell a trust-dialog hang from a slow-but-healthy start. It must ask the exact
 * question the runner answers (same key derivation, same config resolution as
 * trustFolder) and it must be honest about what it does NOT know: an explicit
 * `false` only when the config is readable and the folder is genuinely not vouched
 * for, and `null` when it cannot tell.
 *
 *   node --test engine/trust.folder-trusted-2281.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trust-foldertrusted-2281-')));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, '.claude.json');

const trust = require('./trust');
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

function cfgDir() { return fs.mkdtempSync(path.join(SANDBOX, 'cfg-')); }
function workdir(name) {
  const d = path.join(SANDBOX, 'work', name);
  fs.mkdirSync(d, { recursive: true });
  return fs.realpathSync(d);
}

test('#2281 a folder trustFolder wrote reads back as TRUE, via the same key', () => {
  const cfg = cfgDir();
  const work = workdir('trusted');
  const w = trust.trustFolder(work, { configDir: cfg, createIfAbsent: true });
  assert.equal(w.ok, true, w.because || '');
  assert.equal(trust.folderTrusted(work, { configDir: cfg }), true);
});

test('#2281 a real folder NOT in a readable config reads as FALSE, never null', () => {
  const cfg = cfgDir();
  // a config that exists but vouches for nothing
  fs.writeFileSync(path.join(cfg, '.claude.json'), JSON.stringify({ projects: {} }));
  const work = workdir('untrusted');
  assert.equal(trust.folderTrusted(work, { configDir: cfg }), false,
    'a readable config with no entry for this folder is a definite not-trusted');
});

test('#2281 an entry present but hasTrustDialogAccepted:false reads as FALSE', () => {
  const cfg = cfgDir();
  const work = workdir('declined');
  const key = work.split(path.sep).join('/');
  fs.writeFileSync(path.join(cfg, '.claude.json'), JSON.stringify({ projects: { [key]: { hasTrustDialogAccepted: false } } }));
  assert.equal(trust.folderTrusted(work, { configDir: cfg }), false);
});

test('#2281 an ABSENT config reads as NULL -- we cannot tell, so do not claim untrusted', () => {
  const cfg = cfgDir();   // no .claude.json written into it
  const work = workdir('noconfig');
  assert.equal(trust.folderTrusted(work, { configDir: cfg }), null);
});

test('#2281 a MISSING folder reads as NULL -- no key can be resolved for it', () => {
  const cfg = cfgDir();
  fs.writeFileSync(path.join(cfg, '.claude.json'), JSON.stringify({ projects: {} }));
  const gone = path.join(SANDBOX, 'no', 'such', 'folder');
  assert.equal(trust.folderTrusted(gone, { configDir: cfg }), null);
});

test('#2281 a non-absolute dir reads as NULL', () => {
  assert.equal(trust.folderTrusted('relative/dir', { configDir: cfgDir() }), null);
});
