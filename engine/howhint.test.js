'use strict';
/* kosmos#8935: the first use of a command with a longer guide names the guide, once per agent per guide; kosmos#9015: the
   same agent after a restart, and several calls at once. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const hh = require('./howhint');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'howhint-')));
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
let n = 0;
const fresh = () => { const d = path.join(SANDBOX, 'root-' + (++n)); fs.mkdirSync(d); return d; };
const envFor = (agent, root) => ({ KOSMOS_AGENT_SESSION: agent, KOSMOS_HOWHINT_ROOT: root });
const tokenEnv = (token, root) => ({ KOSMOS_AGENT_TOKEN: token, KOSMOS_HOWHINT_ROOT: root });
const marks = (root) => { try { return fs.readdirSync(path.join(root, 'how-hints')).sort(); } catch { return null; } };
/* A token file as engine/sendertoken.js writes one. */
const giveToken = (root, key, tokens) => { fs.mkdirSync(path.join(root, 'sendertokens'), { recursive: true }); fs.writeFileSync(path.join(root, 'sendertokens', key + '.json'), JSON.stringify({ tokens })); };

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
  assert.equal(marks(file).length, 3, 'one mark for each agent and command');
});

test('#8935 reading the guide first counts as seen, so that agent is never pointed at it', () => {
  const file = fresh();
  assert.equal(hh.hint('task', ['--how'], { env: envFor('mona', file) }), '');
  assert.equal(hh.hint('task', ['add', 'p', 'x'], { env: envFor('mona', file) }), '', 'pointed at a guide it already read');
});

test('#8935 a person (no KOSMOS_AGENT_SESSION) never sees it and nothing is written; task built neither points nor marks', () => {
  const file = fresh();
  assert.equal(hh.hint('claim', ['p', '7'], { env: { KOSMOS_HOWHINT_ROOT: file } }), '');
  assert.equal(marks(file), null, 'a person\'s call wrote a mark');
  assert.equal(hh.hint('task', ['built', 'p', '3'], { env: envFor('mona', file) }), '');
  assert.match(hh.hint('task', ['add', 'p', 'x'], { env: envFor('mona', file) }), /kosmos task --how/, 'task built marked the task guide seen');
});

test('#8935 never throws; #9015 a pointer that cannot be recorded is not shown, and a corrupt old record is passed over', () => {
  const root = fresh();
  fs.writeFileSync(path.join(root, 'how-hints.json'), '{ not json');
  assert.match(hh.hint('claim', ['p'], { env: envFor('mona', root) }), /kosmos claim --how/);
  const blocked = fresh();
  fs.writeFileSync(path.join(blocked, 'how-hints'), 'a file where the folder goes');
  for (let k = 0; k < 2; k += 1) assert.equal(hh.hint('claim', ['p'], { env: envFor('mona', blocked) }), '', 'shown with nowhere to record it, so at every call');
  assert.equal(hh.hint('claim', ['p'], { env: envFor('mona', path.join(SANDBOX, 'no-such-folder')) }), '');
  assert.equal(fs.existsSync(path.join(SANDBOX, 'no-such-folder')), false, 'the hint made the data folder');
  assert.equal(hh.hint(undefined, undefined, { env: envFor('mona', root) }), '');
  /* An agent named like an Object key, or like a path, is recorded like any other. */
  for (const odd of ['__proto__', '../../up', 'a/b', 'launch:../../up', 'launch:0123456789abcdeg']) {
    const r = fresh();
    fs.writeFileSync(path.join(r, 'how-hints.json'), '{}');
    assert.match(hh.hint('claim', ['p'], { env: envFor(odd, r) }), /kosmos claim --how/);
    assert.equal(hh.hint('claim', ['p'], { env: envFor(odd, r) }), '', odd + ' was pointed twice');
    assert.match(marks(r).join(), /^[0-9a-f]{16}-claim$/);
    assert.deepEqual(fs.readdirSync(r).sort(), ['how-hints', 'how-hints.json'], odd + ' made a file outside the marks');
  }
});

