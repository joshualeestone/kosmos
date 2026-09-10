'use strict';

// Both sandbox knobs BEFORE any require, travelling together per #527:
// accounts resolves HOME through AGENT_WORKFORCE_HOME at module load, and
// store resolves its root from AGENT_WORKFORCE_DATA the same way.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-reporthook-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');

const test = require('node:test');
const assert = require('node:assert/strict');
const reporthook = require('./reporthook');
const accounts = require('./accounts');

const SCRIPT = path.join(SANDBOX, 'kosmos-report-hook.sh');
fs.writeFileSync(SCRIPT, '#!/bin/bash\nexit 0\n', { mode: 0o755 });

let n = 0;
const fresh = () => path.join(fs.mkdtempSync(path.join(SANDBOX, 'case-')), `settings${n++}.json`);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const oursIn = (data, event) => (data.hooks[event] || []).filter(reporthook.entryIsOurs).length;

test('an absent settings.json is born with all seven events wired', () => {
  const p = fresh();
  const got = reporthook.ensureWired(p, SCRIPT);
  assert.equal(got.wired, true);
  assert.equal(got.changed, true);
  const data = readJson(p);
  for (const ev of reporthook.HOOK_EVENTS) {
    assert.equal(oursIn(data, ev), 1, ev + ' is not wired');
  }
});

test('merge, never clobber: existing settings and existing hooks survive untouched', () => {
  const p = fresh();
  fs.writeFileSync(p, JSON.stringify({
    model: 'opus',
    permissions: { allow: ['Bash(git *)'] },
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bash somebody-elses-gate.sh' }] }] },
  }));
  const got = reporthook.ensureWired(p, SCRIPT);
  assert.equal(got.wired, true);
  const data = readJson(p);
  assert.equal(data.model, 'opus');
  assert.deepEqual(data.permissions.allow, ['Bash(git *)']);
  assert.equal(data.hooks.PreToolUse[0].hooks[0].command, 'bash somebody-elses-gate.sh',
    'the pre-existing hook was displaced rather than kept first');
  assert.equal(oursIn(data, 'PreToolUse'), 1);
});

test('idempotent: a second call changes nothing and doubles nothing', () => {
  const p = fresh();
  reporthook.ensureWired(p, SCRIPT);
  const again = reporthook.ensureWired(p, SCRIPT);
  assert.equal(again.wired, true);
  assert.equal(again.changed, false);
  const data = readJson(p);
  for (const ev of reporthook.HOOK_EVENTS) assert.equal(oursIn(data, ev), 1, ev + ' is doubled');
});

test('a partial wiring is completed, not restarted: hand-installed events keep their one entry', () => {
  const p = fresh();
  fs.writeFileSync(p, JSON.stringify({
    hooks: { SessionStart: [reporthook.entryFor('/some/older/path/kosmos-report-hook.sh')] },
  }));
  const got = reporthook.ensureWired(p, SCRIPT);
  assert.equal(got.changed, true);
  const data = readJson(p);
  assert.equal(oursIn(data, 'SessionStart'), 1, 'the hand-installed entry was doubled');
  assert.match(data.hooks.SessionStart[0].hooks[0].command, /older/, 'the hand-installed entry was replaced');
  assert.equal(oursIn(data, 'SessionEnd'), 1, 'the missing events were not completed');
});

test('an unparseable settings file is left alone, with a sentence', () => {
  const p = fresh();
  fs.writeFileSync(p, '{ this is not json');
  const got = reporthook.ensureWired(p, SCRIPT);
  assert.equal(got.wired, false);
  assert.match(got.because, /left alone/);
  assert.equal(fs.readFileSync(p, 'utf8'), '{ this is not json', 'the file was touched anyway');
});

test('a tightened file mode survives the merge: 0600 stays 0600', () => {
  const p = fresh();
  fs.writeFileSync(p, '{}', { mode: 0o600 });
  reporthook.ensureWired(p, SCRIPT);
  assert.equal(fs.statSync(p).mode & 0o7777, 0o600);
});

