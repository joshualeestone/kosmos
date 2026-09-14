'use strict';
/**
 * #2281: detecting an agent stuck at Claude Code's workspace-trust prompt.
 *
 * 🔑 THE DETECTABLE STATE (measured read-only on the box 2026-09-13). Claude Code
 * writes `<config-dir>/sessions/<pid>.<hash>.key` when a session starts and only
 * `<pid>.json` once it registers; a session hung at the trust dialog writes the
 * `.key` and never the `.json`. Every arm here drives the detector over a
 * SYNTHETIC listing (no real dir, no real spawn), so it is green on any host --
 * the win32-specific fact is the directory-naming rule, which is asserted as a
 * rule rather than by reading a Windows path.
 *
 *   node --test engine/win32trustwait.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const tw = require('./win32trustwait');

const KEY = (pid) => pid + '.' + 'a'.repeat(64) + '.key';   // <pid>.<hash>.key
const JSON_ = (pid) => pid + '.json';

test('#2281 a lone .key past the grace is STUCK', () => {
  const now = 1_000_000;
  const stuck = tw.stuckSessions({
    entries: [{ name: KEY('4242'), mtimeMs: now - 60_000 }],
    now, olderThanMs: 45_000,
  });
  assert.equal(stuck.length, 1);
  assert.equal(stuck[0].pid, '4242');
  assert.equal(stuck[0].keyFile, KEY('4242'));
  assert.equal(stuck[0].ageMs, 60_000);
});

test('#2281 a .key WITH its .json sibling is NOT stuck, however old', () => {
  const now = 1_000_000;
  const stuck = tw.stuckSessions({
    entries: [
      { name: KEY('7'), mtimeMs: 0 },        // ancient
      { name: JSON_('7'), mtimeMs: 0 },      // ...but it registered
    ],
    now, olderThanMs: 45_000,
  });
  assert.deepEqual(stuck, []);
});

test('#2281 the .json can be listed BEFORE its .key and still counts as registered', () => {
  const now = 1_000_000;
  const stuck = tw.stuckSessions({
    entries: [
      { name: JSON_('7'), mtimeMs: 0 },
      { name: KEY('7'), mtimeMs: 0 },
    ],
    now, olderThanMs: 0,
  });
  assert.deepEqual(stuck, [], 'registration is resolved across the whole listing, not in order');
});

test('#2281 a .key still within its start-up grace is NOT yet stuck', () => {
  const now = 1_000_000;
  const stuck = tw.stuckSessions({
    entries: [{ name: KEY('99'), mtimeMs: now - 5_000 }],   // 5s old
    now, olderThanMs: 45_000,
  });
  assert.deepEqual(stuck, [], 'a freshly spawned agent has its .key for a few seconds before the .json lands');
});

test('#2281 names that are not <pid>.<hash>.key / <pid>.json are ignored', () => {
  const now = 1_000_000;
  const stuck = tw.stuckSessions({
    entries: [
      { name: 'notapid.hash.key', mtimeMs: 0 },
      { name: 'README', mtimeMs: 0 },
      { name: '12.json.bak', mtimeMs: 0 },
      { name: '13.key', mtimeMs: 0 },            // missing the hash segment
    ],
    now, olderThanMs: 0,
  });
  assert.deepEqual(stuck, []);
});

test('#2281 several sessions: only the unregistered, aged ones come back', () => {
  const now = 1_000_000;
  const stuck = tw.stuckSessions({
    entries: [
      { name: KEY('100'), mtimeMs: now - 60_000 },   // stuck
      { name: KEY('200'), mtimeMs: now - 60_000 }, { name: JSON_('200'), mtimeMs: now - 55_000 },  // registered
      { name: KEY('300'), mtimeMs: now - 1_000 },    // too young
    ],
    now, olderThanMs: 45_000,
  });
  assert.deepEqual(stuck.map((s) => s.pid), ['100']);
});

test('#2281 pidWaiting answers about ONE pid, over an injected listing', () => {
  const now = 1_000_000;
  const list = () => [
    { name: KEY('4242'), mtimeMs: now - 60_000 },
    { name: KEY('9000'), mtimeMs: now - 60_000 }, { name: JSON_('9000'), mtimeMs: now - 50_000 },
  ];
  assert.equal(tw.pidWaiting(4242, { list, now, olderThanMs: 45_000 }), true, 'stuck pid');
  assert.equal(tw.pidWaiting(9000, { list, now, olderThanMs: 45_000 }), false, 'registered pid');
  assert.equal(tw.pidWaiting(1, { list, now, olderThanMs: 45_000 }), false, 'a pid with no file');
});

test('#2281 pidWaiting refuses a non-numeric pid without reading anything', () => {
  let read = false;
  const list = () => { read = true; return []; };
  assert.equal(tw.pidWaiting('nope', { list }), false);
  assert.equal(read, false, 'a value that cannot name a .key never triggers a directory read');
});

test('#2281 sessionsDir resolves to the config DIR, not the .claude.json file', () => {
  const saved = process.env.CLAUDE_CONFIG_DIR;
  const savedHome = process.env.AGENT_WORKFORCE_HOME;
  try {
    // 1. an explicit account config dir
    assert.equal(tw.sessionsDir(path.join('X', 'acct')), path.join('X', 'acct', 'sessions'));
    delete process.env.AGENT_WORKFORCE_HOME;
    // 2. the default account: ~/.claude/sessions
    delete process.env.CLAUDE_CONFIG_DIR;
    assert.equal(tw.sessionsDir(null), path.join(os.homedir(), '.claude', 'sessions'));
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
    if (savedHome === undefined) delete process.env.AGENT_WORKFORCE_HOME;
    else process.env.AGENT_WORKFORCE_HOME = savedHome;
  }
});

test('#3013 sessionsDir(null) IGNORES the engine CLAUDE_CONFIG_DIR (mirrors trust.defaultAgentSettings)', () => {
  /* Folded in from the #2281 review: a DEFAULT-account agent launches with
     CLAUDE_CONFIG_DIR DELETED and reads ~/.claude/sessions, so trustWait must scan
     THERE, not the engine's own CLAUDE_CONFIG_DIR (which a used-machine board can
     carry). This became load-bearing when the #3013 board card started asking about
     default-account agents. AGENT_WORKFORCE_HOME is the sandbox seam, parallel to
     trust.defaultAgentSettings'. */
  const saved = process.env.CLAUDE_CONFIG_DIR;
  const savedHome = process.env.AGENT_WORKFORCE_HOME;
  try {
    process.env.CLAUDE_CONFIG_DIR = path.join('Y', 'engine-envcfg');   // the ENGINE's own
    delete process.env.AGENT_WORKFORCE_HOME;
    assert.equal(tw.sessionsDir(null), path.join(os.homedir(), '.claude', 'sessions'),
      'the default-account sessions dir never follows the engine CLAUDE_CONFIG_DIR');
    // AGENT_WORKFORCE_HOME redirects the default base, exactly as defaultAgentSettings honours it
    process.env.AGENT_WORKFORCE_HOME = path.join('Z', 'sandbox-home');
    assert.equal(tw.sessionsDir(null), path.join('Z', 'sandbox-home', '.claude', 'sessions'),
      'AGENT_WORKFORCE_HOME is the sandbox seam for the default-account sessions dir');
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
    if (savedHome === undefined) delete process.env.AGENT_WORKFORCE_HOME;
    else process.env.AGENT_WORKFORCE_HOME = savedHome;
  }
});

