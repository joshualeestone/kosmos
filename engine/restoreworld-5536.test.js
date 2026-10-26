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
const store = require('./store');
const rw = require('./restoreworld');
const { createRestoreSink, RECORD_NAME, LOCK_NAME } = require('./restoresink');

const NOW = new Date(2026, 9, 26, 0, 30).getTime();   // local time, as the world name is
const DAY = '2026-10-26';
const nameOk = (n) => /^[a-z0-9][a-z0-9_-]{1,31}$/.test(n);
const OK = { ok: true };   // runRestore's answer for a restore that succeeded

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
  writeThrough(sink, 'workers/eve/CLAUDE.md', '# Eve\n  @../../elsewhere/client/plan.md\n');
  writeThrough(sink, 'workers/eve/.claude/settings.json', '{"hooks":{}}\n');
  writeThrough(sink, 'workers/eve/.mcp.json', '{}\n');
  writeThrough(sink, 'workers/notes/todo.txt', 'not an agent\n');
  writeThrough(sink, 'projects/site/README.md', 'site\n');
  writeThrough(sink, 'agents/a1b2/AGENTS.md', '# kept elsewhere\n');
  writeThrough(sink, 'elsewhere/client/plan.md', 'plan\n');
  sink.close();

  const f = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
  assert.equal(f.ok, true, f.because);
  assert.deepEqual(f.moved, ['workers', 'projects']);
  assert.deepEqual(f.kept, ['agents', 'elsewhere']);
  const roots = worlds.envOverridesFor(base, p.world);
  assert.equal(fs.readFileSync(path.join(roots.AGENT_WORKFORCE_WORKERS, 'ann', 'CLAUDE.md'), 'utf8'), '# You are Ann\n');
  assert.equal(fs.readFileSync(path.join(roots.AGENT_WORKFORCE_PROJECTS, 'site', 'README.md'), 'utf8'), 'site\n');

  const l = rw.listRestoredAgents({ base, world: p.world, restoreDir: p.restoreDir, nameOk });
  const by = Object.fromEntries(l.agents.map((a) => [a.folder, a]));
  assert.deepEqual(Object.keys(by).sort(), ['Shouty', 'a1b2', 'ann', 'eve', 'notes']);
  assert.deepEqual([by.ann.name, by.ann.brief, by.ann.because, by.ann.from, by.ann.runs], ['ann', 'CLAUDE.md', null, 'workers', []]);
  // Offerable, but every file that runs or loads something at start is named for the screen.
  assert.equal(by.eve.because, null);
  assert.deepEqual(by.eve.runs, ['.claude', '.mcp.json', 'CLAUDE.md imports']);
  assert.equal(by.ann.label, 'ann');
  assert.equal(by.Shouty.name, null);
  assert.match(by.Shouty.because, /folder name cannot be used/);
  assert.match(by.notes.because, /no instructions file/);
  assert.equal(by.a1b2.from, 'elsewhere');
  assert.match(by.a1b2.because, /kept outside the workers folder/);
  assert.equal(l.more, false);
  assert.deepEqual(l.shared, [], 'a project with nothing that loads at start is not listed');
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

test('a name taken by someone else between the registry read and createWorld moves on to the next name', (t) => {
  const base = fresh(t);
  let raced = false;
  const r = rw.prepareRestoreWorld(base, {
    member: 'Ann', now: NOW,
    createWorld: (b, n) => { if (!raced) { raced = true; worlds.createWorld(b, n); } return worlds.createWorld(b, n); },
  });
  assert.equal(r.ok, true, r.because);
  assert.equal(r.world.name, `Restored: Ann, ${DAY} (2)`);
});

