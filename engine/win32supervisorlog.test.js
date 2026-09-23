'use strict';
/**
 * #3441 - the Windows supervisor's persisted, bounded, redacted event log.
 *
 * The supervisor writes its transitions and errors to stderr "so a task log
 * captures it", but the Scheduled Task redirects that stderr nowhere, so the lines
 * are dropped -- which is why a codex agent could fail silently for days (#3439)
 * with no error to see on the box. `win32supervisorlog` persists those SAME lines
 * to a bounded, secret-redacted file per agent under the store root.
 *
 * Every fixture here is built BY CONSTRUCTION (no hand-typed on-disk file): the
 * test drives the real writer against a temp store root and reads back what landed.
 *
 *   node --test engine/win32supervisorlog.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'win32suplog-3441-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
/* A shared box / the test harness must not migrate or touch the real store. */
process.env.KOSMOS_NO_LEGACY_MIGRATION = '1';

const suplog = require('./win32supervisorlog');
const store = require('./store');

test.after(() => {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

function readLog(name) {
  try { return fs.readFileSync(suplog.logPath(name), 'utf8'); } catch { return ''; }
}
function readRotated(name) {
  try { return fs.readFileSync(suplog.logPath(name) + '.1', 'utf8'); } catch { return ''; }
}

test('a line is persisted under store.ROOT/win32-logs/<safeKey>.log, keyed like the rest of the store', () => {
  const name = 'Reh-A';
  const log = suplog.logger(name);
  const line = new Date().toISOString() + ' ' + name + ' turn-failed -- it said: codex exited 1';
  log.line(line);

  const at = suplog.logPath(name);
  // The path mirrors win32streamstate: store.ROOT/win32-logs/<safeKey>.log.
  assert.equal(at, path.join(store.ROOT, 'win32-logs', store.safeKey(name) + '.log'),
    'the log path is not under win32-logs keyed by store.safeKey');
  const body = readLog(name);
  assert.equal(body, line + '\n', 'the exact line was not persisted with a trailing newline');
});

test('the exact lines win32supervisor builds round-trip through the log', () => {
  // These are the literal shapes main() writes (transition, state-unrecorded,
  // channel-refused, host-gone), constructed the same way the supervisor does.
  const name = 'winreh-2';
  const log = suplog.logger(name);
  const now = new Date().toISOString();
  const lines = [
    now + ' ' + name + ' turn-failed -- it said: config.toml parse error at line 3',
    now + ' ' + name + ' state-unrecorded -- we could not record its state (EPERM)',
    now + ' ' + name + ' channel-refused -- the previous supervisor still has it',
    now + ' ' + name + ' host-gone -- its task was ended, so its agent is being stopped',
  ];
  for (const l of lines) log.line(l);
  const body = readLog(name);
  for (const l of lines) assert.ok(body.includes(l + '\n'), 'a supervisor line did not survive: ' + l);
});

test('an embedded newline is collapsed so one event is one line', () => {
  const name = 'multiline';
  suplog.logger(name).line('winreh-2 died -- it said: line one\nline two\r\nline three');
  const body = readLog(name);
  assert.equal(body.split('\n').filter(Boolean).length, 1, 'a multi-line error split into several log lines');
  assert.ok(body.includes('line one line two line three'), 'the collapsed line lost its content');
});

test('planted secrets are redacted, diagnostic content is kept', () => {
  const name = 'redact';
  const log = suplog.logger(name);
  // A realistic turn-failed line whose captured error text carries several
  // credential shapes, alongside the diagnostic bits that must SURVIVE.
  // Built from split literals ON PURPOSE, so no contiguous token sits in this
  // source file to trip a secret scanner; the runtime string still exercises the
  // redactor's regexes in full.
  const secrets = [
    'sk-' + 'ant-api03-AbCdEfGhIjKlMnOpQrStUvWx',
    'ghp' + '_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
    'xox' + 'b-1234567890-abcdefghijklmnop',
    'AKIA' + 'IOSFODNN7FAKEXMP',
  ];
  for (const s of secrets) {
    log.line('winreh-2 turn-failed -- it said: auth error using ' + s + ' for session sess-abc-123');
  }
  log.line('winreh-2 turn-failed -- it said: token=Abcd1234Efgh5678 rejected');
  log.line('winreh-2 turn-failed -- it said: fetch https://user:hunter2pass@api.example.com failed');

  const body = readLog(name);
  for (const s of secrets) assert.ok(!body.includes(s), 'a secret survived redaction: ' + s);
  assert.ok(!body.includes('Abcd1234Efgh5678'), 'a labelled-assignment secret survived');
  assert.ok(!body.includes('hunter2pass'), 'a URL-userinfo password survived');
  assert.ok(body.includes('[redacted-secret]'), 'the redaction marker is absent');
  // The diagnostic content -- the agent name, the action, the session id -- is the
  // whole point of the log and must NOT be scrubbed.
  assert.ok(body.includes('winreh-2 turn-failed'), 'the agent name/action was scrubbed');
  assert.ok(body.includes('sess-abc-123'), 'a session id was scrubbed');
});

test('redactSecrets leaves ordinary supervisor prose untouched', () => {
  // A false-positive guard: names, ids, folders and plain words are not credentials.
  const plain = '2026-09-23T00:00:00.000Z reh-a started -- resuming session 7c-2 in C:\\Users\\joshu\\work';
  assert.equal(suplog.redactSecrets(plain), plain, 'ordinary supervisor prose was over-redacted');
});

test('the file is BOUNDED: writing far past the cap keeps it small and keeps the NEWEST', () => {
  const name = 'bounded';
  const cap = 2 * 1024;               // a small cap so the test is fast and exact
  const log = suplog.logger(name, { maxBytes: cap });
  // Each line is ~60 bytes; 500 lines is ~30 KB, ~15x the cap.
  let newest = '';
  for (let i = 0; i < 500; i += 1) {
    newest = '2026-09-23T00:00:00.000Z bounded turn ' + i + ' -- filler to grow the file';
    log.line(newest);
  }
  const liveSize = (() => { try { return fs.statSync(suplog.logPath(name)).size; } catch { return 0; } })();
  const rotSize = (() => { try { return fs.statSync(suplog.logPath(name) + '.1').size; } catch { return 0; } })();
  // Neither file exceeds the cap by more than one line, and the total on disk is
  // bounded at ~2x the cap regardless of how many lines were written.
  assert.ok(liveSize <= cap + 512, 'the live file grew past the cap: ' + liveSize);
  assert.ok(liveSize + rotSize <= 2 * cap + 512, 'the total on disk is not bounded: ' + (liveSize + rotSize));
  // The newest line must still be readable, across the live file or the one rotation.
  assert.ok((readLog(name) + readRotated(name)).includes(newest), 'the newest line was lost while bounding');
});

test('a log write never throws, even when the directory cannot be created', () => {
  // Point the writer at a path whose parent is a FILE, so mkdir/append fail; the
  // writer must swallow it rather than take the supervisor down.
  const clash = path.join(SANDBOX, 'notadir');
  fs.writeFileSync(clash, 'x');
  const saved = process.env.AGENT_WORKFORCE_DATA;
  process.env.AGENT_WORKFORCE_DATA = clash;   // store.ROOT now resolves under a file
  try {
    assert.doesNotThrow(() => suplog.logger('boom').line('winreh-2 died -- it said: nope'),
      'a failed log write threw instead of being best-effort');
  } finally {
    process.env.AGENT_WORKFORCE_DATA = saved;
  }
});
