'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// ⚠️ Sandbox EVERY root this touches, BEFORE requiring the helper (which requires
// trust.js, which reads these seams). Three roots: the config file trustFolder's
// default-account path writes (#2129 targets ~/.claude.json), the settings file
// preacceptBypass's default-account path writes (~/.claude/settings.json), and the
// data root the trust-write record lives under. Without all three a test would write
// the operator's real config - the exact a-test-of-the-real-env-branch hazard.
const SANDBOX = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'ensure-trust-test-')));
const CONFIG = nodePath.join(SANDBOX, 'claude.json');
const SETTINGS = nodePath.join(SANDBOX, 'settings.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = CONFIG;
process.env.AGENT_WORKFORCE_CLAUDE_SETTINGS = SETTINGS;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { ensureLaunchTrust } = require('./ensure-launch-trust');
const { KEY, BYPASS_KEY } = require('./trust');

// The key trust.js writes is the folder's on-disk realpath, separator-normalised
// (forward slashes; identical on macOS, the #2281 shape on Windows).
const K = (p) => String(fs.realpathSync(p)).split(nodePath.sep).join('/');

let n = 0;
const folder = () => {
  const d = nodePath.join(SANDBOX, `w${++n}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const readConfig = () => JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const readSettings = () => JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
const clear = () => {
  try { fs.rmSync(CONFIG, { force: true }); } catch { /* fine */ }
  try { fs.rmSync(SETTINGS, { force: true }); } catch { /* fine */ }
};

test('re-applies BOTH the folder-trust key and the bypass pre-accept for a default-account agent', () => {
  clear();
  const f = folder();
  ensureLaunchTrust(f, ''); // empty configDir => default account (~/.claude.json + settings.json)
  // Folder-trust: the key Claude Code looks up on startup, under the realpath'd folder.
  const cfg = readConfig();
  assert.ok(cfg.projects && cfg.projects[K(f)], `no trust entry for ${K(f)}: ${JSON.stringify(cfg.projects)}`);
  assert.equal(cfg.projects[K(f)][KEY], true, 'the folder-trust key must be set true');
  // Bypass pre-accept: the one-time "Bypass Permissions mode" acceptance.
  assert.equal(readSettings()[BYPASS_KEY], true, 'the bypass pre-accept key must be set true');
});

test('is idempotent - a second (re)launch re-writes nothing and still leaves both keys true', () => {
  clear();
  const f = folder();
  ensureLaunchTrust(f, '');
  const cfg1 = fs.readFileSync(CONFIG, 'utf8');
  const set1 = fs.readFileSync(SETTINGS, 'utf8');
  ensureLaunchTrust(f, ''); // the restart case: same folder, keys already set
  assert.equal(readConfig().projects[K(f)][KEY], true, 'trust key still true after the second call');
  assert.equal(readSettings()[BYPASS_KEY], true, 'bypass key still true after the second call');
  // Idempotent in the strong sense: the files are byte-identical (no churn on a restart).
  assert.equal(fs.readFileSync(CONFIG, 'utf8'), cfg1, 'config unchanged on the idempotent second call');
  assert.equal(fs.readFileSync(SETTINGS, 'utf8'), set1, 'settings unchanged on the idempotent second call');
});

test('an empty workdir is a no-op - it writes nothing and does not throw', () => {
  clear();
  assert.doesNotThrow(() => ensureLaunchTrust('', ''));
  assert.equal(fs.existsSync(CONFIG), false, 'no config written for an empty workdir');
  assert.equal(fs.existsSync(SETTINGS), false, 'no settings written for an empty workdir');
});

test('best-effort: a non-absolute workdir soft-fails inside trustFolder and never throws', () => {
  clear();
  // trustFolder returns {ok:false} for a non-absolute path rather than throwing; the
  // helper must not surface that as a throw (a launch must never break on a re-trust).
  assert.doesNotThrow(() => ensureLaunchTrust('relative/not/absolute', ''));
  // The bypass pre-accept does not depend on the folder, so it still lands - that is
  // fine and harmless (idempotent per-account preference). The trust key must NOT be
  // written for a folder that failed the absolute-path check.
  if (fs.existsSync(CONFIG)) {
    const cfg = readConfig();
    assert.ok(!cfg.projects || !cfg.projects['relative/not/absolute'], 'no trust entry for a non-absolute path');
  }
});

test('CONTROL: without the helper the folder is NOT trusted - the check can fail', () => {
  clear();
  const f = folder();
  // Do NOT call ensureLaunchTrust. A fresh sandbox has no config, so the folder is
  // untrusted - proving the assertion above is not vacuous (it would fire the #2129
  // prompt in a real launch).
  assert.equal(fs.existsSync(CONFIG), false, 'no trust config exists until the helper runs');
});
