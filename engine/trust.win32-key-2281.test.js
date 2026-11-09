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
  assert.deepEqual(r.also, { key: fwd(f.short), madeEntry: true }, 'and the short one is reported apart, with what it displaced (nothing)');
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
  assert.deepEqual(r.also, { key: fwd(f.short), madeEntry: true });
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
  const r = trust.trustFolder(f.short, { configDir: f.cfgDir });
  assert.equal(r.ok, true, r.because || '');
  assert.deepEqual(r.also, { key: fwd(f.short), madeEntry: false, displaced: false });
  // forgetFolder reads CONFIG(), the default config, so point it at this one for the undo (as the rollback's caller does).
  const prev = process.env.AGENT_WORKFORCE_CLAUDE_CONFIG;
  process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = cfg;
  t.after(() => { process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = prev; });
  assert.equal(trust.recordWrite('undo-4260', { key: r.key, displaced: r.displaced, madeEntry: r.madeEntry, also: r.also }), true);
  const rec = trust.recordedWrite('undo-4260');
  assert.deepEqual(rec.also, { key: fwd(f.short), madeEntry: false, displaced: false }, 'the record keeps the second key in the same shape');
  const got = trust.forgetFolder(rec.key, 'displaced' in rec ? rec.displaced : undefined, rec.madeEntry === true, rec.also);
  assert.equal(got.ok, true, got.because || '');
  assert.deepEqual(readCfg(cfg).projects, { [fwd(f.short)]: { hasTrustDialogAccepted: false, allowedTools: ['y'] } },
    'the main entry we made is gone, and the short entry is back to the person\'s false with their tools');
  trust.dropRecord('undo-4260');
});

test('#4260 a relaunch that adds ONLY the second key joins it to the agent\'s record, so its removal takes both back', { skip: WIN }, (t) => {
  /* An agent made before this change: its record holds the main key only. Its next launch (win32launch) writes the short
     key and answers `already: true`, which no caller records; an 8.3 alias is reused by the next like-named folder, so
     an unrecorded line would outlive the agent and trust a stranger. */
  const f = shortFolder(t, 'relaunch'); if (!f) return;
  const cfg = nodePath.join(f.cfgDir, '.claude.json');
  fs.writeFileSync(cfg, JSON.stringify({ projects: { [fwd(f.long)]: { hasTrustDialogAccepted: true } } }));
  assert.equal(trust.recordWrite('relaunch-4260', { key: fwd(f.long), madeEntry: true }), true);
  t.after(() => trust.dropRecord('relaunch-4260'));
  // A default-account agent: the file its launch writes IS the file a removal edits (CONFIG()).
  const prev = process.env.AGENT_WORKFORCE_CLAUDE_CONFIG;
  process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = cfg;
  t.after(() => { process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = prev; });
  const r = trust.trustFolder(f.short, { configDir: f.cfgDir });
  assert.equal(r.already, true);
  assert.deepEqual(trust.recordedWrite('relaunch-4260').also, { key: fwd(f.short), madeEntry: true }, 'the record gained the second key');
  const rec = trust.recordedWrite('relaunch-4260');
  assert.equal(trust.forgetFolder(rec.key, 'displaced' in rec ? rec.displaced : undefined, rec.madeEntry === true, rec.also).ok, true);
  assert.deepEqual(readCfg(cfg).projects, {}, 'both lines Kosmos wrote are gone');
});

test('#4260 with no record for the main key (the person trusted it), the second key is written but claimed by nobody', { skip: WIN }, (t) => {
  const f = shortFolder(t, 'norecord'); if (!f) return;
  fs.writeFileSync(nodePath.join(f.cfgDir, '.claude.json'), JSON.stringify({ projects: { [fwd(f.long)]: { hasTrustDialogAccepted: true } } }));
  assert.equal(trust.recordWrite('someone-else-4260', { key: 'C:/elsewhere/entirely', madeEntry: true }), true);
  t.after(() => trust.dropRecord('someone-else-4260'));
  const r = trust.trustFolder(f.short, { configDir: f.cfgDir });
  assert.equal(r.already, true);
  assert.deepEqual(r.also, { key: fwd(f.short), madeEntry: true }, 'the second key WAS written, so the attach really had something to place');
  assert.equal('also' in trust.recordedWrite('someone-else-4260'), false, 'another agent\'s record is not touched');
});

test('#4260 a second key written into ANOTHER account\'s config is not attached: a removal edits the default one', { skip: WIN }, (t) => {
  const f = shortFolder(t, 'otheracct'); if (!f) return;
  fs.writeFileSync(nodePath.join(f.cfgDir, '.claude.json'), JSON.stringify({ projects: { [fwd(f.long)]: { hasTrustDialogAccepted: true } } }));
  assert.equal(trust.recordWrite('otheracct-4260', { key: fwd(f.long), madeEntry: true }), true);
  t.after(() => trust.dropRecord('otheracct-4260'));
  // CONFIG() stays the sandbox default (set at the top of this file), not f.cfgDir's file.
  const r = trust.trustFolder(f.short, { configDir: f.cfgDir });
  assert.deepEqual(r.also, { key: fwd(f.short), madeEntry: true }, 'written into that account');
  assert.equal('also' in trust.recordedWrite('otheracct-4260'), false, 'but not attached, so a removal cannot reach a same-spelled key in the default config');
});

test('#4260 a failed first start\'s undo of the second key ALONE leaves the person\'s main key untouched', { skip: WIN }, (t) => {
  /* engine/create.js, `already: true` with `also`: forgetFolder(also.key, ...) on its own. */
  const f = shortFolder(t, 'rollback'); if (!f) return;
  const cfg = nodePath.join(f.cfgDir, '.claude.json');
  fs.writeFileSync(cfg, JSON.stringify({ projects: { [fwd(f.long)]: { hasTrustDialogAccepted: true, allowedTools: ['z'] } } }));
  const prev = process.env.AGENT_WORKFORCE_CLAUDE_CONFIG;
  process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = cfg;
  t.after(() => { process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = prev; });
  const r = trust.trustFolder(f.short, { configDir: f.cfgDir });
  assert.equal(r.already, true);
  const a = r.also;
  assert.equal(trust.forgetFolder(a.key, 'displaced' in a ? a.displaced : undefined, a.madeEntry === true).ok, true);
  assert.deepEqual(readCfg(cfg).projects, { [fwd(f.long)]: { hasTrustDialogAccepted: true, allowedTools: ['z'] } });
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
  assert.match(create, /trusted\.already === true && trusted\.also[\s\S]{0,900}?forgetFolder\(a\.key, /, 'and rolls back the second key alone when the main one was the person\'s');
  assert.match(remove, /forgetFolder\(rec\.key, [^;]*rec\.madeEntry === true, rec\.also\)/, 'a removal takes it back');
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
