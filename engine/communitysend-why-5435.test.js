'use strict';
/**
 * #5435 review 1: two "no"s willSend must not call the switch. A switch file that cannot be read is not the person
 * switching Community off, and an ON period whose start cannot be WRITTEN is a record fault, not an unreadable one
 * the words used to name. engine/communitycomment-4373.test.js covers the other reasons.
 *
 *   node --test engine/communitysend-why-5435.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-sendwhy-5435-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
const cs = require('./communitysend');

test.after(() => { cs.setSwitch(null); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

function fresh() {
  const data = process.env.AGENT_WORKFORCE_DATA;
  assert.ok(data.startsWith(SANDBOX + path.sep), 'refusing to touch a data root outside this test\'s sandbox');
  fs.rmSync(data, { recursive: true, force: true });
}

test('#5435: an unreadable switch file is a record fault, not the switch; an OFF switch is still the switch', () => {
  fresh();
  cs.setSwitch(() => ({ on: false, ok: false }));   // communityswitch's answer for a file it cannot read
  assert.equal(cs.willSend('ava').why, 'records');
  assert.equal(cs.switchOn(), false, 'every other reader must still treat an unreadable switch as off');
  cs.setSwitch(() => ({ on: false, ok: true }));
  assert.equal(cs.willSend('ava').why, 'off', 'control: a switch the person turned off');
  cs.setSwitch(() => { throw new Error('torn'); });
  assert.equal(cs.willSend('ava').why, 'records', 'a switch read that throws is not the person\'s choice either');
  cs.setSwitch(null);
});

test('#5435: an ON period whose start cannot be written says records, in words that say read or write', (t) => {
  if (process.platform === 'win32') { t.skip('a read-only folder does not stop a write on Windows'); return; }
  fresh();
  cs.setSwitch(() => ({ on: true, ok: true }));
  const dir = path.dirname(cs._paths.stateFile());
  fs.mkdirSync(dir, { recursive: true });
  // Every record readable, the state with no start yet, and the folder read-only so the start cannot be written.
  for (const f of [cs._paths.stateFile(), cs._paths.keysFile(), cs._paths.sentFile(), cs._paths.deletesFile(), cs._paths.commentsSentFile(), cs._paths.commentDeletesFile()]) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '{}\n');
  }
  assert.equal(cs.willSend('ava').sends, true, 'control: with the folder writable it sends (and records the start)');
  fs.writeFileSync(cs._paths.stateFile(), '{}\n');   // the start forgotten again
  fs.chmodSync(dir, 0o500);
  const lines = [];
  const real = console.error;
  console.error = (...a) => { lines.push(a.join(' ')); };
  try {
    assert.equal(cs.willSend('ava').why, 'records', 'a start that could not be written read as something else');
    // Review 2: the words send the person to the log, so the log names the file it could not write.
    assert.ok(lines.some((l) => l.includes('cannot write ' + cs._paths.stateFile())), 'the log does not name the state file: ' + JSON.stringify(lines));
  } finally { console.error = real; fs.chmodSync(dir, 0o700); }
  assert.match(cs.notSendingWords('post', 'records'), /cannot read or write/);
  assert.match(cs.notSendingWords('comment', 'records'), /cannot read or write/);
  cs.setSwitch(null);
});

test('#5435: a post\'s words promise nothing about later and send the agent to status; an address tells it to tell its person', () => {
  for (const why of ['address', 'records']) {
    const words = cs.notSendingWords('post', why);
    assert.match(words, /before you see where it stands with: kosmos community status/, why + ': not sent to status');
    assert.doesNotMatch(words, /until that is fixed|goes once|will go/, why + ': promised a post goes later');
  }
  assert.match(cs.notSendingWords('post', 'address'), /Tell your person/);
  assert.match(cs.notSendingWords('comment', 'address'), /Tell your person/);
});

test('#5435 review 2: the log names the switch file, once, when it cannot be read (the words send the person there)', () => {
  fresh();
  const lines = [];
  const real = console.error;
  console.error = (...a) => { lines.push(a.join(' ')); };
  try {
    cs.setSwitch(() => ({ on: false, ok: false }));
    cs.willSend('ava');
    cs.willSend('ava');
    const named = lines.filter((l) => /cannot read the community switch file \(.*community\.json\)/.test(l));
    assert.equal(named.length, 1, 'not named once: ' + JSON.stringify(lines));
    cs.setSwitch(() => ({ on: true, ok: true }));
    cs.willSend('ava');   // readable again: the next failure is said again
    cs.setSwitch(() => ({ on: false, ok: false }));
    cs.willSend('ava');
    assert.equal(lines.filter((l) => /cannot read the community switch file/.test(l)).length, 2, 'a second failure after a recovery was not logged');
  } finally { console.error = real; cs.setSwitch(null); }
});

test('#5435 review 3: a sweep keeps the ON period while the switch file cannot be read; only OFF ends it', async () => {
  fresh();
  const since = '2026-01-01T00:00:00.000Z';
  fs.mkdirSync(path.dirname(cs._paths.stateFile()), { recursive: true });
  fs.writeFileSync(cs._paths.stateFile(), JSON.stringify({ since }) + '\n');
  cs.setSender(() => { throw new Error('this test sends nothing'); });   // nothing may reach the network
  try {
    cs.setSwitch(() => ({ on: false, ok: false }));
    await cs.sweep();
    assert.equal(JSON.parse(fs.readFileSync(cs._paths.stateFile(), 'utf8')).since, since, 'an unreadable switch ended the period, losing every post made meanwhile');
    cs.setSwitch(() => ({ on: false, ok: true }));
    await cs.sweep();
    assert.equal(JSON.parse(fs.readFileSync(cs._paths.stateFile(), 'utf8')).since, undefined, 'CONTROL: switched off, the period did not end');
  } finally { cs.setSender(null); cs.setSwitch(null); }
});

test('#5435 review 3: read, vote and follow say a switch file cannot be read, not that the community is switched off', async () => {
  fresh();
  const read = require('./communityread');
  cs.setSwitch(() => ({ on: false, ok: false }));
  try {
    assert.match(cs.notOnWords(), /cannot read this board's community switch/);
    const r = await read.read({});
    assert.equal(r.ok, false);
    assert.match(r.because, /cannot read this board's community switch/);
    assert.doesNotMatch(r.because, /switched off/);
    cs.setSwitch(() => ({ on: false, ok: true }));
    assert.match((await read.read({})).because, /switched off on this board/, 'CONTROL: a switch turned off says so');
  } finally { cs.setSwitch(null); }
});

test('#5435 review 4: willSend opens the dark window the moment it finds the switch unreadable, before the post is stored', () => {
  fresh();
  const since = '2026-01-01T00:00:00.000Z';
  fs.mkdirSync(path.dirname(cs._paths.stateFile()), { recursive: true });
  fs.writeFileSync(cs._paths.stateFile(), JSON.stringify({ since }) + '\n');
  cs.setSwitch(() => ({ on: false, ok: false }));
  try {
    const now = Date.parse('2026-02-01T00:00:00.000Z');
    assert.equal(cs.willSend('ava', now, 'post').why, 'records');
    const st = JSON.parse(fs.readFileSync(cs._paths.stateFile(), 'utf8'));
    assert.deepEqual(st.dark, [{ from: '2026-02-01T00:00:00.000Z' }]);
    assert.equal(st.since, since, 'the period was ended');
    assert.equal(cs.inDark(st, '2026-02-01T00:00:00.000Z'), true);
    assert.equal(cs.inDark(st, '2026-01-31T23:59:59.999Z'), false, 'CONTROL: made before the tear');
    cs.willSend('ava', now + 60000, 'post');
    assert.equal(JSON.parse(fs.readFileSync(cs._paths.stateFile(), 'utf8')).dark.length, 1, 'a second window opened while one was open');
  } finally { cs.setSwitch(null); }
});
