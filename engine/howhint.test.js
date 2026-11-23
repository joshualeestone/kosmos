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
  assert.equal(hh.classify('report', ['--how']).readsIt, false, 'report has no --how (its guide is --help, answered before this runs)');
  assert.equal(hh.classify('task', ['built', 'p', '3']), null, 'kosmos#8934 names the task guide on task built');
  assert.deepEqual(hh.classify('task', ['add', 'p', 'x']), { guide: 'kosmos task --how', readsIt: false });
  assert.equal(hh.classify('msg', ['x']), null, 'CONTROL: a command with no longer guide');
  for (const c of ['post', 'community', 'connections']) assert.equal(hh.classify(c, ['x']).guide, 'kosmos ' + c + ' --how');
  assert.equal(hh.classify('report', []), null, 'a bare call (the report hook\'s status probe, or a usage request) does not count');
  assert.equal(hh.classify('report', ['working', '--auto', 'running Bash']), null, 'the report hook\'s own --auto calls do not count');
  assert.equal(hh.classify('post', ['p', 'use --auto here']).guide, 'kosmos post --how', 'CONTROL: --auto in a message body is just text');
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
  assert.match(hh.hint('claim', ['p'], { env: envFor('mona', file) }), /kosmos claim --how/);
  const blocked = path.join(SANDBOX, 'a-file');
  fs.writeFileSync(blocked, 'x');
  const unwritable = path.join(blocked, 'rec.json');   // its "folder" is a file
  assert.match(hh.hint('claim', ['p'], { env: envFor('mona', unwritable) }), /kosmos claim --how/);
  assert.match(hh.hint('claim', ['p'], { env: envFor('mona', unwritable) }), /kosmos claim --how/, 'nothing could be recorded, so it shows again');
  assert.equal(hh.hint(undefined, undefined, { env: envFor('mona', file) }), '');
  /* An agent named like an Object key is recorded like any other. */
  const odd = fresh();
  assert.match(hh.hint('claim', ['p'], { env: envFor('__proto__', odd) }), /kosmos claim --how/);
  assert.equal(hh.hint('claim', ['p'], { env: envFor('__proto__', odd) }), '', 'an agent named __proto__ was pointed twice');
});

test('#8935 a Windows agent (a launch token, no session name) is pointed once per launch, and only a hash of the token is kept', () => {
  const file = fresh();
  const env = { KOSMOS_AGENT_TOKEN: 'tok-SECRET-8935', KOSMOS_HOWHINT_FILE: file };
  assert.match(hh.hint('post', ['p', 'hi'], { env }), /kosmos post --how/);
  assert.equal(hh.hint('post', ['p', 'hi'], { env }), '', 'shown twice in one launch');
  assert.match(hh.hint('post', ['p', 'hi'], { env: { KOSMOS_AGENT_TOKEN: 'tok-next-launch', KOSMOS_HOWHINT_FILE: file } }), /kosmos post --how/, 'CONTROL: a new launch is a new key');
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes('SECRET'), 'the token itself was written down');
  assert.match(raw, /"launch:[0-9a-f]{16}"/);
});

test('#8935 bare and --auto calls neither point nor mark; a test run without its own record never points', () => {
  const file = fresh();
  assert.equal(hh.hint('report', [], { env: envFor('mona', file) }), '');
  assert.equal(hh.hint('report', ['started', '--auto'], { env: envFor('mona', file) }), '');
  assert.equal(fs.existsSync(file), false, 'a hook call marked the report guide seen');
  assert.match(hh.hint('report', ['needs_you', '--held'], { env: envFor('mona', file) }), /kosmos report --help/, 'CONTROL: a real report still points');
  /* A test run with no record of its own named shows and writes nothing. The store is a stand-in so only the test-run
     check decides: CONTROL, the same call outside a test run points (into this sandbox). */
  const dir = path.join(SANDBOX, 'store-' + (++n));
  const asTest = { isTestProcess: () => true, currentDataRoot: () => dir };
  assert.equal(hh.hint('claim', ['p'], { env: { KOSMOS_AGENT_SESSION: 'mona' }, store: asTest }), '');
  assert.equal(fs.existsSync(path.join(dir, 'how-hints.json')), false, 'a test run wrote a record');
  const asReal = { isTestProcess: () => false, currentDataRoot: () => dir };
  assert.match(hh.hint('claim', ['p'], { env: { KOSMOS_AGENT_SESSION: 'mona' }, store: asReal }), /kosmos claim --how/, 'CONTROL: outside a test run it points');
});
