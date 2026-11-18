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

/* .native, the SAME call trustFolder keys on (#4257). The JS fs.realpathSync keeps a
   Windows 8.3 short name (os.tmpdir() is C:\Users\RUNNER~1\... on a GitHub runner) while
   .native expands it. The short-name arm below pins what the key is when a caller hands
   over the short spelling. */
const SANDBOX = fs.realpathSync.native(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'trust-win32key-2281-')));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, '.claude.json');
/* kosmos#4260: the record (trust-writes.json) lives under store.ROOT, which store freezes at first require, so the
   data root is sandboxed BEFORE trust is loaded: the record arm below must never write the real one. */
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');

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

/* kosmos#4260: an 8.3 SHORT spelling of a folder, asked of Windows itself (`%~sI`), so these arms run wherever the
   volume makes short names, not only where the temp folder happens to be short (it is on a GitHub runner, RUNNER~1;
   it is not on the Windows box). null when there is none (8.3 names turned off on the volume). */
function shortSpelling(p) {
  const r = require('node:child_process').spawnSync(process.env.ComSpec || 'cmd.exe',
    ['/d /s /c "for %I in ("' + p + '") do @echo %~sI"'], { windowsVerbatimArguments: true, encoding: 'utf8' });
  const s = String(r.stdout || '').trim();
  return s && s.toLowerCase() !== p.toLowerCase() && fs.existsSync(s) ? s : null;
}
const fwd = (p) => p.split(nodePath.sep).join('/');
/* A folder with a name long enough to have a short one, its long and short spellings, and a fresh config dir. */
function shortFolder(t, label) {
  const long = nodePath.join(SANDBOX, 'work', 'a-long-folder-name-' + label);
  fs.mkdirSync(long, { recursive: true });
  const short = shortSpelling(long);
  // On the Windows CI job the runner's own temp folder is 8.3 (RUNNER~1), so a missing short name there is a broken
  // probe, not a volume without them: fail rather than let every #4260 arm skip green.
  if (!short && process.env.GITHUB_ACTIONS) assert.fail('no 8.3 spelling for ' + long + ' on the CI runner, whose temp folder has one');
  if (!short) { t.skip('this volume makes no 8.3 short names'); return null; }
  return { long, short, cfgDir: fs.mkdtempSync(nodePath.join(SANDBOX, 'cfg-')) };
}
const WIN = process.platform !== 'win32' && 'an 8.3 short name exists only on Windows';

test('#4260 a folder handed over in its 8.3 SHORT spelling is keyed on BOTH spellings: the long native one and the short one Claude Code reads', { skip: WIN }, (t) => {
  /* Measured 11-09 (engine/trust.js runnerSpelling): Claude Code started in the short spelling showed the trust dialog
     with only the long key written, and read an entry written under the short one. #4257 had keyed on the long one only. */
  const f = shortFolder(t, 'both'); if (!f) return;
  const r = trust.trustFolder(f.short, { configDir: f.cfgDir, createIfAbsent: true });
  assert.equal(r.ok, true, r.because || '');
  assert.equal(r.already, false);
  assert.equal(r.key, fwd(f.long), 'the main key is still the long native spelling');
  assert.deepEqual(r.also, { key: fwd(f.short), madeEntry: true, forgettable: false },
    'and the short one is reported apart, with what it displaced (nothing); not forgettable: this account config is not the default one an undo edits');
  const projects = readCfg(nodePath.join(f.cfgDir, '.claude.json')).projects;
  assert.deepEqual(Object.keys(projects).sort(), [fwd(f.long), fwd(f.short)].sort());
  assert.equal(projects[fwd(f.short)].hasTrustDialogAccepted, true);
  assert.equal(trust.folderTrusted(f.short, { configDir: f.cfgDir }), true, 'and the read-only check asks the key the runner reads');
});

test('#4260 CONTROL: the long spelling, and a lowercased one, write only the main key (case is not what Claude Code misses)', { skip: WIN }, (t) => {
  const f = shortFolder(t, 'control'); if (!f) return;
  const r = trust.trustFolder(f.long, { configDir: f.cfgDir, createIfAbsent: true });
  assert.equal(r.ok, true, r.because || '');
  assert.equal('also' in r, false, 'no second key for the long spelling: the answer keeps its old shape');
  const lower = trust.trustFolder(f.long.toLowerCase(), { configDir: f.cfgDir, createIfAbsent: true });
  assert.equal(lower.already, true);
  assert.equal('also' in lower, false, 'a spelling that differs only in case adds nothing');
  assert.deepEqual(Object.keys(readCfg(nodePath.join(f.cfgDir, '.claude.json')).projects), [fwd(f.long)]);
});

