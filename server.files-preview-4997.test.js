'use strict';
/*
 * kosmos#4997: the full-page preview for a file in a Files list. GET .../preview and .../download serve ONE listed
 * file by its listed name, and POST .../reveal-file selects it in Finder, for an agent's Files folder and for a
 * project's folder. Everything outside the folder is refused with no bytes: a `..` name, an absolute path, a
 * backslash, a hidden name, a link planted inside the folder that points outside it, a folder, a missing file, and a
 * read from another website. Each refusal arm has a control that the same request shape serves a real listed file.
 *
 *   node --test server.files-preview-4997.test.js
 */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-files-preview-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-files-preview-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-files-preview-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-files-preview-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-files-preview-launch-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
const projects = require('./engine/projects');
const dmfiles = require('./engine/dmfiles');
const attachments = require('./engine/attachments');
const filepreview = require('./engine/filepreview');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7]);
const SECRET = Buffer.from('outside the folder: never served');
const OUTSIDE = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-files-preview-outside-'));
fs.writeFileSync(path.join(OUTSIDE, 'secret.png'), SECRET);
fs.writeFileSync(path.join(OUTSIDE, 'secret.pdf'), SECRET);

let FILES = null;
let PROJECT = null;
const calls = [];
const base = () => `http://127.0.0.1:${server.address().port}`;

