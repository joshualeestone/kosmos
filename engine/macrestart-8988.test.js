'use strict';
require('../test-support/tmpscope');
/**
 * kosmos#8988: engine/macrestart.js, the Mac card's "Restarted at <time>: <why>", from the supervisor's death file and
 * run file, cleared by a finished answer.
 *
 *   node --test engine/macrestart-8988.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-macrestart-8988-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./store');
const mr = require('./macrestart');
const crashloop = require('./crashloop');
const { assertSandboxedDataRoot } = require('../test-support/data-root-sandbox');

assertSandboxedDataRoot(SANDBOX, [store.ROOT]);

const T0 = 1795530000;   // a death, in epoch seconds
/** restartedFor over files given as text, and a self-report history given as rows. */
/* The self-report record is a REAL file read by the real selfreport.history (review 3: hand-built rows had a shape
   history() never returns, so every arm passed against a reader that could not work). */
const selfreport = require('./selfreport');
function reports(rows) {
  const f = selfreport.fileFor('hal');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, (rows || []).map((r) => JSON.stringify({ v: 1, ...r })).join('\n') + (rows && rows.length ? '\n' : ''));
}
function read(died, runs, rows) {
  reports(rows);
  const files = { [mr.diedFileFor('hal')]: died, [crashloop.fileFor('hal')]: runs };
  return mr.restartedFor('hal', {
    memo: false,   // each arm is its own agent; the memo has its own test
    bootMs: (T0 - 100000) * 1000,   // these deaths are long after the boot; the reboot arm says otherwise
    read: (f) => { if (files[f] === undefined) throw Object.assign(new Error('none'), { code: 'ENOENT' }); return files[f]; },
  });
}

test('#8988 parseDied: a status, a signal (named as tmux prints it), and nothing else', () => {
  assert.deepEqual(mr.parseDied(T0 + ' status 7\n'), { atMs: T0 * 1000, code: 7, signal: null });
  assert.deepEqual(mr.parseDied(T0 + ' signal term'), { atMs: T0 * 1000, code: null, signal: 'SIGTERM' });
  assert.deepEqual(mr.parseDied(T0 + ' signal SIGKILL'), { atMs: T0 * 1000, code: null, signal: 'SIGKILL' });
  assert.deepEqual(mr.parseDied(T0 + ' signal 9'), { atMs: T0 * 1000, code: null, signal: '9' }, 'a system that names no signals prints the number');
  assert.equal(mr.parseDied(T0 + ' status 0').code, 0, 'CONTROL: the parser keeps an exit 0; the reader is what hides it');
  for (const bad of ['', 'x status 7', T0 + ' status', T0 + ' status -1', T0 + ' signal 9x!', T0 + ' exit 7', null]) {
    assert.equal(mr.parseDied(bad), null, JSON.stringify(bad));
  }
});

test('#8988 the restart is the last start, within the window after the death', () => {
  const r = read(T0 + ' status 7\n', 'start ' + (T0 - 600) + '\nend ' + T0 + '\nstart ' + (T0 + 40) + '\n');
  assert.deepEqual(r, { at: new Date((T0 + 40) * 1000).toISOString(), why: 'Claude stopped unexpectedly (exit code 7).' });
  assert.equal(read(T0 + ' signal term\n', 'start ' + (T0 + 40) + '\n').why, 'Claude was ended (signal SIGTERM).');
  assert.equal(read(T0 + ' status 7\n', 'start ' + (T0 + 40 + 3600) + '\n'), null, 'a start long after the death is a launch of its own');
  assert.equal(read(T0 + ' status 7\n', 'start ' + (T0 + 40) + '\nend ' + (T0 + 500) + '\nstart ' + (T0 + 900) + '\n'), null,
    'a later start (a person\'s restart) is not that death\'s restart');
  assert.equal(read(T0 + ' status 7\n', 'start ' + (T0 - 30) + '\n'), null, 'the death came after the last start: no restart yet');
  const start = 'start ' + (T0 + 40) + '\n';
  assert.equal(read(T0 + ' signal term\n', 'kosmos ' + (T0 - 5) + '\n' + start), null, 'Kosmos ended it (a restart, a switch): not a crash');
  assert.ok(read(T0 + ' signal term\n', 'kosmos ' + (T0 - 3600) + '\n' + start), 'CONTROL: a Kosmos restart an hour before is another event');
  assert.ok(read(T0 + ' status 1\n', 'kosmos ' + (T0 - 50) + '\nend ' + (T0 - 45) + '\nstart ' + (T0 - 40) + '\nend ' + T0 + '\n' + start),
    'a switch whose NEW process crashed: the crash is said');
  assert.ok(read(T0 + ' status 1\n', 'start ' + (T0 - 600) + '\nend ' + T0 + '\nkosmos ' + (T0 + 20) + '\n' + start),
    'a person restarting an agent that had already crashed: the crash is still why');
  const rebooted = (boot) => mr.restartedFor('hal', { memo: false, bootMs: boot * 1000, history: () => [],
    read: (f) => (f === mr.diedFileFor('hal') ? T0 + ' signal term\n' : start) });
  assert.equal(rebooted(T0 + 20), null, 'a death before this boot is the shutdown, not Claude');
  assert.ok(rebooted(T0 - 3600), 'CONTROL: the same death in this boot is said');
  assert.equal(read(undefined, 'start ' + (T0 + 40) + '\n'), null, 'CONTROL: no death recorded, no line');
  assert.equal(read(T0 + ' status 0\n', 'start ' + (T0 + 40) + '\n'), null, 'exit 0 is Claude closed on purpose (/exit), not a crash');
  assert.equal(read(T0 + ' status 7\n', undefined), null, 'no run file, no line');
});