test('#4260 only the main key trusted (as #4257 wrote it): the short start is reported untrusted, and trusting again adds the short key without claiming the main one', { skip: WIN }, (t) => {
  const f = shortFolder(t, 'upgrade'); if (!f) return;
  const cfg = nodePath.join(f.cfgDir, '.claude.json');
  fs.writeFileSync(cfg, JSON.stringify({ projects: { [fwd(f.long)]: { hasTrustDialogAccepted: true, allowedTools: ['x'] } } }));
  assert.equal(trust.folderTrusted(f.short, { configDir: f.cfgDir }), false, 'the runner would show the dialog, so it must not read as trusted');
  const r = trust.trustFolder(f.short, { configDir: f.cfgDir });
  assert.equal(r.ok, true, r.because || '');
  assert.equal(r.already, true, 'the main key was already true: callers record nothing, so a removal can never take the person\'s line');
  assert.deepEqual(r.also, { key: fwd(f.short), madeEntry: true, forgettable: false });
  const projects = readCfg(cfg).projects;
  assert.deepEqual(projects[fwd(f.long)], { hasTrustDialogAccepted: true, allowedTools: ['x'] }, 'the main entry is untouched');
  assert.equal(trust.folderTrusted(f.short, { configDir: f.cfgDir }), true);
  const again = trust.trustFolder(f.short, { configDir: f.cfgDir });
  assert.equal(again.already, true);
  assert.equal('also' in again, false, 'both already true: nothing written, nothing reported');
});

test('#4260 the undo takes back both keys and puts back exactly what each held, through the record a removal reads', { skip: WIN }, (t) => {
  const f = shortFolder(t, 'undo'); if (!f) return;
  const cfg = nodePath.join(f.cfgDir, '.claude.json');
  // The short key held the person's `false` and their tools; the main key held nothing.
  fs.writeFileSync(cfg, JSON.stringify({ projects: { [fwd(f.short)]: { hasTrustDialogAccepted: false, allowedTools: ['y'] } } }));
  // A default-account agent: the file its write goes to IS CONFIG(), the file every undo edits.
  const prev = process.env.AGENT_WORKFORCE_CLAUDE_CONFIG;
  process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = cfg;
  t.after(() => { process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = prev; });
  const r = trust.trustFolder(f.short, { configDir: f.cfgDir });
  assert.equal(r.ok, true, r.because || '');
  assert.deepEqual(r.also, { key: fwd(f.short), madeEntry: false, displaced: false, forgettable: true });
  assert.equal(trust.recordWrite('undo-4260', { key: r.key, displaced: r.displaced, madeEntry: r.madeEntry, also: r.also }), true);
  const rec = trust.recordedWrite('undo-4260');
  assert.deepEqual(rec.also, { key: fwd(f.short), madeEntry: false, displaced: false }, 'the record keeps the second key in the same shape');
  const got = trust.forgetFolder(rec.key, 'displaced' in rec ? rec.displaced : undefined, rec.madeEntry === true, rec.also);
  assert.equal(got.ok, true, got.because || '');
  assert.deepEqual(readCfg(cfg).projects, { [fwd(f.short)]: { hasTrustDialogAccepted: false, allowedTools: ['y'] } },
    'the main entry we made is gone, and the short entry is back to the person\'s false with their tools');
  trust.dropRecord('undo-4260');
});

/* kosmos#8322: the default account's config is CONFIG(), the file every undo edits, so these arms point it at the
   folder's own config for the test and put it back after. */
function asDefaultConfig(t, cfgDir) {
  const prev = process.env.AGENT_WORKFORCE_CLAUDE_CONFIG;
  const cfg = nodePath.join(cfgDir, '.claude.json');
  process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = cfg;
  t.after(() => { process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = prev; });
  return cfg;
}

