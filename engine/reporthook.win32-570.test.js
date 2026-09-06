'use strict';
/**
 * #570: the bash-free win32 report-hook entrypoint, asserted FROM ANY PLATFORM.
 *
 * 🛑 WHY EVERY ARM INJECTS THE PLATFORM. This fleet is macOS; a behavioural arm
 * for a win32 branch cannot fail on a machine that never takes the branch, so a
 * green suite here would be no evidence about Windows at all. `entryFor`,
 * `hookScriptPath` and `ensureWired` therefore all take the platform they are
 * being ASKED ABOUT, exactly as `store.dataRootFor` does, which is the fix-shape
 * docs/windows-source-coupling-1732.md prescribes for this whole class.
 *
 * The measurements behind these arms were taken on a real Windows box
 * (kosmos#2266 plan doc): no bash, no sh, no jq, no node on PATH; the bundle
 * ships its own runtime\node.exe; `claude agents --json` and the pinned
 * --session-id round-trip.
 *
 *   node --test engine/reporthook.win32-570.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const reporthook = require('./reporthook');
const hook = require('./kosmos-report-hook');
const selfreport = require('./selfreport');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'reporthook-win32-570-'));
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const WIN_SCRIPT = 'C:\\Kosmos\\app\\engine\\kosmos-report-hook.js';
const MAC_SCRIPT = '/Users/x/Kosmos/app/bin/kosmos-report-hook.sh';

function settingsFile(name, contents) {
  const p = path.join(SANDBOX, name);
  fs.writeFileSync(p, JSON.stringify(contents || {}));
  return p;
}

// --- the command each platform gets ------------------------------------------

test('#570 win32 gets a NODE command, never bash', () => {
  const cmd = reporthook.entryFor(WIN_SCRIPT, 'win32').hooks[0].command;
  assert.doesNotMatch(cmd, /(^|\s)bash\b/, 'bash is exactly what Windows does not have');
  assert.match(cmd, /node\.exe/, 'the interpreter is the bundled node');
  assert.match(cmd, /kosmos-report-hook\.js/, 'and it runs the node entrypoint');
  // BOTH halves quoted: a Windows path has spaces far more often than a POSIX one
  // ("C:\Program Files\..."), and an unquoted interpreter is the same defect as an
  // unquoted script.
  assert.match(cmd, /^"[^"]+"\s+"[^"]+"$/, 'interpreter and script are each quoted');
});

test('#570 darwin is UNCHANGED -- the regression guard for the platform this fleet runs on', () => {
  const cmd = reporthook.entryFor(MAC_SCRIPT, 'darwin').hooks[0].command;
  assert.equal(cmd, 'bash "' + MAC_SCRIPT + '"', 'the Mac command must be byte-identical to before');
});

test('#570 hookScriptPath asked about win32 resolves the .js beside engine/', () => {
  const p = reporthook.hookScriptPath('win32');
  assert.ok(p, 'the win32 entrypoint resolves');
  assert.match(p, /kosmos-report-hook\.js$/);
  assert.ok(fs.existsSync(p), 'and it is really there, not a guess that fails at fire time');
});

// --- the dedup family (the migration kosmos#2266 flagged) --------------------

test('#570 entryIsOurs matches BOTH entrypoints, so neither stacks beside the other', () => {
  const sh = { hooks: [{ command: 'bash "/x/kosmos-report-hook.sh"' }] };
  const js = { hooks: [{ command: '"C:\\b\\runtime\\node.exe" "C:\\b\\app\\engine\\kosmos-report-hook.js"' }] };
  assert.equal(reporthook.entryIsOurs(sh), true);
  assert.equal(reporthook.entryIsOurs(js), true);
  assert.equal(reporthook.entryIsOurs({ hooks: [{ command: 'bash /somebody/else.sh' }] }), false,
    'a stranger is still not ours');
});

test('#570 a .sh wiring is REPLACED by the win32 one, not stacked beside it', () => {
  /* The defect this prevents: the old MARKER was the literal string
     'kosmos-report-hook.sh', so a .js entry matched nothing, and a box carrying
     both would fire two hooks and double-report every event. */
  const stranger = { matcher: '', hooks: [{ type: 'command', command: 'bash /somebody/else.sh', timeout: 5 }] };
  const old = { matcher: '', hooks: [{ type: 'command', command: 'bash "/old/kosmos-report-hook.sh"', timeout: 15 }] };
  const f = settingsFile('replace.json', { hooks: { SessionStart: [stranger, old] } });

  const r = reporthook.ensureWired(f, WIN_SCRIPT, 'win32');
  assert.equal(r.wired, true, r.because || '');

  const after = JSON.parse(fs.readFileSync(f, 'utf8'));
  const entries = after.hooks.SessionStart;
  const ours = entries.filter(reporthook.entryIsOurs);
  assert.equal(ours.length, 1, 'exactly one of ours -- replaced, not stacked');
  assert.match(ours[0].hooks[0].command, /kosmos-report-hook\.js/, 'and it is the win32 one');
  assert.ok(entries.some((e) => e.hooks[0].command === 'bash /somebody/else.sh'),
    'somebody else\'s hook is untouched, which is the merge-only promise');
});

