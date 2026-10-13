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

const dirs = require('./geminidirs');
const keyed = require('./win32keyed');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-geminidirs-5812-')));
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
  const total = r.folders.reduce((n, f) => n + f.length, 0);
  assert.ok(total <= dirs.MAX_TOTAL_CHARS, 'total ' + total);
  assert.ok(r.folders.length > 0 && r.leftOut.length > 0);
  assert.match(r.leftOut[0].because, /as long as a launch can carry/);
});

test('includeArgs gives one flag per folder', () => {
  assert.deepEqual(dirs.includeArgs(['/a', '/b']), ['--include-directories', '/a', '--include-directories', '/b']);
  assert.deepEqual(dirs.includeArgs(undefined), []);
});

test('folderTrustOn reads security.folderTrust.enabled from the account settings', () => {
  const off = mk('home-off');
  assert.equal(dirs.folderTrustOn(off), false, 'no settings file: off (gemini\'s default)');
  const on = mk('home-on', '.gemini');
  fs.writeFileSync(path.join(on, 'settings.json'), JSON.stringify({ security: { folderTrust: { enabled: true } } }));
  assert.equal(dirs.folderTrustOn(path.dirname(on)), true);
  const plain = mk('home-plain', '.gemini');
  fs.writeFileSync(path.join(plain, 'settings.json'), JSON.stringify({ security: { auth: {} } }));
  assert.equal(dirs.folderTrustOn(path.dirname(plain)), false);
  const bad = mk('home-bad', '.gemini');
  fs.writeFileSync(path.join(bad, 'settings.json'), '{ not json');
  assert.equal(dirs.folderTrustOn(path.dirname(bad)), null);
});

test('the Mac launch includes nothing when folder trust is on or unknown, and says why', () => {
  const p = mk('trust-proj');
  const projects = [{ folder: p, agents: ['gem'] }];
  assert.deepEqual(dirs.launchFolders('gem', null, '', { projects, folderTrustOn: () => false }).folders, [p]);
  const on = dirs.launchFolders('gem', null, '', { projects, folderTrustOn: () => true });
  assert.deepEqual(on.folders, []);
  assert.match(on.leftOut[0].because, /folder trust is switched on/);
  const unknown = dirs.launchFolders('gem', null, '', { projects, folderTrustOn: () => null });
  assert.deepEqual(unknown.folders, []);
  assert.match(unknown.leftOut[0].because, /could not read/);
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