test('#4260 #8322 a second key added when the main one was ALREADY true goes on the also-record, never on the main record, and only it is taken back', { skip: WIN }, (t) => {
  /* The main key the person trusted (or an older agent relaunching) answers `already: true`, so the main record is
     never written: the person's line is never claimed. Before #8322 the short line was then recorded nowhere. */
  const f = shortFolder(t, 'residual'); if (!f) return;
  const cfg = asDefaultConfig(t, f.cfgDir);
  fs.writeFileSync(cfg, JSON.stringify({ projects: { [fwd(f.long)]: { hasTrustDialogAccepted: true, allowedTools: ['x'] } } }));
  assert.equal(trust.recordWrite('residual-8322', { key: fwd(f.long), madeEntry: true }), true);
  t.after(() => { trust.dropRecord('residual-8322'); trust.dropAlsoRecord('residual-8322'); });
  const r = trust.trustFolder(f.short, {});
  assert.equal(r.already, true);
  assert.deepEqual(r.also, { key: fwd(f.short), madeEntry: true, forgettable: true });

  assert.equal(trust.recordAlsoWrite('residual-8322', r), true);
  const rec = trust.recordedWrite('residual-8322');
  assert.equal(rec.key, fwd(f.long), 'the main record still names only what it named');
  assert.equal('also' in rec, false, 'and it does not gain the line: an older engine reads that record as the main key ours');
  const also = trust.recordedAlsoWrite('residual-8322');
  assert.deepEqual(also.also, { key: fwd(f.short), madeEntry: true }, 'the line is on the also-record, in its undo shape');
  assert.equal(also.config, cfg, 'and names the config file it went into');

  const got = trust.forgetAlso(also.also, also.config);
  assert.deepEqual(got, { ok: true, already: false });
  assert.deepEqual(readCfg(cfg).projects, { [fwd(f.long)]: { hasTrustDialogAccepted: true, allowedTools: ['x'] } },
    'the short line we made is gone, and the person\'s main line is exactly as they left it');
  assert.deepEqual(trust.forgetAlso(also.also), { ok: true, already: true }, 'a second take-back finds nothing of ours');
});

test('#8322 only an already-true answer with a forgettable second key is recorded', { skip: WIN }, (t) => {
  const f = shortFolder(t, 'gate'); if (!f) return;
  const cfg = asDefaultConfig(t, f.cfgDir);
  t.after(() => trust.dropAlsoRecord('gate-8322'));
  fs.writeFileSync(cfg, JSON.stringify({ projects: {} }));
  const fresh = trust.trustFolder(f.short, {});
  assert.equal(fresh.already, false);
  assert.equal(trust.recordAlsoWrite('gate-8322', fresh), false, 'already false: the main record carries the line (create.js), never twice');
  const both = trust.trustFolder(f.short, {});
  assert.equal(trust.recordAlsoWrite('gate-8322', both), false, 'nothing new was written');
  const other = shortFolder(t, 'gate-other'); if (!other) return;
  fs.writeFileSync(nodePath.join(other.cfgDir, '.claude.json'), JSON.stringify({ projects: { [fwd(other.long)]: { hasTrustDialogAccepted: true } } }));
  const elsewhere = trust.trustFolder(other.short, { configDir: other.cfgDir });
  assert.equal(elsewhere.also.forgettable, false);
  assert.equal(trust.recordAlsoWrite('gate-8322', elsewhere), false, 'another account\'s config: an undo would edit CONFIG(), so never recorded');
  assert.equal(trust.recordAlsoWrite('', { ok: true, already: true, also: { key: fwd(f.short), madeEntry: true } }), false, 'no name, no record');
  assert.equal(trust.recordedAlsoWrite('gate-8322'), null);
});

