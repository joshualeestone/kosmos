'use strict';

/**
 * kosmos#5536 slice 4b: the Restored world. A real worlds registry in a temp folder, a real restore sink opened on the
 * folder prepareRestoreWorld made, files written through that sink, then moved and listed. Nothing is registered.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Every root this process could reach is a sandbox (the default nameOk requires create.js, which freezes its roots).
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-restoreworld-'));
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'LaunchAgents');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const worlds = require('./worlds');
const rw = require('./restoreworld');
const { createRestoreSink, RECORD_NAME } = require('./restoresink');

const NOW = new Date(2026, 9, 26, 0, 30).getTime();   // local time, as the world name is
const DAY = '2026-10-26';
const nameOk = (n) => /^[a-z0-9][a-z0-9_-]{1,31}$/.test(n);

/* A base the sink accepts (inside the profile on Windows, as restoresink.test.js makes them). */
const insideHome = (dir) => {
  const rel = path.relative(fs.realpathSync.native(os.homedir()), fs.realpathSync.native(dir));
  return !(rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel));
};
const freshParent = process.platform === 'win32' && !insideHome(os.tmpdir()) ? os.homedir() : SANDBOX;
const fresh = (t) => { const d = fs.mkdtempSync(path.join(freshParent, 'kosmos-rw-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

function writeThrough(sink, rel, text) {
  const f = sink.begin(rel);
  f.write(Buffer.from(text));
  f.commit();
}

test('a restore lands in a new "Restored" Kosmos, its workers and projects become the world\'s own, and agents are listed, not registered', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann Lee', now: NOW });
  assert.equal(p.ok, true, p.because);
  assert.equal(p.world.name, `Restored: Ann Lee, ${DAY}`);
  assert.ok(worlds.readRegistry(base).worlds.some((w) => w.id === p.world.id), 'the world is in the registry');
  assert.equal(p.restoreDir, path.join(p.dir, rw.RESTORE_DIR));
  assert.deepEqual(fs.readdirSync(p.restoreDir), []);
  if (process.platform !== 'win32') assert.equal(fs.statSync(p.restoreDir).mode & 0o777, 0o700);

  // The real sink accepts the folder as its root (empty, private, owned), and the restore writes through it.
  const sink = createRestoreSink(p.restoreDir);
  writeThrough(sink, 'workers/ann/CLAUDE.md', '# You are Ann\n');
  writeThrough(sink, 'workers/Shouty/CLAUDE.md', '# Shouty\n');
  writeThrough(sink, 'workers/notes/todo.txt', 'not an agent\n');
  writeThrough(sink, 'projects/site/README.md', 'site\n');
  writeThrough(sink, 'agents/a1b2/AGENTS.md', '# kept elsewhere\n');
  writeThrough(sink, 'elsewhere/client/plan.md', 'plan\n');
  sink.close();

  const f = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir });
  assert.equal(f.ok, true, f.because);
  assert.deepEqual(f.moved, ['workers', 'projects']);
  assert.deepEqual(f.kept, ['agents', 'elsewhere']);
  const roots = worlds.envOverridesFor(base, p.world);
  assert.equal(fs.readFileSync(path.join(roots.AGENT_WORKFORCE_WORKERS, 'ann', 'CLAUDE.md'), 'utf8'), '# You are Ann\n');
  assert.equal(fs.readFileSync(path.join(roots.AGENT_WORKFORCE_PROJECTS, 'site', 'README.md'), 'utf8'), 'site\n');

  const l = rw.listRestoredAgents({ base, world: p.world, restoreDir: p.restoreDir, nameOk });
  const by = Object.fromEntries(l.agents.map((a) => [a.folder, a]));
  assert.deepEqual(Object.keys(by).sort(), ['Shouty', 'a1b2', 'ann', 'notes']);
  assert.deepEqual([by.ann.name, by.ann.brief, by.ann.because, by.ann.from], ['ann', 'CLAUDE.md', null, 'workers']);
  assert.equal(by.Shouty.name, null);
  assert.match(by.Shouty.because, /folder name cannot be used/);
  assert.match(by.notes.because, /no instructions file/);
  assert.equal(by.a1b2.from, 'elsewhere');
  assert.match(by.a1b2.because, /kept outside the workers folder/);
  assert.equal(l.more, false);
  // Nothing was registered: the new world's store holds no profile.
  assert.deepEqual(worlds.worldProfileNames(base, p.world), []);
});

test('a second restore of the same member on the same day gets "(2)"; a hidden Kosmos\'s name is skipped too', (t) => {
  const base = fresh(t);
  const a = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  assert.equal(a.ok, true, a.because);
  worlds.hideWorld(base, a.world.id);
  const b = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  assert.equal(b.ok, true, b.because);
  assert.equal(b.world.name, `Restored: Ann, ${DAY} (2)`);
  for (let n = 3; n <= 9; n++) assert.equal(rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW }).ok, true);
  const tenth = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  assert.equal(tenth.ok, false);
  assert.match(tenth.because, /already 9 restored Kosmoses/);
});