test('#9015 the same agent after a restart (a new launch token) is not pointed again; CONTROL: another agent is, and so is a token with no name here, once per launch', () => {
  const root = fresh();
  giveToken(root, 'mona', [{ token: 'tok-first', name: 'Mona' }, { token: 'tok-second', name: 'Mona' }]);
  giveToken(root, 'pete', [{ token: 'tok-pete', name: 'Pete' }]);
  assert.match(hh.hint('community', ['read'], { env: tokenEnv('tok-first', root) }), /kosmos community --how/);
  assert.equal(hh.hint('community', ['read'], { env: tokenEnv('tok-first', root) }), '', 'again in the same session');
  assert.equal(hh.hint('community', ['read'], { env: tokenEnv('tok-second', root) }), '', 'again after a restart');
  assert.equal(hh.hint('community', ['read'], { env: envFor('Mona', root) }), '', 'again where the agent has its name');
  assert.match(hh.hint('community', ['read'], { env: tokenEnv('tok-pete', root) }), /kosmos community --how/, 'CONTROL: a brand-new agent sees it');
  assert.match(hh.hint('task', ['list', 'p'], { env: tokenEnv('tok-second', root) }), /kosmos task --how/, 'CONTROL: another command still points');
  const env = tokenEnv('tok-SECRET-9015', root);
  assert.match(hh.hint('post', ['p', 'hi'], { env }), /kosmos post --how/);
  assert.equal(hh.hint('post', ['p', 'hi'], { env }), '', 'shown twice in one launch');
  assert.match(hh.hint('post', ['p', 'hi'], { env: tokenEnv('tok-next-launch', root) }), /kosmos post --how/, 'CONTROL: no name here, so a new launch is a new key');
  assert.ok(!marks(root).join().includes('SECRET'), 'the token itself was written down');
  /* A token file that cannot be read, an older single-token file (its key is the name), and a token that is not a string. */
  const odd = fresh();
  fs.mkdirSync(path.join(odd, 'sendertokens'));
  fs.writeFileSync(path.join(odd, 'sendertokens', 'bbb.json'), JSON.stringify({ tokens: [null, { token: 5 }, { token: 'tok-after', name: 'After' }] }));
  fs.writeFileSync(path.join(odd, 'sendertokens', 'zed.json'), JSON.stringify({ token: 'tok-old' }));
  fs.mkdirSync(path.join(odd, 'sendertokens', 'a-folder.json'));
  assert.equal(hh.agentKeyOf({ KOSMOS_AGENT_TOKEN: ' tok-old ' }, odd), 'zed');
  assert.equal(hh.agentKeyOf({ KOSMOS_AGENT_TOKEN: 'tok-after' }, odd), 'after', 'an entry that is not one hid the next');
  assert.match(hh.agentKeyOf({ KOSMOS_AGENT_TOKEN: '5' }, odd), /^launch:/);
});

test('#9015 review 1: a token file that cannot be read leaves who it is unknown: nothing shown, nothing marked; CONTROL: read again, it points', () => {
  const root = fresh();
  giveToken(root, 'pete', [{ token: 'tok-pete', name: 'Pete' }]);
  fs.writeFileSync(path.join(root, 'sendertokens', 'mona.json'), '{ torn');
  assert.equal(hh.hint('claim', ['p'], { env: tokenEnv('tok-mona', root) }), '');
  assert.deepEqual(marks(root), [], 'marked as somebody else');
  /* Left broken (not being written now), it holds nobody: an agent with no name here is still pointed, once per launch. */
  const old = new Date(Date.now() - 3600000);
  fs.utimesSync(path.join(root, 'sendertokens', 'mona.json'), old, old);
  assert.match(hh.hint('task', ['list'], { env: tokenEnv('tok-elsewhere', root) }), /kosmos task --how/);
  assert.match(hh.hint('claim', ['p'], { env: tokenEnv('tok-pete', root) }), /kosmos claim --how/, 'CONTROL: one whose own file reads');
  giveToken(root, 'mona', [{ token: 'tok-mona', name: 'Mona' }]);
  assert.match(hh.hint('claim', ['p'], { env: tokenEnv('tok-mona', root) }), /kosmos claim --how/);
});

