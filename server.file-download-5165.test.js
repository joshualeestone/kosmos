'use strict';
/* #5165: over Kosmos+ a file click downloads to the device the person is on. These are the two download routes
 * the page uses there, against a real sandboxed board:
 *   GET /api/project/:id/file-download?name=   and   GET /api/agent/:name/files/download?name=
 * They pass the SAME gates as open (projects.fileInFolder), stream the bytes as an attachment, and never ask the
 * board's computer to open anything (the reveal runner is injected and must stay uncalled).
 *
 *   node --test server.file-download-5165.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-filedl-'));
process.env.HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
for (const d of ['data', 'projects', 'workers', 'launch']) fs.mkdirSync(path.join(SANDBOX, d), { recursive: true });

const { start, server } = require('./server');
const projects = require('./engine/projects');

let base;
const calls = [];
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  projects.setRevealRunner((file, args) => { calls.push([file, args]); return { ok: true }; });
  projects.setRevealPlatform('darwin');
});
test.after(() => {
  projects.setRevealPlatform(null);
  projects.setRevealRunner(null);
  try { server.close(); } catch { /* closed */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const PPTX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x10, 0x80, 0x0a]);   // binary, not utf-8 clean

test('a project file downloads: its exact bytes, as an attachment named for the file, and nothing opens here', async () => {
  const folder = fs.mkdtempSync(path.join(SANDBOX, 'projects', 'deck-'));
  fs.mkdirSync(path.join(folder, 'out'));
  fs.writeFileSync(path.join(folder, 'out', 'Q3 deck.pptx'), PPTX);
  const p = projects.create({ name: 'Deck Room 5165', folder, agents: [], roster: [] });
  const before = calls.length;
  const r = await fetch(base + '/api/project/' + encodeURIComponent(p.id) + '/file-download?name=' + encodeURIComponent('out/Q3 deck.pptx'));
  assert.equal(r.status, 200);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), PPTX, 'the bytes changed on the way');
  assert.equal(r.headers.get('content-disposition'), "attachment; filename*=UTF-8''Q3%20deck.pptx");
  assert.equal(r.headers.get('content-type'), 'application/octet-stream');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('content-length'), String(PPTX.length));
  assert.equal(calls.length, before, 'a download asked the board’s computer to open something');

  const head = await fetch(base + '/api/project/' + encodeURIComponent(p.id) + '/file-download?name=' + encodeURIComponent('out/Q3 deck.pptx'), { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(PPTX.length));
});

test('a project download passes the open gates: escapes, links out, folders and missing names are refused', async () => {
  const outside = fs.mkdtempSync(path.join(SANDBOX, 'outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'not yours');
  const folder = fs.mkdtempSync(path.join(SANDBOX, 'projects', 'gate-'));
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(folder, 'link.txt'));
  fs.mkdirSync(path.join(folder, 'sub'));
  const p = projects.create({ name: 'Gate Room 5165', folder, agents: [], roster: [] });
  const dl = (name) => fetch(base + '/api/project/' + encodeURIComponent(p.id) + '/file-download' + (name === null ? '' : '?name=' + encodeURIComponent(name)));
  for (const [name, said] of [
    ['../outside/secret.txt', /not a file in this project/],
    ['link.txt', /lives outside this project/],
    [path.join(outside, 'secret.txt'), /not a file in this project/],
    ['sub', /not a file we can open/],
    ['gone.pptx', /not there any more/],
    [null, /no file was named/],
  ]) {
    const r = await dl(name);
    const body = await r.text();
    assert.equal(r.status, 404, name + ': ' + body);
    assert.match(JSON.parse(body).because, said, name);
    assert.doesNotMatch(body, /not yours/, name + ' leaked the file');
  }
  assert.equal((await fetch(base + '/api/project/nope/file-download?name=a.txt')).status, 404);
});

test('an agent’s Files file downloads the same way; a name outside Files is refused; POST is not the verb', async () => {
  const files = path.join(SANDBOX, 'workers', 'dex', 'Files');
  fs.mkdirSync(files, { recursive: true });
  fs.writeFileSync(path.join(files, 'report.pptx'), PPTX);
  fs.writeFileSync(path.join(SANDBOX, 'workers', 'dex', 'CLAUDE.md'), 'instructions, not a file to hand out');
  const before = calls.length;
  const r = await fetch(base + '/api/agent/dex/files/download?name=report.pptx');
  assert.equal(r.status, 200);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), PPTX);
  assert.equal(r.headers.get('content-disposition'), "attachment; filename*=UTF-8''report.pptx");
  assert.equal(calls.length, before, 'a download asked the board’s computer to open something');

  const out = await fetch(base + '/api/agent/dex/files/download?name=' + encodeURIComponent('../CLAUDE.md'));
  const said = await out.text();
  assert.equal(out.status, 404);
  assert.match(JSON.parse(said).because, /Files folder/);
  assert.doesNotMatch(said, /instructions, not a file/);

  assert.equal((await fetch(base + '/api/agent/dex/files/download?name=report.pptx', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/api/agent/nobody/files/download?name=report.pptx')).status, 404);
});

test('open is unchanged at the computer: the same file still opens through the reveal runner', async () => {
  const files = path.join(SANDBOX, 'workers', 'eve', 'Files');
  fs.mkdirSync(files, { recursive: true });
  fs.writeFileSync(path.join(files, 'deck.pptx'), PPTX);
  const before = calls.length;
  const r = await fetch(base + '/api/agent/eve/files/open', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'deck.pptx' }),
  });
  assert.equal(r.status, 200);
  assert.equal(calls.length, before + 1);
  assert.equal(calls[calls.length - 1][0], '/usr/bin/open');
  assert.equal(fs.realpathSync(calls[calls.length - 1][1][0]), fs.realpathSync(path.join(files, 'deck.pptx')));
});

