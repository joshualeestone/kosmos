'use strict';
/**
 * #1629: an account flip writes trust into the config the agent will actually read.
 *
 * 🛑 THE DEFECT. Claude Code records trust PER CONFIG DIR, reading
 * `$CLAUDE_CONFIG_DIR/.claude.json` when that variable is set. #164/#165 pre-record
 * the trust flag at CREATE time into the config THIS process reads. So pointing an
 * agent at another account left it reading a file where the flag had never been
 * written, and it came up frozen on "Is this a project you created or one you
 * trust?" with `No, exit` PRESELECTED. From outside that is indistinguishable from
 * an agent ignoring you.
 *
 * ⚠️ BOTH SHAPES ARE REAL, AND THE SECOND IS THE ONE A NAIVE FIX MISSES. Measured
 * on this machine across worker folders, trust is sometimes `false` and sometimes
 * ABSENT ENTIRELY - claudebot's worker folder had no entry in any of three
 * configs. A fix that flipped an existing boolean would do nothing for it. Both
 * cells are below.
 *
 *   node --test engine/trust.flip-1629.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'trustflip-')));
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');
fs.mkdirSync(process.env.AGENT_WORKFORCE_HOME, { recursive: true });
const trust = require('./trust');

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const KEY = 'hasTrustDialogAccepted';

function acct(name, projects) {
  const dir = nodePath.join(SANDBOX, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, '.claude.json'), JSON.stringify({ projects: projects || {} }), 'utf8');
  return dir;
}
function folder(name) {
  const d = nodePath.join(SANDBOX, name);
  fs.mkdirSync(d, { recursive: true });
  return fs.realpathSync(d);
}
const readTrust = (dir, key) => {
  const d = JSON.parse(fs.readFileSync(nodePath.join(dir, '.claude.json'), 'utf8'));
  const e = (d.projects || {})[key];
  return e === undefined ? 'ENTRY-ABSENT' : (KEY in e ? e[KEY] : 'KEY-ABSENT');
};

test('#1629: the flip CREATES the entry when the account has none', () => {
  const target = acct('acct-empty');
  const work = folder('worker-a');
  assert.equal(readTrust(target, work), 'ENTRY-ABSENT', 'the fixture already had an entry, so this cell is not testing creation');

  const r = trust.trustFolder(work, { configDir: target });
  assert.equal(r.ok, true, r.because);
  assert.equal(r.madeEntry, true, 'the write did not report creating the entry');
  assert.equal(readTrust(target, work), true, 'the account config still does not trust the folder');
});

test('#1629: the flip FLIPS an entry that exists and says false', () => {
  const work = folder('worker-b');
  const target = acct('acct-false', { [work]: { [KEY]: false } });
  assert.equal(readTrust(target, work), false, 'the fixture is not in the false state this cell needs');

  const r = trust.trustFolder(work, { configDir: target });
  assert.equal(r.ok, true, r.because);
  assert.equal(r.displaced, false, 'the write did not record what it displaced, so the undo cannot restore it');
  assert.equal(readTrust(target, work), true);
});

/* 🛑 THE ONE THAT NAMES THE DEFECT. Without configDir the write lands in the
   config THIS process reads, which on a flipped agent is not the file the agent
   opens. Both configs are inspected, so the test says WHERE it went rather than
   only whether a call succeeded. */
test('#1629: without configDir the write lands in OUR config, not the account\'s', () => {
  const work = folder('worker-c');
  const target = acct('acct-untouched');
  const ours = acct('acct-ours');
  process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(ours, '.claude.json');
  try {
    const r = trust.trustFolder(work);
    assert.equal(r.ok, true, r.because);
    assert.equal(readTrust(ours, work), true, 'the default path did not write where this process reads');
    assert.equal(readTrust(target, work), 'ENTRY-ABSENT',
      'the write reached the account config without being asked to, so this test cannot show the defect');
  } finally { delete process.env.AGENT_WORKFORCE_CLAUDE_CONFIG; }
});

test('#1629: CLAUDE_CONFIG_DIR is honoured, because Claude Code honours it', () => {
  const work = folder('worker-d');
  const viaEnv = acct('acct-env');
  const home = acct('home-cfg');
  process.env.CLAUDE_CONFIG_DIR = viaEnv;
  process.env.AGENT_WORKFORCE_HOME = nodePath.dirname(nodePath.join(home, '.claude.json'));
  try {
    const r = trust.trustFolder(work);
    assert.equal(r.ok, true, r.because);
    assert.equal(readTrust(viaEnv, work), true,
      'CLAUDE_CONFIG_DIR was ignored, so Kosmos writes where the agent does not read');
  } finally { delete process.env.CLAUDE_CONFIG_DIR; }
});

/* The explicit option must WIN over the environment: the caller is pointing an
   agent somewhere, and that destination is not this process's own account. */
test('#1629: an explicit configDir beats CLAUDE_CONFIG_DIR', () => {
  const work = folder('worker-e');
  const envDir = acct('acct-env-2');
  const wanted = acct('acct-wanted');
  process.env.CLAUDE_CONFIG_DIR = envDir;
  try {
    const r = trust.trustFolder(work, { configDir: wanted });
    assert.equal(r.ok, true, r.because);
    assert.equal(readTrust(wanted, work), true, 'the explicit destination was not written');
    assert.equal(readTrust(envDir, work), 'ENTRY-ABSENT',
      'the environment won over the explicit destination, so a flip would trust the wrong account');
  } finally { delete process.env.CLAUDE_CONFIG_DIR; }
});

/* Already-true stays a success and writes nothing new, so a repeated flip does not
   manufacture an undo record for a change it did not make. */
test('#1629: an account that already trusts the folder reports already, not a fresh write', () => {
  const work = folder('worker-f');
  const target = acct('acct-true', { [work]: { [KEY]: true } });
  const r = trust.trustFolder(work, { configDir: target });
  assert.equal(r.ok, true);
  assert.equal(r.already, true, 'a second flip reports a fresh write, which would leave a false undo record');
});