test('#8322 the first write of a key is kept, a new key replaces it, and a line no longer true is left', { skip: WIN }, (t) => {
  const f = shortFolder(t, 'first'); if (!f) return;
  const cfg = asDefaultConfig(t, f.cfgDir);
  t.after(() => trust.dropAlsoRecord('first-8322'));
  const ans = (displaced) => ({ ok: true, already: true, key: fwd(f.long),
    also: Object.assign({ key: fwd(f.short), madeEntry: displaced === undefined, forgettable: true }, displaced === undefined ? {} : { displaced }) });
  assert.equal(trust.recordAlsoWrite('first-8322', ans(undefined)), true);
  assert.equal(trust.recordAlsoWrite('first-8322', ans(false)), true);
  assert.deepEqual(trust.recordedAlsoWrite('first-8322').also, { key: fwd(f.short), madeEntry: true }, 'the first write holds what was there before Kosmos');
  const moved = { ok: true, already: true, key: fwd(f.long), also: { key: 'Z:/elsewhere', madeEntry: true, forgettable: true } };
  assert.equal(trust.recordAlsoWrite('first-8322', moved), true);
  assert.equal(trust.recordedAlsoWrite('first-8322').also.key, 'Z:/elsewhere', 'a different spelling replaces it');

  fs.writeFileSync(cfg, JSON.stringify({ projects: { [fwd(f.short)]: { hasTrustDialogAccepted: false } } }));
  assert.deepEqual(trust.forgetAlso({ key: fwd(f.short), madeEntry: true }), { ok: true, already: true });
  assert.deepEqual(readCfg(cfg).projects, { [fwd(f.short)]: { hasTrustDialogAccepted: false } }, 'a line that no longer says yes is the person\'s now');
  fs.writeFileSync(cfg, JSON.stringify({ projects: { [fwd(f.short)]: 'not an object' } }));
  assert.deepEqual(trust.forgetAlso({ key: fwd(f.short), madeEntry: true }), { ok: true, already: true }, 'an entry we cannot read is left, and never a red step forever');
  fs.writeFileSync(cfg, JSON.stringify({ projects: { [fwd(f.short)]: { hasTrustDialogAccepted: true } } }));
  assert.deepEqual(trust.forgetAlso({ key: fwd(f.short), madeEntry: true, forgettable: false }), { ok: true, already: true }, 'not ours to take back');
  assert.deepEqual(readCfg(cfg).projects, { [fwd(f.short)]: { hasTrustDialogAccepted: true } }, 'and a line it could have taken is still there');
  const other = nodePath.join(f.cfgDir, 'another.claude.json');
  fs.writeFileSync(other, JSON.stringify({ projects: { [fwd(f.short)]: { hasTrustDialogAccepted: true }, keep: { a: 1 } } }));
  assert.deepEqual(trust.forgetAlso({ key: fwd(f.short), madeEntry: true }, other), { ok: true, already: false },
    'recorded against another config file than this process\'s CONFIG(): the take-back edits the recorded file');
  assert.deepEqual(readCfg(other).projects, { keep: { a: 1 } }, 'the line is gone from the file the record names, the rest kept');
  assert.deepEqual(readCfg(cfg).projects, { [fwd(f.short)]: { hasTrustDialogAccepted: true } }, 'and this process\'s CONFIG() is untouched');
  assert.deepEqual(trust.forgetAlso({ key: fwd(f.short), madeEntry: true }, 'relative.json'), { ok: true, already: true }, 'a recorded file that is not absolute is left');
  assert.deepEqual(trust.forgetAlso({ key: fwd(f.short), madeEntry: true }, cfg), { ok: true, already: false }, 'CONTROL: the same call against this file takes it');
  fs.rmSync(cfg);
  assert.deepEqual(trust.forgetAlso({ key: fwd(f.short), madeEntry: true }), { ok: true, already: true }, 'no config at all: nothing of ours, never a red step forever');
});

test('#4260 a second-key entry we cannot read is left alone: the launch still trusts the main key, and an undo still takes it back', { skip: WIN }, (t) => {
  const f = shortFolder(t, 'unreadable'); if (!f) return;
  const cfg = nodePath.join(f.cfgDir, '.claude.json');
  fs.writeFileSync(cfg, JSON.stringify({ projects: { [fwd(f.short)]: 'not an object' } }));
  const r = trust.trustFolder(f.short, { configDir: f.cfgDir });
  assert.equal(r.ok, true, r.because || '');
  assert.equal('also' in r, false, 'nothing written under the key we could not read');
  assert.equal(readCfg(cfg).projects[fwd(f.short)], 'not an object', 'and it is untouched');
  assert.equal(readCfg(cfg).projects[fwd(f.long)].hasTrustDialogAccepted, true);
  const prev = process.env.AGENT_WORKFORCE_CLAUDE_CONFIG;
  process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = cfg;
  t.after(() => { process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = prev; });
  const got = trust.forgetFolder(r.key, r.displaced, r.madeEntry, { key: fwd(f.short), madeEntry: true });
  assert.equal(got.ok, true, got.because || '');
  assert.deepEqual(readCfg(cfg).projects, { [fwd(f.short)]: 'not an object' }, 'the main key we made is gone; the unreadable one is left');
});