test('no script on the machine refuses in a sentence rather than wiring a command that cannot run', () => {
  const got = reporthook.ensureWired(fresh(), null);
  assert.equal(got.wired, false);
  assert.match(got.because, /not on this machine/);
});

test('accounts.prepare births an account with its hooks wired, and says so', () => {
  const got = accounts.prepare('hooktest');
  assert.equal(got.ok, true);
  assert.equal(got.hooksWired, true, 'prepare did not report the wiring: ' + JSON.stringify(got));
  const data = readJson(path.join(got.dir, 'settings.json'));
  for (const ev of reporthook.HOOK_EVENTS) assert.equal(oursIn(data, ev), 1, ev + ' missing from the born account');
});

test('prepare on a dir that already has settings keeps them: the merge posture holds at birth too', () => {
  const dir = path.join(SANDBOX, '.claude-keepme');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ model: 'sonnet' }));
  const got = accounts.prepare('keepme');
  assert.equal(got.ok, true);
  const data = readJson(path.join(dir, 'settings.json'));
  assert.equal(data.model, 'sonnet', 'prepare clobbered a real settings file');
  assert.equal(oursIn(data, 'SessionStart'), 1);
});

test('hookScriptPath finds the source-checkout script from the engine directory', () => {
  const found = reporthook.hookScriptPath();
  assert.ok(found && found.endsWith('kosmos-report-hook.sh'),
    'the probe found nothing; the script beside install/kosmos is missing');
  assert.ok(fs.existsSync(found));
});

test('a script path carrying shell-special characters is refused, not embedded in a command', () => {
  const evil = path.join(SANDBOX, 'x"y', 'kosmos-report-hook.sh');
  const got = reporthook.ensureWired(fresh(), evil);
  assert.equal(got.wired, false);
  assert.match(got.because, /will not embed/);
});

// #1582: a release cut resolves an app/bin/kosmos-report-hook.sh that genuinely
// exists inside its temp sandbox, and the naive fix persisted that ephemeral path
// into the DURABLE shared ~/.claude/settings.json, killing reporting for every
// agent on the box. The refusal must fire on the RESOLVED /private/var/... form
// (os.tmpdir() returns the unresolved /var/... form; a startsWith(os.tmpdir())
// guard never fires on the path that actually reaches a settings file), and only
// when the settings file itself is durable.
const RESOLVED_TMP = (() => { try { return fs.realpathSync(os.tmpdir()); } catch { return os.tmpdir(); } })();
// A durable (non-temp) settings path; the refusal returns BEFORE any file access,
// so nothing is created here.
const DURABLE_SETTINGS = path.join(path.sep, 'nonexistent-durable-1582', 'settings.json');

test('#1582: a temp-root script into a durable settings file is refused, in BOTH the raw and resolved forms', () => {
  // Exercise both roots the guard checks. On macOS os.tmpdir() (/var/folders/...)
  // and its realpath (/private/var/folders/...) DIFFER, so the resolved form
  // catches a reintroduced raw-only comparison (the documented trap) and the raw
  // form catches a resolved-only one. On Linux they coincide, so only one branch
  // is distinct there, but both assertions still hold.
  const forms = [
    path.join(os.tmpdir(), 'tmp.FAKE1582raw', 'home', 'app', 'bin', 'kosmos-report-hook.sh'),
    path.join(RESOLVED_TMP, 'tmp.FAKE1582res', 'home', 'app', 'bin', 'kosmos-report-hook.sh'),
  ];
  for (const dead of forms) {
    const got = reporthook.ensureWired(DURABLE_SETTINGS, dead);
    assert.equal(got.wired, false, dead);
    assert.match(got.because, /temp root|ephemeral/);
  }
});

test('#1582 fail-soft: a null/undefined settingsPath does not throw (the module never throws for an expected shape)', () => {
  const dead = path.join(RESOLVED_TMP, 'tmp.FAKE1582null', 'home', 'app', 'bin', 'kosmos-report-hook.sh');
  // Before the guard, underRoot(settingsPath) called .startsWith on null and threw.
  assert.doesNotThrow(() => reporthook.ensureWired(null, dead));
  assert.doesNotThrow(() => reporthook.ensureWired(undefined, dead));
});

