'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/**
 * kosmos#5434 slice 21: six more records save flushed (#5431): the sign-in flow state (connect.js), the agent browser's
 * MCP config (agentbrowser.js), the daily feedback report (feedback.js), the Windows session ownership record
 * (win32sessions.js, 0600 under its lock), the Windows stream state (win32streamstate.js) and the setup guide's launch
 * record (setup-assistant.js, 0600). feedback and win32sessions are driven through their public saves; all six are held
 * to "a flushed save, no hand-made temp renamed" by reading their source.
 *
 *   node --test engine/state21.fsync-5434.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'state21-fsync-')));
process.env.AGENT_WORKFORCE_DATA = SB;
process.env.AGENT_WORKFORCE_HOME = path.join(SB, 'home');
process.on('exit', () => { try { fs.rmSync(SB, { recursive: true, force: true }); } catch { /* best effort */ } });
const store = require('./store');
fs.mkdirSync(store.ROOT, { recursive: true });
const feedback = require('./feedback');
const win32sessions = require('./win32sessions');

function recording(fn) {
  const events = [];
  const fdPath = new Map();
  const realOpen = fs.openSync;
  const realFsync = fs.fsyncSync;
  const realRename = fs.renameSync;
  fs.openSync = (p, ...rest) => { const fd = realOpen.call(fs, p, ...rest); fdPath.set(fd, String(p)); return fd; };
  fs.fsyncSync = (fd) => { events.push(['fsync', fdPath.get(fd)]); return realFsync(fd); };
  fs.renameSync = (a, b) => { events.push(['rename', String(a), String(b)]); return realRename(a, b); };
  let out;
  let err = null;
  try { out = fn(); } catch (e) { err = e; } finally { fs.openSync = realOpen; fs.fsyncSync = realFsync; fs.renameSync = realRename; }
  return { events, out, err };
}
function flushedBeforeRename(events, file) {
  const r = events.findIndex((e) => e[0] === 'rename' && e[2] === file);
  assert.ok(r >= 0, 'no rename into ' + path.basename(file) + ': ' + JSON.stringify(events));
  assert.ok(events.slice(0, r).some((e) => e[0] === 'fsync' && e[1] === events[r][1]), path.basename(file) + ': the temp was not flushed before its rename');
}

test('#5434 feedback report: flushed before its rename', () => {
  const { events, out, err } = recording(() => feedback.write('a finding worth keeping', { date: '2026-10-09' }));
  assert.equal(err, null, String(err));
  assert.equal(out.ok, true, JSON.stringify(out));
  flushedBeforeRename(events, feedback.pathFor('2026-10-09'));
});

test('#5434 Windows session record: flushed before its rename, exactly 0600 over a loose file', () => {
  fs.mkdirSync(path.dirname(win32sessions.FILE), { recursive: true });
  fs.writeFileSync(win32sessions.FILE, '{}\n', { mode: 0o644 });
  if (process.platform !== 'win32') fs.chmodSync(win32sessions.FILE, 0o644);
  const prev = process.umask(0o022);
  let rec;
  try { rec = recording(() => win32sessions.record('sess-1', { name: 'ana', runner: 'claude' })); } finally { process.umask(prev); }
  assert.equal(rec.err, null, String(rec.err));
  assert.equal(rec.out.ok, true, JSON.stringify(rec.out));
  flushedBeforeRename(rec.events, win32sessions.FILE);
  if (process.platform !== 'win32') assert.equal(fs.statSync(win32sessions.FILE).mode & 0o777, 0o600);
});

test('#5434: all six writers save flushed, with no hand-made temp renamed', () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  const scan = { 'connect.js': 'STATE_FILE()', 'agentbrowser.js': 'writeConfigIfNeeded', 'feedback.js': 'dest, content', 'win32sessions.js': 'FILE_MODE', 'win32streamstate.js': 'saveFlushed(at', 'setup-assistant.js': 'writeSecret(file, text, 0o600' };
  // setup-assistant.js holds other writers (the guard settings, the guard state) owned by other slices: scan only
  // writeLaunchRecord there.
  const only = { 'setup-assistant.js': 'function writeLaunchRecord(' };
  const body = (src, header) => { const i = src.indexOf(header); assert.ok(i >= 0, header + ' not found'); return src.slice(i, src.indexOf('\n}\n', i)); };
  for (const [f, mark] of Object.entries(scan)) {
    let src = strip(fs.readFileSync(path.join(__dirname, f), 'utf8'));
    if (only[f]) src = body(src, only[f]);
    assert.ok(src.includes(mark), f + ': the marker ' + mark + ' is gone, so this scan is aimed at nothing');
    assert.doesNotMatch(src, /renameSync\(tmp, (?:STATE_FILE\(\)|file\(\)|file|dest|at)\)/, f + ': still renames a hand-made temp');
  }
  for (const f of ['win32sessions.js', 'setup-assistant.js']) {
    let src = strip(fs.readFileSync(path.join(__dirname, f), 'utf8'));
    if (only[f]) src = body(src, only[f]);
    assert.match(src, /writeSecret\([^;]*(?:0o600|FILE_MODE)[^;]*atomicOnly/, f + ': an owner-only record must save at its exact mode');
  }
});