function fillFolder(dir) {
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'shot.png'), PNG);
  fs.writeFileSync(path.join(dir, 'sub', 'deep.png'), PNG);
  fs.writeFileSync(path.join(dir, 'doc.pdf'), Buffer.from('%PDF-1.4 fake'));
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello');
  fs.writeFileSync(path.join(dir, '.hidden.png'), PNG);
  fs.symlinkSync(path.join(OUTSIDE, 'secret.png'), path.join(dir, 'link.png'));
  fs.symlinkSync(path.join(OUTSIDE, 'secret.pdf'), path.join(dir, 'link.pdf'));  // Review 1 (a blocker, measured): files INSIDE the folder that the list never shows.
  fs.mkdirSync(path.join(dir, '.secretdir'));
  fs.writeFileSync(path.join(dir, '.secretdir', 'key.png'), SECRET);
  fs.symlinkSync(path.join(dir, '.secretdir', 'key.png'), path.join(dir, 'innocent.png'));
  fs.symlinkSync(path.join(dir, '.secretdir'), path.join(dir, 'dirlink'));
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'x.png'), SECRET);
  fs.mkdirSync(path.join(dir, 'dist'));
  fs.writeFileSync(path.join(dir, 'dist', 'z.png'), SECRET);
  fs.mkdirSync(path.join(dir, 'a', 'b', 'c', 'd'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a', 'b', 'c', 'd', 'deep.png'), SECRET);   // four folders down: past the list's depth
}

test.before(async () => {
  await start(0);
  projects.setRevealPlatform('darwin');
  projects.setRevealRunner((bin, args) => { calls.push([bin, args]); return { ok: true }; });
  attachments.setRenderer((file, dir) => { fs.writeFileSync(path.join(dir, 'preview.png'), Buffer.concat([PNG, fs.readFileSync(file)])); });
  FILES = dmfiles.filesDir('ava');
  assert.ok(FILES, 'no Files folder path for ava');
  fs.mkdirSync(FILES, { recursive: true });
  fillFolder(FILES);
  const folder = fs.mkdtempSync(path.join(process.env.AGENT_WORKFORCE_PROJECTS, 'pv-'));
  fillFolder(folder);
  PROJECT = projects.create({ name: 'Preview Room 4997', folder });
});
test.after(() => {
  projects.setRevealPlatform(null);
  projects.setRevealRunner(null);
  attachments.setRenderer(null);
  try { server.closeAllConnections(); server.close(); } catch { /* best effort */ }
});

const SURFACES = [
  ['agent Files', () => ({ preview: '/api/agent/ava/files/preview', download: '/api/agent/ava/files/download', reveal: '/api/agent/ava/files/reveal-file' })],
  ['project', () => ({ preview: '/api/project/' + encodeURIComponent(PROJECT.id) + '/file-preview', download: '/api/project/' + encodeURIComponent(PROJECT.id) + '/file-download', reveal: '/api/project/' + encodeURIComponent(PROJECT.id) + '/reveal-file' })],
];
const get = (route, name, headers) => fetch(base() + route + '?name=' + encodeURIComponent(name), { headers: headers || {} });

test('#4997 sandbox: the PDF preview cache is under this test\'s data root', () => {
  assert.ok(filepreview.CACHE.startsWith(SANDBOX + path.sep), filepreview.CACHE);
});

test('#4997 review 13: the cache follows the data root when it changes after load (never frozen, as store.js #1443 requires)', () => {
  const was = process.env.AGENT_WORKFORCE_DATA;
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-files-preview-root2-'));
  try {
    process.env.AGENT_WORKFORCE_DATA = other;
    assert.ok(filepreview.CACHE.startsWith(other + path.sep), filepreview.CACHE);
  } finally { process.env.AGENT_WORKFORCE_DATA = was; }
  assert.ok(filepreview.CACHE.startsWith(SANDBOX + path.sep), 'CONTROL: back to this test\'s root');
});

for (const [label, routes] of SURFACES) {
  test(`#4997 ${label}: a listed image is served as itself, typed by its extension, nosniff and sandboxed`, async () => {
    const r = await get(routes().preview, 'shot.png');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/png');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(String(r.headers.get('content-security-policy')), /sandbox/);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), PNG);
  });
  test(`#4997 ${label}: a listed PDF's preview is its first page as a PNG, drawn outside the person's folder`, async () => {
    const r = await get(routes().preview, 'doc.pdf');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/png');
    const body = Buffer.from(await r.arrayBuffer());
    assert.ok(body.subarray(0, PNG.length).equals(PNG) && body.toString().endsWith('%PDF-1.4 fake'), 'not the rendered page of THIS file');
    const folder = label === 'project' ? PROJECT.folder : FILES;
    assert.ok(!fs.readdirSync(folder).some((n) => /preview/.test(n)), 'a preview was written into the person\'s folder');
  });
  if (label === 'project') {
    test(`#4997 ${label}: a file in a subfolder is served by its listed relative name (the project list walks subfolders; CONTROL for the shape refusals)`, async () => {
      const r = await get(routes().preview, 'sub/deep.png');
      assert.equal(r.status, 200);
      assert.deepEqual(Buffer.from(await r.arrayBuffer()), PNG);
    });
  } else {
    test(`#4997 ${label} REFUSED: a file below the top level (the agent's Files list is flat), with no bytes`, async () => {
      const r = await get(routes().preview, 'sub/deep.png');
      assert.equal(r.status, 404);
      assert.equal((await r.json()).ok, false);
    });
  }
  test(`#4997 + #5165 ${label}: the download is any listed file's bytes as an attachment (one route, #5165's sender)`, async () => {
    const r = await get(routes().download, 'shot.png');
    assert.equal(r.status, 200);
    assert.match(String(r.headers.get('content-disposition')), /^attachment; filename="shot\.png"; filename\*=UTF-8''shot\.png$/);
    assert.equal(r.headers.get('content-type'), 'application/octet-stream');
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), PNG);
    const pdf = await get(routes().download, 'doc.pdf');
    assert.equal(pdf.status, 200, 'CONTROL: a PDF downloads');
    const txt = await get(routes().download, 'notes.txt');
    assert.equal(txt.status, 200, '#5165: over Kosmos+ any listed file reaches the device you are on');
    assert.ok((await txt.text()).includes('hello'), 'the text file\'s bytes were not sent');
  });
  for (const [why, name] of [
    ['a .. segment', '../../../../../../' + path.join(OUTSIDE, 'secret.png').replace(/^\//, '')],
    ['a .. into a sibling', 'sub/../../' + path.basename(OUTSIDE) + '/secret.png'],
    ['an absolute path', path.join(OUTSIDE, 'secret.png')],
    ['a backslash', 'sub\\deep.png'],
    ['a hidden name', '.hidden.png'],
    ['a link inside the folder that points outside it', 'link.png'],
    ['a link to an outside PDF', 'link.pdf'],
    ['a folder', 'sub'],
    ['a link inside the folder to a hidden file in it (review 1)', 'innocent.png'],
    ['a link to a hidden folder, then a file in it (review 1)', 'dirlink/key.png'],
    ['a file under a skipped folder (review 1)', 'node_modules/x.png'],
    ['a skipped folder in another case (review 2: the disk may ignore case)', 'NODE_MODULES/x.png'],
    ['another skipped folder (review 5)', 'dist/z.png'],
    ['a file four folders down, past the list\'s depth (review 5)', 'a/b/c/d/deep.png'],
    ['a listed file in another case', 'SHOT.PNG'],
    ['a missing file', 'nope.png'],
    ['no name', ''],
  ]) {
    for (const verb of ['preview', 'download']) {
      test(`#4997 ${label} REFUSED (${verb}): ${why}, with no bytes`, async () => {
        const r = await get(routes()[verb], name);
        assert.equal(r.status, 404, why + ' was served');
        const text = await r.text();
        assert.ok(!text.includes(SECRET.toString()), 'refusal carried the file\'s bytes: ' + text.slice(0, 80));
        assert.equal(r.headers.get('content-type').split(';')[0], 'application/json', 'a refusal must be the JSON sentence, never a file');
        const b = JSON.parse(text);
        assert.equal(b.ok, false);
        assert.ok(typeof b.because === 'string' && b.because.length > 0, 'no sentence');
      });
    }
  }
  for (const verb of ['preview', 'download']) {
    test(`#4997 ${label} REFUSED (${verb}): a read from another website gets nothing (CONTROL: the same read same-origin is served)`, async () => {
      const r = await get(routes()[verb], 'shot.png', { 'sec-fetch-site': 'cross-site' });
      assert.equal(r.status, 403);
      const ok = await get(routes()[verb], 'shot.png', { 'sec-fetch-site': 'same-origin' });
      assert.equal(ok.status, 200);
    });
  }
  test(`#4997 ${label}: reveal-file selects the listed file (open -R) and refuses a link out with nothing opened`, async () => {
    const folder = label === 'project' ? PROJECT.folder : FILES;
    calls.length = 0;
    const r = await fetch(base() + routes().reveal, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'shot.png' }) });
    assert.equal(r.status, 200);
    assert.deepEqual(calls, [['/usr/bin/open', ['-R', fs.realpathSync(path.join(folder, 'shot.png'))]]]);
    for (const name of ['link.png', 'innocent.png', 'node_modules/x.png', 'NODE_MODULES/x.png', 'dirlink/key.png', '.hidden.png']) {
      calls.length = 0;
      const out = await fetch(base() + routes().reveal, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
      assert.equal(out.status, 409, name);
      assert.equal(calls.length, 0, name + ' was revealed');
    }
  });
}