test('#1582 control: a non-temp (installed) script is never refused as temp-rooted', () => {
  // scriptEphemeral is false for a non-temp path, so the refusal cannot fire
  // regardless of the settings file's durability. (The durable-settings arm is
  // exercised by the raw+resolved test above and the refinement test below; this
  // control proves only that the guard does not over-fire on a normal path.)
  const installed = path.join(os.homedir(), '.local', 'share', 'kosmos', 'bin', 'kosmos-report-hook.sh');
  const got = reporthook.ensureWired(fresh(), installed);
  assert.equal(got.wired, true, 'a non-temp script must wire, proving the temp guard does not over-fire');
});

test('#1582 refinement: an ephemeral script in an ephemeral settings file is NOT a mismatch and still wires', () => {
  // Both under the temp sandbox (the test fixtures already do this); the durable
  // vs ephemeral distinction is what keeps the refusal from breaking test isolation.
  const ephemeralScript = path.join(SANDBOX, 'kosmos-report-hook.sh'); // under temp, exists
  const got = reporthook.ensureWired(fresh(), ephemeralScript);
  assert.equal(got.wired, true);
});

// ---------------------------------------------------------------------------
// #561/#1467: an entry of ours pointing at the WRONG COPY is not "already wired"
// ---------------------------------------------------------------------------

/* 🛑 MEASURED ON THE REAL MACHINE, 2026-08-29. Seven live entries pointed at a
   hand-placed copy of the script in ~/.claude/hooks/user dated Aug 26, and
   `ensureWired` answered {wired: true, changed: false} against them: SUCCESS,
   having changed nothing, for a script it had never seen.

   `entryIsOurs` matches the FILENAME, and every copy of the script carries the
   filename. So the product's self-healing path could not heal the one thing it
   exists to heal, and reported that it had. `setup.sh` re-runs this on every
   update, which is why a stale hook survived all of them. */

const STALE = path.join(SANDBOX, 'elsewhere', 'kosmos-report-hook.sh');
const staleEntry = () => ({
  matcher: '',
  hooks: [{ type: 'command', command: 'bash "' + STALE + '"', timeout: 15 }],
});

test('#1467: an entry aimed at another copy of the script is REPOINTED, not skipped', () => {
  const p = fresh();
  const hooks = {};
  for (const e of reporthook.HOOK_EVENTS) hooks[e] = [staleEntry()];
  fs.writeFileSync(p, JSON.stringify({ hooks }));

  const got = reporthook.ensureWired(p, SCRIPT);
  assert.equal(got.wired, true);
  assert.equal(got.changed, true, 'it reported success while changing nothing, which is the whole defect');

  const data = readJson(p);
  const all = JSON.stringify(data);
  assert.equal(all.includes(STALE), false, 'a stale copy is still wired, so an update cannot fix a machine');
  for (const e of reporthook.HOOK_EVENTS) {
    assert.equal(oursIn(data, e), 1, `event ${e} should carry exactly one entry of ours`);
    assert.equal(data.hooks[e][0].hooks[0].command.includes(SCRIPT), true, `event ${e} points at the wrong script`);
  }
});

test('#1467: repointing is IDEMPOTENT, so a second update is a no-op', () => {
  const p = fresh();
  const hooks = {};
  for (const e of reporthook.HOOK_EVENTS) hooks[e] = [staleEntry()];
  fs.writeFileSync(p, JSON.stringify({ hooks }));

  reporthook.ensureWired(p, SCRIPT);
  const after1 = fs.readFileSync(p, 'utf8');
  const got2 = reporthook.ensureWired(p, SCRIPT);
  assert.equal(got2.changed, false, 'a settings file already correct must not be rewritten');
  assert.equal(fs.readFileSync(p, 'utf8'), after1);
});

