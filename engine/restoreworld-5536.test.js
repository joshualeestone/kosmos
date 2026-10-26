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
const nameOk = (n) => require('./create').NAME_RE.test(n);   // the real rule, required after the sandbox above
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

test('prepare reads a taken name by the id createWorld derives (the two derivations stay one)', (t) => {
  const base = fresh(t);
  const name = rw.worldName('Ann Lee', NOW);
  const w = worlds.createWorld(base, name);
  assert.equal(w.id, store.safeKey(name), 'createWorld no longer derives its id with store.safeKey: prepare would stop seeing a taken name');
  const p = rw.prepareRestoreWorld(base, { member: 'Ann Lee', now: NOW });
  assert.equal(p.ok, true, p.because);
  assert.equal(p.world.name, `${name} (2)`, 'the taken name was tried again instead of moving on');
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
  let r;
  try {
    r = rw.prepareRestoreWorld(base, {
      member: 'Ann', now: NOW,
      // A fresh world whose folder cannot be written: the restore folder inside it cannot be made.
      createWorld: (b, n) => { const w = worlds.createWorld(b, n); dir = worlds.worldBaseDir(b, w); fs.chmodSync(dir, 0o555); return w; },
      hideWorld: (b, id) => { hidden.push(id); return worlds.hideWorld(b, id); },
    });
  } finally { if (dir) fs.chmodSync(dir, 0o755); }   // before the temp folder is removed
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
    { where: 'workers', label: '(the workers folder itself)', runs: ['CLAUDE.md imports'] },
    { where: 'workers', label: 'CLAUDE.md', runs: [] },
    { where: 'projects', label: 'site', runs: ['.git', 'CLAUDE.md imports', 'git runs its settings here (hooks, fsmonitor) when an agent uses git in this folder'] },
  ], '.DS_Store is not listed and a plain project is not shared');

  put(w, '.git/config', '[core]\n');
  l = rw.listRestoredAgents({ base, world: p.world, nameOk });
  by = Object.fromEntries(l.agents.map((a) => [a.folder, a]));
  assert.match(by.ann.because, /workers folder holds a git folder/, 'a git folder above every agent blocks them all');
  assert.ok(l.shared.some((x) => x.label === '(the workers folder itself)' && x.runs.includes('.git')
    && x.runs.includes('git runs its settings here (hooks, fsmonitor) when an agent uses git in this folder')));
  assert.ok(!l.shared.some((x) => x.label === '.git'), 'a dot-entry gets no row of its own; the folder row names it');
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

test('git folders are matched in any case, and any provider folder, opencode.json, a (@ import and a UTF-16 brief are named', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  const w = worlds.envOverridesFor(base, p.world).AGENT_WORKFORCE_WORKERS;
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(w, rel)), { recursive: true }); fs.writeFileSync(path.join(w, rel), text); };
  put('mixed/CLAUDE.md', '# m\n');
  put('mixed/.Git/config', '[core]\n');
  put('grok/CLAUDE.md', '# see the notes (@notes.md)\n');
  put('grok/.grok/settings.json', '{}\n');
  put('grok/opencode.json', '{}\n');
  put('wide/CLAUDE.md', '');
  fs.writeFileSync(path.join(w, 'wide', 'CLAUDE.md'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('@x\n', 'utf16le')]));
  let by = Object.fromEntries(rw.listRestoredAgents({ base, world: p.world, nameOk }).agents.map((a) => [a.folder, a]));
  assert.match(by.mixed.because, /git folder/);
  if (fs.existsSync(path.join(w, 'mixed', '.git'))) {   // a filesystem that folds case opens .Git as .git
    assert.equal(by.mixed.runs.filter((r) => r.toLowerCase() === '.git').length, 1, 'one git folder, one row');
  }
  assert.deepEqual(by.grok.runs, ['.grok', 'opencode.json', 'CLAUDE.md imports']);
  assert.equal(by.grok.because, null, 'listed for the screen, not refused');
  assert.deepEqual(by.wide.runs, ['CLAUDE.md (not plain text, so not checked)']);
  put('.GIT/config', '[core]\n');
  by = Object.fromEntries(rw.listRestoredAgents({ base, world: p.world, nameOk }).agents.map((a) => [a.folder, a]));
  assert.match(by.grok.because, /workers folder holds a git folder/);
});

test('a leftover world folder that cannot be set aside stops the restore and names the world left on the list', (t) => {
  const base = fresh(t);
  fs.mkdirSync(path.join(base, worlds.WORLDS_SUBDIR, store.safeKey(rw.worldName('Ann', NOW)), 'workers', 'old'), { recursive: true });
  const r = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW, hideWorld: () => { throw new Error('locked'); } });
  assert.equal(r.ok, false);
  assert.match(r.because, /could not be set aside/);
  const left = worlds.readRegistry(base).worlds.find((x) => x.name === `Restored: Ann, ${DAY}`);
  assert.ok(left && !left.hiddenAt, 'the world is still on the list');
  assert.ok(r.because.includes(`"Restored: Ann, ${DAY}"`), 'and the refusal names it, so the person can hide it');
});

