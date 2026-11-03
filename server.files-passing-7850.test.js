'use strict';
/*
 * kosmos#7850: a listing refusal says whether it is PASSING. "we could not read what is in that folder" when the read
 * failed with a passing code, and "that folder changed while it was being read", carry `passing: true` on every route
 * that lists a folder: an agent's flat Files list, its browse (the top, 409, and below it, 404) and a project's documents. A
 * phone keeps the list it shows through a passing refusal and lets a lasting one replace it, so each route also has a
 * lasting refusal as its control, which the route marks `passing: false` (the phone half of #7850; an older board said
 * neither, and the phone keeps its list for that).
 *
 * A refusal is made by failing the one directory read for the one folder under test with a chosen error code (and, for
 * the change arm, by swapping the folder during that read), in this process, where the server runs.
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

const fsError = (code) => { const e = new Error(code + ': test'); e.code = code; return e; };
/* Fail fs[method] for the one folder `dir` (by its real path) while `run` is awaited, by throwing `act` when it is an
   error code and by calling it otherwise; reports how many reads it reached, so an arm whose read never reached the
   seam says so instead of passing on another reason. */
async function failingRead(method, dir, run, act) {
  const real = fs.realpathSync(dir);
  const was = fs[method];
  let hits = 0;
  fs[method] = function (p, ...rest) {
    if (String(p) === real) {
      hits += 1;
      if (typeof act === 'string') throw fsError(act);
      return act(was, p, rest);
    }
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

test('#7850 agent Files list: a read that fails with too many open files is a 200 refusal marked passing', async () => {
  const { got, hits } = await failingRead('readdirSync', FILES, () => getJson('/api/agent/ava/files'), 'EMFILE');
  assert.ok(hits > 0, 'the read never reached the seam');
  assert.equal(got.status, 200);
  assert.equal(got.body.ok, false);
  assert.equal(got.body.because, 'we could not read what is in that folder');
  assert.equal(got.body.passing, true, JSON.stringify(got.body));
});

test('#7850 agent Files list CONTROL: a read that fails with EIO (a dead mount) is the same refusal, marked lasting (passing: false)', async () => {
  const { got, hits } = await failingRead('readdirSync', FILES, () => getJson('/api/agent/ava/files'), 'EIO');
  assert.ok(hits > 0, 'the read never reached the seam');
  assert.equal(got.status, 200);
  assert.equal(got.body.because, 'we could not read what is in that folder');
  assert.strictEqual(got.body.passing, false, JSON.stringify(got.body));
});

test('#7850 agent Files list CONTROL: a lasting refusal (Files is a file) is marked lasting (passing: false)', async () => {
  const other = dmfiles.filesDir('bea');
  fs.mkdirSync(path.dirname(other), { recursive: true });
  fs.writeFileSync(other, 'not a folder');
  const { status, body } = await getJson('/api/agent/bea/files');
  assert.equal(status, 200);
  assert.equal(body.ok, false, JSON.stringify(body));
  assert.equal(body.because, 'this is a file, not a folder');
  assert.strictEqual(body.passing, false, JSON.stringify(body));
});

test('#7850 agent browse, top: an open that fails with EAGAIN is a 409 marked passing', async () => {
  const { got, hits } = await failingRead('opendirSync', FILES, () => getJson('/api/agent/ava/files/browse'), 'EAGAIN');
  assert.ok(hits > 0, 'the read never reached the seam');
  assert.equal(got.status, 409);
  assert.equal(got.body.because, 'we could not read what is in that folder');
  assert.equal(got.body.passing, true, JSON.stringify(got.body));
});

test('#7850 agent browse, below the top: a folder that changed while it was read is a 404 marked passing', async () => {
  const sub = path.join(FILES, 'sub');
  // Swap the folder for a new one with the same name between the identity read and the listing (as an agent saving a
  // folder over itself would), then list the original handle: the before and after identities differ.
  try {
    const { got, hits } = await failingRead('opendirSync', sub, () => getJson('/api/agent/ava/files/browse?dir=sub'), (was, p, rest) => {
      const h = was.call(fs, p, ...rest);
      fs.renameSync(sub, sub + '-old');
      fs.mkdirSync(sub);
      return h;
    });
    assert.ok(hits > 0, 'the read never reached the seam');
    assert.equal(got.status, 404);
    assert.equal(got.body.because, 'that folder changed while it was being read');
    assert.equal(got.body.passing, true, JSON.stringify(got.body));
  } finally {
    if (fs.existsSync(sub + '-old')) { fs.rmSync(sub, { recursive: true, force: true }); fs.renameSync(sub + '-old', sub); }
  }
});

test('#7850 agent browse CONTROL: a folder removed while it was read is a 404 marked lasting (passing: false)', async () => {
  const sub = path.join(FILES, 'sub');
  try {
    const { got, hits } = await failingRead('opendirSync', sub, () => getJson('/api/agent/ava/files/browse?dir=sub'), (was, p, rest) => {
      const h = was.call(fs, p, ...rest);
      fs.renameSync(sub, sub + '-old');
      return h;
    });
    assert.ok(hits > 0, 'the read never reached the seam');
    assert.equal(got.status, 404);
    assert.equal(got.body.because, 'that folder is not there any more, or it was moved');
    assert.strictEqual(got.body.passing, false, JSON.stringify(got.body));
  } finally {
    if (fs.existsSync(sub + '-old')) { fs.rmSync(sub, { recursive: true, force: true }); fs.renameSync(sub + '-old', sub); }
  }
});

test('#7850 agent browse CONTROL: a folder swapped for a file while it was read is a 404 marked lasting (passing: false)', async () => {
  const sub = path.join(FILES, 'sub');
  try {
    const { got, hits } = await failingRead('opendirSync', sub, () => getJson('/api/agent/ava/files/browse?dir=sub'), (was, p, rest) => {
      const h = was.call(fs, p, ...rest);
      fs.renameSync(sub, sub + '-old');
      fs.writeFileSync(sub, 'now a file');
      return h;
    });
    assert.ok(hits > 0, 'the read never reached the seam');
    assert.equal(got.status, 404);
    assert.equal(got.body.because, 'that is not a folder in this agent\u2019s Files folder');
    assert.strictEqual(got.body.passing, false, JSON.stringify(got.body));
  } finally {
    if (fs.existsSync(sub + '-old')) { fs.rmSync(sub, { recursive: true, force: true }); fs.renameSync(sub + '-old', sub); }
  }
});

test('#7850 agent browse, below the top: an entry read that fails with EINTR is a 404 marked passing', async () => {
  const sub = path.join(FILES, 'sub');
  const { got, hits } = await failingRead('opendirSync', sub, () => getJson('/api/agent/ava/files/browse?dir=sub'), (was, p, rest) => {
    const h = was.call(fs, p, ...rest);
    h.readSync = () => { throw fsError('EINTR'); };
    return h;
  });
  assert.ok(hits > 0, 'the read never reached the seam');
  assert.equal(got.status, 404);
  assert.equal(got.body.because, 'we could not read what is in that folder');
  assert.equal(got.body.passing, true, JSON.stringify(got.body));
});

test('#7850 agent browse, below the top: the identity read after the listing failing with EMFILE is a 404 marked passing', async () => {
  const sub = path.join(FILES, 'sub');
  // Fail the first lstat of the folder made AFTER the listing opened it, whatever other reads came before.
  const real = fs.realpathSync(sub);
  const wasOpen = fs.opendirSync;
  let opened = false;
  let failedAfter = false;
  fs.opendirSync = function (p, ...rest) { if (String(p) === real) opened = true; return wasOpen.call(fs, p, ...rest); };
  let res;
  try {
    res = await failingRead('lstatSync', sub, () => getJson('/api/agent/ava/files/browse?dir=sub'), (was, p, rest) => {
      if (opened && !failedAfter) { failedAfter = true; throw fsError('EMFILE'); }
      return was.call(fs, p, ...rest);
    });
  } finally { fs.opendirSync = wasOpen; }
  const { got, hits } = res;
  assert.ok(hits > 0 && failedAfter, 'the read after the listing never reached the seam');
  assert.equal(got.status, 404);
  assert.equal(got.body.because, 'we could not read what is in that folder');
  assert.equal(got.body.passing, true, JSON.stringify(got.body));
});

test('#7850 agent Files list CONTROL: a read that finds the folder gone (ENOENT) says it is not there, marked lasting (passing: false)', async () => {
  const { got, hits } = await failingRead('readdirSync', FILES, () => getJson('/api/agent/ava/files'), 'ENOENT');
  assert.ok(hits > 0, 'the read never reached the seam');
  assert.equal(got.status, 200);
  assert.equal(got.body.because, 'that folder is not there any more, or it was moved');
  assert.strictEqual(got.body.passing, false, JSON.stringify(got.body));
});

test('#7850 agent browse CONTROL: a folder that is not there is a 404 marked lasting (passing: false)', async () => {
  const { status, body } = await getJson('/api/agent/ava/files/browse?dir=gone');
  assert.equal(status, 404);
  assert.equal(body.ok, false);
  assert.equal(body.because, 'that folder is not there any more, or it was moved');
  assert.strictEqual(body.passing, false, JSON.stringify(body));
});

test('#7850 project documents: a read that fails with EBUSY is a 200 refusal marked passing', async () => {
  const { got, hits } = await failingRead('readdirSync', PROJECT.folder, () => getJson('/api/project/' + encodeURIComponent(PROJECT.id) + '/documents'), 'EBUSY');
  assert.ok(hits > 0, 'the read never reached the seam');
  assert.equal(got.status, 200);
  assert.equal(got.body.ok, false);
  assert.equal(got.body.because, 'we could not read what is in that folder');
  assert.equal(got.body.passing, true, JSON.stringify(got.body));
});

test('#7850 project documents CONTROL: a folder that is gone is a refusal marked lasting (passing: false)', async () => {
  const folder = fs.mkdtempSync(path.join(process.env.AGENT_WORKFORCE_PROJECTS, 'pg-'));
  const gone = projects.create({ name: 'Gone Room 7850', folder });
  fs.rmSync(folder, { recursive: true, force: true });
  const { status, body } = await getJson('/api/project/' + encodeURIComponent(gone.id) + '/documents');
  assert.equal(status, 200);
  assert.equal(body.ok, false, JSON.stringify(body));
  assert.equal(body.because, 'this folder is not there any more, or it was moved');
  assert.strictEqual(body.passing, false, JSON.stringify(body));
});

test('#7850 phone half: Files being a link is a lasting refusal, said so on the list and on browse', async (t) => {
  const other = dmfiles.filesDir('cyd');
  fs.mkdirSync(path.dirname(other), { recursive: true });
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-files-passing-linked-'));
  fs.symlinkSync(target, other);
  t.after(() => { try { fs.rmSync(other, { force: true }); fs.rmSync(target, { recursive: true, force: true }); } catch { /* best effort */ } });
  const list = await getJson('/api/agent/cyd/files');
  assert.equal(list.status, 200);
  assert.equal(list.body.ok, false, JSON.stringify(list.body));
  assert.strictEqual(list.body.passing, false, JSON.stringify(list.body));
  assert.match(list.body.because, /is a link to somewhere else/, 'CONTROL: the list refused as a link, not for another reason');
  const top = await getJson('/api/agent/cyd/files/browse');
  assert.equal(top.status, 409);
  assert.strictEqual(top.body.passing, false, JSON.stringify(top.body));
  assert.match(top.body.because, /is a link to somewhere else/, 'CONTROL: refused as a link, not for another reason');
});

/* Fail fs.realpathSync.native (how folderState resolves a folder) for `dir`, given or real path, while `run` is awaited. */
async function failingRealpath(dir, code, run) {
  const real = fs.realpathSync(dir);
  const was = fs.realpathSync.native;
  let hits = 0;
  fs.realpathSync.native = function (p, ...rest) {
    if (String(p) === dir || String(p) === real) { hits += 1; const e = new Error(code + ': test'); e.code = code; throw e; }
    return was.call(fs, p, ...rest);
  };
  try { return { got: await run(), hits }; } finally { fs.realpathSync.native = was; }
}

test('#7850 phone half: a folder whose own read (folderState) fails with EBUSY is a refusal marked passing, on the list and the documents', async () => {
  const a = await failingRealpath(FILES, 'EBUSY', () => getJson('/api/agent/ava/files'));
  assert.ok(a.hits > 0, 'the read never reached the seam');
  assert.equal(a.got.body.ok, false, JSON.stringify(a.got.body));
  assert.strictEqual(a.got.body.passing, true, JSON.stringify(a.got.body));
  const d = await failingRealpath(PROJECT.folder, 'EBUSY', () => getJson('/api/project/' + encodeURIComponent(PROJECT.id) + '/documents'));
  assert.ok(d.hits > 0, 'the documents read never reached the seam');
  assert.strictEqual(d.got.body.passing, true, JSON.stringify(d.got.body));
});

test('#7850 phone half CONTROL: the same read failing with EACCES is marked lasting', async () => {
  const a = await failingRealpath(FILES, 'EACCES', () => getJson('/api/agent/ava/files'));
  assert.ok(a.hits > 0, 'the read never reached the seam');
  assert.equal(a.got.body.because, 'we cannot read this folder');
  assert.strictEqual(a.got.body.passing, false, JSON.stringify(a.got.body));
});

test('#7850 phone half: a subfolder whose lstat (resolveListedDir) fails with EAGAIN is a 404 marked passing; ENOENT stays lasting', async () => {
  const sub = path.join(FILES, 'sub');
  const real = fs.realpathSync(sub);
  const was = fs.lstatSync;
  let hits = 0;
  let code = 'EAGAIN';
  fs.lstatSync = function (p, ...rest) {
    if ((String(p) === sub || String(p) === real) && !(rest[0] && rest[0].bigint)) { hits += 1; const e = new Error(code + ': test'); e.code = code; throw e; }
    return was.call(fs, p, ...rest);
  };
  try {
    const g = await getJson('/api/agent/ava/files/browse?dir=sub');
    assert.ok(hits > 0, 'the walk never reached the seam');
    assert.equal(g.status, 404);
    assert.strictEqual(g.body.passing, true, JSON.stringify(g.body));
    code = 'ENOENT';
    const h = await getJson('/api/agent/ava/files/browse?dir=sub');
    assert.equal(h.body.because, 'that folder is not there any more, or it was moved');
    assert.strictEqual(h.body.passing, false, JSON.stringify(h.body));
  } finally { fs.lstatSync = was; }
});

test('#7850 phone half: a Files folder removed between the route\'s check and its read is the empty state, not a refusal', async () => {
  const gone = dmfiles.filesDir('dee');
  fs.mkdirSync(gone, { recursive: true });
  const real = fs.realpathSync(gone);
  const was = fs.readdirSync;
  let hits = 0;
  // The route's own check finds the folder; then it goes, just as listFiles reads it.
  fs.readdirSync = function (p, ...rest) {
    if (String(p) === real) { hits += 1; fs.rmSync(gone, { recursive: true, force: true }); const e = new Error('ENOENT: test'); e.code = 'ENOENT'; throw e; }
    return was.call(fs, p, ...rest);
  };
  let got;
  try { got = await getJson('/api/agent/dee/files'); } finally { fs.readdirSync = was; }
  assert.ok(hits > 0, 'the read never reached the seam');
  assert.equal(got.status, 200);
  assert.deepEqual({ ok: got.body.ok, missing: got.body.missing, files: got.body.files }, { ok: true, missing: true, files: [] }, JSON.stringify(got.body));
});

test('#7850 phone half: Files removed between the browse route\'s check and its read is the empty state at the top, not a refusal', async () => {
  const gone = dmfiles.filesDir('eve');
  fs.mkdirSync(gone, { recursive: true });
  const real = fs.realpathSync(gone);
  const was = fs.realpathSync.native;
  let calls = 0;
  // The route's own check resolves the folder; on the next resolve (the listing's) it is gone.
  fs.realpathSync.native = function (p, ...rest) {
    if (String(p) === gone || String(p) === real) {
      calls += 1;
      if (calls === 2) { fs.rmSync(gone, { recursive: true, force: true }); const e = new Error('ENOENT: test'); e.code = 'ENOENT'; throw e; }
    }
    return was.call(fs, p, ...rest);
  };
  let got;
  try { got = await getJson('/api/agent/eve/files/browse'); } finally { fs.realpathSync.native = was; }
  assert.ok(calls >= 2, 'the listing never reached the seam (' + calls + ' resolves)');
  assert.equal(got.status, 200, JSON.stringify(got.body));
  assert.deepEqual({ ok: got.body.ok, missing: got.body.missing, dir: got.body.dir }, { ok: true, missing: true, dir: '' }, JSON.stringify(got.body));
});
