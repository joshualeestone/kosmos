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
  try {
    // 1. an explicit account config dir
    assert.equal(tw.sessionsDir(path.join('X', 'acct')), path.join('X', 'acct', 'sessions'));
    // 2. the process CLAUDE_CONFIG_DIR when no dir is passed
    process.env.CLAUDE_CONFIG_DIR = path.join('Y', 'envcfg');
    assert.equal(tw.sessionsDir(null), path.join('Y', 'envcfg', 'sessions'));
    // 3. the default account: ~/.claude/sessions
    delete process.env.CLAUDE_CONFIG_DIR;
    assert.equal(tw.sessionsDir(null), path.join(os.homedir(), '.claude', 'sessions'));
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});

test('#2281 the default real-dir read is fail-soft: a missing dir is "not stuck"', () => {
  /* Exercises the ONE real IO path (no injected list) against a directory that
     does not exist. Read-only and path-agnostic -- it proves readEntries swallows
     the fault and answers false rather than throwing into the supervisor. */
  const missing = path.join(os.tmpdir(), 'win32trustwait-does-not-exist-' + process.pid + '-' + Date.now());
  assert.equal(tw.pidWaiting(4242, { configDir: missing, olderThanMs: 0 }), false);
});