test('finish and listing refuse a world folder swapped for a link', { skip: process.platform === 'win32' ? 'a directory symlink needs privileges on Windows' : false }, (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  fs.mkdirSync(path.join(p.restoreDir, 'workers', 'ann'), { recursive: true });
  fs.mkdirSync(path.join(p.dir, 'workers', 'bob'));
  fs.writeFileSync(path.join(p.dir, 'workers', 'bob', 'CLAUDE.md'), '# bob\n');
  assert.equal(rw.listRestoredAgents({ base, world: p.world, nameOk }).agents.length, 1, 'control: bob is listed through the real folder');
  assert.equal(rw.isRestoredWorld(base, p.world), true, 'control: the real folder carries the mark');
  fs.rmSync(path.join(p.dir, 'restored-world.json'));
  assert.equal(rw.isRestoredWorld(base, p.world), false, 'control: a real folder without the mark is not Restored');
  fs.writeFileSync(path.join(p.dir, 'restored-world.json'), '{}');
  fs.renameSync(p.dir, `${p.dir}-real`);
  fs.symlinkSync(`${p.dir}-real`, p.dir);
  fs.rmSync(path.join(`${p.dir}-real`, 'restored-world.json'));   // the link's target has no mark either
  assert.equal(rw.isRestoredWorld(base, p.world), true, 'a world folder swapped for a link cannot be vouched for, so it reads as Restored (hooks off)');
  const r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
  assert.equal(r.ok, false);
  assert.match(r.because, /did not name its Kosmos/);
  assert.ok(fs.existsSync(path.join(`${p.dir}-real`, rw.RESTORE_DIR, 'workers', 'ann')), 'nothing moved');
  assert.deepEqual(rw.listRestoredAgents({ base, world: p.world, nameOk }).agents, [], 'nothing is listed through the link');
});

test('a move that fails part way says which root moved and puts the empty target back; finishing again moves the rest', { skip: process.platform === 'win32' ? 'a read-only folder needs POSIX modes' : false }, (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  fs.mkdirSync(path.join(p.restoreDir, 'workers', 'ann'), { recursive: true });
  fs.mkdirSync(path.join(p.restoreDir, 'projects', 'site'), { recursive: true });
  const roots = worlds.envOverridesFor(base, p.world);
  // Moving a folder to another parent rewrites its '..', which needs write permission on the folder itself.
  const ro = path.join(p.restoreDir, 'projects');
  fs.chmodSync(ro, 0o555);
  let r;
  try { r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK }); } finally { fs.chmodSync(ro, 0o755); }
  assert.equal(r.ok, false, 'the read-only projects folder was moved, so this test shows nothing here');
  assert.deepEqual(r.moved, ['workers']);
  assert.match(r.because, /restored projects could not be moved into the new Kosmos \((EACCES|EPERM)\)$/);
  assert.ok(fs.existsSync(path.join(roots.AGENT_WORKFORCE_WORKERS, 'ann')));
  assert.deepEqual(fs.readdirSync(roots.AGENT_WORKFORCE_PROJECTS), [], 'the empty projects target was put back');
  const again = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
  assert.equal(again.ok, true, again.because);
  assert.deepEqual(again.moved, ['projects']);
  assert.ok(fs.existsSync(path.join(roots.AGENT_WORKFORCE_PROJECTS, 'site')));
});

test('a cut-short list says more, and a git folder at the top of workers blocks agents however many sort before it', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  const w = worlds.envOverridesFor(base, p.world).AGENT_WORKFORCE_WORKERS;
  for (const n of ['!first', 'bob', 'cat']) { fs.mkdirSync(path.join(w, n)); fs.writeFileSync(path.join(w, n, 'CLAUDE.md'), '# x\n'); }
  let l = rw.listRestoredAgents({ base, world: p.world, nameOk, maxListed: 2 });
  assert.equal(l.agents.length + l.shared.length, 2);
  assert.equal(l.more, true);
  assert.equal(rw.listRestoredAgents({ base, world: p.world, nameOk }).more, false);
  fs.mkdirSync(path.join(w, '.git'));
  // The "(the workers folder itself)" row, from runsIn on the top of workers, comes first and fills one place; ! sorts
  // before .git, so the cap stops there.
  l = rw.listRestoredAgents({ base, world: p.world, nameOk: () => true, maxListed: 2 });
  assert.deepEqual(l.agents.map((a) => a.folder), ['!first']);
  assert.match(l.agents[0].because, /workers folder holds a git folder/);
});

test('start-time names are matched in any case, and AGENTS.override.md is read as a brief', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  const w = worlds.envOverridesFor(base, p.world).AGENT_WORKFORCE_WORKERS;
  fs.mkdirSync(path.join(w, 'cased'));
  fs.writeFileSync(path.join(w, 'cased', 'CLAUDE.md'), '# c\n');
  fs.writeFileSync(path.join(w, 'cased', 'claude.local.md'), 'local\n');
  fs.writeFileSync(path.join(w, 'cased', 'OPENCODE.JSONC'), '{}\n');
  fs.writeFileSync(path.join(w, 'cased', 'AGENTS.override.md'), 'first read by Codex @../../x\n');
  const a = rw.listRestoredAgents({ base, world: p.world, nameOk }).agents.find((x) => x.folder === 'cased');
  assert.deepEqual(a.runs, ['CLAUDE.local.md', 'opencode.jsonc', 'AGENTS.override.md imports']);
});