test('#3013 (control) the float-ms age clamp: a future-dated .key still counts at olderThanMs:0, not under a threshold', () => {
  /* Folded in from the #2281 review: statSync's mtimeMs is a FLOAT and Date.now()
     truncates to whole ms, so a just-written .key can compute a hair-negative age.
     stuckSessions clamps the age at 0, which is what makes olderThanMs:0 mean
     "accept all ages" rather than "accept nothing this instant". Pin both halves:
     a future-dated (negative raw age) .key is STILL stuck at olderThanMs:0, and is
     NOT stuck under any positive threshold (a clamped-to-0 age is < the threshold). */
  const now = 1_000_000;
  const future = now + 5_000;   // mtime AHEAD of the clock -> raw age -5000ms
  const atZero = tw.stuckSessions({
    entries: [{ name: KEY('4242'), mtimeMs: future }],
    now, olderThanMs: 0,
  });
  assert.equal(atZero.length, 1, 'clamped to age 0, a future-dated lone .key is accepted at olderThanMs:0');
  assert.equal(atZero[0].pid, '4242');
  assert.equal(atZero[0].ageMs, 0, 'the negative raw age is clamped to 0, never surfaced negative');

  const atThreshold = tw.stuckSessions({
    entries: [{ name: KEY('4242'), mtimeMs: future }],
    now, olderThanMs: 1,
  });
  assert.deepEqual(atThreshold, [], 'a clamped-to-0 age is below any positive threshold');
});