test('#1467 CONTROL: somebody else hook in the same event survives repointing', () => {
  // Without this, "replace our entries" could quietly become "replace the list".
  const p = fresh();
  const theirs = { matcher: '', hooks: [{ type: 'command', command: 'bash /somebody/else/thing.sh' }] };
  fs.writeFileSync(p, JSON.stringify({ hooks: { SessionStart: [theirs, staleEntry()] } }));

  reporthook.ensureWired(p, SCRIPT);
  const data = readJson(p);
  const cmds = data.hooks.SessionStart.map((e) => e.hooks[0].command);
  assert.equal(cmds.filter((c) => c.includes('/somebody/else/thing.sh')).length, 1,
    'a hook that is not ours was destroyed by repointing');
  assert.equal(cmds.some((c) => c.includes(SCRIPT)), true);
  assert.equal(cmds.some((c) => c.includes(STALE)), false);
});

// ---- #570: the native-win32 branch (platform injected, so it runs on the Mac) ----

const WIN_NODE = 'C:\\Program Files\\Kosmos\\runtime\\node.exe';
const WIN_SCRIPT = 'C:\\Program Files\\Kosmos\\app\\engine\\kosmos-report-hook.js';

test('#570 entryFor: win32 is EXEC form (command=node.exe, args=[script], no shell); darwin stays bash shell form', () => {
  const win = reporthook.entryFor(WIN_SCRIPT, { platform: 'win32', node: WIN_NODE });
  // Exec form: command is the bare node executable, the script is a verbatim arg,
  // and NO shell string is built -- this is what makes the win32 hook fire the
  // same whether Git Bash is present or PowerShell is the fallback (#570).
  assert.equal(win.hooks[0].command, WIN_NODE, 'win32 command must be the bare node executable');
  assert.deepEqual(win.hooks[0].args, [WIN_SCRIPT], 'win32 must pass the script as a verbatim arg');
  // Guard against a silent regression to shell form: the command must NOT embed
  // the script path, and must NOT be a leading-quoted "<node>" "<script>" string
  // (the node path itself may legitimately contain spaces, e.g. Program Files).
  assert.ok(!win.hooks[0].command.includes(WIN_SCRIPT), 'win32 command must not embed the script (that is the shell form)');
  assert.ok(!win.hooks[0].command.startsWith('"'), 'win32 command must not be a quoted shell-form string');
  const mac = reporthook.entryFor('/app/engine/kosmos-report-hook.sh', { platform: 'darwin' });
  assert.equal(mac.hooks[0].command, 'bash "/app/engine/kosmos-report-hook.sh"');
  assert.equal(mac.hooks[0].args, undefined, 'posix stays shell form (no args)');
});

test('#570 hookScriptPath: win32 returns the .js entry beside this module; posix returns the .sh', () => {
  // The .js entry ships in engine/ (source) and app/engine/ (installed); on this
  // source checkout it sits beside reporthook.js, so the win32 probe finds it.
  const js = reporthook.hookScriptPath('win32');
  assert.ok(js && js.endsWith('kosmos-report-hook.js'), 'win32 did not resolve the node hook: ' + js);
  const sh = reporthook.hookScriptPath('linux');
  assert.ok(sh && sh.endsWith('kosmos-report-hook.sh'), 'posix did not resolve the bash hook: ' + sh);
});

