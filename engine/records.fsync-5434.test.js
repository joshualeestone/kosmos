'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/**
 * kosmos#5434 slice 20: twelve records Kosmos keeps (commitments, instruction-adds, the world boot guard's two maps,
 * world starts, federation links and invites, agent permissions, the restart note, room holds, the org rollup state,
 * styles, the community store) save through store.saveFlushed or securewrite.writeSecret, so each is flushed before
 * the rename makes it the file (#5431). commitments and instruction-adds are driven through their public saves (the
 * latter at exact 0600); all twelve are held to "flushed save, no hand-made temp" by reading their source.
 *
 *   node --test engine/records.fsync-5434.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'records-fsync-workers-')));
const DATA = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'records-fsync-data-')));
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'records-fsync-home-'));
process.env.AGENT_WORKFORCE_WORKERS = ROOT;
process.env.AGENT_WORKFORCE_DATA = DATA;
process.env.HOME = HOME;

const test = require('node:test');
const assert = require('node:assert/strict');
const adds = require('./instructionadds');
const commitments = require('./commitments');
test.after(() => { for (const d of [ROOT, DATA, HOME]) fs.rmSync(d, { recursive: true, force: true }); });

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

test('#5434 commitments: a report is flushed before its rename', () => {
  const { events, err } = recording(() => commitments.report('flushme', [{ what: 'ship it', id: 'k1', createdAt: new Date().toISOString(), source: 'agent' }]));
  assert.equal(err, null, String(err));
  flushedBeforeRename(events, commitments.recordPath('flushme'));
});

test('#5434 instruction-adds: the record is flushed before its rename, and an existing 0644 record ends exactly 0600', () => {
  fs.mkdirSync(path.join(ROOT, 'sally'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'sally', 'CLAUDE.md'), 'You are the sales agent. Answer leads from the shared inbox, politely and quickly.\n');
  // review 1: an ordinary umask and a LOOSE existing record, so only an exact-mode save gives 0600 (saveFlushed would
  // keep 0644 here, and under umask 077 would have given 0600 by accident).
  fs.mkdirSync(path.dirname(adds.FILE), { recursive: true });
  fs.writeFileSync(adds.FILE, '{}\n', { mode: 0o644 });
  fs.chmodSync(adds.FILE, 0o644);
  const prev = process.umask(0o022);
  let rec;
  try { rec = recording(() => adds.propose('sally', 'When a lead goes quiet for two days, write once. Then tell me.', 'Ops lead')); }
  finally { process.umask(prev); }
  assert.equal(rec.err, null, String(rec.err));
  flushedBeforeRename(rec.events, adds.FILE);
  if (process.platform !== 'win32') assert.equal(fs.statSync(adds.FILE).mode & 0o777, 0o600);
});

test('#5434 agent permission settings: an existing 0644 file ends exactly 0600 (review 1)', { skip: process.platform === 'win32' && 'POSIX modes' }, () => {
  const ap = require('./agentpermission');
  const file = path.join(DATA, 'ap-mode', 'agent-permission-settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'old\n', { mode: 0o644 });
  fs.chmodSync(file, 0o644);
  const prev = process.umask(0o022);
  let rec;
  try { rec = recording(() => ap.ensureSettings({ platform: 'darwin', node: '/usr/local/bin/node', script: '/tmp/hook.js', file })); }
  finally { process.umask(prev); }
  assert.equal(rec.out, file, 'the settings were not written: ' + String(rec.out));
  flushedBeforeRename(rec.events, file);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('#5434: all twelve writers save flushed, with no hand-made temp renamed', () => {
  const files = ['commitments.js', 'instructionadds.js', 'worldbootguard.js', 'worldstarts.js', 'federation.js', 'fedmembers.js',
    'agentpermission.js', 'restartnote.js', 'roomhold.js', 'orgrollup.js', 'styles.js', 'communitystore.js'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.match(src, /(?:saveFlushed|writeSecret)\(/, f + ': no flushed save');
    // Any rename at all, except the two documented MOVES (review 1): instructionadds' unreadable-file aside and the
    // community store's corrupt-file quarantine.
    const count = (needle) => src.split(needle).length - 1;
    const moves = count('renameSync(file(), aside)') + count('renameSync(file, `${file}.corrupt-');
    assert.equal(count('renameSync(') - moves, 0, f + ': still renames by hand');
  }
});