test('finish says how many files the restore listed as failed, and refuses a world that is not in the registry', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  fs.mkdirSync(path.join(p.restoreDir, 'workers', 'ann'), { recursive: true });
  // A world folder shaped like a real one, with no registry row.
  const ghost = { id: 'ghost' };
  const ghostDir = worlds.worldBaseDir(base, ghost);
  for (const leaf of ['workers', 'projects', rw.RESTORE_DIR]) fs.mkdirSync(path.join(ghostDir, leaf), { recursive: true });
  fs.mkdirSync(path.join(ghostDir, rw.RESTORE_DIR, 'workers', 'x'), { recursive: true });
  const g = rw.finishRestoreWorld({ base, world: ghost, restoreDir: path.join(ghostDir, rw.RESTORE_DIR), result: OK });
  assert.equal(g.ok, false);
  assert.match(g.because, /not a Kosmos on your list/);
  assert.ok(fs.existsSync(path.join(ghostDir, rw.RESTORE_DIR, 'workers', 'x')), 'nothing moved');
  const r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: { ok: true, result: { restored: ['a'], failed: [{ path: 'b' }, { path: 'c' }] } } });
  assert.equal(r.ok, true, r.because);
  assert.equal(r.failedFiles, 2);
});

test('git reads HEAD, objects and refs as a repository with no .git: in an agent it refuses, at the top of workers it blocks all, at the top of projects it is shared', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  const roots = worlds.envOverridesFor(base, p.world);
  const bare = (dir) => { fs.writeFileSync(path.join(dir, 'HEAD'), 'ref: refs/heads/main\n'); fs.mkdirSync(path.join(dir, 'objects')); fs.mkdirSync(path.join(dir, 'refs')); fs.writeFileSync(path.join(dir, 'config'), '[core]\n'); };
  const w = roots.AGENT_WORKFORCE_WORKERS;
  for (const n of ['ann', 'barry']) { fs.mkdirSync(path.join(w, n)); fs.writeFileSync(path.join(w, n, 'CLAUDE.md'), '# x\n'); }
  bare(path.join(w, 'barry'));
  fs.mkdirSync(path.join(roots.AGENT_WORKFORCE_PROJECTS, 'plain'));
  fs.mkdirSync(path.join(roots.AGENT_WORKFORCE_PROJECTS, '.git'));
  let l = rw.listRestoredAgents({ base, world: p.world, nameOk });
  let by = Object.fromEntries(l.agents.map((a) => [a.folder, a]));
  assert.equal(by.ann.because, null);
  assert.match(by.barry.because, /git folder/);
  assert.ok(by.barry.runs.some((r) => /^HEAD \(git can read/.test(r)));
  assert.ok(l.shared.some((x) => x.where === 'projects' && x.label === '(the projects folder itself)' && x.runs.includes('.git')));
  assert.ok(l.shared.some((x) => x.label === '(the projects folder itself)' && x.runs.includes('git runs its settings here (hooks, fsmonitor) when an agent uses git in this folder')), 'the row says why it is shared');
  bare(w);
  l = rw.listRestoredAgents({ base, world: p.world, nameOk });
  by = Object.fromEntries(l.agents.map((a) => [a.folder, a]));
  assert.match(by.ann.because, /workers folder holds a git folder/);
  assert.ok(l.shared.some((x) => x.label === '(the workers folder itself)'));
});

test('failedFiles counts the failures past the listed ones; a busy Kosmos list asks to try again; a folder too big to read in full says so', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  fs.mkdirSync(path.join(p.restoreDir, 'workers', 'ann'), { recursive: true });
  const r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: { ok: true, result: { restored: ['a'], failed: [{ path: 'b' }], failedNotListed: 12000 } } });
  assert.equal(r.failedFiles, 12001);
  const f = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: { ok: true, fetchProblems: ['the hourly limit was reached', 7, 'x'.repeat(400)], result: { restored: [], failed: [] } } });
  assert.deepEqual(f.fetchProblems, ['the hourly limit was reached', 'x'.repeat(300)], 'reasons carried, non-strings dropped, each cut');
  const busy = rw.prepareRestoreWorld(base, { member: 'Bo', now: NOW, createWorld: () => { const e = new Error('busy'); e.code = 'EWORLDLOCK'; throw e; } });
  assert.equal(busy.ok, false);
  assert.match(busy.because, /try again in a moment/);
  const w = worlds.envOverridesFor(base, p.world).AGENT_WORKFORCE_WORKERS;
  fs.writeFileSync(path.join(w, 'ann', 'CLAUDE.md'), '# ann\n');
  for (let i = 0; i < 4001; i++) fs.writeFileSync(path.join(w, 'ann', `f${i}`), '');
  const l = rw.listRestoredAgents({ base, world: p.world, nameOk });
  const a = l.agents.find((x) => x.folder === 'ann');
  assert.ok(a.runs.includes('(the folder holds more entries than were checked)'));
  assert.match(a.because, /more entries than were checked/, 'a padded folder could hide its start-time files past the cut');
  assert.equal(l.more, true);
});

test('listing refuses a world that is not in the registry', (t) => {
  const base = fresh(t);
  const ghost = { id: 'ghost' };
  const dir = worlds.worldBaseDir(base, ghost);
  fs.mkdirSync(path.join(dir, 'workers', 'ann'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'workers', 'ann', 'CLAUDE.md'), '# ann\n');
  const l = rw.listRestoredAgents({ base, world: ghost, nameOk });
  assert.deepEqual(l.agents, []);
  assert.match(l.because, /not a Kosmos on your list/, 'a refusal says so, rather than reading as an empty restore');
});