test('control, format and bidi characters never reach the world name, and a long name is cut', () => {
  const rlo = String.fromCodePoint(0x202e), zw = String.fromCodePoint(0x200b), nl = String.fromCodePoint(10);
  const name = rw.worldName(`Ann${rlo}gnp.exe${zw}${nl}x`, NOW);
  assert.equal(name, `Restored: Anngnp.exex, ${DAY}`);
  assert.equal(rw.worldName('', NOW), `Restored: a member, ${DAY}`);
  assert.equal(rw.worldName('x'.repeat(200), NOW), `Restored: ${'x'.repeat(60)}, ${DAY}`);
  const mark = String.fromCodePoint(0x0301);
  // q has no precomposed form with U+0301, so NFC leaves every mark in place and only the cap removes them.
  assert.equal(rw.worldName('q' + mark.repeat(5) + 'oe', NOW), `Restored: q${mark}${mark}oe, ${DAY}`, 'stacked combining marks are capped at two');
});

test('a restore folder that cannot be made hides the new Kosmos again and says so', { skip: process.platform === 'win32' ? 'a read-only folder needs POSIX modes' : false }, (t) => {
  const base = fresh(t);
  const hidden = [];
  let dir = null;
  t.after(() => { if (dir) fs.chmodSync(dir, 0o755); });
  const r = rw.prepareRestoreWorld(base, {
    member: 'Ann', now: NOW,
    // A fresh world whose folder cannot be written: the restore folder inside it cannot be made.
    createWorld: (b, n) => { const w = worlds.createWorld(b, n); dir = worlds.worldBaseDir(b, w); fs.chmodSync(dir, 0o555); return w; },
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
  let r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: other, result: OK });
  assert.equal(r.ok, false);
  assert.match(r.because, /not the one made for this Kosmos/);
  assert.ok(fs.existsSync(path.join(other, 'workers')));

  // A non-empty target refuses before anything moves: workers is checked first, but projects stays put too.
  fs.writeFileSync(path.join(roots.AGENT_WORKFORCE_PROJECTS, 'already.txt'), 'x');
  r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
  assert.equal(r.ok, false);
  assert.match(r.because, /already has files in its projects folder/);
  assert.deepEqual(r.moved, []);
  assert.ok(fs.existsSync(path.join(p.restoreDir, 'workers', 'ann')), 'workers was not moved');
  fs.rmSync(path.join(roots.AGENT_WORKFORCE_PROJECTS, 'already.txt'));

  // A restored root that is a file is refused.
  fs.rmSync(path.join(p.restoreDir, 'projects'), { recursive: true });
  fs.writeFileSync(path.join(p.restoreDir, 'projects'), 'x');
  r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
  assert.equal(r.ok, false);
  assert.match(r.because, /restored projects is not a folder/);
  assert.deepEqual(r.moved, []);
});

test('a restore that stopped (its record kept) or is still open (its lock) is never finished; a snapshot with no projects moves its workers alone', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  fs.mkdirSync(path.join(p.restoreDir, 'workers', 'ann'), { recursive: true });
  for (const entry of [RECORD_NAME, LOCK_NAME, RECORD_NAME.toUpperCase()]) {
    fs.writeFileSync(path.join(p.restoreDir, entry), '');
    const stopped = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
    assert.equal(stopped.ok, false, entry);
    assert.match(stopped.because, /has not finished/);
    assert.ok(fs.existsSync(path.join(p.restoreDir, 'workers', 'ann')), `${entry}: nothing moved`);
    fs.rmSync(path.join(p.restoreDir, entry));
  }
  const r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
  assert.equal(r.ok, true, r.because);
  assert.deepEqual(r.moved, ['workers']);
  assert.deepEqual(r.kept, []);
});