test('#8988 a finished answer after the restart clears it; one before it, an operator row, or a working row does not', () => {
  const runs = 'start ' + (T0 + 40) + '\n';
  const at = (s) => new Date(s * 1000).toISOString();
  const done = (s, extra) => ({ state: 'idle', because: 'finished responding', at: at(s), by: 'auto', ...extra });
  assert.equal(read(T0 + ' status 7\n', runs, [done(T0 + 100)]), null, 'a turn finished on the restarted process');
  assert.equal(selfreport.history('hal').filter((r) => r.turn === 'end').length, 1, 'CONTROL: the real reader marks the hook\'s Stop as a turn end');
  assert.ok(read(T0 + ' status 7\n', runs, [done(T0 - 100)]), 'a turn before the restart does not clear it');
  assert.ok(read(T0 + ' status 7\n', runs, [done(T0 + 100, { by: 'operator' })]), 'a person\'s row is not the agent\'s turn');
  assert.ok(read(T0 + ' status 7\n', runs, [{ state: 'working', because: 'started', at: at(T0 + 100) }]), 'a turn that only started does not');
  assert.ok(read(T0 + ' status 7\n', runs, [{ state: 'idle', because: 'waiting for direction', at: at(T0 + 100) }]), 'another idle is not a finished answer');
  assert.ok(read(T0 + ' status 7\n', runs, [{ state: 'blocked', because: 'provider api (rate_limit)', by: 'auto', on: 'provider api (rate_limit)', at: at(T0 + 100) }]),
    'a turn that ended in an API error (StopFailure) does not clear it');
  /* Review 7: a turn that heartbeats past 64 KB keeps its Stop out of the default reading, and the line must not come
     back (the real record, the real reader). */
  const beats = [done(T0 + 50)];
  for (let i = 0; i < 2500; i++) beats.push({ state: 'working', because: 'answering a prompt', by: 'auto', at: at(T0 + 60 + i) });
  reports(beats);
  assert.ok(fs.statSync(selfreport.fileFor('hal')).size > 64 * 1024, 'precondition: more than the default reading');
  assert.equal(read(T0 + ' status 7\n', runs, beats), null, 'a finished turn long before a long turn of heartbeats still clears it');
  const cut = [{ state: 'working', at: T0 * 1000 + 90000, by: 'auto' }]; cut.truncated = true;
  assert.equal(mr.restartedFor('hal', { memo: false, bootMs: 0, history: () => cut, read: (f) => (f === mr.diedFileFor('hal') ? T0 + ' status 7\n' : runs) }), null,
    'a record cut short before the restart cannot say: no line');
  const reached = [{ state: 'working', at: T0 * 1000 - 1000, by: 'auto' }]; reached.truncated = true;
  assert.ok(mr.restartedFor('hal', { memo: false, bootMs: 0, history: () => reached, read: (f) => (f === mr.diedFileFor('hal') ? T0 + ' status 7\n' : runs) }),
    'CONTROL: a cut record that reaches back past the restart, with no finished turn, keeps the line');
  const unreadable = mr.restartedFor('hal', { memo: false, read: (f) => (f === mr.diedFileFor('hal') ? T0 + ' status 7\n' : runs), history: () => { throw new Error('x'); } });
  assert.equal(unreadable, null, 'when the record cannot say, no line');
});

