'use strict';
/**
 * #5812: a Gemini agent's workspace includes the folders of the projects it is on
 * (engine/geminidirs.js), on the Mac at launch and on Windows at every turn.
 *
 *   node --test engine/geminidirs-5812.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-geminidirs-5812-')));
/* projects.json for the paths that read it for real (Windows, below): the store root lives in the
   sandbox, set before anything loads store.js. */
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
const store = require('./store');
const dirs = require('./geminidirs');
const keyed = require('./win32keyed');

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

function mk(...parts) { const d = path.join(SANDBOX, ...parts); fs.mkdirSync(d, { recursive: true }); return d; }

test('a project the agent is on is included; one it is not on is not', () => {
  const mine = mk('p-mine');
  const theirs = mk('p-theirs');
  const r = dirs.foldersFor('gem', { projects: [
    { name: 'Mine', folder: mine, agents: ['gem', 'other'] },
    { name: 'Theirs', folder: theirs, agents: ['other'] },
  ] });
  assert.deepEqual(r.folders, [mine]);
  assert.deepEqual(r.leftOut, []);
});

test('a missing folder is left out and said (gemini would throw at startup on it)', () => {
  const gone = path.join(SANDBOX, 'not-there');
  const r = dirs.foldersFor('gem', { projects: [{ folder: gone, agents: ['gem'] }] });
  assert.deepEqual(r.folders, []);
  assert.equal(r.leftOut.length, 1);
  assert.match(r.leftOut[0].because, /not there/);
});

test('a file where the folder should be is left out', () => {
  const f = path.join(SANDBOX, 'a-file');
  fs.writeFileSync(f, 'x');
  const r = dirs.foldersFor('gem', { projects: [{ folder: f, agents: ['gem'] }] });
  assert.deepEqual(r.folders, []);
  assert.match(r.leftOut[0].because, /not there/);
});

test('a folder with a comma, or a trailing space, is left out (gemini splits and trims)', () => {
  const comma = mk('a,b');
  const space = mk('trailing ');
  const r = dirs.foldersFor('gem', { projects: [
    { folder: comma, agents: ['gem'] },
    { folder: space, agents: ['gem'] },
  ] });
  assert.deepEqual(r.folders, []);
  assert.equal(r.leftOut.length, 2);
  for (const l of r.leftOut) assert.match(l.because, /commas/);
});

test('the agent\'s own folder, a folder inside it, and a repeat are not passed again', () => {
  const own = mk('own');
  const inside = mk('own', 'sub');
  const other = mk('other-proj');
  const r = dirs.foldersFor('gem', { workdir: own, projects: [
    { folder: own, agents: ['gem'] },
    { folder: inside, agents: ['gem'] },
    { folder: other, agents: ['gem'] },
    { folder: other + path.sep, agents: ['gem'] },
  ] });
  assert.deepEqual(r.folders, [other]);
});

test('a sibling whose name starts with the own folder\'s name is still included', () => {
  const own = mk('work');
  const sibling = mk('work-two');
  const r = dirs.foldersFor('gem', { workdir: own, projects: [{ folder: sibling, agents: ['gem'] }] });
  assert.deepEqual(r.folders, [sibling]);
});

test('a relative folder and an unnamed agent include nothing', () => {
  assert.deepEqual(dirs.foldersFor('gem', { projects: [{ folder: 'rel/path', agents: ['gem'] }] }).folders, []);
  assert.deepEqual(dirs.foldersFor('', { projects: [{ folder: mk('x'), agents: [''] }] }).folders, []);
});

test('folders past the length cap are left out and said', () => {
  const projects = [];
  for (let i = 0; i < 200; i++) projects.push({ folder: mk('cap', 'project-folder-with-a-long-name-' + i), agents: ['gem'] });
  const r = dirs.foldersFor('gem', { projects });
  const total = r.folders.reduce((n, f) => n + f.length + '--include-directories'.length + 4, 0);
  assert.ok(total <= dirs.MAX_TOTAL_CHARS, 'total ' + total);
  assert.ok(r.folders.length > 0 && r.leftOut.length > 0);
  assert.match(r.leftOut[0].because, /as long as a launch can carry/);
});