test('#570 unsafeForCommand: backslash is a normal separator on win32 but dangerous in sh', () => {
  // The whole reason the guard is platform-specific: a Windows path is all backslashes.
  assert.equal(reporthook.unsafeForCommand(WIN_SCRIPT, 'win32'), false, 'a normal Windows path was refused');
  assert.equal(reporthook.unsafeForCommand('C:\\a\\b.js', 'linux'), true, 'sh must refuse a backslash');
  // The win32 set (["%$`\r\n]) is kept UNCHANGED after the #570 exec-form change.
  // In exec form the path is passed verbatim as an argv element with no shell, so
  // these refusals are defensive/over-refusal (a rare real path with one of these
  // degrades to scraping) rather than load-bearing injection defense. Pinned so a
  // future edit that relaxes the win32 set is a deliberate, reviewed change.
  assert.equal(reporthook.unsafeForCommand('C:\\a"b.js', 'win32'), true);
  assert.equal(reporthook.unsafeForCommand('C:\\a%PATH%b.js', 'win32'), true);
  assert.equal(reporthook.unsafeForCommand('C:\\a`b.js', 'win32'), true, 'backtick stays refused (over-refusal, safe direction)');
  assert.equal(reporthook.unsafeForCommand('C:\\a$env.js', 'win32'), true, '$ stays refused (over-refusal, safe direction)');
  assert.equal(reporthook.unsafeForCommand('/a/b$x.sh', 'linux'), true);
  assert.equal(reporthook.unsafeForCommand('/a/b.sh', 'linux'), false);
  // Shell metacharacters that the win32 set does NOT refuse must stay allowed --
  // especially `()`, since C:\Program Files (x86)\ is a normal path and refusing
  // it would break the common case. In exec form these are inert because no shell
  // parses the arg at all (not because quotes protect them, which was the old
  // shell-form framing); the point that survives is that they must not be refused.
  assert.equal(reporthook.unsafeForCommand('C:\\Program Files (x86)\\Kosmos\\app\\engine\\kosmos-report-hook.js', 'win32'), false,
    'the Program Files (x86) path must be allowed');
  assert.equal(reporthook.unsafeForCommand('C:\\a&b^c|d<e>f.js', 'win32'), false,
    'shell metacharacters outside the win32 set must not be refused');
  // A raw CR/LF is refused on BOTH platforms (line-oriented parsing can break out
  // of even a quoted argument); no legitimate hook path contains one.
  assert.equal(reporthook.unsafeForCommand('C:\\a\nb.js', 'win32'), true, 'a newline must be refused on win32');
  assert.equal(reporthook.unsafeForCommand('/a/b\rc.sh', 'linux'), true, 'a carriage return must be refused in sh');
  assert.equal(reporthook.unsafeForCommand(null, 'win32'), true, 'a non-string is unsafe, not a throw');
});

test('#570 ensureWired win32: all seven events wired with the node.exe EXEC-form entry', () => {
  const p = fresh();
  const r = reporthook.ensureWired(p, WIN_SCRIPT, { platform: 'win32', node: WIN_NODE });
  assert.equal(r.wired, true);
  const data = readJson(p);
  for (const event of reporthook.HOOK_EVENTS) {
    assert.equal(oursIn(data, event), 1, 'event ' + event + ' not wired once');
    assert.equal(data.hooks[event][0].hooks[0].command, WIN_NODE, 'event ' + event + ' command must be bare node.exe');
    assert.deepEqual(data.hooks[event][0].hooks[0].args, [WIN_SCRIPT], 'event ' + event + ' args must be [script]');
  }
  // Idempotent: a second run changes nothing.
  const r2 = reporthook.ensureWired(p, WIN_SCRIPT, { platform: 'win32', node: WIN_NODE });
  assert.equal(r2.wired, true);
  assert.equal(r2.changed, false, 'a second win32 wiring run must be a no-op');
});

test('#570 ensureWired win32 migration: an OLD shell-form entry is repointed to exec form, not doubled', () => {
  // End-to-end migration: a machine carrying the pre-exec-form win32 hook must be
  // recognized as ours and REPLACED with exec form, leaving exactly one entry per
  // event. NOTE this arm does NOT prove the full-shape sameHook: the old shell-form
  // command differs from the bare-node target, so it repoints under a command-only
  // check too. The sameHook args-comparison is pinned by the separate stale-exec-form
  // non-vacuity test below; entryIsOurs(args) recognition is pinned by the MARKER test.
  const oldShellForm = '"' + WIN_NODE + '" "' + WIN_SCRIPT + '"';
  const data = { hooks: {} };
  for (const e of reporthook.HOOK_EVENTS) {
    data.hooks[e] = [{ matcher: '', hooks: [{ type: 'command', command: oldShellForm, timeout: 15 }] }];
  }
  const p = fresh();
  fs.writeFileSync(p, JSON.stringify(data));
  const r = reporthook.ensureWired(p, WIN_SCRIPT, { platform: 'win32', node: WIN_NODE });
  assert.equal(r.wired, true);
  assert.equal(r.changed, true, 'the old shell-form entry must be repointed (changed)');
  const out = readJson(p);
  for (const e of reporthook.HOOK_EVENTS) {
    assert.equal(oursIn(out, e), 1, 'event ' + e + ' must have exactly one of ours (repointed, not doubled)');
    assert.equal(out.hooks[e][0].hooks[0].command, WIN_NODE, 'event ' + e + ' was not repointed to exec form');
    assert.deepEqual(out.hooks[e][0].hooks[0].args, [WIN_SCRIPT], 'event ' + e + ' exec-form args missing after repoint');
  }
});

