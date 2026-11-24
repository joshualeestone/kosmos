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
function read(died, runs, rows) {
  const files = { [mr.diedFileFor('hal')]: died, [crashloop.fileFor('hal')]: runs };
  return mr.restartedFor('hal', {
    read: (f) => { if (files[f] === undefined) throw Object.assign(new Error('none'), { code: 'ENOENT' }); return files[f]; },
    history: () => rows || [],
  });
}

test('#8988 parseDied: a status, a signal (named as tmux prints it), and nothing else', () => {
  assert.deepEqual(mr.parseDied(T0 + ' status 7\n'), { atMs: T0 * 1000, code: 7, signal: null });
  assert.deepEqual(mr.parseDied(T0 + ' signal term'), { atMs: T0 * 1000, code: null, signal: 'SIGTERM' });
  assert.deepEqual(mr.parseDied(T0 + ' signal SIGKILL'), { atMs: T0 * 1000, code: null, signal: 'SIGKILL' });
  for (const bad of ['', 'x status 7', T0 + ' status', T0 + ' status -1', T0 + ' signal 9x', T0 + ' exit 7', null]) {
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
  assert.equal(read(undefined, 'start ' + (T0 + 40) + '\n'), null, 'CONTROL: no death recorded, no line');
  assert.equal(read(T0 + ' status 0\n', 'start ' + (T0 + 40) + '\n'), null, 'exit 0 is Claude closed on purpose (/exit), not a crash');
  assert.equal(read(T0 + ' status 7\n', undefined), null, 'no run file, no line');
});

test('#8988 a finished answer after the restart clears it; one before it, an operator row, or a working row does not', () => {
  const runs = 'start ' + (T0 + 40) + '\n';
  const at = (s) => new Date(s * 1000).toISOString();
  const done = (s, extra) => ({ state: 'idle', because: 'finished responding', at: at(s), by: 'auto', ...extra });
  assert.equal(read(T0 + ' status 7\n', runs, [done(T0 + 100)]), null, 'a turn finished on the restarted process');
  assert.ok(read(T0 + ' status 7\n', runs, [done(T0 - 100)]), 'a turn before the restart does not clear it');
  assert.ok(read(T0 + ' status 7\n', runs, [done(T0 + 100, { by: 'operator' })]), 'a person\'s row is not the agent\'s turn');
  assert.ok(read(T0 + ' status 7\n', runs, [{ state: 'working', because: 'started', at: at(T0 + 100) }]), 'a turn that only started does not');
  assert.ok(read(T0 + ' status 7\n', runs, [{ state: 'idle', because: 'waiting for direction', at: at(T0 + 100) }]), 'another idle is not a finished answer');
  const unreadable = mr.restartedFor('hal', { read: (f) => (f === mr.diedFileFor('hal') ? T0 + ' status 7\n' : runs), history: () => { throw new Error('x'); } });
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