test('#9015 review 1: one agent, however it is spelled; CONTROL: another agent whose name starts the same', () => {
  const root = fresh();
  giveToken(root, 'mona', [{ token: 'tok-mona', name: 'Mona' }]);
  assert.match(hh.hint('claim', ['p'], { env: tokenEnv('tok-mona', root) }), /kosmos claim --how/);
  for (const s of ['mona', 'Mona', 'mona-discord']) assert.equal(hh.hint('claim', ['p'], { env: envFor(s, root) }), '', s + ' was pointed again');
  assert.equal(hh.hint('claim', ['p'], { env: { ...envFor('mona-discord+lab', root), KOSMOS_WORLD: 'lab' } }), '', 'in a named Kosmos');
  giveToken(root, 'mona-discord', [{ token: 'tok-other', name: 'mona-discord' }]);
  assert.match(hh.hint('claim', ['p'], { env: tokenEnv('tok-other', root) }), /kosmos claim --how/, 'a token\'s name is the agent\'s own: mona-discord is another agent');
  for (const s of ['mona-discord-2', 'mona+lab']) assert.match(hh.hint('claim', ['p'], { env: envFor(s, root) }), /kosmos claim --how/, s);
});

test('#9015 review 1: a launch looks its token up once a command', (t) => {
  const root = fresh();
  giveToken(root, 'mona', [{ token: 'tok-mona', name: 'Mona' }]);
  assert.match(hh.hint('claim', ['p'], { env: tokenEnv('tok-mona', root) }), /kosmos claim --how/);
  const looked = t.mock.method(fs, 'readdirSync');
  assert.equal(hh.hint('claim', ['p'], { env: tokenEnv('tok-mona', root) }), '');
  assert.equal(looked.mock.calls.length, 0, 'the token folder was read again');
  assert.match(hh.hint('post', ['p', 'x'], { env: tokenEnv('tok-mona', root) }), /kosmos post --how/);
  assert.ok(looked.mock.calls.length > 0, 'CONTROL: a first use of another command reads it');
  t.mock.restoreAll();
  assert.equal(marks(root).length, 4, 'the agent\'s marks and the launch\'s');
});

test('#9015 review 2: a name that is removed or made again is pointed; CONTROL: another agent\'s marks stay', () => {
  const root = fresh();
  for (const a of ['mona', 'pete']) assert.match(hh.hint('claim', ['p'], { env: envFor(a, root) }), /kosmos claim --how/);
  hh.hint('post', ['p', 'x'], { env: envFor('mona-discord', root) });
  hh.forget('Mona', root);
  for (const c of ['claim', 'post']) assert.match(hh.hint(c, ['p', 'x'], { env: envFor('mona', root) }), /First use of/, c);
  assert.equal(hh.hint('claim', ['p'], { env: envFor('pete', root) }), '', 'another agent\'s mark went');
  hh.forget('mona', path.join(SANDBOX, 'no-such-root'));   // never throws
});