test('#4997: a project that does not exist is a 404, not a read of some other folder', async () => {
  const r = await fetch(base() + '/api/project/no-such-project/file-preview?name=shot.png');
  assert.equal(r.status, 404);
  // Review 15: the ROUTE's sentence, since any unknown /api path is a 404 too (this must fail if the route is gone).
  assert.equal((await r.json()).because, 'there is no project by that name');
});

test('#4997 review 1: an agent whose Files folder is itself a link is refused for every new verb, with no bytes', async () => {
  const files = dmfiles.filesDir('bea');
  fs.mkdirSync(path.dirname(files), { recursive: true });
  fs.symlinkSync(OUTSIDE, files);
  for (const verb of ['preview', 'download']) {
    const r = await fetch(base() + '/api/agent/bea/files/' + verb + '?name=secret.png');
    assert.equal(r.status, 409, verb);
    assert.ok(!(await r.text()).includes(SECRET.toString()));
  }
  const rv = await fetch(base() + '/api/agent/bea/files/reveal-file', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'secret.png' }) });
  assert.equal(rv.status, 409);
});

test('#4997 review 1: a new PDF at the same path with the same size and time is drawn afresh, not served from the cache', async () => {
  let drawn = 0;
  attachments.setRenderer((file, dir) => { drawn++; fs.writeFileSync(path.join(dir, 'preview.png'), Buffer.concat([PNG, fs.readFileSync(file)])); });
  try {
    const file = path.join(FILES, 'same.pdf');
    fs.writeFileSync(file, 'AAAA');
    const t = new Date('2026-01-01T00:00:00Z');
    fs.utimesSync(file, t, t);
    const first = Buffer.from(await (await get('/api/agent/ava/files/preview', 'same.pdf')).arrayBuffer());
    assert.ok(first.toString().endsWith('AAAA'));
    fs.rmSync(file);
    fs.writeFileSync(file, 'BBBB');
    fs.utimesSync(file, t, t);
    const second = Buffer.from(await (await get('/api/agent/ava/files/preview', 'same.pdf')).arrayBuffer());
    assert.ok(second.toString().endsWith('BBBB'), 'the old first page was served for a new file');
    assert.equal(drawn, 2);
    const again = Buffer.from(await (await get('/api/agent/ava/files/preview', 'same.pdf')).arrayBuffer());
    assert.ok(again.toString().endsWith('BBBB'));
    assert.equal(drawn, 2, 'CONTROL: an unchanged file is served from the cache');
  } finally {
    attachments.setRenderer((file, dir) => { fs.writeFileSync(path.join(dir, 'preview.png'), Buffer.concat([PNG, fs.readFileSync(file)])); });
  }
});

