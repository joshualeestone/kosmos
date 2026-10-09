'use strict';
require('../test-support/tmpscope');   // first: every mkdtemp in this file lands in a per-process dir removed on exit (#4273)
delete process.env.KOSMOS_GUARD_PANE_PATH;   // a board start: no pane PATH unless a test passes one

/*
 * #5663: the token-only guard prunes launch rules it wrote whose paths are gone (they only grew before, so every upgrade
 * of an installed tool added versioned paths for good), and says when its deny paths pass a ceiling (measured: Claude
 * Code puts the Edit deny rules in the sandbox profile too, and a profile past 64 KB of data makes every sandboxed
 * command fail). Asserts the config written, as launchpath-5516.test.js does.
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
  // The tool is upgraded: the PATH now names 2.0, and 1.0's folder is gone from disk (its parent too). Review 2: the
  // expected spellings are taken BEFORE the folder goes (realOr of a gone path falls back to the unresolved spelling).
  const r1 = dirRule(v1);
  const w1 = realOr(v1);
  assert.ok(s1.permissions.deny.includes(r1) && s1.sandbox.filesystem.denyWrite.includes(w1), 'CONTROL: 1.0 was covered before the upgrade');
  fs.rmSync(path.join(SANDBOX, 'bins', 'tool', '1.0'), { recursive: true });
  assert.deepEqual(setup.guardTokenOnlyFolder(dir, 'lp-upgrade', { ...BASE, panePath: v2 }), { ok: true });
  const s2 = readSettings(dir);
  assert.ok(!s2.permissions.deny.includes(r1), 'the old version\'s folder rule was kept for good');
  assert.ok(!s2.sandbox.filesystem.denyWrite.includes(w1), 'the old version\'s folder stayed in the sandbox layer');
  // Review 2: in no spelling (the file-tool layer also writes a folder's other spellings).
  const left = [...s2.permissions.deny, ...s2.sandbox.filesystem.denyWrite].filter((x) => x.includes('/bins/tool/1.0'));
  assert.deepEqual(left, [], 'an old spelling stayed');
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
  fs.rmSync(path.join(SANDBOX, 'bins', 'old', '1.0'), { recursive: true });
  assert.deepEqual(setup.guardTokenOnlyFolder(dir, 'lp-norecord', { ...BASE, panePath: v2 }), { ok: true });
  assert.ok(readSettings(dir).permissions.deny.includes(dirRule(v1)), 'with no record, a rule was pruned it cannot know the guard wrote');
  // From now on the record exists, so the next upgrade prunes 2.0.
  const v3 = binDir('old/3.0/bin');
  fs.rmSync(path.join(SANDBOX, 'bins', 'old', '2.0'), { recursive: true });
  assert.deepEqual(setup.guardTokenOnlyFolder(dir, 'lp-norecord', { ...BASE, panePath: v3 }), { ok: true });
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

test('#5663: a sandbox layer past the measured ceiling is a warning (the guard is whole and written), never a refusal', () => {
  const dir = agentDir('lp-ceiling');
  const many = [];
  for (let i = 0; i < 1400; i++) many.push(binDir(`ceiling/pkg${i}/1.${i}/bin`));
  const r = setup.guardTokenOnlyFolder(dir, 'lp-ceiling', { ...BASE, panePath: many.join(path.delimiter) });
  // Review 4: a warning, never a refusal (creation refuses on ok:false, and the limits are fitted to measurements).
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 200));
  assert.match(r.warning, /denied paths \(\d+ distinct characters, \d+ in all\) are past/);
  assert.ok(readSettings(dir).sandbox.filesystem.denyWrite.length > 1000, 'the guard was not written');
  // CONTROL: the same agent with a handful of folders is whole.
  assert.deepEqual(setup.guardTokenOnlyFolder(agentDir('lp-ceiling-ok'), 'lp-ceiling-ok', { ...BASE, panePath: many.slice(0, 5).join(path.delimiter) }), { ok: true });
});

test('#5663 reviews 1 and 2: only an agent launch prunes; the board\'s own start (no launch inputs) keeps what a launch wrote, even once it is gone', () => {
  const dir = agentDir('lp-callers');
  const v = binDir('callers/1.0/bin');
  const other = binDir('callers/other/bin');
  assert.deepEqual(setup.guardTokenOnlyFolder(dir, 'lp-callers', { ...BASE, panePath: v }), { ok: true });
  const rv = dirRule(v);
  const wv = realOr(v);
  // The board's start: no pane PATH, so no launch rules are current.
  assert.deepEqual(setup.guardTokenOnlyFolder(dir, 'lp-callers', { ...BASE }), { ok: true });
  const s = readSettings(dir);
  assert.ok(s.permissions.deny.includes(rv) && s.sandbox.filesystem.denyWrite.includes(wv), 'a board-start refresh pruned what the launch wrote');
  const rec = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'kosmos-launch-rules.json'), 'utf8'));
  assert.ok(rec.deny.includes(rv) && rec.denyWrite.includes(wv), 'the record forgot what the launch wrote: ' + JSON.stringify(rec));
  // Gone (an unmounted volume looks the same): a board start still keeps it, in the settings and the record.
  fs.rmSync(path.join(SANDBOX, 'bins', 'callers', '1.0'), { recursive: true });
  setup.guardTokenOnlyFolder(dir, 'lp-callers', { ...BASE });
  const s2 = readSettings(dir);
  assert.ok(s2.permissions.deny.includes(rv) && s2.sandbox.filesystem.denyWrite.includes(wv), 'a board start pruned a gone folder');
  // CONTROL: the next launch (a PATH without it) prunes it.
  setup.guardTokenOnlyFolder(dir, 'lp-callers', { ...BASE, panePath: other });
  const s3 = readSettings(dir);
  assert.ok(!s3.permissions.deny.includes(rv) && !s3.sandbox.filesystem.denyWrite.includes(wv), 'a launch did not prune a gone folder');
  const rec3 = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'kosmos-launch-rules.json'), 'utf8'));
  assert.ok(!rec3.deny.includes(rv) && !rec3.denyWrite.includes(wv), 'the record kept a pruned entry');
});

test('#5663 review 2: the ceiling is a macOS check, and its reason is said beside an uncovered PATH entry, not instead of it', () => {
  // Off macOS no sandbox is written, so a sandbox block the person's file already has is not counted.
  const dir = agentDir('lp-linux');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  const huge = Array.from({ length: 900 }, (_, i) => '/' + String(i).padStart(4, '0') + 'x'.repeat(200));
  fs.writeFileSync(settingsFile(dir), JSON.stringify({ sandbox: { filesystem: { denyWrite: huge } } }));
  assert.deepEqual(setup.guardTokenOnlyFolder(dir, 'lp-linux', { ...BASE, platform: 'linux' }), { ok: true });
  // CONTROL: the same file on macOS is past the ceiling.
  const mac = agentDir('lp-mac-huge');
  fs.mkdirSync(path.join(mac, '.claude'), { recursive: true });
  fs.writeFileSync(settingsFile(mac), JSON.stringify({ sandbox: { filesystem: { denyWrite: huge } } }));
  const rm = setup.guardTokenOnlyFolder(mac, 'lp-mac-huge', { ...BASE });
  assert.equal(rm.ok, true); assert.match(rm.warning, /denied paths/);
  // Both reasons at once: past the ceiling AND a PATH entry it could not cover.
  const both = setup.guardTokenOnlyFolder(mac, 'lp-mac-huge', { ...BASE, panePath: 'relative/bin' });
  assert.equal(both.ok, false);
  assert.match(both.because, /could not cover/); assert.match(both.warning, /denied paths/);
});

test('#5663: a launch path not current but still on disk is kept; once it is gone it is pruned, even in a folder that stays', () => {
  const dir = agentDir('lp-keep');
  const a = binDir('keep/a/bin');
  const b = binDir('keep/b/bin');
  setup.guardTokenOnlyFolder(dir, 'lp-keep', { ...BASE, panePath: [a, b].join(path.delimiter) });
  const rb = dirRule(b);
  // A narrower launch: b is no longer on the PATH but is still on disk.
  setup.guardTokenOnlyFolder(dir, 'lp-keep', { ...BASE, panePath: a });
  assert.ok(readSettings(dir).permissions.deny.includes(rb), 'a folder still on disk was pruned');
  // Review 3: b goes and its parent stays: pruned.
  fs.rmSync(b, { recursive: true });
  setup.guardTokenOnlyFolder(dir, 'lp-keep', { ...BASE, panePath: a });
  assert.ok(!readSettings(dir).permissions.deny.includes(rb), 'a gone folder in a folder that stays was kept');
});

test('#5663 review 3: a version FILE removed from a versions folder that stays (one file per version) is pruned', () => {
  const dir = agentDir('lp-verfile');
  const store = binDir('verstore/versions');
  for (const v of ['1.0', '2.0']) fs.writeFileSync(path.join(store, v), '#!/bin/sh\n', { mode: 0o755 });
  const pd = binDir('verstore-path');
  fs.symlinkSync(path.join(store, '1.0'), path.join(pd, 'tool'));
  assert.deepEqual(setup.guardTokenOnlyFolder(dir, 'lp-verfile', { ...BASE, panePath: pd }), { ok: true });
  const r1 = `Edit(${ruleAbs(path.join(realOr(store), '1.0'))})`;
  assert.ok(readSettings(dir).permissions.deny.includes(r1), 'CONTROL: the version file is named: ' + readSettings(dir).permissions.deny.filter((x) => x.includes('verstore')).join(' '));
  // The tool upgrades itself: the link now names 2.0 and 1.0 is removed; the versions folder stays.
  fs.unlinkSync(path.join(pd, 'tool'));
  fs.symlinkSync(path.join(store, '2.0'), path.join(pd, 'tool'));
  fs.unlinkSync(path.join(store, '1.0'));
  assert.deepEqual(setup.guardTokenOnlyFolder(dir, 'lp-verfile', { ...BASE, panePath: pd }), { ok: true });
  const s = readSettings(dir);
  assert.ok(!s.permissions.deny.includes(r1), 'the removed version file stayed');
  assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(path.join(realOr(store), '2.0'))})`), 'the new version file is not named');
});

test('#5663: a corrupt or wrong-shaped record prunes nothing, even a gone path', () => {
  for (const bad of ['{not json', '[]', '{"deny":"x","denyWrite":7}']) {
    const name = 'lp-corrupt-' + bad.length;
    const dir = agentDir(name);
    const a = binDir(`corrupt${bad.length}/a/bin`);
    const b = binDir(`corrupt${bad.length}/b/bin`);
    setup.guardTokenOnlyFolder(dir, name, { ...BASE, panePath: [a, b].join(path.delimiter) });
    const rb = dirRule(b);
    fs.rmSync(b, { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'kosmos-launch-rules.json'), bad);
    assert.deepEqual(setup.guardTokenOnlyFolder(dir, name, { ...BASE, panePath: a }), { ok: true });
    assert.ok(readSettings(dir).permissions.deny.includes(rb), 'a corrupt record pruned a rule: ' + bad);
  }
});

test('#5663: the ceiling counts the Edit and Read deny paths too, by distinct prefix and by raw length, and turns at exactly each limit', () => {
  // Counting: both sandbox lists and the Edit/Read rule targets, each path once; a path adds what it does not share with
  // the one sorted before it.
  // Per clause (review 5): write = denyWrite + Edit targets, read = denyRead + Read targets; a path in both is paid twice.
  assert.deepEqual(setup.sandboxDenySize({ denyWrite: ['/ab/c', '/ab/d'] }, ['Edit(//ab/c/**)', 'Read(//x)', 'Bash(rm:*)']), { paths: 3, raw: 12, prefixes: 8 });
  assert.deepEqual(setup.sandboxDenySize({ denyWrite: ['/ab/c'], denyRead: ['/ab/c'] }, []), { paths: 2, raw: 10, prefixes: 10 });
  const dir = agentDir('lp-edge');
  setup.guardTokenOnlyFolder(dir, 'lp-edge', { ...BASE });
  const s0 = readSettings(dir);
  const z = setup.sandboxDenySize(s0.sandbox.filesystem, s0.permissions.deny);
  // '/Q...' sorts between paths that share only '/', so a path of length n adds n - 1 distinct characters and n raw.
  const withPaths = (ps) => { const t = readSettings(dir); t.permissions.deny = t.permissions.deny.filter((r) => !r.startsWith('Edit(//Q')).concat(ps.map((x) => `Edit(/${x})`)); fs.writeFileSync(settingsFile(dir), JSON.stringify(t)); return setup.guardTokenOnlyFolder(dir, 'lp-edge', { ...BASE }); };
  const P = setup.SANDBOX_DENY_PREFIX_MAX;
  assert.equal(P, 40 * 1024);
  assert.deepEqual(withPaths(['/Q' + 'q'.repeat(P - z.prefixes - 1)]), { ok: true }, 'at exactly the prefix limit');
  const over = withPaths(['/Q' + 'q'.repeat(P - z.prefixes)]);
  assert.equal(over.ok, true); assert.match(over.warning, new RegExp(`\\(${P + 1} distinct characters`));
  // Raw: many long paths that share all but their last few characters (they cost little in prefixes).
  const R = setup.SANDBOX_DENY_RAW_MAX;
  assert.equal(R, 160 * 1024);
  const rawSet = (extra) => {
    const need = R - z.raw + extra;
    const ps = [];
    const stem = '/Q' + 'q'.repeat(993) + '/';
    let left = need;
    for (let i = 0; left >= 2000; i++, left -= 1000) ps.push(stem + String(i).padStart(4, '0'));
    ps.push(stem + 'z'.repeat(left - stem.length));
    return ps;
  };
  assert.deepEqual(withPaths(rawSet(0)), { ok: true }, 'at exactly the raw limit');
  const overRaw = withPaths(rawSet(1));
  assert.equal(overRaw.ok, true); assert.match(overRaw.warning, new RegExp(`, ${R + 1} in all\\)`));
  assert.ok(Number(/\((\d+) distinct/.exec(overRaw.warning)[1]) < P, 'CONTROL: the raw arm turned it, not the prefix arm');
});

test('#5663 review 5: a real launch passes its PATH in KOSMOS_GUARD_PANE_PATH (as the supervisor does), and that is what lets it prune', () => {
  const dir = agentDir('lp-env');
  const v1 = binDir('envtool/1.0/bin');
  const v2 = binDir('envtool/2.0/bin');
  const run = (pane) => {
    if (pane === undefined) delete process.env.KOSMOS_GUARD_PANE_PATH; else process.env.KOSMOS_GUARD_PANE_PATH = pane;
    try { return setup.guardTokenOnlyFolder(dir, 'lp-env', { ...BASE }); } finally { delete process.env.KOSMOS_GUARD_PANE_PATH; }
  };
  assert.deepEqual(run(v1), { ok: true });
  const r1 = dirRule(v1);
  assert.ok(readSettings(dir).permissions.deny.includes(r1), 'CONTROL: the env PATH was read');
  fs.rmSync(path.join(SANDBOX, 'bins', 'envtool', '1.0'), { recursive: true });
  assert.deepEqual(run(undefined), { ok: true });
  assert.ok(readSettings(dir).permissions.deny.includes(r1), 'CONTROL: without it (a board start), nothing is pruned');
  assert.deepEqual(run(v2), { ok: true });
  assert.ok(!readSettings(dir).permissions.deny.includes(r1), 'a launch with the env PATH did not prune a gone folder');
});

test('#5663 review 7: a launch never prunes what only a board start wrote (an absent path on the board\'s own PATH, denied on purpose)', () => {
  const dir = agentDir('lp-asym');
  const absent = path.join(SANDBOX, 'bins', 'asym-not-made-yet', 'bin');   // never created: what is later made there would run
  const v = binDir('asym/1.0/bin');
  // The board starts with that folder on its PATH; the launch's inputs do not have it.
  setup.guardTokenOnlyFolder(dir, 'lp-asym', { ...BASE, ownPath: absent });
  const s1 = readSettings(dir);
  assert.ok(s1.permissions.deny.some((r) => r.includes('asym-not-made-yet')), 'CONTROL: the board start denied the absent folder: ' + s1.permissions.deny.filter((r) => r.includes('asym')).join(' '));
  const before = s1.permissions.deny.filter((r) => r.includes('asym-not-made-yet'));
  const beforeW = s1.sandbox.filesystem.denyWrite.filter((x) => x.includes('asym-not-made-yet'));
  setup.guardTokenOnlyFolder(dir, 'lp-asym', { ...BASE, panePath: v });
  setup.guardTokenOnlyFolder(dir, 'lp-asym', { ...BASE, panePath: v });
  const s2 = readSettings(dir);
  for (const r of before) assert.ok(s2.permissions.deny.includes(r), 'a launch pruned what only the board start wrote: ' + r);
  for (const x of beforeW) assert.ok(s2.sandbox.filesystem.denyWrite.includes(x), 'a launch pruned a board-start sandbox entry: ' + x);
});