test('control, format and bidi characters never reach the world name, and a long name is cut', () => {
  const rlo = String.fromCodePoint(0x202e), zw = String.fromCodePoint(0x200b), nl = String.fromCodePoint(10);
  const name = rw.worldName(`Ann${rlo}gnp.exe${zw}${nl}x`, NOW);
  assert.equal(name, `Restored: Anngnp.exex, ${DAY}`);
  assert.equal(rw.worldName('', NOW), `Restored: a member, ${DAY}`);
  assert.equal(rw.worldName('x'.repeat(200), NOW), `Restored: ${'x'.repeat(60)}, ${DAY}`);
});

test('a restore folder that cannot be made hides the new Kosmos again and says so', (t) => {
  const base = fresh(t);
  const hidden = [];
  const r = rw.prepareRestoreWorld(base, {
    member: 'Ann', now: NOW,
    createWorld: (b, n) => { const w = worlds.createWorld(b, n); fs.mkdirSync(path.join(worlds.worldBaseDir(b, w), rw.RESTORE_DIR)); return w; },
    hideWorld: (b, id) => { hidden.push(id); return worlds.hideWorld(b, id); },
  });
  assert.equal(r.ok, false);
  assert.match(r.because, /hidden again/);
  assert.equal(hidden.length, 1);
  assert.ok(worlds.readRegistry(base).worlds.find((w) => w.id === hidden[0]).hiddenAt, 'the world is hidden');
});

test('finish moves nothing when any check fails, and only from the folder made for that world', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  fs.mkdirSync(path.join(p.restoreDir, 'workers', 'ann'), { recursive: true });
  fs.mkdirSync(path.join(p.restoreDir, 'projects', 'site'), { recursive: true });
  const roots = worlds.envOverridesFor(base, p.world);

  // Another folder, even one shaped the same, is refused.
  const other = fresh(t);
  fs.mkdirSync(path.join(other, 'workers'));
  let r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: other });
  assert.equal(r.ok, false);
  assert.match(r.because, /not the one made for this Kosmos/);
  assert.ok(fs.existsSync(path.join(other, 'workers')));

  // A non-empty target refuses before anything moves: workers is checked first, but projects stays put too.
  fs.writeFileSync(path.join(roots.AGENT_WORKFORCE_PROJECTS, 'already.txt'), 'x');
  r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir });
  assert.equal(r.ok, false);
  assert.match(r.because, /already has files in its projects folder/);
  assert.deepEqual(r.moved, []);
  assert.ok(fs.existsSync(path.join(p.restoreDir, 'workers', 'ann')), 'workers was not moved');
  fs.rmSync(path.join(roots.AGENT_WORKFORCE_PROJECTS, 'already.txt'));

  // A restored root that is a file is refused.
  fs.rmSync(path.join(p.restoreDir, 'projects'), { recursive: true });
  fs.writeFileSync(path.join(p.restoreDir, 'projects'), 'x');
  r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir });
  assert.equal(r.ok, false);
  assert.match(r.because, /restored projects is not a folder/);
  assert.deepEqual(r.moved, []);
});

test('a snapshot with no projects moves its workers alone, and the sink\'s record is not listed as kept', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  fs.mkdirSync(path.join(p.restoreDir, 'workers', 'ann'), { recursive: true });
  fs.writeFileSync(path.join(p.restoreDir, RECORD_NAME), '');
  const r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir });
  assert.equal(r.ok, true, r.because);
  assert.deepEqual(r.moved, ['workers']);
  assert.deepEqual(r.kept, []);
});

test('listing reads only the restore folder made for the world, refuses links, and uses create.js\'s name rule by default', { skip: process.platform === 'win32' ? 'symlinks need privileges on Windows' : false }, (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  const roots = worlds.envOverridesFor(base, p.world);
  const target = fresh(t);
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), '# elsewhere on disk\n');
  fs.symlinkSync(target, path.join(roots.AGENT_WORKFORCE_WORKERS, 'linked'));
  fs.mkdirSync(path.join(roots.AGENT_WORKFORCE_WORKERS, 'ok-name'));
  fs.writeFileSync(path.join(roots.AGENT_WORKFORCE_WORKERS, 'ok-name', 'AGENTS.md'), '# codex\n');
  const other = fresh(t);
  fs.mkdirSync(path.join(other, 'agents', 'x9'), { recursive: true });

  const l = rw.listRestoredAgents({ base, world: p.world, restoreDir: other });
  const by = Object.fromEntries(l.agents.map((a) => [a.folder, a]));
  assert.deepEqual(Object.keys(by).sort(), ['linked', 'ok-name'], 'the foreign folder\'s agents/ was not read');
  assert.match(by.linked.because, /link/);
  assert.equal(by.linked.brief, null, 'a link is not opened');
  assert.deepEqual([by['ok-name'].name, by['ok-name'].brief, by['ok-name'].because], ['ok-name', 'AGENTS.md', null]);
});