test('#9015 review 2: revoking a name\'s tokens takes its marks', { skip: process.platform === 'win32' && 'the folder the store makes is named for the Mac and Linux here' }, () => {
  const data = fresh();
  const root = path.join(data, 'Kosmos');   // where the store puts its folder in AGENT_WORKFORCE_DATA
  fs.mkdirSync(root);
  assert.match(hh.hint('claim', ['p'], { env: envFor('mona', root) }), /kosmos claim --how/);
  const r = require('node:child_process').spawnSync(process.execPath, ['-e', 'require(' + JSON.stringify(path.join(__dirname, 'sendertoken.js')) + ').revoke("mona")'],
    { env: { ...process.env, AGENT_WORKFORCE_DATA: data, HOME: fresh() }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(marks(root), [], 'its mark stayed');
});

test('#9015 review 2: the old record is read under any of an agent\'s spellings, and never waited on when it is not a file', () => {
  const root = fresh();
  fs.writeFileSync(path.join(root, 'how-hints.json'), JSON.stringify({ 'mona-discord': ['claim'], Pete: ['claim'] }));
  giveToken(root, 'mona', [{ token: 'tok-mona', name: 'Mona' }]);
  assert.equal(hh.hint('claim', ['p'], { env: tokenEnv('tok-mona', root) }), '');
  assert.equal(hh.hint('claim', ['p'], { env: envFor('pete', root) }), '');
  const odd = fresh();
  fs.mkdirSync(path.join(odd, 'how-hints.json'));
  assert.match(hh.hint('claim', ['p'], { env: envFor('mona', odd) }), /kosmos claim --how/);
});

test('#9015 review 1: marks are only made in a real folder, owner only', { skip: process.platform === 'win32' && 'links and modes are POSIX here' }, () => {
  const root = fresh();
  const elsewhere = fresh();
  fs.symlinkSync(elsewhere, path.join(root, 'how-hints'));
  assert.equal(hh.hint('claim', ['p'], { env: envFor('mona', root) }), '');
  assert.deepEqual(fs.readdirSync(elsewhere), [], 'wrote through a link');
  const real = fresh();
  const was = process.umask(0);
  try { assert.match(hh.hint('claim', ['p'], { env: envFor('mona', real) }), /kosmos claim --how/); } finally { process.umask(was); }
  assert.equal(fs.statSync(path.join(real, 'how-hints')).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(real, 'how-hints', marks(real)[0])).mode & 0o777, 0o600);
});

test('#9015 reading the guide counts for the session and after a restart', () => {
  const root = fresh();
  giveToken(root, 'mona', [{ token: 'tok-first', name: 'Mona' }, { token: 'tok-second', name: 'Mona' }]);
  assert.equal(hh.hint('community', ['--how'], { env: tokenEnv('tok-first', root) }), '');
  assert.equal(hh.hint('community', ['home'], { env: tokenEnv('tok-first', root) }), '', 'pointed after reading the guide, in the same session');
  assert.equal(hh.hint('community', ['home'], { env: tokenEnv('tok-second', root) }), '', 'pointed after reading the guide, after a restart');
});

test('#9015 the record kept before is still honoured, by name and by this launch, and is not written', () => {
  const root = fresh();
  const hash = require('node:crypto').createHash('sha256').update('tok-now').digest('hex').slice(0, 16);
  const before = JSON.stringify({ mona: ['claim'], ['launch:' + hash]: ['post'] });
  fs.writeFileSync(path.join(root, 'how-hints.json'), before);
  giveToken(root, 'pete', [{ token: 'tok-now', name: 'Pete' }]);
  assert.equal(hh.hint('claim', ['p', '7'], { env: envFor('mona', root) }), '', 'a pointer seen before this change was shown again');
  assert.equal(hh.hint('post', ['p', 'x'], { env: tokenEnv('tok-now', root) }), '', 'so was one this launch saw');
  assert.match(hh.hint('task', ['list', 'p'], { env: envFor('mona', root) }), /kosmos task --how/, 'CONTROL: one it had not seen');
  assert.match(hh.hint('claim', ['p', '7'], { env: tokenEnv('tok-now', root) }), /kosmos claim --how/, 'CONTROL: another agent\'s mark');
  assert.equal(fs.readFileSync(path.join(root, 'how-hints.json'), 'utf8'), before);
  /* And after the next restart, whose token the old record does not hold: what was seen was carried to the agent. */
  giveToken(root, 'pete', [{ token: 'tok-next', name: 'Pete' }]);
  assert.equal(hh.hint('post', ['p', 'x'], { env: tokenEnv('tok-next', root) }), '', 'pointed again after the next restart');
});

test('#9015 many agents at once each see it once: no mark is lost', async () => {
  const root = fresh();
  const script = path.join(__dirname, 'howhint.js');
  const { spawn } = require('node:child_process');
  const run = (agent) => new Promise((resolve) => {
    const p = spawn(process.execPath, [script, 'claim', 'p', '7'], { env: { ...process.env, KOSMOS_AGENT_TOKEN: '', ...envFor(agent, root) } });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => resolve(out.includes('First use of') ? 1 : 0));
  });
  const agents = Array.from({ length: 12 }, (_, k) => 'agent' + k);
  const shown = await Promise.all([...agents, ...agents].map(run));   // each agent twice, all at once
  agents.forEach((a, k) => assert.equal(shown[k] + shown[k + 12], 1, a + ' saw it ' + (shown[k] + shown[k + 12]) + ' times'));
  assert.equal(marks(root).length, 12);
});

