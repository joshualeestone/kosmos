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
