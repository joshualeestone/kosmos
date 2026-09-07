'use strict';

/*
 * kosmos#2129 / the 0.6.42 fresh-macOS keystone (#5): a NEW agent (Claude AND
 * codex) stalled on the runner's OWN first-run directory-trust menu, which the
 * Kosmos chat box cannot answer (Enter = No/exit = the agent dies). The
 * auto-trust write keyed the trust on `fs.realpathSync(dir)`, but the RUNNER
 * looks up its cwd's ON-DISK canonical spelling:
 *   - measured: fs.realpathSync resolves symlinks but does NOT case-fold on macOS
 *     (realpathSync of a lowercase path on a disk holding the capital case returns
 *     the LOWERCASE input);
 *   - measured: process.cwd() after chdir to the lowercase path returns the
 *     CAPITAL on-disk case -- which is what a Node runner (Claude Code) looks up,
 *     and codex's std::fs::canonicalize does the same.
 * So on a fresh macOS user whose on-disk worker root is `~/Work` while the code
 * hardcodes lowercase `~/work` (workersDir), the realpath key (lowercase) missed
 * the runner's capital-cased lookup and the menu fired. The fix keys on
 * `canonicalOnDisk(dir)` (a readdir-walk that recovers the stored case), which
 * equals what the runner looks up.
 *
 * These tests PIN the trust key to the runner's actual lookup spelling
 * (process.cwd() after chdir), with a control proving realpathSync -- the OLD key
 * -- would have missed. The case arms are guarded on a case-insensitive
 * filesystem (macOS/APFS default); on a case-sensitive FS they no-op with a note.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trust-canon-2129c-')));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { trustFolder, canonicalOnDisk, KEY } = require('./trust');
const create = require('./create');

// Is this filesystem case-insensitive (like macOS/APFS default, and Josh's)?
function caseInsensitiveFS() {
  const probe = path.join(SANDBOX, 'CaseProbe');
  try { fs.mkdirSync(probe, { recursive: true }); } catch { /* exists */ }
  return fs.existsSync(path.join(SANDBOX, 'caseprobe'));
}
const CI_FS = caseInsensitiveFS();

let n = 0;
// Build a folder whose ON-DISK case is CAPITAL 'Work', and return the LOWERCASE
// spelling the code would hand us (workersDir hardcodes lowercase 'work').
function capitalOnDiskLowercaseHanded() {
  const id = ++n;
  const realCap = path.join(SANDBOX, `Work${id}`, 'workers', 'fix');
  fs.mkdirSync(realCap, { recursive: true }); // on-disk case = 'Work<id>'
  const handedLower = path.join(SANDBOX, `work${id}`, 'workers', 'fix'); // what the code passes
  return { handedLower, capitalMarker: `${path.sep}Work${id}${path.sep}` };
}

test('canonicalOnDisk resolves a symlink to its target (the property realpath also had, kept)', () => {
  const real = path.join(SANDBOX, `real${++n}`);
  fs.mkdirSync(real, { recursive: true });
  const link = path.join(SANDBOX, `link${n}`);
  fs.symlinkSync(real, link);
  assert.equal(canonicalOnDisk(link), fs.realpathSync(link), 'symlinks resolve like realpath');
});

test('#2129/#5: canonicalOnDisk equals what the RUNNER looks up (process.cwd), where realpath does NOT', { skip: !CI_FS && 'case-sensitive FS' }, () => {
  const { handedLower, capitalMarker } = capitalOnDiskLowercaseHanded();
  // What the runner actually looks up: its resolved cwd.
  const prev = process.cwd();
  process.chdir(handedLower);
  const runnerLookup = process.cwd();
  process.chdir(prev);
  assert.ok(runnerLookup.includes(capitalMarker), 'sanity: the runner resolves to the CAPITAL on-disk case');
  // The fix's key equals the runner's lookup...
  assert.equal(canonicalOnDisk(handedLower), runnerLookup, 'canonicalOnDisk == the runner lookup spelling');
  // ...and the OLD key (realpath) does NOT -- the control that proves the bug.
  assert.notEqual(fs.realpathSync(handedLower), runnerLookup,
    'CONTROL: fs.realpathSync (the old trust key) does NOT equal the runner lookup -> it missed, the menu fired');
});

test('#2129/#5 Claude: trustFolder keys the trust under the on-disk (runner-lookup) spelling', { skip: !CI_FS && 'case-sensitive FS' }, () => {
  const { handedLower, capitalMarker } = capitalOnDiskLowercaseHanded();
  const cfgDir = path.join(SANDBOX, `cfg${++n}`);
  const r = trustFolder(handedLower, { configDir: cfgDir, createIfAbsent: true });
  assert.equal(r.ok, true, r.because);
  const cfg = JSON.parse(fs.readFileSync(path.join(cfgDir, '.claude.json'), 'utf8'));
  const keys = Object.keys(cfg.projects);
  assert.equal(keys.length, 1, 'exactly one key');
  assert.ok(keys[0].includes(capitalMarker), `the key is the on-disk CAPITAL spelling (${keys[0]})`);
  assert.equal(cfg.projects[keys[0]][KEY], true);
  // Control: the old realpath key would have been the lowercase handed spelling.
  assert.ok(!keys[0].includes(`${path.sep}work${path.parse(handedLower).dir.match(/work(\d+)/)[1]}${path.sep}`),
    'CONTROL: the key is NOT the lowercase spelling realpath would have written');
});

test('#2129/#5 codex: trustCodexFolder keys the trust under the on-disk (runner-lookup) spelling', { skip: !CI_FS && 'case-sensitive FS' }, () => {
  const { handedLower, capitalMarker } = capitalOnDiskLowercaseHanded();
  const codexHome = path.join(SANDBOX, `codexhome${++n}`);
  create.trustCodexFolder(handedLower, codexHome, false);
  const toml = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
  assert.ok(toml.includes(capitalMarker), `the codex trust block uses the on-disk CAPITAL spelling:\n${toml}`);
  assert.equal((toml.match(/trust_level = "trusted"/g) || []).length, 1, 'exactly one trust block');
});

test('#2129/#5 codex: create->trust then forget removes it, matching the on-disk spelling (undo intact)', { skip: !CI_FS && 'case-sensitive FS' }, () => {
  const { handedLower } = capitalOnDiskLowercaseHanded();
  const codexHome = path.join(SANDBOX, `codexhome${++n}`);
  create.trustCodexFolder(handedLower, codexHome, false);
  const before = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
  assert.match(before, /trust_level = "trusted"/);
  const r = create.forgetCodexFolder(handedLower, codexHome, false);
  assert.equal(r.ok, true, r.because);
  assert.equal(r.removed, true, 'the entry was removed (spelling matched what trust wrote)');
  const after = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
  assert.doesNotMatch(after, /trust_level = "trusted"/, 'no trust block left behind');
});