test('a hidden world is neither finished nor listed', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  fs.mkdirSync(path.join(p.restoreDir, 'workers', 'ann'), { recursive: true });
  const w = worlds.envOverridesFor(base, p.world).AGENT_WORKFORCE_WORKERS;
  fs.mkdirSync(path.join(w, 'bob'));
  fs.writeFileSync(path.join(w, 'bob', 'CLAUDE.md'), '# bob\n');
  assert.equal(rw.listRestoredAgents({ base, world: p.world, nameOk }).agents.length, 1, 'control: listed while on the list');
  worlds.hideWorld(base, p.world.id);
  assert.deepEqual(rw.listRestoredAgents({ base, world: p.world, nameOk }).agents, []);
  fs.rmSync(path.join(w, 'bob'), { recursive: true });
  const r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
  assert.equal(r.ok, false);
  assert.match(r.because, /not a Kosmos on your list/);
  assert.ok(fs.existsSync(path.join(p.restoreDir, 'workers', 'ann')), 'nothing moved');
});

test('a restored root that cannot be checked is refused, not read as absent', { skip: process.platform === 'win32' ? 'POSIX modes' : false }, (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  fs.mkdirSync(path.join(p.restoreDir, 'workers', 'ann'), { recursive: true });
  // Readable but not searchable: the folder lists, and lstat of anything in it fails with EACCES.
  fs.chmodSync(p.restoreDir, 0o600);
  let r;
  try { r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK }); } finally { fs.chmodSync(p.restoreDir, 0o700); }
  assert.equal(r.ok, false, 'an unreadable root must not finish as an empty restore');
  assert.match(r.because, /restored workers could not be checked/);
  assert.ok(fs.existsSync(path.join(p.restoreDir, 'workers', 'ann')), 'nothing moved');
});

test('a HEAD with a commondir pointing elsewhere is git too: refused in an agent, blocking at the top of workers', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  const w = worlds.envOverridesFor(base, p.world).AGENT_WORKFORCE_WORKERS;
  const commondir = (dir) => {
    fs.writeFileSync(path.join(dir, 'HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(path.join(dir, 'commondir'), 'c\n');
    for (const sub of ['c/objects', 'c/refs']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
    fs.writeFileSync(path.join(dir, 'c', 'config'), '[core]\n');
  };
  for (const n of ['ann', 'cora']) { fs.mkdirSync(path.join(w, n)); fs.writeFileSync(path.join(w, n, 'CLAUDE.md'), '# x\n'); }
  commondir(path.join(w, 'cora'));
  let by = Object.fromEntries(rw.listRestoredAgents({ base, world: p.world, nameOk }).agents.map((a) => [a.folder, a]));
  assert.equal(by.ann.because, null);
  assert.match(by.cora.because, /git folder/);
  fs.writeFileSync(path.join(w, 'HEAD'), 'ref: refs/heads/main\n');
  by = Object.fromEntries(rw.listRestoredAgents({ base, world: p.world, nameOk }).agents.map((a) => [a.folder, a]));
  assert.match(by.ann.because, /workers folder holds a git folder/);
});

test('briefs past the listing\'s byte budget are named as not checked', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  const w = worlds.envOverridesFor(base, p.world).AGENT_WORKFORCE_WORKERS;
  for (const n of ['ann', 'bob']) { fs.mkdirSync(path.join(w, n)); fs.writeFileSync(path.join(w, n, 'CLAUDE.md'), '# ' + 'x'.repeat(100) + '\n'); }
  const by = Object.fromEntries(rw.listRestoredAgents({ base, world: p.world, nameOk, briefTotal: 50 }).agents.map((a) => [a.folder, a]));
  assert.deepEqual(by.ann.runs, [], 'the first brief is read while budget is left');
  assert.deepEqual(by.bob.runs, ['CLAUDE.md (not checked: the listing has read as much as it may)']);
});

test('an agent folder that cannot be listed is refused, and git is still found in it', { skip: process.platform === 'win32' ? 'POSIX modes' : false }, (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  const w = worlds.envOverridesFor(base, p.world).AGENT_WORKFORCE_WORKERS;
  const dirs = ['shut', 'shutgit'].map((n) => path.join(w, n));
  for (const d of dirs) { fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'CLAUDE.md'), '# shut\n'); }
  fs.mkdirSync(path.join(dirs[1], '.git'));
  for (const d of dirs) fs.chmodSync(d, 0o100);   // searchable, not listable: lstat inside works, opendir does not
  let by;
  try { by = Object.fromEntries(rw.listRestoredAgents({ base, world: p.world, nameOk }).agents.map((x) => [x.folder, x])); } finally { for (const d of dirs) fs.chmodSync(d, 0o755); }
  assert.deepEqual(by.shut.runs, ['(the folder could not be read)']);
  assert.match(by.shut.because, /could not be read/);
  assert.ok(by.shutgit.runs.includes('.git'), 'git is asked by lstat even when the folder cannot be listed');
  assert.match(by.shutgit.because, /git folder/);
});

test('a lone Finder file in the new world\'s empty folder does not stop finish', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  fs.mkdirSync(path.join(p.restoreDir, 'workers', 'ann'), { recursive: true });
  const w = worlds.envOverridesFor(base, p.world).AGENT_WORKFORCE_WORKERS;
  fs.writeFileSync(path.join(w, '.DS_Store'), '');
  const r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
  assert.equal(r.ok, true, r.because);
  assert.ok(fs.existsSync(path.join(w, 'ann')));
});