test('listing reads only the restore folder made for the world, refuses links (a junction on Windows), and uses create.js\'s name rule by default', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  const roots = worlds.envOverridesFor(base, p.world);
  const target = fresh(t);
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), '# elsewhere on disk\n');
  fs.symlinkSync(target, path.join(roots.AGENT_WORKFORCE_WORKERS, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.mkdirSync(path.join(roots.AGENT_WORKFORCE_WORKERS, 'Bad'));
  fs.writeFileSync(path.join(roots.AGENT_WORKFORCE_WORKERS, 'Bad', 'CLAUDE.md'), '# upper case\n');
  fs.mkdirSync(path.join(roots.AGENT_WORKFORCE_WORKERS, 'ok-name'));
  fs.writeFileSync(path.join(roots.AGENT_WORKFORCE_WORKERS, 'ok-name', 'AGENTS.md'), '# codex\n');
  const other = fresh(t);
  fs.mkdirSync(path.join(other, 'agents', 'x9'), { recursive: true });

  const l = rw.listRestoredAgents({ base, world: p.world, restoreDir: other });
  const by = Object.fromEntries(l.agents.map((a) => [a.folder, a]));
  assert.deepEqual(Object.keys(by).sort(), ['Bad', 'linked', 'ok-name'], 'the foreign folder\'s agents/ was not read');
  assert.match(by.Bad.because, /folder name cannot be used/, 'the default rule is create.js NAME_RE');
  assert.match(by.linked.because, /link/);
  assert.equal(by.linked.brief, null, 'a link is not opened');
  assert.deepEqual([by['ok-name'].name, by['ok-name'].brief, by['ok-name'].because], ['ok-name', 'AGENTS.md', null]);
});

test('finish moves nothing unless the restore itself says it succeeded', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  fs.mkdirSync(path.join(p.restoreDir, 'workers', 'ann'), { recursive: true });
  for (const result of [undefined, { ok: false, partial: true }, { ok: 'yes' }]) {
    const r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result });
    assert.equal(r.ok, false, JSON.stringify(result));
    assert.match(r.because, /did not succeed/);
    assert.ok(fs.existsSync(path.join(p.restoreDir, 'workers', 'ann')));
  }
});

test('imports anywhere in a line, in any brief, and a brief too big to read in full are all named; a .claude folder of skills alone counts', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  const w = worlds.envOverridesFor(base, p.world).AGENT_WORKFORCE_WORKERS;
  const agent = (name, files) => {
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(w, name, rel)), { recursive: true });
      fs.writeFileSync(path.join(w, name, rel), text);
    }
  };
  agent('inline', { 'CLAUDE.md': '# Inline\r\nsee @~/.ssh/config for details\r\n' });
  agent('second', { 'CLAUDE.md': '# clean, mail me at a@b.example\n', 'AGENTS.md': '# Codex\n@../../secret\n' });
  agent('skills', { 'CLAUDE.md': '# skills only\n', '.claude/skills/x/SKILL.md': 'x\n' });
  agent('big', { 'CLAUDE.md': '# big\n' + 'x'.repeat(512 * 1024) + '\n@tail\n' });
  agent('plain', { 'CLAUDE.md': '# plain, nothing to load\n' });
  const by = Object.fromEntries(rw.listRestoredAgents({ base, world: p.world, nameOk }).agents.map((a) => [a.folder, a]));
  assert.deepEqual(by.inline.runs, ['CLAUDE.md imports']);
  assert.deepEqual(by.second.runs, ['AGENTS.md imports'], 'an e-mail address is not an import; the second brief is read');
  assert.deepEqual(by.skills.runs, ['.claude']);
  assert.deepEqual(by.big.runs, ['CLAUDE.md (too large to check in full)']);
  assert.deepEqual(by.plain.runs, []);
});

