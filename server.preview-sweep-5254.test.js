'use strict';
/*
 * kosmos#5254: a cached PDF first page goes when its PDF, its project or its agent goes, not only when 200 newer
 * renders push it out (engine/filepreview.js sweep). Each arm has a control that a folder whose file and owner are
 * still there is kept.
 *
 *   node --test server.preview-sweep-5254.test.js
 */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-preview-sweep-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-preview-sweep-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-preview-sweep-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-preview-sweep-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-preview-sweep-launch-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
const projects = require('./engine/projects');
const dmfiles = require('./engine/dmfiles');
const attachments = require('./engine/attachments');
const filepreview = require('./engine/filepreview');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const base = () => `http://127.0.0.1:${server.address().port}`;
const get = (route, name) => fetch(base() + route + '?name=' + encodeURIComponent(name));
const NOBODY_REMOVED = { removedNames: () => ({ ok: true, names: [] }) };
let FILES = null;
let PROJECT = null;
let renderFails = false;

/* The cache folder holding the page for one resolved file, found by its record (the folder name is a hash). */
function folderFor(target) {
  let ents = [];
  try { ents = fs.readdirSync(filepreview.CACHE); } catch { return null; }
  for (const n of ents) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(filepreview.CACHE, n, filepreview.SOURCE_FILE), 'utf8'));
      if (rec.target === fs.realpathSync(path.dirname(target)) + path.sep + path.basename(target)) return path.join(filepreview.CACHE, n);
    } catch { /* not this one */ }
  }
  return null;
}
async function draw(route, name) {
  const r = await get(route, name);
  assert.equal(r.status, 200, 'the preview did not draw: ' + (await r.text()));
  await r.arrayBuffer().catch(() => {});
}

test.before(async () => {
  await start(0);
  attachments.setRenderer((file, dir) => {
    if (renderFails) return;
    fs.writeFileSync(path.join(dir, 'preview.png'), Buffer.concat([PNG, fs.readFileSync(file)]));
  });
  FILES = dmfiles.filesDir('ava');
  fs.mkdirSync(FILES, { recursive: true });
  const folder = fs.mkdtempSync(path.join(process.env.AGENT_WORKFORCE_PROJECTS, 'sw-'));
  PROJECT = projects.create({ name: 'Sweep Room 5254', folder });
});
test.after(() => {
  attachments.setRenderer(null);
  try { server.closeAllConnections(); server.close(); } catch { /* best effort */ }
});

test('#5254 sandbox: the cache is under this test\'s data root', () => {
  assert.ok(filepreview.CACHE.startsWith(SANDBOX + path.sep), filepreview.CACHE);
});

test('#5254: a drawn page carries a private record of its file and its owner', async () => {
  fs.writeFileSync(path.join(FILES, 'rec.pdf'), Buffer.from('%PDF-1.4 rec'));
  await draw('/api/agent/ava/files/preview', 'rec.pdf');
  const dir = folderFor(path.join(FILES, 'rec.pdf'));
  assert.ok(dir, 'no record names the drawn file');
  const f = path.join(dir, filepreview.SOURCE_FILE);
  assert.equal(fs.statSync(f).mode & 0o777, 0o600, 'the record is readable by others');
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')).owner, { kind: 'agent', id: 'ava' });
});

test('#5254: a deleted PDF\'s page is swept; CONTROL: a PDF still there keeps its page', async () => {
  fs.writeFileSync(path.join(FILES, 'gone.pdf'), Buffer.from('%PDF-1.4 gone'));
  fs.writeFileSync(path.join(FILES, 'kept.pdf'), Buffer.from('%PDF-1.4 kept'));
  await draw('/api/agent/ava/files/preview', 'gone.pdf');
  await draw('/api/agent/ava/files/preview', 'kept.pdf');
  const goneDir = folderFor(path.join(FILES, 'gone.pdf'));
  const keptDir = folderFor(path.join(FILES, 'kept.pdf'));
  assert.ok(goneDir && keptDir);
  fs.rmSync(path.join(FILES, 'gone.pdf'));
  filepreview.sweep({ removal: NOBODY_REMOVED });
  assert.equal(fs.existsSync(goneDir), false, 'a picture of a deleted PDF stayed on disk');
  assert.equal(fs.existsSync(keptDir), true, 'a page whose PDF is still there was swept');
});