test('an @ before a path counts as an import whatever precedes it; an address still does not', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  const w = worlds.envOverridesFor(base, p.world).AGENT_WORKFORCE_WORKERS;
  const brief = (n, text) => { fs.mkdirSync(path.join(w, n)); fs.writeFileSync(path.join(w, n, 'CLAUDE.md'), text); };
  brief('dot', 'see.@../../x\n');
  brief('word', 'x@~/secret\n');
  brief('mail', 'write to a@b.example or c@d.org\n');
  const by = Object.fromEntries(rw.listRestoredAgents({ base, world: p.world, nameOk }).agents.map((a) => [a.folder, a]));
  assert.deepEqual(by.dot.runs, ['CLAUDE.md imports']);
  assert.deepEqual(by.word.runs, ['CLAUDE.md imports']);
  assert.deepEqual(by.mail.runs, []);
});

test('leftover folders that take every name tried are said to be the reason, not restored Kosmoses', (t) => {
  const base = fresh(t);
  for (let n = 1; n <= 9; n++) fs.mkdirSync(path.join(base, worlds.WORLDS_SUBDIR, store.safeKey(rw.worldName('Ann', NOW, n)), 'workers', 'old'), { recursive: true });
  const r = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  assert.equal(r.ok, false);
  assert.match(r.because, /took 9 of the 9 names/);
});

test('listing does not read agents through a restore folder swapped for a link', { skip: process.platform === 'win32' ? 'a directory symlink needs privileges on Windows' : false }, (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  fs.mkdirSync(path.join(p.restoreDir, 'agents', 'x9'), { recursive: true });
  assert.equal(rw.listRestoredAgents({ base, world: p.world, restoreDir: p.restoreDir, nameOk }).agents.length, 1, 'control: x9 is listed through the real folder');
  fs.renameSync(p.restoreDir, `${p.restoreDir}-real`);
  fs.symlinkSync(`${p.restoreDir}-real`, p.restoreDir);
  assert.deepEqual(rw.listRestoredAgents({ base, world: p.world, restoreDir: p.restoreDir, nameOk }).agents, []);
});

test('only plain-named folders at the top of workers and projects become the world\'s; the rest is held back and named', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(p.restoreDir, rel)), { recursive: true }); fs.writeFileSync(path.join(p.restoreDir, rel), text); };
  put('workers/ann/CLAUDE.md', '# ann\n');
  put('workers/.git/config', '[core]\n\tfsmonitor = touch /tmp/x\n');
  put('workers/HEAD', 'ref: refs/heads/main\n');
  put('workers/CLAUDE.md', 'every agent @~/.ssh/id\n');
  put('workers/.foo/settings', 'x\n');   // any dot-folder, not only the names git and providers are known to open
  put('projects/site/README.md', 'site\n');
  put('projects/.git/config', '[core]\n');
  const r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
  assert.equal(r.ok, true, r.because);
  assert.deepEqual(r.moved, ['workers', 'projects']);
  assert.deepEqual(r.heldBack, ['workers/.foo', 'workers/.git', 'workers/CLAUDE.md', 'workers/HEAD', 'projects/.git']);
  const roots = worlds.envOverridesFor(base, p.world);
  assert.deepEqual(fs.readdirSync(roots.AGENT_WORKFORCE_WORKERS), ['ann'], 'nothing sits above the agents a person makes later');
  assert.deepEqual(fs.readdirSync(roots.AGENT_WORKFORCE_PROJECTS), ['site']);
  const l = rw.listRestoredAgents({ base, world: p.world, nameOk });
  assert.equal(l.agents.find((a) => a.folder === 'ann').because, null);
  assert.deepEqual(l.shared, []);
});

test('a backup that supplies its own held-back entries cannot block the finish', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  fs.mkdirSync(path.join(p.restoreDir, 'workers', 'ann'), { recursive: true });
  fs.mkdirSync(path.join(p.restoreDir, 'workers', '.git'));
  fs.writeFileSync(path.join(p.restoreDir, 'held-back'), 'x');   // where a fixed name would have gone
  const r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
  assert.equal(r.ok, true, r.because);
  assert.deepEqual(r.heldBack, ['workers/.git']);
  assert.deepEqual(fs.readdirSync(worlds.envOverridesFor(base, p.world).AGENT_WORKFORCE_WORKERS), ['ann']);
});

test('a finish refused after an earlier one held something back still names what it held back', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  fs.mkdirSync(path.join(p.restoreDir, 'workers', 'ann'), { recursive: true });
  fs.mkdirSync(path.join(p.restoreDir, 'workers', '.git'));
  const first = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
  assert.equal(first.ok, true, first.because);
  assert.deepEqual(first.heldBack, ['workers/.git']);
  // A sink entry appears (a second restore started into the same folder): the rerun is refused, and still says so.
  fs.mkdirSync(path.join(p.restoreDir, require('./restoresink').TEMP_PREFIX + 'again'));
  const again = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
  assert.equal(again.ok, false);
  assert.match(again.because, /has not finished/);
  assert.deepEqual(again.heldBack, ['workers/.git'], 'the refusal does not hide what the first finish held back');
});