test('a name written to spoof the screen gets a safe label, kept entries too; a linked brief and a linked agents folder are not read', { skip: process.platform === 'win32' ? 'a file symlink needs privileges on Windows' : false }, (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  const w = worlds.envOverridesFor(base, p.world).AGENT_WORKFORCE_WORKERS;
  const rlo = String.fromCodePoint(0x202e);
  const spoof = `ann${rlo}dm.exe`;
  fs.mkdirSync(path.join(w, spoof));
  fs.writeFileSync(path.join(w, spoof, 'CLAUDE.md'), '# x\n');
  const outside = fresh(t);
  fs.writeFileSync(path.join(outside, 'CLAUDE.md'), '# outside\n@~/.ssh/id\n');
  fs.mkdirSync(path.join(w, 'linkbrief'));
  fs.symlinkSync(path.join(outside, 'CLAUDE.md'), path.join(w, 'linkbrief', 'CLAUDE.md'));
  fs.mkdirSync(path.join(outside, 'x9'));
  fs.symlinkSync(outside, path.join(p.restoreDir, 'agents'));
  const l = rw.listRestoredAgents({ base, world: p.world, restoreDir: p.restoreDir, nameOk });
  const by = Object.fromEntries(l.agents.map((a) => [a.folder, a]));
  assert.deepEqual(Object.keys(by).sort(), [spoof, 'linkbrief'].sort(), 'the linked agents folder was not scanned');
  assert.equal(by[spoof].label, 'anndm.exe');
  assert.equal(by.linkbrief.brief, null);
  assert.match(by.linkbrief.because, /no instructions file/);
  assert.deepEqual(by.linkbrief.runs, ['CLAUDE.md is a link'], 'a linked brief is named, never opened');
  // A kept entry is shown by its label as well.
  fs.rmSync(path.join(p.restoreDir, 'agents'));
  fs.mkdirSync(path.join(p.restoreDir, `elsewhere${rlo}`));
  const f = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
  assert.equal(f.ok, true, f.because);
  assert.deepEqual(f.kept, ['elsewhere']);
});

test('a git folder in an agent makes it not offered; one at the top of workers blocks every agent; files there and risky projects are shared', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  const roots = worlds.envOverridesFor(base, p.world);
  const put = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  const w = roots.AGENT_WORKFORCE_WORKERS, pr = roots.AGENT_WORKFORCE_PROJECTS;
  put(w, 'ann/CLAUDE.md', '# Ann\n');
  put(w, 'gitty/CLAUDE.md', '# Gitty\n');
  put(w, 'gitty/.git/config', '[core]\n\tfsmonitor = touch /tmp/x\n');
  put(w, '.DS_Store', '');
  put(w, 'CLAUDE.md', 'every agent reads this @~/.ssh/id\n');
  put(pr, 'site/CLAUDE.md', '@../../secret\n');
  put(pr, 'site/.git/config', '[core]\n');
  put(pr, 'plain/README.md', 'nothing\n');
  let l = rw.listRestoredAgents({ base, world: p.world, nameOk });
  let by = Object.fromEntries(l.agents.map((a) => [a.folder, a]));
  assert.equal(by.ann.because, null);
  assert.match(by.gitty.because, /git folder/);
  assert.ok(by.gitty.runs.includes('.git'));
  assert.deepEqual(l.shared, [
    { where: 'workers', label: 'CLAUDE.md', runs: [] },
    { where: 'projects', label: 'site', runs: ['.git', 'CLAUDE.md imports'] },
  ], '.DS_Store is not listed and a plain project is not shared');

  put(w, '.git/config', '[core]\n');
  l = rw.listRestoredAgents({ base, world: p.world, nameOk });
  by = Object.fromEntries(l.agents.map((a) => [a.folder, a]));
  assert.match(by.ann.because, /workers folder holds a git folder/, 'a git folder above every agent blocks them all');
  assert.ok(l.shared.some((x) => x.where === 'workers' && x.label === '.git'));
});

test('a world folder left on disk under the chosen id is never reused: it is hidden and the next name is taken', (t) => {
  const base = fresh(t);
  const leftover = path.join(base, worlds.WORLDS_SUBDIR, store.safeKey(rw.worldName('Ann', NOW)), 'workers', 'old-agent');
  fs.mkdirSync(leftover, { recursive: true });
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  assert.equal(p.ok, true, p.because);
  assert.equal(p.world.name, `Restored: Ann, ${DAY} (2)`);
  const first = worlds.readRegistry(base).worlds.find((x) => x.name === `Restored: Ann, ${DAY}`);
  assert.ok(first && first.hiddenAt, 'the world over the leftover folder was hidden');
  assert.deepEqual(rw.listRestoredAgents({ base, world: p.world, nameOk }).agents, []);
});
