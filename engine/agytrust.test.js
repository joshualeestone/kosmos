'use strict';

/**
 * #3568: engine/agytrust.js pre-answers agy's folder-trust question by adding the agent's folder
 * to ~/.gemini/antigravity-cli/settings.json `trustedWorkspaces`. Every case runs against a
 * sandbox home, never the real one.
 *
 *   node --test engine/agytrust.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'agytrust-')));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { trustAgyFolder, settingsPath } = require('./agytrust');

let n = 0;
function home() { n += 1; const h = nodePath.join(SANDBOX, `home${n}`); fs.mkdirSync(h, { recursive: true }); return h; }
function folder(name) { const d = nodePath.join(SANDBOX, 'agents', name); fs.mkdirSync(d, { recursive: true }); return d; }
const read = (h) => JSON.parse(fs.readFileSync(settingsPath(h), 'utf8'));

test('a new folder is added to trustedWorkspaces, creating the settings file if there is none', () => {
  const h = home();
  const dir = folder('ada');
  assert.deepEqual(trustAgyFolder(dir, { home: h }), { ok: true, changed: true });
  assert.deepEqual(read(h).trustedWorkspaces, [dir]);
});

test('every other setting and every existing trusted folder is kept', () => {
  const h = home();
  fs.mkdirSync(nodePath.dirname(settingsPath(h)), { recursive: true });
  fs.writeFileSync(settingsPath(h), JSON.stringify({ trustedWorkspaces: ['/Users/someone'], theme: 'dark', model: { name: 'x' } }));
  const dir = folder('bea');
  trustAgyFolder(dir, { home: h });
  const s = read(h);
  assert.deepEqual(s.trustedWorkspaces, ['/Users/someone', dir]);
  assert.equal(s.theme, 'dark');
  assert.deepEqual(s.model, { name: 'x' });
});

test('running it again changes nothing', () => {
  const h = home();
  const dir = folder('cai');
  trustAgyFolder(dir, { home: h });
  const before = fs.readFileSync(settingsPath(h), 'utf8');
  assert.deepEqual(trustAgyFolder(dir, { home: h }), { ok: true, changed: false });
  assert.equal(fs.readFileSync(settingsPath(h), 'utf8'), before);
});

test('a settings file it cannot parse, or whose list is not a list, is left exactly as it was', () => {
  for (const body of ['{ not json', '[1,2]', JSON.stringify({ trustedWorkspaces: 'oops' })]) {
    const h = home();
    fs.mkdirSync(nodePath.dirname(settingsPath(h)), { recursive: true });
    fs.writeFileSync(settingsPath(h), body);
    const r = trustAgyFolder(folder('dee'), { home: h });
    assert.equal(r.ok, false, `accepted ${body}`);
    assert.equal(fs.readFileSync(settingsPath(h), 'utf8'), body, 'a settings file it could not read was rewritten');
  }
});

test('the folder is recorded as agy sees it, after symlinks (a /tmp folder is /private/tmp)', () => {
  const h = home();
  const real = folder('eli');
  const link = nodePath.join(SANDBOX, 'eli-link');
  fs.symlinkSync(real, link);
  trustAgyFolder(link, { home: h });
  assert.deepEqual(read(h).trustedWorkspaces, [real]);
});

test('a relative, missing or not-yet-created folder is refused and writes nothing', () => {
  const h = home();
  assert.equal(trustAgyFolder('relative/dir', { home: h }).ok, false);
  assert.equal(trustAgyFolder(undefined, { home: h }).ok, false);
  // Not created yet: it cannot be resolved the way agy will record it, so it is not guessed.
  assert.equal(trustAgyFolder(nodePath.join(SANDBOX, 'not-made-yet'), { home: h }).ok, false);
  assert.equal(fs.existsSync(settingsPath(h)), false);
});

test('the settings file keeps its permissions', () => {
  const h = home();
  fs.mkdirSync(nodePath.dirname(settingsPath(h)), { recursive: true });
  fs.writeFileSync(settingsPath(h), JSON.stringify({ trustedWorkspaces: [] }), { mode: 0o600 });
  fs.chmodSync(settingsPath(h), 0o600);
  trustAgyFolder(folder('gus'), { home: h });
  assert.equal(fs.statSync(settingsPath(h)).mode & 0o777, 0o600, 'a private settings file became readable by others');
});

test('a symlinked settings file is written through to its target and stays a link', () => {
  const h = home();
  const realFile = nodePath.join(SANDBOX, `dotfiles-${n}`, 'agy-settings.json');
  fs.mkdirSync(nodePath.dirname(realFile), { recursive: true });
  fs.writeFileSync(realFile, JSON.stringify({ theme: 'dark' }));
  fs.mkdirSync(nodePath.dirname(settingsPath(h)), { recursive: true });
  fs.symlinkSync(realFile, settingsPath(h));
  const dir = folder('hal');
  trustAgyFolder(dir, { home: h });
  assert.equal(fs.lstatSync(settingsPath(h)).isSymbolicLink(), true, 'the link was replaced by a plain file');
  assert.deepEqual(JSON.parse(fs.readFileSync(realFile, 'utf8')), { theme: 'dark', trustedWorkspaces: [dir] });
});

test('eight agents starting at once each end up trusted (none overwrites another)', async () => {
  const h = home();
  const script = nodePath.join(__dirname, 'agytrust.js');
  const dirs = Array.from({ length: 8 }, (_, i) => folder(`many${i}`));
  const { spawn } = require('node:child_process');
  await Promise.all(dirs.map((d) => new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [script, d], { env: { PATH: process.env.PATH, HOME: h } });
    c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('exit ' + code))));
  })));
  assert.deepEqual([...read(h).trustedWorkspaces].sort(), [...dirs].sort(), 'a concurrent start lost another agent\'s folder');
  const left = fs.readdirSync(nodePath.dirname(settingsPath(h))).filter((f) => f !== 'settings.json');
  assert.deepEqual(left, [], 'a lock or temp file was left behind');
});

test('a lock left by a start that died is taken over', () => {
  const h = home();
  fs.mkdirSync(nodePath.dirname(settingsPath(h)), { recursive: true });
  const lockFile = settingsPath(h) + '.kosmos-lock';
  fs.writeFileSync(lockFile, '');
  const old = new Date(Date.now() - 60 * 1000);
  fs.utimesSync(lockFile, old, old);
  const dir = folder('ivy');
  assert.equal(trustAgyFolder(dir, { home: h }).ok, true);
  assert.deepEqual(read(h).trustedWorkspaces, [dir]);
  assert.equal(fs.existsSync(lockFile), false, 'the lock was not released');
});

test('an odd lock (a folder in its place) ends the wait with a reason instead of spinning', () => {
  const h = home();
  fs.mkdirSync(nodePath.dirname(settingsPath(h)), { recursive: true });
  const lockDir = settingsPath(h) + '.kosmos-lock';
  fs.mkdirSync(lockDir);
  fs.writeFileSync(nodePath.join(lockDir, 'x'), ''); // not removable by a plain unlink
  const old = new Date(Date.now() - 60 * 1000);
  fs.utimesSync(lockDir, old, old); // after the write, which would reset it: the lock must look stale
  const t0 = Date.now();
  const r = trustAgyFolder(folder('kit'), { home: h });
  assert.ok(Date.now() - t0 < 8000, 'the lock wait did not end');
  assert.equal(typeof r.ok, 'boolean');
});

test('a settings link whose target is gone is left alone, not replaced by a plain file', () => {
  const h = home();
  fs.mkdirSync(nodePath.dirname(settingsPath(h)), { recursive: true });
  fs.symlinkSync(nodePath.join(SANDBOX, 'nowhere', 'settings.json'), settingsPath(h));
  const r = trustAgyFolder(folder('lou'), { home: h });
  assert.equal(r.ok, false);
  assert.equal(fs.lstatSync(settingsPath(h)).isSymbolicLink(), true, 'the dangling link was replaced');
});

test('a lock is released only by its owner: a lock someone else holds now is left alone', () => {
  const { _lock } = require('./agytrust');
  const h = home();
  fs.mkdirSync(nodePath.dirname(settingsPath(h)), { recursive: true });
  const held = _lock(settingsPath(h));
  assert.equal(typeof held.release, 'function');
  const lockFile = settingsPath(h) + '.kosmos-lock';
  fs.writeFileSync(lockFile, 'someone-else'); // another start took the path meanwhile
  held.release();
  assert.equal(fs.readFileSync(lockFile, 'utf8'), 'someone-else', 'a release deleted a lock it did not own');
  fs.unlinkSync(lockFile);
  const mine = _lock(settingsPath(h));
  mine.release();
  assert.equal(fs.existsSync(lockFile), false, 'CONTROL: the owner\'s own release removes it');
});

test('as a script it says why on stderr when it could not add the folder, and still exits 0', () => {
  const h = home();
  fs.mkdirSync(nodePath.dirname(settingsPath(h)), { recursive: true });
  fs.writeFileSync(settingsPath(h), '{ not json');
  const r = require('node:child_process').spawnSync(process.execPath, [nodePath.join(__dirname, 'agytrust.js'), folder('jo')],
    { env: { PATH: process.env.PATH, HOME: h }, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /agytrust: agy settings could not be read/);
});

test('as a script (how the supervisor calls it) it trusts the folder under HOME and exits 0, even on a bad argument', () => {
  const h = home();
  const dir = folder('fae');
  const script = nodePath.join(__dirname, 'agytrust.js');
  execFileSync(process.execPath, [script, dir], { env: { PATH: process.env.PATH, HOME: h } });
  assert.deepEqual(read(h).trustedWorkspaces, [dir]);
  execFileSync(process.execPath, [script], { env: { PATH: process.env.PATH, HOME: h } }); // throws if it exits non-zero
});