test('#3013 dirWaiting answers the FOLDER-level question over an injected listing', () => {
  const now = 1_000_000;
  const stuckList = () => [{ name: KEY('4242'), mtimeMs: now - 60_000 }];   // a lone aged .key
  const healthyList = () => [
    { name: KEY('9000'), mtimeMs: now - 60_000 }, { name: JSON_('9000'), mtimeMs: now - 50_000 },  // registered
  ];
  const cfg = path.join('X', 'acct');
  assert.equal(tw.dirWaiting(cfg, { list: stuckList, now, olderThanMs: 45_000 }), true,
    'a lone aged .key in the account dir reads as waiting, with no pid needed');
  assert.equal(tw.dirWaiting(cfg, { list: healthyList, now, olderThanMs: 45_000 }), false,
    'a registered session (.key + .json) is not waiting');
  assert.equal(tw.dirWaiting(cfg, { list: () => [], now, olderThanMs: 0 }), false,
    'an empty account dir is not waiting');
});

test('#3013 dirWaiting is fail-soft through the real fs chain: a missing dir is "not waiting"', () => {
  const missing = path.join(os.tmpdir(), 'win32trustwait-dir-missing-' + process.pid + '-' + Date.now());
  assert.equal(tw.dirWaiting(missing, { olderThanMs: 0 }), false,
    'a real read of an absent dir swallows the fault and answers false');
});

test('#2281 the default real-dir read is fail-soft: a missing dir is "not stuck"', () => {
  /* Exercises the ONE real IO path (no injected list) against a directory that
     does not exist. Read-only and path-agnostic -- it proves readEntries swallows
     the fault and answers false rather than throwing into the supervisor. */
  const missing = path.join(os.tmpdir(), 'win32trustwait-does-not-exist-' + process.pid + '-' + Date.now());
  assert.equal(tw.pidWaiting(4242, { configDir: missing, olderThanMs: 0 }), false);
});

test('#2281 (FIX 4) pidWaiting returns TRUE through the real fs chain on a lone .key', () => {
  /* The production true-return path -- real readdirSync/statSync, real sessionsDir,
     real KEY_RE -- with no injected list. Host-independent (os.tmpdir), so it runs
     on any platform. */
  const cfg = path.join(os.tmpdir(), 'win32trustwait-real-' + process.pid + '-' + Date.now());
  const sdir = path.join(cfg, 'sessions');
  require('node:fs').mkdirSync(sdir, { recursive: true });
  const pid = 424242;
  const keyPath = path.join(sdir, KEY(pid));
  require('node:fs').writeFileSync(keyPath, 'x');   // a lone .key, no .json
  /* Back-date the .key so its age is unambiguously positive (a just-written file
     can otherwise sit within the same integer ms as Date.now(); the production
     clamp handles that, but a deterministic mtime keeps this test independent of
     it and exercises a real, aged lone .key). */
  const past = Date.now() - 60_000;
  require('node:fs').utimesSync(keyPath, new Date(past), new Date(past));
  try {
    assert.equal(tw.pidWaiting(pid, { configDir: cfg, olderThanMs: 0 }), true,
      'a real <pid>.<hash>.key with no sibling <pid>.json reads as waiting');
    // control: give it its .json and it is no longer waiting
    require('node:fs').writeFileSync(path.join(sdir, JSON_(pid)), '{}');
    assert.equal(tw.pidWaiting(pid, { configDir: cfg, olderThanMs: 0 }), false,
      'once it registers (a real <pid>.json lands) it is not waiting');
  } finally {
    require('node:fs').rmSync(cfg, { recursive: true, force: true });
  }
});