test('includeArgs gives one flag per folder', () => {
  assert.deepEqual(dirs.includeArgs(['/a', '/b']), ['--include-directories', '/a', '--include-directories', '/b']);
  assert.deepEqual(dirs.includeArgs(undefined), []);
});

function trustHome(name, content) {
  const home = mk(name);
  if (content !== undefined) {
    fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
    fs.writeFileSync(path.join(home, '.gemini', 'trustedFolders.json'), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return home;
}
const theirTrust = (home) => path.join(home, '.gemini', 'trustedFolders.json');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

test('agentTrust: writes the agent its OWN trust file holding exactly its folders; the person\'s file is not written', () => {
  const a = mk('t-own-a');
  const b = mk('t-own-b');
  const home = trustHome('t-own', { '/elsewhere': 'TRUST_FOLDER' });
  const before = fs.readFileSync(theirTrust(home), 'utf8');
  const file = path.join(SANDBOX, 't-own-agent', 'gem.json');
  const r = dirs.agentTrust('gem', [a, b], home, { file });
  assert.equal(r.file, file);
  assert.deepEqual(r.folders, [a, b]);
  assert.deepEqual(readJson(file), { [a]: 'TRUST_FOLDER', [b]: 'TRUST_FOLDER' });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'owner only, like gemini\'s own');
  assert.equal(fs.readFileSync(theirTrust(home), 'utf8'), before, 'the person\'s trust file is untouched');
  dirs.agentTrust('gem', [b], home, { file });
  assert.deepEqual(readJson(file), { [b]: 'TRUST_FOLDER' }, 'rewritten whole: a project it left is no longer trusted');
});

test('agentTrust: the default file is per agent, in the Kosmos store', () => {
  const f = dirs.agentTrustFile('gem+w1');
  assert.ok(f.startsWith(path.join(store.ROOT, 'gemini-trust')), f);
  assert.notEqual(f, dirs.agentTrustFile('gem'));
  assert.equal(path.dirname(dirs.agentTrustFile('a/../b')), path.join(store.ROOT, 'gemini-trust'), 'a name cannot leave the folder');
});

test('agentTrust: a folder the person marked DO_NOT_TRUST is left out (longest rule wins, TRUST_PARENT covers the parent)', () => {
  const outer = mk('t-deny');
  const inner = mk('t-deny', 'inner');
  const okInner = mk('t-deny', 'ok');
  const parentRule = path.join(mk('t-par'), 'child');
  const sib = mk('t-par', 'sib');
  const home = trustHome('t-deny-home', { [outer]: 'DO_NOT_TRUST', [okInner]: 'TRUST_FOLDER', [parentRule]: 'TRUST_PARENT' });
  const file = path.join(SANDBOX, 't-deny-agent.json');
  const r = dirs.agentTrust('gem', [inner, okInner, sib], home, { file });
  assert.deepEqual(r.folders, [okInner, sib]);
  assert.equal(r.leftOut.length, 1);
  assert.equal(r.leftOut[0].folder, inner);
  assert.match(r.leftOut[0].because, /do not trust/);
  assert.deepEqual(Object.keys(readJson(file)), [okInner, sib]);
});

test('agentTrust: an unreadable or non-object person trust file includes nothing (their marks cannot be honoured)', () => {
  const a = mk('t-bad-a');
  for (const [name, body] of [['t-bad-json', '{ nope'], ['t-bad-list', '[]']]) {
    const home = trustHome(name, body);
    const file = path.join(SANDBOX, name + '-agent.json');
    const r = dirs.agentTrust('gem', [a], home, { file });
    assert.deepEqual(r.folders, [], name);
    assert.equal(r.file, null, name);
    assert.match(r.leftOut[0].because, /left alone/, name);
    assert.ok(!fs.existsSync(file), name + ': no agent file');
    assert.equal(fs.readFileSync(theirTrust(home), 'utf8'), body, name + ': not rewritten');
  }
});

test('launchFolders: the Mac launch returns the folders and the agent trust file', () => {
  const p = mk('l-proj');
  const file = path.join(SANDBOX, 'l-agent.json');
  const r = dirs.launchFolders('gem', null, trustHome('l-home'), { projects: [{ folder: p, agents: ['gem'] }], file });
  assert.deepEqual(r.folders, [p]);
  assert.equal(r.trustFile, file);
  assert.deepEqual(readJson(file), { [p]: 'TRUST_FOLDER' });
  const none = dirs.launchFolders('gem', null, trustHome('l-home2'), { projects: [], file: path.join(SANDBOX, 'l-none.json') });
  assert.equal(none.trustFile, null);
  assert.ok(!fs.existsSync(path.join(SANDBOX, 'l-none.json')), 'no folders, no trust file');
});

test('the home folder itself, or a folder holding it, or the disk root, is left out', () => {
  const r = dirs.foldersFor('gem', { projects: [{ folder: os.homedir(), agents: ['gem'] }, { folder: path.parse(SANDBOX).root, agents: ['gem'] }] });
  assert.deepEqual(r.folders, []);
  assert.equal(r.leftOut.length, 2);
  for (const l of r.leftOut) assert.match(l.because, /too wide/);
});

test('Windows: the real turn path (no folder seam) reads the agent\'s projects by its name', async () => {
  const proj = mk('w-proj');
  fs.mkdirSync(store.ROOT, { recursive: true });
  assert.ok(store.ROOT.startsWith(SANDBOX), 'the store is the sandbox: ' + store.ROOT);
  fs.writeFileSync(path.join(store.ROOT, 'projects.json'), JSON.stringify([{ name: 'W', folder: proj, agents: ['gem'] }]));
  const { EventEmitter } = require('node:events');
  const { superviseCodexStreaming } = require('./win32codexsup');
  const seen = [];
  keyed.setSpawn((file, args) => {
    seen.push(args);
    const c = new EventEmitter();
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    c.kill = () => {};
    setImmediate(() => { c.stdout.emit('data', '{"session_id":"s1","response":"ok"}\n'); c.emit('close', 0); });
    return c;
  });
  const h = superviseCodexStreaming({ name: 'gem', cwd: mk('w-own'), runner: 'gemini' }, {
    bin: '/x/gemini', env: { GEMINI_API_KEY: 'k' }, onEvent: () => {},
    stream: { started() {}, event() {}, wrote() {}, stopped() {}, rekey() {} },
    retireRun: () => ({ ok: true }), sessions: { pruneName: () => ({ ok: true, removed: 0 }) }, supervisorPid: 1,
    prepare: () => ({ ok: true, sessionId: 'k1', name: 'gem', token: 't', instance: 'i' }),
  });
  try {
    await new Promise((res) => h.send('hello', res));
    for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
    assert.equal(seen.length, 1);
    const i = seen[0].indexOf('--include-directories');
    assert.ok(i >= 0 && seen[0][i + 1] === proj, JSON.stringify(seen[0]));
  } finally { h.stop(); keyed.setSpawn(null); fs.rmSync(path.join(store.ROOT, 'projects.json'), { force: true }); }
});

test('Windows: a gemini turn carries the folders; grok and an empty list do not', () => {
  const a = keyed.turnArgs('gemini', { message: 'hi', newSessionId: 'id', includeDirs: ['C:\\p1'] });
  assert.deepEqual(a.slice(-2), ['--include-directories', 'C:\\p1']);
  const b = keyed.turnArgs('gemini', { message: 'hi', newSessionId: 'id' });
  assert.ok(!b.includes('--include-directories'));
  const g = keyed.turnArgs('grok', { message: 'hi', newSessionId: 'id', includeDirs: ['C:\\p1'] });
  assert.ok(!g.includes('--include-directories'));
});

test('Windows: runKeyedTurn passes the folders it is given to the spawned gemini', async () => {
  const { EventEmitter } = require('node:events');
  let seen = null;
  keyed.setSpawn((file, args) => {
    seen = args;
    const c = new EventEmitter();
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    setImmediate(() => { c.stdout.emit('data', '{"session_id":"s1","response":"ok"}\n'); c.emit('close', 0); });
    return c;
  });
  try {
    const r = await keyed.runKeyedTurn({ runner: 'gemini', bin: '/x/gemini', message: 'm', includeDirs: ['/proj/a'], platform: 'darwin' });
    assert.ok(r.ok, JSON.stringify(r));
    const i = seen.indexOf('--include-directories');
    assert.ok(i >= 0 && seen[i + 1] === '/proj/a', JSON.stringify(seen));
  } finally { keyed.setSpawn(null); }
});