test('#4260 the callers carry the second key: creation records it and rolls it back, removal takes it back', () => {
  /* Read from the source: the record and undo arms above drive trust.js itself, and these three call sites are the
     only places `also` crosses into it. Dropping it at any of them is the regression this pins. */
  const create = fs.readFileSync(nodePath.join(__dirname, 'create.js'), 'utf8');
  const remove = fs.readFileSync(nodePath.join(__dirname, 'remove.js'), 'utf8');
  assert.match(create, /recordWrite\(name, \{[^}]*also: trusted\.also/, 'creation records the second key');
  assert.match(create, /forgetFolder\(trusted\.key, trusted\.displaced, trusted\.madeEntry, trusted\.also\)/, 'a failed start rolls it back');
  assert.match(remove, /forgetFolder\(rec\.key, [^;]*rec\.madeEntry === true, rec\.also\)/, 'a removal takes it back');
  /* kosmos#8322: the also-record's crossings: a launch records it, creation replaces any previous incarnation's and
     rolls a failed start's back, a removal takes it back and drops it only after. */
  const w32 = fs.readFileSync(nodePath.join(__dirname, 'win32launch.js'), 'utf8');
  assert.equal((w32.match(/recordShortTrust\(s, trusted\);/g) || []).length, 2, 'both the Windows launch and resume record it');
  const drop = create.search(/if \(!DRY_RUN\) \{\s*try \{ require\('\.\/trust'\)\.dropAlsoRecord\(name\); \}/);
  const start = create.indexOf('win32Launched = win32StartViaJob(name');
  const rec = create.indexOf("require('./trust').recordAlsoWrite(name, trusted)");
  assert.ok(drop > 0 && start > drop && rec > start, 'creation drops a previous incarnation\'s entry before the agent starts, and records its own after');
  assert.match(create, /forgetAlso\(trusted\.also\)/, 'a failed start takes back only the second key');
  assert.match(remove, /forgetAlso\(alsoRec\.also, alsoRec\.config\)[\s\S]*?if \(gaveBackAlso && !\(DRY_RUN && !runner\)\)[\s\S]*?dropAlsoRecord\(clean\)/, 'a removal takes it back, then drops the record');
});

test('#4260 a second key marked NOT forgettable (another account\'s config) is never undone or recorded here', () => {
  /* Built from plain paths so it runs anywhere: what matters is the flag, which trustFolder sets per write. */
  const cfgDir = fs.mkdtempSync(nodePath.join(SANDBOX, 'cfg-'));
  const cfg = nodePath.join(cfgDir, '.claude.json');
  const main = fwd(nodePath.join(SANDBOX, 'work', 'nf-main'));
  const other = fwd(nodePath.join(SANDBOX, 'work', 'nf-other'));
  fs.writeFileSync(cfg, JSON.stringify({ projects: { [main]: { hasTrustDialogAccepted: true }, [other]: { hasTrustDialogAccepted: true } } }));
  const prev = process.env.AGENT_WORKFORCE_CLAUDE_CONFIG;
  process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = cfg;
  try {
    const got = trust.forgetFolder(main, undefined, true, { key: other, madeEntry: true, forgettable: false });
    assert.equal(got.ok, true, got.because || '');
    assert.deepEqual(readCfg(cfg).projects, { [other]: { hasTrustDialogAccepted: true } }, 'the main key we made is gone; the not-forgettable one is left as it is');
    assert.equal(trust.recordWrite('nf-4260', { key: main, madeEntry: true, also: { key: other, madeEntry: true, forgettable: false } }), true);
    assert.equal('also' in trust.recordedWrite('nf-4260'), false, 'and a record never keeps it for a removal to reach');
    trust.dropRecord('nf-4260');
  } finally { process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = prev; }
});

test('#4260 an undo with no second key, or a damaged one, takes back the main key exactly as before', () => {
  const cfgDir = fs.mkdtempSync(nodePath.join(SANDBOX, 'cfg-'));
  const cfg = nodePath.join(cfgDir, '.claude.json');
  const work = nodePath.join(SANDBOX, 'work', 'plain-undo');
  fs.mkdirSync(work, { recursive: true });
  const prev = process.env.AGENT_WORKFORCE_CLAUDE_CONFIG;
  process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = cfg;
  try {
    for (const also of [undefined, null, 'C:/not-an-object', { key: 7 }, { key: 'relative/path', madeEntry: true }]) {
      const r = trust.trustFolder(work, { configDir: cfgDir, createIfAbsent: true });
      assert.equal(r.ok, true, r.because || '');
      const got = trust.forgetFolder(r.key, r.displaced, r.madeEntry, also);
      assert.equal(got.ok, true, JSON.stringify(also) + ': ' + (got.because || ''));
      assert.deepEqual(readCfg(cfg).projects, {}, JSON.stringify(also) + ': the main entry we made is gone and nothing else touched');
    }
  } finally { process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = prev; }
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