test('#5254: a removed project\'s pages are swept (its folder may stay); CONTROL: before removal they stay', async () => {
  const route = '/api/project/' + encodeURIComponent(PROJECT.id) + '/file-preview';
  fs.writeFileSync(path.join(PROJECT.folder, 'plan.pdf'), Buffer.from('%PDF-1.4 plan'));
  await draw(route, 'plan.pdf');
  const dir = folderFor(path.join(PROJECT.folder, 'plan.pdf'));
  assert.ok(dir);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, filepreview.SOURCE_FILE), 'utf8')).owner, { kind: 'project', id: PROJECT.id });
  filepreview.sweep({ removal: NOBODY_REMOVED });
  assert.equal(fs.existsSync(dir), true, 'CONTROL: a live project\'s page was swept');
  projects.remove(PROJECT.id);
  assert.ok(fs.existsSync(path.join(PROJECT.folder, 'plan.pdf')), 'premise: removing a project leaves its files');
  filepreview.sweep({ removal: NOBODY_REMOVED });
  assert.equal(fs.existsSync(dir), false, 'a removed project\'s page stayed');
});

test('#5254: a removed agent\'s pages are swept; an unreadable removed list is not read as "nobody removed"', async () => {
  fs.writeFileSync(path.join(FILES, 'agent.pdf'), Buffer.from('%PDF-1.4 agent'));
  await draw('/api/agent/ava/files/preview', 'agent.pdf');
  const dir = folderFor(path.join(FILES, 'agent.pdf'));
  assert.ok(dir);
  // Review 2 (NIT): the unreadable answer NAMES ava, so only skipping the check keeps the page (an empty list would too).
  filepreview.sweep({ removal: { removedNames: () => ({ ok: false, names: ['ava'] }) } });
  assert.equal(fs.existsSync(dir), true, 'an unreadable removed list was used anyway');
  filepreview.sweep({ removal: { removedNames: () => ({ ok: true, names: ['someone-else'] }) } });
  assert.equal(fs.existsSync(dir), true, 'CONTROL: another agent\'s removal swept this one');
  filepreview.sweep({ removal: { removedNames: () => ({ ok: true, names: ['ava'] }) } });
  assert.equal(fs.existsSync(dir), false, 'a removed agent\'s page stayed');
});

test('#5254: a cache folder with no record (drawn before this) is swept once it is old; CONTROL: a young one is kept', () => {
  const old = path.join(filepreview.CACHE, 'f'.repeat(32));
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, 'a'.repeat(32) + '.png'), PNG);
  filepreview.sweep({ removal: NOBODY_REMOVED });
  assert.equal(fs.existsSync(old), true, 'a young folder with no record (maybe a first render) was swept');
  filepreview.sweep({ removal: NOBODY_REMOVED, now: Date.now() + 11 * 60 * 1000 });
  assert.equal(fs.existsSync(old), false, 'an old folder with no record stayed');
});

test('#5254 review 1: a sweep DURING a first render does not take it, even when old; the page is drawn', async () => {
  fs.writeFileSync(path.join(FILES, 'racing.pdf'), Buffer.from('%PDF-1.4 racing'));
  attachments.setRenderer((file, dir) => {
    filepreview.sweep({ removal: NOBODY_REMOVED, now: Date.now() + 11 * 60 * 1000 });   // the hourly timer, mid-render
    fs.writeFileSync(path.join(dir, 'preview.png'), Buffer.concat([PNG, fs.readFileSync(file)]));
  });
  try {
    await draw('/api/agent/ava/files/preview', 'racing.pdf');
  } finally {
    attachments.setRenderer((file, dir) => {
      if (renderFails) return;
      fs.writeFileSync(path.join(dir, 'preview.png'), Buffer.concat([PNG, fs.readFileSync(file)]));
    });
  }
  assert.ok(folderFor(path.join(FILES, 'racing.pdf')), 'the page was not kept with its record');
});