test('#570 CONTROL: a foreign win32 exec-form hook in the same event survives repointing', () => {
  // The win32 analog of the #1467 CONTROL. A bystander that SHARES our node.exe
  // command but is NOT ours (no marker in command or args) must survive when our
  // OLD shell-form entry in the same event is repointed to exec form. Without
  // this, the entryIsOurs(args)/full-shape sameHook coupling could let "replace
  // our entries" quietly become "replace the list" on win32 -- and because the
  // foreign entry shares our command string, a command-only identity check would
  // be especially prone to mistaking it for ours.
  const p = fresh();
  const theirs = { matcher: '', hooks: [{ type: 'command', command: WIN_NODE, args: ['C:\\Somebody\\else\\thing.js'] }] };
  const oursOldShell = { matcher: '', hooks: [{ type: 'command', command: '"' + WIN_NODE + '" "' + WIN_SCRIPT + '"', timeout: 15 }] };
  fs.writeFileSync(p, JSON.stringify({ hooks: { SessionStart: [theirs, oursOldShell] } }));
  reporthook.ensureWired(p, WIN_SCRIPT, { platform: 'win32', node: WIN_NODE });
  const entries = readJson(p).hooks.SessionStart;
  // The foreign exec-form bystander is untouched.
  assert.equal(entries.filter((e) => e.hooks[0].args && e.hooks[0].args[0] === 'C:\\Somebody\\else\\thing.js').length, 1,
    'a foreign win32 exec-form hook was destroyed by repointing');
  // Ours is present exactly once, now in exec form (repointed, not doubled).
  assert.equal(entries.filter(reporthook.entryIsOurs).length, 1, 'our win32 hook must be present exactly once after repoint');
  const ours = entries.filter(reporthook.entryIsOurs)[0];
  assert.equal(ours.hooks[0].command, WIN_NODE);
  assert.deepEqual(ours.hooks[0].args, [WIN_SCRIPT]);
});

test('#570 sameHook non-vacuity: a STALE win32 exec-form entry (old args) is repointed, not skipped as already-correct', () => {
  // The non-vacuity proof for the FULL-SHAPE sameHook (command AND args). The
  // entry is ALREADY exec form with the CURRENT node.exe as command, but args[0]
  // is an OLD script copy still carrying the marker (so entryIsOurs matches it).
  // A command-only "already correct" check (h.command === want.command) would see
  // the matching command, skip it, and leave the stale args -- the #1467 defect in
  // exec-form clothing. Reverting sameHook to command-only makes THIS test fail
  // (the migration test does NOT, because an old shell-form command already differs
  // from the bare-node target and repoints under command-only too).
  const staleScript = 'C:\\Program Files\\Kosmos\\OLD\\app\\engine\\kosmos-report-hook.js';
  assert.ok(staleScript.includes('kosmos-report-hook'), 'precondition: the stale args path must carry the marker so entryIsOurs matches it');
  const data = { hooks: {} };
  for (const e of reporthook.HOOK_EVENTS) {
    data.hooks[e] = [{ matcher: '', hooks: [{ type: 'command', command: WIN_NODE, args: [staleScript], timeout: 15 }] }];
  }
  const p = fresh();
  fs.writeFileSync(p, JSON.stringify(data));
  const r = reporthook.ensureWired(p, WIN_SCRIPT, { platform: 'win32', node: WIN_NODE });
  assert.equal(r.wired, true);
  assert.equal(r.changed, true, 'a stale exec-form entry (old args) must be repointed (changed)');
  const out = readJson(p);
  for (const e of reporthook.HOOK_EVENTS) {
    assert.equal(oursIn(out, e), 1, 'event ' + e + ' must have exactly one of ours (repointed, not doubled)');
    assert.deepEqual(out.hooks[e][0].hooks[0].args, [WIN_SCRIPT], 'event ' + e + ' stale args were not repointed to the current script');
  }
});