test('#8988 the card carries it for one of our Mac Claude panes only', () => {
  const status = require('./status');
  const dir = crashloop.dir();
  fs.mkdirSync(dir, { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  fs.writeFileSync(mr.diedFileFor('hal'), (now - 60) + ' status 2\n');
  fs.writeFileSync(crashloop.fileFor('hal'), 'start ' + (now - 30) + '\n');
  const ours = { name: 'hal', session: 'hal', claim: 'hal', command: 'claude' };
  assert.deepEqual(status.restartedOf(ours), { at: new Date((now - 30) * 1000).toISOString(), why: 'Claude stopped unexpectedly (exit code 2).' });
  assert.equal(status.restartedOf({ ...ours, claim: null }), null, 'not a pane we can tie to the name');
  assert.equal(status.restartedOf({ ...ours, runner: 'codex' }), null, 'not another runner');
  assert.equal(status.restartedOf({ ...ours, command: 'codex' }), null, 'not a codex pane without its tag');
  fs.rmSync(mr.diedFileFor('hal'));
  assert.equal(status.restartedOf(ours), null, 'CONTROL: no death, no line');
});

test('#8988 the files are where the supervisor writes them (the run file\'s folder and key)', () => {
  assert.equal(path.dirname(mr.diedFileFor('Hal-9')), crashloop.dir());
  assert.equal(path.basename(mr.diedFileFor('Hal-9')), store.safeKey('Hal-9') + '.died');
  assert.equal(path.basename(crashloop.fileFor('Hal-9')), store.safeKey('Hal-9') + '.log');
});

test('#8988 a removed or re-made agent carries no death from its last life', () => {
  fs.mkdirSync(crashloop.dir(), { recursive: true });
  fs.writeFileSync(mr.diedFileFor('hal'), '1 status 7\n');
  fs.writeFileSync(crashloop.fileFor('hal'), 'start 1\n');
  crashloop.forget('hal');
  assert.equal(fs.existsSync(mr.diedFileFor('hal')), false);
  assert.equal(fs.existsSync(crashloop.fileFor('hal')), false);
});

test('#8988 the supervisor writes no death file for an agent in a named Kosmos', { skip: process.platform === 'win32' && 'it runs a bash function' }, () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bin', 'agent-supervisor.sh'), 'utf8');
  const take = (name) => { const m = new RegExp('\\n' + name + '\\(\\) \\{\\n[\\s\\S]*?\\n\\}\\n').exec(src); assert.ok(m, name + ' is gone from bin/agent-supervisor.sh'); return m[0]; };
  const data = path.join(SANDBOX, 'world');
  fs.mkdirSync(data, { recursive: true });
  const { spawnSync } = require('node:child_process');
  const run = (world) => spawnSync('/bin/bash', ['-c', 'set -u\n' + take('runs_file') + take('died_file') + '\nSESSION=ava\ndied_file'],
    { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: SANDBOX, AGENT_WORKFORCE_DATA: data, ...(world === undefined ? {} : { KOSMOS_WORLD: world }) } });
  assert.match(run(undefined).stdout, /\/Kosmos\/runs\/ava\.died$/m, 'CONTROL: the default Kosmos has one');
  assert.match(run('default').stdout, /\/Kosmos\/runs\/ava\.died$/m);
  assert.equal(run('qa').stdout, '', 'a named Kosmos has none');
});

test('#8988 a later launch takes the line with it: a person restart after a cleared crash does not bring the crash back', () => {
  const at = (n) => new Date(n * 1000).toISOString();
  const runs = 'start ' + (T0 - 600) + '\nend ' + T0 + '\nstart ' + (T0 + 40) + '\n';
  const rows = [{ state: 'idle', because: 'finished responding', by: 'auto', at: at(T0 + 100) }];
  assert.equal(read(T0 + ' status 7\n', runs, rows), null, 'the first restart: the turn cleared it');
  assert.ok(read(T0 + ' status 7\n', runs, []), 'CONTROL: with no turn it is said');
  assert.equal(read(T0 + ' status 7\n', runs + 'kosmos ' + (T0 + 200) + '\nend ' + (T0 + 210) + '\nstart ' + (T0 + 230) + '\n', rows), null,
    'a person\'s restart later is another launch: nothing');
  /* The run that died, and the one right after it, in whole seconds (measured: the relaunch's start can share the death's
     second, or come just before tmux's death time). */
  assert.ok(read((T0 + 1) + ' status 7\n', 'start ' + T0 + '\nend ' + (T0 + 1) + '\nstart ' + (T0 + 1) + '\n'), 'same second');
  assert.ok(read((T0 + 2) + ' status 7\n', 'start ' + T0 + '\nend ' + (T0 + 1) + '\nstart ' + (T0 + 1) + '\n'), 'start a second before the death time');
  assert.equal(read((T0 + 1) + ' status 7\n', 'start ' + T0 + '\n'), null, 'no relaunch yet: the run that died is still the last');
  assert.equal(read(T0 + ' status 7\n', runs + 'end ' + (T0 + 60) + '\nstart ' + (T0 + 70) + '\n', []), null,
    'a second launch, for any reason, ends that line (a failed relaunch too, the plan\'s stated cost)');
});

test('#8988 a cleared line is not read again at every poll', () => {
  mr.CLEARED.clear();
  let reads = 0;
  const run = () => mr.restartedFor('hal', { bootMs: 0, history: () => { reads += 1; const r = [{ turn: 'end', at: (T0 + 100) * 1000, state: 'idle' }]; return r; },
    read: (f) => (f === mr.diedFileFor('hal') ? T0 + ' status 7\n' : 'start ' + (T0 + 40) + '\n') });
  assert.equal(run(), null);
  assert.equal(run(), null);
  assert.equal(reads, 1, 'the second poll did not read the history again');
  /* CONTROL: a newer crash (a new death, a new start) is read afresh. */
  const later = mr.restartedFor('hal', { bootMs: 0, history: () => { reads += 1; return []; },
    read: (f) => (f === mr.diedFileFor('hal') ? (T0 + 500) + ' status 9\n' : 'start ' + (T0 + 540) + '\n') });
  assert.ok(later, 'the next death is its own line');
  mr.CLEARED.clear();
});
