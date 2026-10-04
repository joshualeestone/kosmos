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
  filepreview.sweep({ removal: { removedNames: () => ({ ok: false, names: [] }) } });
  assert.equal(fs.existsSync(dir), true, 'an unreadable list was taken as a removal');
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
