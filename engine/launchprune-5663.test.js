'use strict';
require('../test-support/tmpscope');   // first: every mkdtemp in this file lands in a per-process dir removed on exit (#4273)

/*
 * #5663: the token-only guard REPLACES its launch rules on each refresh (they only grew before, so every upgrade of an
 * installed tool added versioned paths for good), and its sandbox layer has a ceiling (measured: a profile past 64 KB
 * of data makes every sandboxed command fail). Asserts the config written, as launchpath-5516.test.js does.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'launchprune-5663-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_HOME, { recursive: true });

const setup = require('./setup-assistant');
const store = require('./store');

fs.mkdirSync(store.ROOT, { recursive: true });
function realOr(p) { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } }
function ruleAbs(p) { return '//' + String(p).replace(/^\/+/, ''); }
function agentDir(name) { const d = path.join(SANDBOX, 'workers', name); fs.mkdirSync(d, { recursive: true }); return d; }
function settingsFile(dir) { return path.join(dir, '.claude', 'settings.json'); }
function readSettings(dir) { return JSON.parse(fs.readFileSync(settingsFile(dir), 'utf8')); }
function binDir(name) { const d = path.join(SANDBOX, 'bins', name); fs.mkdirSync(d, { recursive: true }); return d; }
const BASE = { platform: 'darwin', dataRoot: store.ROOT, home: process.env.AGENT_WORKFORCE_HOME, runner: 'claude', runnerOf: () => 'claude', ownPath: '', launchFixed: [], ownProgramDirs: [], launchFiles: [], launchConfigDirs: [], launchTemps: [] };
const dirRule = (d) => `Edit(${ruleAbs(realOr(d))}/**)`;

test('#5663: an upgrade replaces the old versioned folder in both layers; the person\'s own rules and the rest of the guard stay', () => {
  const dir = agentDir('lp-upgrade');
  const v1 = binDir('tool/1.0/bin');
  const v2 = binDir('tool/2.0/bin');
  assert.deepEqual(setup.guardTokenOnlyFolder(dir, 'lp-upgrade', { ...BASE, panePath: v1 }), { ok: true });
  // The person adds their own rules beside the guard's.
  const s1 = readSettings(dir);
  s1.permissions.deny.push('Edit(//person/own/rule)');
  s1.sandbox.filesystem.denyWrite.push('/person/own/path');
  fs.writeFileSync(settingsFile(dir), JSON.stringify(s1, null, 2));
  const tokenRules = s1.permissions.deny.filter((r) => /board\.token/.test(r));
  assert.ok(tokenRules.length > 0, 'CONTROL: the rest of the guard is there to keep');
  // The tool is upgraded: the PATH now names 2.0.
  assert.deepEqual(setup.guardTokenOnlyFolder(dir, 'lp-upgrade', { ...BASE, panePath: v2 }), { ok: true });
  const s2 = readSettings(dir);
  assert.ok(!s2.permissions.deny.includes(dirRule(v1)), 'the old version\'s folder rule was kept for good');
  assert.ok(!s2.sandbox.filesystem.denyWrite.includes(realOr(v1)), 'the old version\'s folder stayed in the sandbox layer');
  assert.ok(s2.permissions.deny.includes(dirRule(v2)) && s2.sandbox.filesystem.denyWrite.includes(realOr(v2)), 'the new version is not covered');
  assert.ok(s2.permissions.deny.includes('Edit(//person/own/rule)') && s2.sandbox.filesystem.denyWrite.includes('/person/own/path'), 'the person\'s own rules were pruned');
  for (const r of tokenRules) assert.ok(s2.permissions.deny.includes(r), 'a rule of the rest of the guard was pruned: ' + r);
});

test('#5663: with no record (a guard written before this change), nothing is pruned; from the next refresh on, it is', () => {
  const dir = agentDir('lp-norecord');
  const v1 = binDir('old/1.0/bin');
  const v2 = binDir('old/2.0/bin');
  assert.deepEqual(setup.guardTokenOnlyFolder(dir, 'lp-norecord', { ...BASE, panePath: v1 }), { ok: true });
  // As a guard written before this change: no record on disk.
  fs.rmSync(path.join(dir, '.claude', 'kosmos-launch-rules.json'), { force: true });
  setup.guardTokenOnlyFolder(dir, 'lp-norecord', { ...BASE, panePath: v2 });
  assert.ok(readSettings(dir).permissions.deny.includes(dirRule(v1)), 'with no record, a rule was pruned it cannot know the guard wrote');
  // From now on the record exists, so the next upgrade prunes 2.0.
  const v3 = binDir('old/3.0/bin');
  setup.guardTokenOnlyFolder(dir, 'lp-norecord', { ...BASE, panePath: v3 });
  const s = readSettings(dir);
  assert.ok(!s.permissions.deny.includes(dirRule(v2)) && s.permissions.deny.includes(dirRule(v3)));
});

test('#5663: the record cannot be rewritten by the agent: it is denied to the file tools, and the sandbox denies its folder', () => {
  const dir = agentDir('lp-record');
  setup.guardTokenOnlyFolder(dir, 'lp-record', { ...BASE, panePath: binDir('rec/bin') });
  const rec = path.join(dir, '.claude', 'kosmos-launch-rules.json');
  assert.ok(fs.existsSync(rec), 'no record was written');
  const s = readSettings(dir);
  assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(rec)})`), 'the record is not denied to the file tools');
  assert.ok(s.sandbox.filesystem.denyWrite.includes(realOr(path.join(dir, '.claude'))), 'CONTROL: the sandbox denies the folder it sits in');
  // It names what this refresh wrote (and only rules not current at the next refresh are ever pruned by it).
  const j = JSON.parse(fs.readFileSync(rec, 'utf8'));
  assert.ok(j.deny.length > 0 && j.denyWrite.length > 0, JSON.stringify(j));
});

test('#5663: a sandbox layer past the measured ceiling says the guard is not whole, and the guard is still written', () => {
  const dir = agentDir('lp-ceiling');
  const many = [];
  for (let i = 0; i < 1400; i++) many.push(binDir(`ceiling/pkg${i}/1.${i}/bin`));
  const r = setup.guardTokenOnlyFolder(dir, 'lp-ceiling', { ...BASE, panePath: many.join(path.delimiter) });
  assert.equal(r.ok, false, JSON.stringify(r).slice(0, 200));
  assert.match(r.because, /sandbox rules are \d+ bytes/);
  assert.ok(readSettings(dir).sandbox.filesystem.denyWrite.length > 1000, 'the guard was not written');
  // CONTROL: the same agent with a handful of folders is whole.
  assert.deepEqual(setup.guardTokenOnlyFolder(agentDir('lp-ceiling-ok'), 'lp-ceiling-ok', { ...BASE, panePath: many.slice(0, 5).join(path.delimiter) }), { ok: true });
});
