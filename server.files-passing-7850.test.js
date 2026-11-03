'use strict';
/*
 * kosmos#7850: a listing refusal says whether it is PASSING. The engine's two passing reasons ("we could not read what is
 * in that folder", "that folder changed while it was being read") carry `passing: true` on every route that lists a
 * folder: an agent's flat Files list, its browse (the top, 409, and below it, 404) and a project's documents. A
 * phone keeps the list it shows through a passing refusal and lets a lasting one replace it, so each route also has a
 * lasting refusal as its control, which must NOT carry the mark.
 *
 * A passing refusal is made by failing the one directory read for the one folder under test (and, for the change arm,
 * by swapping the folder during that read), in this process, where the server runs.
 *
 *   node --test server.files-passing-7850.test.js
 */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-files-passing-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-files-passing-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-files-passing-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-files-passing-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-files-passing-launch-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
const projects = require('./engine/projects');
const dmfiles = require('./engine/dmfiles');

let FILES = null;
let PROJECT = null;
const base = () => `http://127.0.0.1:${server.address().port}`;
const getJson = async (route) => { const r = await fetch(base() + route); return { status: r.status, body: await r.json() }; };

function fill(dir) {
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  fs.writeFileSync(path.join(dir, 'sub', 'b.txt'), 'b');
}

/* Fail fs[method] for the one folder `dir` (by its real path) while `run` is awaited; reports how many reads it failed,
   so an arm whose read never reached the seam says so instead of passing on another reason. */
async function failingRead(method, dir, run, act) {
  const real = fs.realpathSync(dir);
  const was = fs[method];
  let hits = 0;
  fs[method] = function (p, ...rest) {
    if (String(p) === real) { hits += 1; return act ? act(was, p, rest) : (() => { const e = new Error('EIO: test'); e.code = 'EIO'; throw e; })(); }
    return was.call(fs, p, ...rest);
  };
  try { return { got: await run(), hits }; } finally { fs[method] = was; }
}

test.before(async () => {
  await start(0);
  FILES = dmfiles.filesDir('ava');
  assert.ok(FILES, 'no Files folder path for ava');
  fs.mkdirSync(FILES, { recursive: true });
  fill(FILES);
  const folder = fs.mkdtempSync(path.join(process.env.AGENT_WORKFORCE_PROJECTS, 'pp-'));
  fill(folder);
  PROJECT = projects.create({ name: 'Passing Room 7850', folder });
});
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

test('#7850 CONTROL: every route lists normally, with no mark, when nothing fails', async () => {
  for (const route of ['/api/agent/ava/files', '/api/agent/ava/files/browse', '/api/agent/ava/files/browse?dir=sub',
    '/api/project/' + encodeURIComponent(PROJECT.id) + '/documents']) {
    const { status, body } = await getJson(route);
    assert.equal(status, 200, route);
    assert.equal(body.ok, true, route + ': ' + JSON.stringify(body));
    assert.equal('passing' in body, false, route);
  }
});

test('#7850 agent Files list: an unreadable folder is a 200 refusal marked passing', async () => {
  const { got, hits } = await failingRead('readdirSync', FILES, () => getJson('/api/agent/ava/files'));
  assert.ok(hits > 0, 'the read never reached the seam');
  assert.equal(got.status, 200);
  assert.equal(got.body.ok, false);
  assert.equal(got.body.because, 'we could not read what is in that folder');
  assert.equal(got.body.passing, true, JSON.stringify(got.body));
});

test('#7850 agent Files list CONTROL: a lasting refusal (Files is a file) carries no mark', async () => {
  const other = dmfiles.filesDir('bea');
  fs.mkdirSync(path.dirname(other), { recursive: true });
  fs.writeFileSync(other, 'not a folder');
  const { status, body } = await getJson('/api/agent/bea/files');
  assert.equal(status, 200);
  assert.equal(body.ok, false, JSON.stringify(body));
  assert.equal('passing' in body, false, JSON.stringify(body));
});

test('#7850 agent browse, top: an unreadable folder is a 409 marked passing', async () => {
  const { got, hits } = await failingRead('opendirSync', FILES, () => getJson('/api/agent/ava/files/browse'));
  assert.ok(hits > 0, 'the read never reached the seam');
  assert.equal(got.status, 409);
  assert.equal(got.body.because, 'we could not read what is in that folder');
  assert.equal(got.body.passing, true, JSON.stringify(got.body));
});

test('#7850 agent browse, below the top: a folder that changed while it was read is a 404 marked passing', async () => {
  const sub = path.join(FILES, 'sub');
  // Swap the folder for a new one with the same name between the identity read and the listing (as an agent saving a
  // folder over itself would), then list the original handle: the before and after identities differ.
  const { got, hits } = await failingRead('opendirSync', sub, () => getJson('/api/agent/ava/files/browse?dir=sub'), (was, p, rest) => {
    const h = was.call(fs, p, ...rest);
    fs.renameSync(sub, sub + '-old');
    fs.mkdirSync(sub);
    return h;
  });
  try {
    assert.ok(hits > 0, 'the read never reached the seam');
    assert.equal(got.status, 404);
    assert.equal(got.body.because, 'that folder changed while it was being read');
    assert.equal(got.body.passing, true, JSON.stringify(got.body));
  } finally {
    fs.rmSync(sub, { recursive: true, force: true });
    fs.renameSync(sub + '-old', sub);
  }
});

test('#7850 agent browse CONTROL: a folder that is not there is a lasting 404 with no mark', async () => {
  const { status, body } = await getJson('/api/agent/ava/files/browse?dir=gone');
  assert.equal(status, 404);
  assert.equal(body.ok, false);
  assert.equal('passing' in body, false, JSON.stringify(body));
});

test('#7850 project documents: an unreadable folder is a 200 refusal marked passing', async () => {
  const { got, hits } = await failingRead('readdirSync', PROJECT.folder, () => getJson('/api/project/' + encodeURIComponent(PROJECT.id) + '/documents'));
  assert.ok(hits > 0, 'the read never reached the seam');
  assert.equal(got.status, 200);
  assert.equal(got.body.ok, false);
  assert.equal(got.body.because, 'we could not read what is in that folder');
  assert.equal(got.body.passing, true, JSON.stringify(got.body));
});

test('#7850 project documents CONTROL: a folder that is gone is a lasting refusal with no mark', async () => {
  const folder = fs.mkdtempSync(path.join(process.env.AGENT_WORKFORCE_PROJECTS, 'pg-'));
  const gone = projects.create({ name: 'Gone Room 7850', folder });
  fs.rmSync(folder, { recursive: true, force: true });
  const { status, body } = await getJson('/api/project/' + encodeURIComponent(gone.id) + '/documents');
  assert.equal(status, 200);
  assert.equal(body.ok, false, JSON.stringify(body));
  assert.equal('passing' in body, false, JSON.stringify(body));
});