test('HEAD answers like GET with no body, on both routes; a refused HEAD is a 404 the page can see', async () => {
  const files = path.join(SANDBOX, 'workers', 'hed', 'Files');
  fs.mkdirSync(files, { recursive: true });
  fs.writeFileSync(path.join(files, 'deck.pptx'), PPTX);
  const ok = await fetch(base + '/api/agent/hed/files/download?name=deck.pptx', { method: 'HEAD' });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-length'), String(PPTX.length));
  assert.equal((await ok.arrayBuffer()).byteLength, 0);
  const gone = await fetch(base + '/api/agent/hed/files/download?name=gone.pptx', { method: 'HEAD' });
  assert.equal(gone.status, 404);
});

test('an agent\u2019s Files that is a link to somewhere else is not downloaded from', async () => {
  const elsewhere = fs.mkdtempSync(path.join(SANDBOX, 'elsewhere-'));
  fs.writeFileSync(path.join(elsewhere, 'theirs.pptx'), 'not this agent\u2019s');
  fs.mkdirSync(path.join(SANDBOX, 'workers', 'lnk'), { recursive: true });
  fs.symlinkSync(elsewhere, path.join(SANDBOX, 'workers', 'lnk', 'Files'));
  const r = await fetch(base + '/api/agent/lnk/files/download?name=theirs.pptx');
  const said = await r.text();
  assert.equal(r.status, 409, said);
  assert.doesNotMatch(said, /not this agent/);
});

test('a file the gates pass but that cannot be opened is refused as unreadable (it is still there), never a 200 that stops short', {
  skip: (typeof process.getuid !== 'function' || process.getuid() === 0) && 'needs POSIX permissions and a non-root user',
}, async () => {
  const folder = fs.mkdtempSync(path.join(SANDBOX, 'projects', 'locked-'));
  const locked = path.join(folder, 'locked.pptx');
  fs.writeFileSync(locked, PPTX);
  fs.chmodSync(locked, 0o000);
  try {
    const p = projects.create({ name: 'Locked Room 5165', folder, agents: [], roster: [] });
    assert.equal(projects.fileInFolder(folder, 'locked.pptx').ok, true, 'fixture: the gates must PASS this file, or this tests the gates instead');
    const r = await fetch(base + '/api/project/' + encodeURIComponent(p.id) + '/file-download?name=locked.pptx');
    const body = await r.text();
    assert.equal(r.status, 404, body);
    assert.equal(JSON.parse(body).because, 'that file could not be read on the computer Kosmos runs on');
  } finally {
    fs.chmodSync(locked, 0o600);
  }
});

test('a name with characters RFC 5987 does not allow is percent-encoded in the download\u2019s name', async () => {
  const files = path.join(SANDBOX, 'workers', 'rfc', 'Files');
  fs.mkdirSync(files, { recursive: true });
  fs.writeFileSync(path.join(files, "Q3 (final)'s*!.pptx"), PPTX);
  const r = await fetch(base + '/api/agent/rfc/files/download?name=' + encodeURIComponent("Q3 (final)'s*!.pptx"));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-disposition'), "attachment; filename*=UTF-8''Q3%20%28final%29%27s%2A%21.pptx");
});

test('?check=1 passes the same gates and answers 204 with no body; a refused check is the refusal', async () => {
  const files = path.join(SANDBOX, 'workers', 'chk', 'Files');
  fs.mkdirSync(files, { recursive: true });
  fs.writeFileSync(path.join(files, 'deck.pptx'), PPTX);
  const before = calls.length;
  const ok = await fetch(base + '/api/agent/chk/files/download?check=1&name=deck.pptx');
  assert.equal(ok.status, 204);
  assert.equal((await ok.arrayBuffer()).byteLength, 0, 'the look moved the file');
  assert.equal(ok.headers.get('content-disposition'), null, 'a look is not a download');
  const gone = await fetch(base + '/api/agent/chk/files/download?check=1&name=gone.pptx');
  assert.equal(gone.status, 404);
  assert.match((await gone.json()).because, /not there any more|not a file/);
  const out = await fetch(base + '/api/agent/chk/files/download?check=1&name=' + encodeURIComponent('../CLAUDE.md'));
  assert.equal(out.status, 404);
  assert.equal(calls.length, before, 'a look asked the board\u2019s computer to open something');
});

test('a zero-byte file and a file of many stream chunks both arrive whole', async () => {
  const files = path.join(SANDBOX, 'workers', 'siz', 'Files');
  fs.mkdirSync(files, { recursive: true });
  fs.writeFileSync(path.join(files, 'empty.txt'), '');
  const big = Buffer.alloc(3 * 1024 * 1024 + 17);
  for (let i = 0; i < big.length; i += 1) big[i] = (i * 31 + 7) & 0xff;
  fs.writeFileSync(path.join(files, 'big.bin'), big);
  const e = await fetch(base + '/api/agent/siz/files/download?name=empty.txt');
  assert.equal(e.status, 200);
  assert.equal(e.headers.get('content-length'), '0');
  assert.equal((await e.arrayBuffer()).byteLength, 0);
  const b = await fetch(base + '/api/agent/siz/files/download?name=big.bin');
  assert.equal(b.status, 200);
  assert.deepEqual(Buffer.from(await b.arrayBuffer()), big, 'a multi-chunk file arrived changed or short');
});