test('#5254 review 1: an agent named with stray spacing matches its cleaned removed name', async () => {
  const create = require('./engine/create');
  fs.writeFileSync(path.join(FILES, 'case.pdf'), Buffer.from('%PDF-1.4 case'));
  await draw('/api/agent/ava/files/preview', 'case.pdf');
  const dir = folderFor(path.join(FILES, 'case.pdf'));
  const rec = JSON.parse(fs.readFileSync(path.join(dir, filepreview.SOURCE_FILE), 'utf8'));
  rec.owner.id = 'ava ';   // as a route could have decoded it (cleanName trims)
  fs.writeFileSync(path.join(dir, filepreview.SOURCE_FILE), JSON.stringify(rec));
  assert.equal(create.cleanName('ava '), 'ava', 'premise: the removed list stores the cleaned name');
  filepreview.sweep({ removal: { removedNames: () => ({ ok: true, names: ['ava'] }) } });
  assert.equal(fs.existsSync(dir), false, 'an owner spelled differently from its removed name kept its page');
});

test('#5254 review 2: a symlinked cache folder is never swept; CONTROL: the real one is', () => {
  const CACHE = filepreview.CACHE;
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-preview-sweep-outside-'));
  const precious = path.join(outside, 'precious');
  fs.mkdirSync(precious);
  fs.writeFileSync(path.join(precious, 'notes.txt'), 'keep me');
  const aside = CACHE + '.aside-5254';
  fs.renameSync(CACHE, aside);
  try {
    fs.symlinkSync(outside, CACHE);
    const later = Date.now() + 11 * 60 * 1000;   // old enough that a real folder with no record would go
    assert.deepEqual(filepreview.sweep({ removal: NOBODY_REMOVED, now: later }), { removed: 0 });
    assert.ok(fs.existsSync(path.join(precious, 'notes.txt')), 'a sweep through a symlinked cache folder removed a folder outside the data folder');
  } finally {
    try { fs.unlinkSync(CACHE); } catch { /* not made */ }
    fs.renameSync(aside, CACHE);
    fs.rmSync(outside, { recursive: true, force: true });
  }
  // CONTROL: the same old folder with no record, inside the real cache folder, is swept.
  const real = path.join(CACHE, 'e'.repeat(32));
  fs.mkdirSync(real, { recursive: true });
  fs.writeFileSync(path.join(real, 'notes.txt'), 'x');
  filepreview.sweep({ removal: NOBODY_REMOVED, now: Date.now() + 11 * 60 * 1000 });
  assert.equal(fs.existsSync(real), false, 'CONTROL: an old folder with no record in the real cache stayed');
});

test('#5254 review 2: a render folder left by a crash (dead or old) is removed with its PDF copy; CONTROL: a live young one protects', () => {
  const later = Date.now() + 11 * 60 * 1000;
  const dead = () => { const e = new Error('no such process'); e.code = 'ESRCH'; throw e; };
  const alive = () => true;
  // A crash mid first render: no record, a render folder holding a copy of the PDF, from a process that is gone.
  const crashed = path.join(filepreview.CACHE, 'c'.repeat(32));
  fs.mkdirSync(path.join(crashed, 'r-999999-aaaaaaaaaaaa'), { recursive: true });
  fs.writeFileSync(path.join(crashed, 'r-999999-aaaaaaaaaaaa', 'source.pdf'), '%PDF-1.4 private copy');
  filepreview.sweep({ removal: NOBODY_REMOVED, now: later, kill: dead });
  assert.equal(fs.existsSync(path.join(crashed, 'r-999999-aaaaaaaaaaaa')), false, 'a dead render folder (a copy of the PDF) stayed');
  assert.equal(fs.existsSync(crashed), false, 'its folder, with no record and old, stayed');
  // A live process but an old render folder: past any render's own timeout, so it is not a render in progress.
  const stuck = path.join(filepreview.CACHE, 'd'.repeat(32));
  fs.mkdirSync(path.join(stuck, 'r-' + process.pid + '-bbbbbbbbbbbb'), { recursive: true });
  const longAgo = new Date(Date.now() - 60 * 60 * 1000);   // its own age is read from the real clock
  fs.utimesSync(path.join(stuck, 'r-' + process.pid + '-bbbbbbbbbbbb'), longAgo, longAgo);
  filepreview.sweep({ removal: NOBODY_REMOVED, now: later, kill: alive });
  assert.equal(fs.existsSync(path.join(stuck, 'r-' + process.pid + '-bbbbbbbbbbbb')), false, 'an old render folder of a live process stayed');
  // Review 3: another process that is alive (or answers EPERM: alive, not ours to signal) and young protects too.
  const eperm = () => { const e = new Error('not permitted'); e.code = 'EPERM'; throw e; };
  for (const [tag, kill] of [['alive', alive], ['eperm', eperm]]) {
    const other = path.join(filepreview.CACHE, (tag === 'alive' ? '7' : '8').repeat(32));
    fs.mkdirSync(path.join(other, 'r-999998-dddddddddddd'), { recursive: true });
    filepreview.sweep({ removal: NOBODY_REMOVED, kill });
    assert.equal(fs.existsSync(path.join(other, 'r-999998-dddddddddddd')), true, `a young render of another live process (${tag}) was taken`);
    // A reused pid: alive but old by the real clock, so not a render in progress; removed.
    fs.utimesSync(path.join(other, 'r-999998-dddddddddddd'), longAgo, longAgo);
    filepreview.sweep({ removal: NOBODY_REMOVED, kill });
    assert.equal(fs.existsSync(path.join(other, 'r-999998-dddddddddddd')), false, `an old render of another live process (${tag}) stayed`);
    fs.rmSync(other, { recursive: true, force: true });
  }
  // CONTROL: a live and young render folder still protects its folder (the round-1 race).
  const live = path.join(filepreview.CACHE, '9'.repeat(32));
  fs.mkdirSync(path.join(live, 'r-' + process.pid + '-cccccccccccc'), { recursive: true });
  filepreview.sweep({ removal: NOBODY_REMOVED, kill: alive });
  assert.equal(fs.existsSync(path.join(live, 'r-' + process.pid + '-cccccccccccc')), true, 'CONTROL: a live young render was taken');
  fs.rmSync(live, { recursive: true, force: true });
});

