'use strict';
/* kosmos#8935: the first use of a command with a longer guide names the guide, once per agent per guide. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const hh = require('./howhint');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'howhint-')));
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
let n = 0;
const fresh = () => path.join(SANDBOX, 'rec-' + (++n) + '.json');
const envFor = (agent, file) => ({ KOSMOS_AGENT_SESSION: agent, KOSMOS_HOWHINT_FILE: file });

test('#8935 each guided command maps to its guide; reading the guide is recognised; task built is left to its own line', () => {
  assert.deepEqual(hh.classify('claim', ['proj', '12']), { guide: 'kosmos claim --how', readsIt: false });
  assert.deepEqual(hh.classify('claim', ['--how']), { guide: 'kosmos claim --how', readsIt: true });
  assert.deepEqual(hh.classify('report', ['needs_you', '--held']), { guide: 'kosmos report --help', readsIt: false });
  assert.deepEqual(hh.classify('report', ['--help']), { guide: 'kosmos report --help', readsIt: true });
  assert.equal(hh.classify('report', ['--how']).readsIt, false, 'report has no --how: only --help reads its guide');
  assert.equal(hh.classify('task', ['built', 'p', '3']), null, 'kosmos#8934 names the task guide on task built');
  assert.deepEqual(hh.classify('task', ['add', 'p', 'x']), { guide: 'kosmos task --how', readsIt: false });
  assert.equal(hh.classify('msg', ['x']), null, 'CONTROL: a command with no longer guide');
  for (const c of ['post', 'community', 'connections']) assert.equal(hh.classify(c, []).guide, 'kosmos ' + c + ' --how');
});

test('#8935 the first use points at the guide once per agent per guide; CONTROL: a second use, another guide, another agent', () => {
  const file = fresh();
  const first = hh.hint('claim', ['p', '7'], { env: envFor('mona', file) });
  assert.equal(first, 'First use of kosmos claim here: its full guide is kosmos claim --how (shown once).');
  assert.equal(hh.hint('claim', ['p', '8'], { env: envFor('mona', file) }), '', 'shown twice to the same agent');
  assert.match(hh.hint('post', ['p', 'hi'], { env: envFor('mona', file) }), /kosmos post --how/, 'CONTROL: another guide still points');
  assert.match(hh.hint('claim', ['p', '7'], { env: envFor('pete', file) }), /kosmos claim --how/, 'CONTROL: another agent still gets it');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { mona: ['claim', 'post'], pete: ['claim'] });
});

test('#8935 reading the guide first counts as seen, so that agent is never pointed at it', () => {
  const file = fresh();
  assert.equal(hh.hint('task', ['--how'], { env: envFor('mona', file) }), '');
  assert.equal(hh.hint('task', ['add', 'p', 'x'], { env: envFor('mona', file) }), '', 'pointed at a guide it already read');
  assert.equal(hh.hint('report', ['--help'], { env: envFor('mona', file) }), '');
  assert.equal(hh.hint('report', ['needs_you', '--held'], { env: envFor('mona', file) }), '');
});

test('#8935 a person (no KOSMOS_AGENT_SESSION) never sees it and nothing is written; task built neither points nor marks', () => {
  const file = fresh();
  assert.equal(hh.hint('claim', ['p', '7'], { env: { KOSMOS_HOWHINT_FILE: file } }), '');
  assert.equal(fs.existsSync(file), false, 'a person\'s call wrote the record');
  assert.equal(hh.hint('task', ['built', 'p', '3'], { env: envFor('mona', file) }), '');
  assert.match(hh.hint('task', ['add', 'p', 'x'], { env: envFor('mona', file) }), /kosmos task --how/, 'task built marked the task guide seen');
});

test('#8935 never throws: a corrupt record starts over, an unwritable one only means the pointer may show again', () => {
  const file = fresh();
  fs.writeFileSync(file, '{ not json');
  assert.match(hh.hint('claim', [], { env: envFor('mona', file) }), /kosmos claim --how/);
  const blocked = path.join(SANDBOX, 'a-file');
  fs.writeFileSync(blocked, 'x');
  const unwritable = path.join(blocked, 'rec.json');   // its "folder" is a file
  assert.match(hh.hint('claim', [], { env: envFor('mona', unwritable) }), /kosmos claim --how/);
  assert.match(hh.hint('claim', [], { env: envFor('mona', unwritable) }), /kosmos claim --how/, 'nothing could be recorded, so it shows again');
  assert.equal(hh.hint(undefined, undefined, { env: envFor('mona', file) }), '');
});