test('#4997 review 1: a POST to preview or download is told to use GET', async () => {
  const r = await fetch(base() + '/api/agent/ava/files/preview?name=shot.png', { method: 'POST' });
  assert.equal(r.status, 405);
  assert.equal((await r.json()).because, 'use GET for that');
});

test('#4997 review 2: the PDF renderer is handed a private copy under the cache, never the person\'s file', async () => {
  const seen = [];
  attachments.setRenderer((file, dir) => { seen.push(file); fs.writeFileSync(path.join(dir, 'preview.png'), PNG); });
  try {
    fs.writeFileSync(path.join(FILES, 'copy.pdf'), 'CCCC');
    const r = await get('/api/agent/ava/files/preview', 'copy.pdf');
    assert.equal(r.status, 200);
    assert.equal(seen.length, 1);
    assert.ok(seen[0].startsWith(filepreview.CACHE + path.sep), 'the renderer read the person\'s path: ' + seen[0]);
    assert.ok(!fs.existsSync(seen[0]), 'the private copy was left behind');
  } finally {
    attachments.setRenderer((file, dir) => { fs.writeFileSync(path.join(dir, 'preview.png'), Buffer.concat([PNG, fs.readFileSync(file)])); });
  }
});

test('#4997 review 3 (measured race): a file swapped for a link to a hidden file right after the walk approved it is refused, not served (CONTROL: no swap serves it)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-files-preview-race-'));
  fs.mkdirSync(path.join(dir, '.secret'));
  fs.writeFileSync(path.join(dir, '.secret', 'key.png'), SECRET);
  const pic = path.join(dir, 'pic.png');
  fs.writeFileSync(pic, PNG);
  const control = (await filepreview.preview(dir, 'pic.png', 'here', { maxDepth: 0 }));
  assert.equal(control.ok, true, 'CONTROL');
  const real = fs.lstatSync;
  let swapped = false;
  fs.lstatSync = function (p, ...rest) {
    const st = real.call(fs, p, ...rest);
    if (!swapped && String(p).endsWith(path.sep + 'pic.png')) { swapped = true; fs.rmSync(pic); fs.symlinkSync(path.join(dir, '.secret', 'key.png'), pic); }
    return st;
  };
  let got;
  try { got = (await filepreview.preview(dir, 'pic.png', 'here', { maxDepth: 0 })); } finally { fs.lstatSync = real; }
  assert.ok(swapped, 'the swap never happened, so this arm proved nothing');
  assert.equal(got.ok, false, 'the hidden file was served: ' + (got.bytes ? got.bytes.toString() : ''));
});