test('#9015 marks past the limit: the oldest go, this one stays', () => {
  const root = fresh();
  const dir = path.join(root, 'how-hints');
  fs.mkdirSync(dir);
  const old = new Date(Date.now() - 86400000);
  const put = (name, at) => { const f = path.join(dir, name); fs.writeFileSync(f, ''); fs.utimesSync(f, at, at); };
  const older = new Date(Date.now() - 2 * 86400000);
  put('0123456789abcdef-claim', older);   // an agent's own mark, older than all of them
  put('notes.txt', older);   // not a mark at all
  for (let k = 0; k < hh.MARKS_MAX + 2; k += 1) put('l-' + k.toString(16).padStart(16, '0') + '-claim', old);
  assert.match(hh.hint('claim', ['p'], { env: tokenEnv('tok-new', root) }), /kosmos claim --how/);
  assert.equal(marks(root).filter((f) => f.startsWith('l-')).length, hh.MARKS_MAX);
  assert.ok(marks(root).includes('0123456789abcdef-claim') && marks(root).includes('notes.txt'), 'something other than a launch\'s mark was taken');
  assert.equal(hh.hint('claim', ['p'], { env: tokenEnv('tok-new', root) }), '', 'its own mark was dropped');
});

test('#8935 bare and --auto calls neither point nor mark; a test run without its own record never points', () => {
  const file = fresh();
  assert.equal(hh.hint('report', [], { env: envFor('mona', file) }), '');
  assert.equal(hh.hint('report', ['started', '--auto'], { env: envFor('mona', file) }), '');
  assert.equal(marks(file), null, 'a hook call marked the report guide seen');
  assert.match(hh.hint('report', ['needs_you', '--held'], { env: envFor('mona', file) }), /kosmos report --help/, 'CONTROL: a real report still points');
  /* A test run with no record of its own named shows and writes nothing. The store is a stand-in so only the test-run
     check decides: its data folder exists and is not under the (stand-in) temp folder, so every other guard would let
     it point. Each half of the check gets its own case: the env handed in (a Mac CLI test's node) and this process's
     env (a Windows CLI test, whose main() gets a small env with no test marker). */
  const notTmp = path.join(SANDBOX, 'elsewhere');   // stands in for the system temp folder, so a sandbox folder is "not under temp"
  fs.mkdirSync(notTmp, { recursive: true });
  const ready = path.join(SANDBOX, 'store-ready-' + (++n));
  fs.mkdirSync(ready, { recursive: true });
  const handed = { env: { KOSMOS_AGENT_SESSION: 'mona' }, tmpdir: notTmp };
  assert.equal(hh.hint('claim', ['p'], { ...handed, store: { isTestProcess: (e) => e === process.env, currentDataRoot: () => ready } }), '', 'this process is a test run, the env handed in is not');
  assert.equal(hh.hint('claim', ['p'], { ...handed, store: { isTestProcess: (e) => e !== process.env, currentDataRoot: () => ready } }), '', 'the env handed in is a test run');
  assert.equal(marks(ready), null, 'a test run wrote a mark');
  assert.match(hh.hint('claim', ['p'], { ...handed, store: { isTestProcess: () => false, currentDataRoot: () => ready } }), /kosmos claim --how/, 'CONTROL: the same call outside a test run points');
  const dir = path.join(SANDBOX, 'store-' + (++n));
  const asReal = { isTestProcess: () => false, currentDataRoot: () => dir };
  /* No data folder yet: nothing shown, nothing made (making it would block the legacy-store migration). */
  assert.equal(hh.hint('claim', ['p'], { env: { KOSMOS_AGENT_SESSION: 'mona' }, store: asReal, tmpdir: notTmp }), '');
  assert.equal(fs.existsSync(dir), false, 'the hint made the data folder');
  fs.mkdirSync(dir, { recursive: true });
  assert.match(hh.hint('claim', ['p'], { env: { KOSMOS_AGENT_SESSION: 'mona' }, store: asReal, tmpdir: notTmp }), /kosmos claim --how/, 'CONTROL: outside a test run, with its data folder, it points');
  /* A data folder under the temp folder (a CLI test's sandbox) is never written to. */
  const other = path.join(SANDBOX, 'store-under-tmp');
  fs.mkdirSync(other, { recursive: true });
  assert.equal(hh.hint('post', ['p', 'x'], { env: { KOSMOS_AGENT_SESSION: 'mona' }, store: { isTestProcess: () => false, currentDataRoot: () => other }, tmpdir: SANDBOX }), '');
  assert.equal(marks(other), null, 'wrote into a data folder under temp');
});