test('#5254 review 2: an unreadable projects list keeps project pages; CONTROL: an empty list sweeps them', async () => {
  const p = projects.create({ name: 'Sweep Unreadable 5254', folder: fs.mkdtempSync(path.join(process.env.AGENT_WORKFORCE_PROJECTS, 'sw2-')) });
  const route = '/api/project/' + encodeURIComponent(p.id) + '/file-preview';
  fs.writeFileSync(path.join(p.folder, 'brief.pdf'), Buffer.from('%PDF-1.4 brief'));
  await draw(route, 'brief.pdf');
  const dir = folderFor(path.join(p.folder, 'brief.pdf'));
  assert.ok(dir);
  filepreview.sweep({ removal: NOBODY_REMOVED, projects: { readAll: () => { throw new Error('projects file damaged'); } } });
  assert.equal(fs.existsSync(dir), true, 'an unreadable projects list was taken as "no projects"');
  filepreview.sweep({ removal: NOBODY_REMOVED, projects: { readAll: () => [] } });
  assert.equal(fs.existsSync(dir), false, 'CONTROL: with no project listed, its page stayed');
  projects.remove(p.id);
});

test('#5254: a failed render leaves no folder behind (the record is written only beside a page)', async () => {
  fs.writeFileSync(path.join(FILES, 'fails.pdf'), Buffer.from('%PDF-1.4 fails'));
  const before = fs.readdirSync(filepreview.CACHE).length;
  renderFails = true;
  try {
    const r = await get('/api/agent/ava/files/preview', 'fails.pdf');
    assert.notEqual(r.status, 200);
    await r.text().catch(() => {});
  } finally { renderFails = false; }
  assert.equal(fs.readdirSync(filepreview.CACHE).length, before, 'a failed render left a folder counting against the limit');
});

test('#5254: the board sweeps at start and hourly, after a project is removed, and both routes name the owner', () => {
  const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.match(SRC, /function start\(port = PORT\) \{[\s\S]{0,400}filepreview\.sweep\(\);[\s\S]{0,200}setInterval\(\(\) => \{ try \{ filepreview\.sweep\(\);/);
  assert.match(SRC, /gone = projects\.remove\(id\);\n\s*try \{ filepreview\.sweep\(\); \}/);
  assert.match(SRC, /maxDepth: 0, owner: \{ kind: 'agent', id: name \}/);
  assert.match(SRC, /'this project', \{ owner: \{ kind: 'project', id \} \}/);
});