test('#570 wiring all seven events is idempotent on win32', () => {
  const f = settingsFile('idem.json', {});
  const first = reporthook.ensureWired(f, WIN_SCRIPT, 'win32');
  assert.equal(first.wired, true, first.because || '');
  const wired = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const ev of reporthook.HOOK_EVENTS) {
    assert.ok(Array.isArray(wired.hooks[ev]) && wired.hooks[ev].some(reporthook.entryIsOurs),
      ev + ' is wired');
  }
  const second = reporthook.ensureWired(f, WIN_SCRIPT, 'win32');
  assert.equal(second.wired, true);
  assert.equal(second.changed, false, 'a second run changes nothing');
});

// --- the refusal that would have made the whole arm unreachable --------------

test('#570 a BACKSLASHED win32 path is accepted -- the POSIX refusal rejected every real one', () => {
  /* 🛑 THE BUG THIS PINS. The character refusal was written for a bash command,
     where `\` is an escape, and it rejects any path containing one. On Windows
     `\` is the SEPARATOR, so that rule fired on 100% of real inputs: the win32
     arm would have wired NOTHING and said only that the path "contains
     characters we will not embed". A refusal that always fires is an outage with
     a sentence, and it is invisible from macOS where no path carries a `\`. */
  const f = settingsFile('backslash.json', {});
  const r = reporthook.ensureWired(f, WIN_SCRIPT, 'win32');
  assert.equal(r.wired, true, 'a normal Windows path must wire: ' + (r.because || ''));
});

test('#570 each platform still refuses what can actually hurt IT', () => {
  const f = settingsFile('danger.json', {});
  assert.equal(reporthook.ensureWired(f, 'C:\\a\\b"c\\hook.js', 'win32').wired, false,
    'a double quote terminates the argument on win32');
  assert.equal(reporthook.ensureWired(f, 'C:\\a\\%PATH%\\hook.js', 'win32').wired, false,
    'a percent is expanded if the command reaches cmd');
  assert.equal(reporthook.ensureWired(f, '/tmp/a$(id)/kosmos-report-hook.sh', 'darwin').wired, false,
    'the POSIX set is unchanged: $ still refused there');
  assert.equal(reporthook.ensureWired(f, '/tmp/a\\b/kosmos-report-hook.sh', 'darwin').wired, false,
    'and a backslash is still refused on POSIX, where it IS an escape');
});

// --- the node entrypoint reproduces the .sh table ----------------------------

test('#570 the node entrypoint maps all seven events to the SAME words as the .sh hook', () => {
  const expected = {
    SessionStart: 'started',
    UserPromptSubmit: 'working',
    PreToolUse: 'working',
    PermissionRequest: 'needs_you',
    Stop: 'idle',
    StopFailure: 'blocked',
    SessionEnd: 'stopped',
  };
  for (const ev of reporthook.HOOK_EVENTS) {
    const plan = hook.planFor(ev, { hook_event_name: ev, source: 'startup' });
    assert.ok(plan.fields, ev + ' produces a report');
    assert.equal(plan.fields.state, expected[ev], ev + ' maps to ' + expected[ev]);
    assert.equal(plan.fields.auto, true,
      ev + ' is written by the MACHINE, so it must be auto -- without it an automatic '
      + 'idle/working erases a standing needs_you (#900/#1949)');
  }
});

test('#570 every word it can emit is in selfreport.STATES, the closed list', () => {
  for (const w of hook.STATES) {
    assert.ok(selfreport.STATES.includes(w), w + ' is one of the six words the record accepts');
  }
  assert.deepEqual([...hook.STATES].sort(), [...selfreport.STATES].sort(),
    'the entrypoint and the record hold the SAME closed list, not two that drift');
});

test('#570 SessionStart on a RESUME does not erase a waiting state (#1058)', () => {
  assert.equal(hook.planFor('SessionStart', { hook_event_name: 'SessionStart', source: 'resume' }).skip, true,
    'a continuation must not report started');
  assert.equal(hook.planFor('SessionStart', { hook_event_name: 'SessionStart', source: 'startup' }).skip, undefined,
    'a real startup still reports');
  assert.equal(hook.planFor('SessionStart', { hook_event_name: 'SessionStart' }).skip, undefined,
    'no source at all is an older Claude Code and still reports, exactly as today');
});

// --- the throttle collapse kosmos#2266 measured ------------------------------

test('#570 the heartbeat throttle is PER AGENT, not one shared mark for every paneless one', () => {
  /* The .sh hook keys on `${TMUX_PANE:-nopane}`. Every win32 agent is paneless,
     so all of them collapsed onto the single key "nopane" and one agent's
     PreToolUse beat suppressed every other agent's for 60s. */
  const a = hook.throttleKey({ session_id: 'aaaaaaaa-1111' });
  const b = hook.throttleKey({ session_id: 'bbbbbbbb-2222' });
  assert.notEqual(a, b, 'two agents must not share a throttle key');
  assert.doesNotMatch(a, /nopane/, 'and the key is the session, not a paneless fallback');
  assert.match(a, /^[A-Za-z0-9_-]+$/, 'the key is safe as a filename');
});