test('#570 ensureWired win32 guard: a node path with a double-quote is refused, a backslash path is not', () => {
  const bad = reporthook.ensureWired(fresh(), WIN_SCRIPT, { platform: 'win32', node: 'C:\\a"evil\\node.exe' });
  assert.equal(bad.wired, false, 'a quote in the node path must be refused');
  // Control: an ordinary all-backslash Windows install path wires fine.
  const ok = reporthook.ensureWired(fresh(), WIN_SCRIPT, { platform: 'win32', node: WIN_NODE });
  assert.equal(ok.wired, true, 'a normal backslash path was wrongly refused');
});

test('#570 MARKER: entryIsOurs recognises the posix command, the OLD win32 shell form, and the exec-form args', () => {
  // Back-compat: an already-wired posix bash entry (marker in the command) is ours.
  const shEntry = { matcher: '', hooks: [{ type: 'command', command: 'bash "/app/bin/kosmos-report-hook.sh"', timeout: 15 }] };
  // The OLD win32 shell form carried the marker in the command string too -- still
  // ours, so it gets repointed to exec form rather than doubled.
  const oldWinShell = { matcher: '', hooks: [{ type: 'command', command: '"' + WIN_NODE + '" "' + WIN_SCRIPT + '"', timeout: 15 }] };
  // The #570 exec form carries the marker in args[0], NOT the command (which is
  // the bare node.exe) -- entryIsOurs must find it there.
  const jsEntry = reporthook.entryFor(WIN_SCRIPT, { platform: 'win32', node: WIN_NODE });
  assert.ok(!jsEntry.hooks[0].command.includes('kosmos-report-hook'), 'precondition: exec-form command is the bare node, no marker');
  assert.equal(reporthook.entryIsOurs(shEntry), true, 'the marker lost the posix .sh entry');
  assert.equal(reporthook.entryIsOurs(oldWinShell), true, 'the marker lost the OLD win32 shell-form entry (breaks migration)');
  assert.equal(reporthook.entryIsOurs(jsEntry), true, 'the marker does not match the exec-form entry via args');
  // A truly foreign hook is still not ours (neither command nor args carry the stem).
  assert.equal(reporthook.entryIsOurs({ hooks: [{ command: 'bash "/somebody/else.sh"' }] }), false);
  assert.equal(reporthook.entryIsOurs({ hooks: [{ command: 'node', args: ['/somebody/else.js'] }] }), false);
});

test('#570 + #1582: an ephemeral win32 NODE path into a durable settings file is refused', () => {
  // The win32 exec-form entry carries node too (as the command), so a durable
  // settings.json pointing at a cut-sandbox runtime/node.exe is the same #1582
  // defect as an ephemeral script.
  const ephemeralNode = path.join(RESOLVED_TMP, 'kosmos-cut-abc', 'runtime', 'node.exe');
  const r = reporthook.ensureWired(DURABLE_SETTINGS, WIN_SCRIPT, { platform: 'win32', node: ephemeralNode });
  assert.equal(r.wired, false, 'an ephemeral node path into a durable settings file must be refused');
  assert.match(r.because, /ephemeral|temp/);
});

test('#570 + #1582 control: an ephemeral node in an ephemeral settings file is NOT a mismatch and still wires', () => {
  // Same node, but the settings file is also under temp -> not durable -> the
  // node-ephemeral arm must NOT fire (mirrors the script-path refinement).
  const ephemeralNode = path.join(RESOLVED_TMP, 'kosmos-cut-abc', 'runtime', 'node.exe');
  const r = reporthook.ensureWired(fresh(), WIN_SCRIPT, { platform: 'win32', node: ephemeralNode });
  assert.equal(r.wired, true, 'an ephemeral node with an ephemeral settings file must still wire');
});