test('isRestoredWorld reads Restored for anything but a certainly absent mark', { skip: process.platform === 'win32' ? 'POSIX modes' : (process.getuid && process.getuid() === 0 ? 'root reads through modes' : false) }, (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  const mark = path.join(p.dir, 'restored-world.json');
  fs.rmSync(mark);
  assert.equal(rw.isRestoredWorld(base, p.world), false, 'control: no mark, not Restored');
  fs.mkdirSync(mark);
  assert.equal(rw.isRestoredWorld(base, p.world), true, 'a mark that is a folder still marks it');
  fs.rmdirSync(mark);
  fs.writeFileSync(mark, '{}');
  fs.chmodSync(p.dir, 0o600);   // no search bit: the mark cannot be looked up (EACCES)
  t.after(() => { try { fs.chmodSync(p.dir, 0o700); } catch { /* gone */ } });
  assert.equal(rw.isRestoredWorld(base, p.world), true, 'a mark that cannot be looked up reads as Restored (hooks off)');
  fs.chmodSync(p.dir, 0o700);
  fs.rmSync(mark);
  fs.chmodSync(p.dir, 0o600);
  assert.equal(rw.isRestoredWorld(base, p.world), true, 'even with no mark, a folder that cannot be searched cannot be vouched for');
  fs.chmodSync(p.dir, 0o700);
  assert.equal(rw.isRestoredWorld(base, p.world), false, 'control: with the folder searchable again and no mark, not Restored');
  assert.equal(rw.isRestoredWorld(base, null), true, 'no world to place cannot be vouched for');
  assert.equal(rw.isRestoredWorld(base, { id: 'default' }), false, 'the default world is never Restored: hooks stay on for a person who never restored anything');
  assert.equal(rw.isRestoredWorld('relative/base', p.world), true, 'nor can a world under a relative base');
});

test('finish and the listing need the mark certainly present: a mark that cannot be looked up reads as no', { skip: process.platform === 'win32' ? 'POSIX modes' : (process.getuid && process.getuid() === 0 ? 'root reads through modes' : false) }, (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  fs.mkdirSync(path.join(p.restoreDir, 'workers', 'ann'), { recursive: true });
  const mark = path.join(p.dir, 'restored-world.json');
  fs.rmSync(mark);
  fs.mkdirSync(mark);   // a mark that is not a file: Restored for the hooks, not certain for moving files
  assert.equal(rw.isRestoredWorld(base, p.world), true, 'control: the hooks decision reads it as Restored');
  const r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
  assert.equal(r.ok, false);
  assert.match(r.because, /not made for a restore/);
  assert.match(rw.listRestoredAgents({ base, world: p.world, nameOk }).because || '', /not made for a restore/);
  fs.rmdirSync(mark);
  fs.writeFileSync(mark, '{}');
  assert.equal(rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK }).ok, true, 'control: with the mark a file, finish goes ahead');
});

test('the listing offers nothing in a world prepare did not make', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  fs.mkdirSync(path.join(p.dir, 'workers', 'bob'));
  fs.writeFileSync(path.join(p.dir, 'workers', 'bob', 'CLAUDE.md'), '# bob\n');
  assert.equal(rw.listRestoredAgents({ base, world: p.world, nameOk }).agents.length, 1, 'control: listed while the mark is there');
  fs.rmSync(path.join(p.dir, 'restored-world.json'));
  const l = rw.listRestoredAgents({ base, world: p.world, nameOk });
  assert.deepEqual(l.agents, []);
  assert.match(l.because, /not made for a restore/);
});

test('finish moves nothing into a world on the list that prepare did not make', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  fs.mkdirSync(path.join(p.restoreDir, 'workers', 'ann'), { recursive: true });
  fs.rmSync(path.join(worlds.worldBaseDir(base, p.world), 'restored-world.json'));
  assert.equal(rw.isRestoredWorld(base, p.world), false, 'the mark is gone, so this world reads as an ordinary one');
  const r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
  assert.equal(r.ok, false);
  assert.match(r.because, /not made for a restore/);
  assert.deepEqual(fs.readdirSync(worlds.envOverridesFor(base, p.world).AGENT_WORKFORCE_WORKERS), [], 'nothing moved');
  assert.ok(fs.existsSync(path.join(p.restoreDir, 'workers', 'ann')), 'the restored agent stays where it was');
});

test('an agents folder that cannot be read leaves the list marked incomplete', { skip: process.platform === 'win32' ? 'POSIX modes' : false }, (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  const agentsDir = path.join(p.restoreDir, 'agents');
  fs.mkdirSync(path.join(agentsDir, 'x9'), { recursive: true });
  assert.equal(rw.listRestoredAgents({ base, world: p.world, restoreDir: p.restoreDir, nameOk }).more, false, 'control');
  fs.chmodSync(agentsDir, 0o000);
  let l;
  try { l = rw.listRestoredAgents({ base, world: p.world, restoreDir: p.restoreDir, nameOk }); } finally { fs.chmodSync(agentsDir, 0o755); }
  assert.deepEqual(l.agents, []);
  assert.equal(l.more, true);
});