test('#4997 #1732: with the kernel O_NOFOLLOW taken away (as on Windows), a link swapped in at the open is refused by the identity check alone (CONTROL: no swap serves it)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-files-preview-nofollow-'));
  fs.mkdirSync(path.join(dir, '.secret'));
  const pic = path.join(dir, 'pic.png');
  const hidden = path.join(dir, '.secret', 'key.png');
  fs.writeFileSync(pic, PNG);
  fs.writeFileSync(hidden, SECRET);
  filepreview._setNofollowForTest(undefined);
  const real = fs.openSync;
  let swapped = false;
  let got;
  try {
    assert.equal((await filepreview.preview(dir, 'pic.png', 'here', { maxDepth: 0 })).ok, true, 'CONTROL');
    /* Between the resolve and the open, as review 11's arm, but a LINK: without the kernel flag the open follows it,
       so only the fstat identity check stands between the hidden file and the answer. */
    fs.openSync = function (p, ...rest) {
      if (!swapped && String(p) === fs.realpathSync(pic)) { swapped = true; fs.rmSync(pic); fs.symlinkSync(hidden, pic); }
      return real.call(fs, p, ...rest);
    };
    got = (await filepreview.preview(dir, 'pic.png', 'here', { maxDepth: 0 }));
  } finally { fs.openSync = real; filepreview._setNofollowForTest(); }
  assert.ok(swapped, 'the swap never happened, so this arm proved nothing');
  assert.equal(got.ok, false, 'the hidden file was served: ' + (got.bytes ? got.bytes.toString() : ''));
  /* Refused BY THE IDENTITY CHECK (review): with the kernel flag still on, the open fails with ELOOP and answers
     'could not be read', which would keep this arm green with the seam broken. */
  assert.equal(got.because, 'that file changed while it was being read');
});

test('#4997 review 6: on Windows a name with a colon (an alternate data stream, photo.png:Zone.Identifier) is refused (CONTROL: the same file, a real name here, is served off Windows)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-files-preview-ads-'));
  fs.writeFileSync(path.join(dir, 'photo.png:Zone.Identifier'), PNG);   // a legal file name on macOS and Linux
  const ask = () => projects.resolveListedFile(dir, 'photo.png:Zone.Identifier', 'here', { listed: true, maxDepth: 0 });
  assert.equal(ask().ok, true, 'CONTROL: off Windows the file is listed and served');
  const was = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  let got;
  try { got = ask(); } finally { Object.defineProperty(process, 'platform', was); }
  assert.equal(got.ok, false);
  assert.match(got.because, /not a file in here/);
});

test('#4997 review 9 (parity): the routes accept exactly the files listFiles lists, flat and walked, but for a name with a backslash, which openFile\'s shape gate refuses on every route (the card: safe) (CONTROL: the depths swapped disagree)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-files-preview-parity-'));
  const put = (rel, body = 'x') => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
  for (const rel of ['top.png', 'Icon\r', 'Thumbs.db', '~$doc.docx', '~WRL0001.tmp', '.hidden', 'build', 'a/one.png', 'a/b/two.png', 'a/b/c/three.png',
    'a/b/c/d/four.png', 'node_modules/x.png', 'Node_Modules/y.png', 'x/dist/z.png', '.dot/in.png', 'sub/ok.pdf']) put(rel);
  fs.symlinkSync(path.join(dir, 'top.png'), path.join(dir, 'link.png'));
  fs.symlinkSync(path.join(dir, 'a'), path.join(dir, 'alink'));
  const candidates = [];
  const walk = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? rel + '/' + e.name : e.name; candidates.push(r); if (e.isDirectory()) walk(path.join(d, e.name), r); } };
  walk(dir, '');
  candidates.push('alink/one.png');
  const agree = (listDepth, routeDepth) => {
    const listed = new Set(projects.listFiles(dir, 1000, listDepth === undefined ? undefined : { maxDepth: listDepth }).files.map((f) => f.name));
    return candidates.filter((c) => listed.has(c) !== projects.resolveListedFile(dir, c, 'here', { listed: true, maxDepth: routeDepth }).ok);
  };
  assert.ok(candidates.length > 20, 'the fixture is too small to say anything');
  assert.deepEqual(agree(0, 0), [], 'flat (an agent\'s Files)');
  assert.deepEqual(agree(undefined, undefined), [], 'walked (a project)');
  assert.notDeepEqual(agree(0, undefined), [], 'CONTROL: different depths disagree, so this test can see a difference');
});