test('node_modules at the top of workers is held back; a lookalike held-back folder from the snapshot is not reported as held back', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(p.restoreDir, rel)), { recursive: true }); fs.writeFileSync(path.join(p.restoreDir, rel), text); };
  put('workers/ann/CLAUDE.md', '# ann\n');
  put('workers/node_modules/evil/package.json', '{"bin":"x.js"}\n');
  put('held-back-snapshot/workers/fake', 'x\n');
  const r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
  assert.equal(r.ok, true, r.because);
  assert.deepEqual(r.heldBack, ['workers/node_modules']);
  assert.deepEqual(fs.readdirSync(worlds.envOverridesFor(base, p.world).AGENT_WORKFORCE_WORKERS), ['ann']);
  assert.ok(r.kept.includes('held-back-snapshot'), 'the snapshot\'s own root is kept, as any other');
  assert.ok(!r.kept.some((n) => n.startsWith('held-back-') && n !== 'held-back-snapshot'), 'this run\'s held-back folder is itemised, not listed as kept');
});

test('an entry the filesystem opens as node_modules is held back, whatever its spelling', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  const longS = String.fromCodePoint(0x17f);   // folds to s under full Unicode case folding
  const odd = `node_module${longS}`;
  fs.mkdirSync(path.join(p.restoreDir, 'workers', odd), { recursive: true });
  let folds = false;
  try { fs.lstatSync(path.join(p.restoreDir, 'workers', 'node_modules')); folds = true; } catch { /* this filesystem keeps them apart */ }
  if (!folds) { t.skip('this filesystem does not open the long s as s, so there is nothing to hold back'); return; }
  fs.mkdirSync(path.join(p.restoreDir, 'workers', 'ann'));
  const r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
  assert.equal(r.ok, true, r.because);
  assert.deepEqual(fs.readdirSync(worlds.envOverridesFor(base, p.world).AGENT_WORKFORCE_WORKERS), ['ann']);
});

test('kept is capped and says so when the restore folder holds more than it lists', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  for (let i = 0; i < 1001; i++) fs.mkdirSync(path.join(p.restoreDir, `r${String(i).padStart(4, '0')}`));
  const r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
  assert.equal(r.ok, true, r.because);
  assert.equal(r.kept.length, 1001);
  assert.equal(r.kept[1000], '(more not listed)');
});

test('a link at the top of the restored workers is held back, not moved in', { skip: process.platform === 'win32' ? 'a directory symlink needs privileges on Windows' : false }, (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  fs.mkdirSync(path.join(p.restoreDir, 'workers', 'ann'), { recursive: true });
  const outside = fresh(t);
  fs.symlinkSync(outside, path.join(p.restoreDir, 'workers', 'linked'));
  const r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
  assert.equal(r.ok, true, r.because);
  assert.deepEqual(r.heldBack, ['workers/linked']);
  assert.deepEqual(fs.readdirSync(worlds.envOverridesFor(base, p.world).AGENT_WORKFORCE_WORKERS), ['ann']);
});

test('fetchProblems past twenty say more were not listed', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  const many = Array.from({ length: 25 }, (_, i) => `problem ${i}`);
  const r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: { ok: true, fetchProblems: many, result: { restored: [], failed: [] } } });
  assert.equal(r.fetchProblems.length, 21);
  assert.equal(r.fetchProblems[20], '(more not listed)');
});

test('a node_modules in an agent folder is named in runs, and heldBack is capped with a marker', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  for (let i = 0; i < 1001; i++) fs.mkdirSync(path.join(p.restoreDir, 'workers', `.d${String(i).padStart(4, '0')}`), { recursive: true });
  fs.mkdirSync(path.join(p.restoreDir, 'workers', 'ann', 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(p.restoreDir, 'workers', 'ann', 'CLAUDE.md'), '# ann\n');
  const r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
  assert.equal(r.ok, true, r.because);
  assert.equal(r.heldBack.length, 1001);
  assert.equal(r.heldBack[1000], 'workers/(more not listed)');
  const a = rw.listRestoredAgents({ base, world: p.world, nameOk }).agents.find((x) => x.folder === 'ann');
  assert.deepEqual(a.runs, ['node_modules']);
});

test('a rerun after a part-way failure still names what the first run held back', { skip: process.platform === 'win32' ? 'POSIX modes' : false }, (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  fs.mkdirSync(path.join(p.restoreDir, 'workers', 'ann'), { recursive: true });
  fs.mkdirSync(path.join(p.restoreDir, 'workers', '.git'));
  fs.mkdirSync(path.join(p.restoreDir, 'projects', 'site'), { recursive: true });
  const ro = path.join(p.restoreDir, 'projects');
  fs.chmodSync(ro, 0o555);
  let first;
  try { first = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK }); } finally { fs.chmodSync(ro, 0o755); }
  assert.equal(first.ok, false);
  assert.deepEqual(first.heldBack, ['workers/.git']);
  const again = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
  assert.equal(again.ok, true, again.because);
  assert.deepEqual(again.heldBack, ['workers/.git'], 'the first run\'s held-back entries are still named');
  assert.ok(!again.kept.some((n) => n.startsWith('held-back-')), 'and its folder is itemised, not listed as kept');
});

test('one finish at a time: a live lock refuses, a dead process\'s lock is taken over', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  fs.mkdirSync(path.join(p.restoreDir, 'workers', 'ann'), { recursive: true });
  const lock = path.join(p.dir, 'restore-finishing');
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'pid'), String(process.pid));
  const busy = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
  assert.equal(busy.ok, false);
  assert.match(busy.because, /already under way/);
  assert.ok(fs.existsSync(path.join(p.restoreDir, 'workers', 'ann')), 'nothing moved');
  const dead = 2147483646;   // above every system's pid limit (Linux at most 4194304), so never alive
  fs.writeFileSync(path.join(lock, 'pid'), String(dead));
  const r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
  assert.equal(r.ok, true, r.because);
  assert.ok(!fs.existsSync(lock), 'the lock is released after the finish');
});