test('#4997 review 10: a PDF whose first page cannot be drawn leaves no empty cache folder (CONTROL: a drawn one keeps its folder)', async () => {
  const folders = () => (fs.existsSync(filepreview.CACHE) ? fs.readdirSync(filepreview.CACHE).length : 0);
  attachments.setRenderer(() => { /* draws nothing */ });
  try {
    fs.writeFileSync(path.join(FILES, 'nopage.pdf'), 'NOPAGE');
    const before = folders();
    const r = await get('/api/agent/ava/files/preview', 'nopage.pdf');
    assert.equal(r.status, 404);
    assert.equal(folders(), before, 'a failed render left a folder');
  } finally {
    attachments.setRenderer((file, dir) => { fs.writeFileSync(path.join(dir, 'preview.png'), Buffer.concat([PNG, fs.readFileSync(file)])); });
  }
  fs.writeFileSync(path.join(FILES, 'haspage.pdf'), 'HASPAGE');
  const before = folders();
  assert.equal((await get('/api/agent/ava/files/preview', 'haspage.pdf')).status, 200);
  assert.equal(folders(), before + 1, 'CONTROL: a drawn page keeps its folder');
});

test('#4997 review 11: a hidden file renamed over a listed name between the resolve and the open is refused by the read\'s own check (CONTROL: no swap serves it)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-files-preview-openswap-'));
  fs.mkdirSync(path.join(dir, '.secret'));
  const pic = path.join(dir, 'pic.png');
  const hidden = path.join(dir, '.secret', 'key.png');
  fs.writeFileSync(pic, PNG);
  fs.writeFileSync(hidden, SECRET);
  assert.equal((await filepreview.preview(dir, 'pic.png', 'here', { maxDepth: 0 })).ok, true, 'CONTROL');
  const real = fs.openSync;
  let swapped = false;
  fs.openSync = function (p, ...rest) {
    if (!swapped && String(p) === fs.realpathSync(pic)) { swapped = true; fs.renameSync(hidden, pic); }
    return real.call(fs, p, ...rest);
  };
  let got;
  try { got = (await filepreview.preview(dir, 'pic.png', 'here', { maxDepth: 0 })); } finally { fs.openSync = real; }
  assert.ok(swapped, 'the swap never happened, so this arm proved nothing');
  assert.equal(got.ok, false, 'the hidden file was served: ' + (got.bytes ? got.bytes.toString() : ''));
  assert.equal(got.because, 'that file changed while it was being read', 'refused, but not by the read\'s own check');
});

test('#4997 + #5165: the resolved-equals-walked check is exact off Windows and case- and separator-blind on Windows (sameListedPath)', () => {
  assert.equal(projects.sameListedPath('/a/B.png', '/a/B.png', 'darwin'), true);
  assert.equal(projects.sameListedPath('/a/b.png', '/a/B.png', 'darwin'), false, 'off Windows another case is refused');
  assert.equal(projects.sameListedPath('C:\\Proj\\B.png', 'c:\\proj/b.png', 'win32'), true, 'Windows: case and separators do not refuse');
  assert.equal(projects.sameListedPath('C:\\Proj\\B.png', 'C:\\Proj\\C.png', 'win32'), false, 'CONTROL: another file is still refused on Windows');
});