test('a lock with no pid blocks only while young, and one that cannot be made does not mislabel the finish', { skip: process.platform === 'win32' ? 'POSIX modes' : false }, (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  fs.mkdirSync(path.join(p.restoreDir, 'workers', 'ann'), { recursive: true });
  const lock = path.join(p.dir, 'restore-finishing');
  // An empty lock folder: no finish makes one (a lock is renamed into place with its pid), and renaming onto an
  // empty folder replaces it, so it is taken at once.
  fs.mkdirSync(lock);
  const empty = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
  assert.equal(empty.ok, true, empty.because);
  // A lock holding something but no readable pid is busy while young and stale once old.
  const q0 = rw.prepareRestoreWorld(base, { member: 'Cy', now: NOW });
  fs.mkdirSync(path.join(q0.restoreDir, 'workers', 'cy'), { recursive: true });
  const odd = path.join(q0.dir, 'restore-finishing');
  fs.mkdirSync(odd);
  fs.writeFileSync(path.join(odd, 'note'), 'x');
  const young = rw.finishRestoreWorld({ base, world: q0.world, restoreDir: q0.restoreDir, result: OK });
  assert.equal(young.ok, false);
  assert.match(young.because, /already under way/);
  const old = (Date.now() - 60 * 1000) / 1000;
  fs.utimesSync(odd, old, old);
  const r = rw.finishRestoreWorld({ base, world: q0.world, restoreDir: q0.restoreDir, result: OK });
  assert.equal(r.ok, true, r.because);
  const q = rw.prepareRestoreWorld(base, { member: 'Bo', now: NOW });
  fs.chmodSync(q.dir, 0o555);
  let s;
  try { s = rw.finishRestoreWorld({ base, world: q.world, restoreDir: q.restoreDir, result: OK }); } finally { fs.chmodSync(q.dir, 0o755); }
  assert.equal(s.ok, false);
  assert.match(s.because, /could not be locked for the finish \(EACCES\)/, 'not "already under way"');
});

test('a lone surrogate never reaches a label or the world name', (t) => {
  const lone = String.fromCharCode(0xd800);
  assert.equal(rw.worldName(`Ann${lone}`, NOW), `Restored: Ann, ${DAY}`);
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  const w = worlds.envOverridesFor(base, p.world).AGENT_WORKFORCE_WORKERS;
  let made = true;
  try { fs.mkdirSync(path.join(w, `ann${lone}x`)); } catch { made = false; }
  if (!made) { t.skip('this filesystem refuses a lone surrogate in a name'); return; }
  // On macOS and Linux node writes the name as UTF-8 with U+FFFD in its place, so readdir never hands back a surrogate
  // and this half passes with or without the strip. Windows (UTF-16 names, in tools/windows-tests.js) is where it bites;
  // the worldName half above tests the strip on every platform.
  const labels = rw.listRestoredAgents({ base, world: p.world, nameOk }).agents.map((a) => a.label);
  assert.ok(labels.every((l) => !/[\uD800-\uDFFF]/.test(l)), labels.join(','));
});

test('lock and record temp files a crash left are swept once old, and kept while young', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  fs.mkdirSync(path.join(p.restoreDir, 'workers', 'ann'), { recursive: true });
  const oldLock = path.join(p.dir, 'restore-finishing.new-1-aaaa');
  const oldRec = path.join(p.dir, 'restore-held-back.json.1.tmp');
  const youngLock = path.join(p.dir, 'restore-finishing.new-2-bbbb');
  fs.mkdirSync(oldLock);
  fs.writeFileSync(oldRec, '{}');
  fs.mkdirSync(youngLock);
  const old = (Date.now() - 11 * 60 * 1000) / 1000;
  fs.utimesSync(oldLock, old, old);
  fs.utimesSync(oldRec, old, old);
  const r = rw.finishRestoreWorld({ base, world: p.world, restoreDir: p.restoreDir, result: OK });
  assert.equal(r.ok, true, r.because);
  assert.ok(!fs.existsSync(oldLock) && !fs.existsSync(oldRec), 'old leftovers swept');
  assert.ok(fs.existsSync(youngLock), 'a young one may belong to a finish under way');
});

test('a Restored world carries a mark an agent start path can ask for; an ordinary world does not', (t) => {
  const base = fresh(t);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann', now: NOW });
  assert.equal(rw.isRestoredWorld(base, p.world), true);
  const plain = worlds.createWorld(base, `Restored: Ann, ${DAY} (lookalike)`);   // the name alone proves nothing
  assert.equal(rw.isRestoredWorld(base, plain), false);
  assert.equal(rw.isRestoredWorld(base, { id: 'missing' }), false);
});

test('unassigned code points never reach the world name', () => {
  const unassigned = String.fromCodePoint(0x2065);
  assert.equal(rw.worldName(`Ann${unassigned}`, NOW), `Restored: Ann, ${DAY}`);
  assert.equal(rw.worldName(unassigned.repeat(3), NOW), `Restored: a member, ${DAY}`, 'nothing visible left falls back');
});
