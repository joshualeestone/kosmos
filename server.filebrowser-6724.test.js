'use strict';
/* #6724 (Josh viewing a board from another computer: "Open in Finder" opens on the far Mac): the in-app, read-only
 * browser of an agent's Files, against a real sandboxed board.
 *   GET /api/agent/:name/files/browse?dir=           one level: folders and files
 *   GET /api/agent/:name/files/download-folder?dir=  that folder as one zip
 *   GET /api/agent/:name/files/preview?name=         now also text, and files in subfolders
 * It is a security surface over the remote link, so each way out of the folder has its own case: every one is refused
 * by browse AND by the zip, and nothing outside Files ever reaches the response.
 *
 *   node --test server.filebrowser-6724.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-filebrowser-'));
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

const { start, server, boardAuthState } = require('./server');
const projects = require('./engine/projects');
const filepreview = require('./engine/filepreview');

let base;
const calls = [];
const SECRET = 'TOPSECRET_6724_outside_files';
const OUTSIDE = path.join(SANDBOX, 'outside');
const AGENT = path.join(SANDBOX, 'workers', 'brow');
const FILES = path.join(AGENT, 'Files');
const write = (rel, data) => { const p = path.join(FILES, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };
const BIG = Buffer.alloc(300 * 1024, 'a');
const DEEP8 = ['deep', '1', '2', '3', '4', '5', '6', '7'];   // eight folders below Files: the deepest the browser goes

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  projects.setRevealRunner((file, args) => { calls.push([file, args]); return { ok: true }; });
  projects.setRevealPlatform('darwin');
  fs.mkdirSync(OUTSIDE, { recursive: true });
  fs.writeFileSync(path.join(OUTSIDE, 'secret.txt'), SECRET);
  fs.mkdirSync(FILES, { recursive: true });
  fs.writeFileSync(path.join(AGENT, 'CLAUDE.md'), 'instructions ' + SECRET);
  write('note.txt', 'hello from the agent');
  write('page.html', '<script>alert(1)</script>');
  write('bin.txt', Buffer.from([0x68, 0x00, 0x69]));
  write('big.log', BIG);
  write('.hidden.txt', SECRET);
  write('~$lock.docx', SECRET);
  write('reports/a.pdf', '%PDF-1.4 a');
  write('reports/2026/q1.csv', 'month,total\njan,1\n');
  write('reports/.git/config', SECRET);
  write('node_modules/x.js', SECRET);
  write(path.join(...DEEP8, 'eight.txt'), 'eight folders down');
  write(path.join(...DEEP8, '8', 'nine.txt'), SECRET);
  fs.symlinkSync(OUTSIDE, path.join(FILES, 'linkout'));
  fs.symlinkSync(path.join(FILES, 'reports'), path.join(FILES, 'linkin'));
  fs.symlinkSync(path.join(OUTSIDE, 'secret.txt'), path.join(FILES, 'linkfile.txt'));
  fs.symlinkSync(path.join(OUTSIDE, 'secret.txt'), path.join(FILES, 'reports', 'linked.txt'));
});
test.after(() => {
  projects.setRevealPlatform(null);
  projects.setRevealRunner(null);
  try { server.close(); } catch { /* closed */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

function rawGet(urlPath, headers, method = 'GET') {
  return new Promise((resolve) => {
    const u = new URL(base + urlPath);
    // agent: false: a fresh connection each time, so the board closing an idle kept-alive one (5 s) during a slow fixture cannot read as a refusal
    const req = require('node:http').request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), complete: true }));
      res.on('error', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), complete: false }));
      res.on('aborted', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), complete: false }));
    });
    req.on('error', (err) => resolve({ status: 0, headers: {}, body: Buffer.alloc(0), complete: false, err }));
    req.end();
  });
}
const browse = (dir) => rawGet('/api/agent/brow/files/browse' + (dir === null ? '' : '?dir=' + encodeURIComponent(dir)));
const zipOf = (dir, headers) => rawGet('/api/agent/brow/files/download-folder' + (dir === null ? '' : '?dir=' + encodeURIComponent(dir)), headers);
const json = (r) => JSON.parse(r.body.toString('utf8'));

/* The zip read back by Python's zipfile (an independent reader): [[name, hex bytes], ...], and unzip -t's verdict. */
let HAVE_PY = true;
try { execFileSync('python3', ['-I', '-c', 'import zipfile']); } catch { HAVE_PY = false; }
let HAVE_UNZIP = true;
try { execFileSync('unzip', ['-v'], { stdio: 'pipe' }); } catch { HAVE_UNZIP = false; }
function readZip(buf) {
  const f = path.join(SANDBOX, 'got-' + Math.random().toString(16).slice(2) + '.zip');
  fs.writeFileSync(f, buf);
  const out = execFileSync('python3', ['-I', '-c', [
    'import zipfile, sys, json',
    'z = zipfile.ZipFile(sys.argv[1])',
    'assert z.testzip() is None',
    'print(json.dumps([[i.filename, z.read(i).hex()] for i in z.infolist()]))',
  ].join('\n'), f]).toString('utf8');
  let unzipOk = true;   // iteration 2: where there is no unzip (Windows), Python's reader is the check alone
  if (HAVE_UNZIP) { try { execFileSync('unzip', ['-tq', f], { stdio: 'pipe' }); } catch { unzipOk = false; } }
  return { entries: JSON.parse(out), unzipOk };
}

test('browse: the top of Files is its folders, then its files, each by its path in Files; hidden, scratch, skipped and linked names are left out', async () => {
  const r = await browse('');
  assert.equal(r.status, 200, r.body.toString());
  const b = json(r);
  assert.equal(b.ok, true);
  assert.deepEqual(b.dirs.map((d) => d.name), ['deep', 'reports']);
  assert.deepEqual(b.files.map((f) => f.name), ['big.log', 'bin.txt', 'note.txt', 'page.html']);
  const note = b.files.find((f) => f.name === 'note.txt');
  assert.equal(note.size, 'hello from the agent'.length);
  assert.ok(!isNaN(new Date(note.modified)), 'a date for every file');
  assert.ok(typeof b.stamp === 'string' && b.stamp.length > 0);
  assert.doesNotMatch(r.body.toString(), /linkout|linkin|linkfile|node_modules|hidden|lock\.docx|TOPSECRET/);
  assert.deepEqual(json(await browse(null)), b, 'no dir is the top');
});

test('browse: a folder in Files lists its own entries, named from the top of Files (the names preview and download take)', async () => {
  const b = json(await browse('reports'));
  assert.equal(b.ok, true);
  assert.equal(b.dir, 'reports');
  assert.deepEqual(b.dirs.map((d) => d.name), ['reports/2026']);
  assert.deepEqual(b.files.map((f) => f.name), ['reports/a.pdf'], 'the link inside reports/ is not listed');
  const deeper = json(await browse('reports/2026'));
  assert.deepEqual(deeper.files.map((f) => f.name), ['reports/2026/q1.csv']);
  const eight = json(await browse(DEEP8.join('/')));
  assert.equal(eight.ok, true, 'CONTROL: eight folders down is browsable');
  assert.deepEqual(eight.files.map((f) => f.name), [DEEP8.join('/') + '/eight.txt']);
  assert.deepEqual(eight.dirs, [], 'a folder past the depth cap is not offered');
});

/* Each way out of Files, refused by browse and by the zip, with nothing from outside in the answer. */
const ESCAPES = [
  ['..', 'the parent'],
  ['../outside', 'a sibling through the parent'],
  ['reports/../..', 'out through a folder'],
  ['reports/..', 'a dot-dot segment'],
  ['./reports', 'a dot segment'],
  ['/etc', 'an absolute path'],
  [OUTSIDE, 'an absolute path to the folder outside'],
  ['reports\\2026', 'a backslash'],
  ['reports//2026', 'an empty segment'],
  ['reports/', 'a trailing slash'],
  ['/reports', 'a leading slash'],
  ['.git', 'a hidden folder at the top'],
  ['reports/.git', 'a hidden folder inside'],
  ['linkout', 'a link to a folder outside'],
  ['linkout/', 'a link to a folder outside, with a slash'],
  ['linkin', 'a link to a folder inside'],
  ['linkfile.txt', 'a link to a file outside, named as a folder'],
  ['node_modules', 'a skipped folder'],
  ['note.txt', 'a file named as a folder'],
  ['gone', 'a folder that is not there'],
  [DEEP8.join('/') + '/8', 'past the depth cap'],
  ['reports\u0000', 'a NUL'],
];
if (process.platform === 'darwin') ESCAPES.push(['NODE_MODULES', 'a skipped folder in another case (APFS is case-blind)'], ['Reports', 'a folder in another case']);

for (const [dir, what] of ESCAPES) {
  test(`#6724 escape REFUSED by browse: ${what} (${JSON.stringify(dir)})`, async () => {
    const r = await browse(dir);
    const text = r.body.toString('utf8');
    assert.equal(r.status, 404, text);
    assert.equal(json(r).ok, false);
    assert.doesNotMatch(text, /TOPSECRET|secret\.txt|instructions/, 'something from outside Files reached the answer');
  });
  test(`#6724 escape REFUSED by the folder zip: ${what} (${JSON.stringify(dir)})`, async () => {
    const r = await zipOf(dir);
    const text = r.body.toString('utf8');
    assert.equal(r.status, 404, text);
    assert.doesNotMatch(String(r.headers['content-type']), /zip/);
    assert.doesNotMatch(text, /TOPSECRET|instructions/);
    const nav = await zipOf(dir, { 'sec-fetch-mode': 'navigate' });
    assert.equal(nav.status, 204, 'a refused zip navigation must give the browser nothing to save');
    assert.equal(nav.body.length, 0);
  });
}

test('CONTROL for the escapes: the same folders spelled as the browser names them are served', async () => {
  for (const dir of ['', 'reports', 'reports/2026', 'deep']) {
    assert.equal((await browse(dir)).status, 200, 'browse ' + dir);
    assert.equal((await zipOf(dir)).status, 200, 'zip ' + dir);
  }
});

test('a Files that is itself a link is refused for browse and for the zip', async () => {
  const other = path.join(SANDBOX, 'workers', 'linked');
  fs.mkdirSync(other, { recursive: true });
  fs.symlinkSync(OUTSIDE, path.join(other, 'Files'));
  for (const verb of ['browse', 'download-folder']) {
    const r = await rawGet('/api/agent/linked/files/' + verb);
    assert.equal(r.status, 409, verb + ': ' + r.body);
    assert.doesNotMatch(r.body.toString(), /TOPSECRET|secret\.txt/);
  }
});

test('a Files not made yet browses as empty; an agent with no folder is 404', async () => {
  fs.mkdirSync(path.join(SANDBOX, 'workers', 'fresh'), { recursive: true });
  const b = json(await rawGet('/api/agent/fresh/files/browse'));
  assert.deepEqual([b.ok, b.missing, b.dirs, b.files], [true, true, [], []]);
  assert.equal((await rawGet('/api/agent/nobody-6724/files/browse')).status, 404);
});

test('preview and download reach a file the browser shows in a subfolder, and not one it does not', async () => {
  const csv = await rawGet('/api/agent/brow/files/download?name=' + encodeURIComponent('reports/2026/q1.csv'));
  assert.equal(csv.status, 200);
  assert.equal(csv.body.toString(), 'month,total\njan,1\n');
  const eight = await rawGet('/api/agent/brow/files/download?name=' + encodeURIComponent(DEEP8.join('/') + '/eight.txt'));
  assert.equal(eight.status, 200, 'CONTROL: eight folders down downloads');
  for (const name of ['linkin/a.pdf', 'linkout/secret.txt', 'reports/linked.txt', 'node_modules/x.js', 'reports/.git/config', DEEP8.join('/') + '/8/nine.txt', '../CLAUDE.md']) {
    for (const verb of ['download', 'preview']) {
      const r = await rawGet('/api/agent/brow/files/' + verb + '?name=' + encodeURIComponent(name));
      assert.equal(r.status, 404, verb + ' ' + name + ': ' + r.body);
      assert.doesNotMatch(r.body.toString(), /TOPSECRET|instructions/, verb + ' ' + name + ' leaked');
    }
  }
  assert.equal(calls.length, 0, 'nothing was opened on the board’s computer');
});

test('a text file previews as plain text (an .html file too, never a page); a file with a NUL is not text; a big one is cut and says so', async () => {
  const note = await rawGet('/api/agent/brow/files/preview?name=note.txt');
  assert.equal(note.status, 200);
  assert.equal(note.headers['content-type'], 'text/plain; charset=utf-8');
  assert.equal(note.headers['x-content-type-options'], 'nosniff');
  assert.equal(note.headers['content-security-policy'], "default-src 'none'; sandbox");
  assert.equal(note.body.toString(), 'hello from the agent');
  assert.equal(note.headers['x-kosmos-preview-cut'], undefined);
  const html = await rawGet('/api/agent/brow/files/preview?name=page.html');
  assert.equal(html.headers['content-type'], 'text/plain; charset=utf-8', 'an .html file is shown as its words');
  assert.equal(html.body.toString(), '<script>alert(1)</script>');
  const bin = await rawGet('/api/agent/brow/files/preview?name=bin.txt');
  assert.equal(bin.status, 404);
  assert.match(json(bin).because, /not text/);
  const big = await rawGet('/api/agent/brow/files/preview?name=big.log');
  assert.equal(big.status, 200);
  assert.equal(big.body.length, filepreview.TEXT_PREVIEW_BYTES);
  assert.equal(big.headers['x-kosmos-preview-cut'], '1');
  const csv = await rawGet('/api/agent/brow/files/preview?name=' + encodeURIComponent('reports/2026/q1.csv'));
  assert.equal(csv.status, 200, 'a text file in a subfolder previews');
});

test('the folder zip holds exactly the browsed files, byte for byte, under the folder’s own name, and nothing else', { skip: !HAVE_PY && 'python3 is not on this machine' }, async () => {
  const r = await zipOf('');
  assert.equal(r.status, 200, r.body.toString().slice(0, 200));
  assert.equal(r.headers['content-type'], 'application/zip');
  assert.equal(r.headers['content-disposition'], "attachment; filename=\"Files.zip\"; filename*=UTF-8''Files.zip");
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(Number(r.headers['content-length']), r.body.length, 'the length said is the length sent');
  const { entries, unzipOk } = readZip(r.body);
  assert.equal(unzipOk, true, 'unzip -t refused the zip');
  const want = {
    'Files/': '', 'Files/big.log': BIG.toString('hex'), 'Files/bin.txt': '680069', 'Files/note.txt': Buffer.from('hello from the agent').toString('hex'),
    'Files/page.html': Buffer.from('<script>alert(1)</script>').toString('hex'),
    'Files/reports/': '', 'Files/reports/a.pdf': Buffer.from('%PDF-1.4 a').toString('hex'), 'Files/reports/2026/': '',
    'Files/reports/2026/q1.csv': Buffer.from('month,total\njan,1\n').toString('hex'),
  };
  let path8 = 'Files';
  for (const d of DEEP8) { path8 += '/' + d; want[path8 + '/'] = ''; }
  want[path8 + '/eight.txt'] = Buffer.from('eight folders down').toString('hex');
  assert.deepEqual(Object.fromEntries(entries), want);
  assert.ok(!r.body.includes(Buffer.from(SECRET)), 'bytes from outside Files, a hidden file or a skipped folder are in the zip');

  const sub = await zipOf('reports/2026');
  assert.equal(sub.headers['content-disposition'], "attachment; filename=\"2026.zip\"; filename*=UTF-8''2026.zip");
  assert.deepEqual(readZip(sub.body).entries.map((e) => e[0]), ['2026/', '2026/q1.csv']);
  assert.equal(calls.length, 0, 'nothing was opened on the board’s computer');
});

test('the zip: ?check=1 is 204 with nothing; HEAD says the same length; a name that is not ASCII is kept exactly', { skip: !HAVE_PY && 'python3 is not on this machine' }, async () => {
  const look = await zipOf('', null);
  assert.equal(look.status, 200);
  const check = await rawGet('/api/agent/brow/files/download-folder?check=1');
  assert.equal(check.status, 204);
  assert.equal(check.body.length, 0);
  const head = await rawGet('/api/agent/brow/files/download-folder', {}, 'HEAD');
  assert.equal(head.headers['content-length'], look.headers['content-length']);
  fs.mkdirSync(path.join(SANDBOX, 'workers', 'uni', 'Files', 'Résumés'), { recursive: true });
  fs.writeFileSync(path.join(SANDBOX, 'workers', 'uni', 'Files', 'Résumés', 'Zoë – final.txt'), 'é');
  const u = await rawGet('/api/agent/uni/files/download-folder?dir=' + encodeURIComponent('Résumés'));
  assert.equal(u.status, 200);
  assert.deepEqual(readZip(u.body).entries, [['Résumés/', ''], ['Résumés/Zoë – final.txt', Buffer.from('é').toString('hex')]]);
});

test('the zip is refused, with the reason and before any byte, past its file cap', async () => {
  const many = path.join(SANDBOX, 'workers', 'many', 'Files');
  fs.mkdirSync(many, { recursive: true });
  for (let i = 0; i <= 2000; i++) fs.writeFileSync(path.join(many, 'f' + i + '.txt'), '');
  const r = await rawGet('/api/agent/many/files/download-folder?check=1');
  assert.equal(r.status, 413);
  assert.match(json(r).because, /more than 2000 files/);
  const nav = await rawGet('/api/agent/many/files/download-folder', { 'sec-fetch-mode': 'navigate' });
  assert.equal(nav.status, 204);
  fs.rmSync(path.join(many, 'f2000.txt'));
  assert.equal((await rawGet('/api/agent/many/files/download-folder?check=1')).status, 204, 'CONTROL: 2000 files is a zip');
});

test('the walk caps bytes as well as files (engine)', () => {
  const dir = path.join(SANDBOX, 'bytes-cap');
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sub', 'a.bin'), Buffer.alloc(3 * 1024 * 1024));
  const over = projects.walkListedDir(dir, '', 'here', { maxDepth: 8, maxBytes: 2 * 1024 * 1024 });
  assert.equal(over.ok, false);
  assert.equal(over.tooBig, true);
  assert.match(over.because, /more than 2 MB/);
  assert.equal(projects.walkListedDir(dir, '', 'here', { maxDepth: 8, maxBytes: 4 * 1024 * 1024 }).ok, true, 'CONTROL');
});

test('a file swapped for a link to a secret AFTER the walk is not sent: the zip ends short, never with the secret', async () => {
  const swap = path.join(SANDBOX, 'workers', 'swap', 'Files');
  fs.mkdirSync(swap, { recursive: true });
  fs.writeFileSync(path.join(swap, 'a.txt'), 'first');
  fs.writeFileSync(path.join(swap, 'b.txt'), 'x'.repeat(SECRET.length));   // the secret's length: only the gate can tell
  const real = projects.walkListedDir;
  projects.walkListedDir = (...args) => {
    const got = real(...args);
    fs.rmSync(path.join(swap, 'b.txt'));
    fs.symlinkSync(path.join(OUTSIDE, 'secret.txt'), path.join(swap, 'b.txt'));
    return got;
  };
  let r;
  try { r = await rawGet('/api/agent/swap/files/download-folder'); } finally { projects.walkListedDir = real; }
  assert.equal(r.status, 200, 'the walk passed, so the headers went');
  assert.ok(r.body.length < Number(r.headers['content-length']), 'the zip should end short of the length it promised');
  assert.ok(!r.body.includes(Buffer.from(SECRET)), 'the secret was sent');
});

test('a FOLDER swapped for a link after the walk (which O_NOFOLLOW on the file cannot see) is not sent either', async () => {
  const swap = path.join(SANDBOX, 'workers', 'swapdir', 'Files');
  const away = path.join(SANDBOX, 'outside-dir');
  fs.mkdirSync(path.join(swap, 'sub'), { recursive: true });
  fs.mkdirSync(away, { recursive: true });
  fs.writeFileSync(path.join(swap, 'sub', 'b.txt'), 'x'.repeat(SECRET.length));
  fs.writeFileSync(path.join(away, 'b.txt'), SECRET);   // the same name and length, behind the link
  const real = projects.walkListedDir;
  projects.walkListedDir = (...args) => {
    const got = real(...args);
    fs.rmSync(path.join(swap, 'sub'), { recursive: true });
    fs.symlinkSync(away, path.join(swap, 'sub'));
    return got;
  };
  let r;
  try { r = await rawGet('/api/agent/swapdir/files/download-folder'); } finally { projects.walkListedDir = real; }
  assert.equal(r.status, 200);
  assert.ok(r.body.length < Number(r.headers['content-length']), 'the zip should end short of the length it promised');
  assert.ok(!r.body.includes(Buffer.from(SECRET)), 'the secret was sent through a swapped folder');
});

test('a HARD link to a secret swapped in after the gate (a regular file inside Files: only the open handle’s identity can tell) is not sent', async () => {
  const swap = path.join(SANDBOX, 'workers', 'swaphard', 'Files');
  fs.mkdirSync(swap, { recursive: true });
  fs.writeFileSync(path.join(swap, 'b.txt'), 'x'.repeat(SECRET.length));
  const real = filepreview.resolve;
  filepreview.resolve = (...args) => {
    const got = real(...args);
    if (got.ok && path.basename(got.target) === 'b.txt') {
      fs.rmSync(got.target);
      fs.linkSync(path.join(OUTSIDE, 'secret.txt'), got.target);
    }
    return got;
  };
  let r;
  try { r = await rawGet('/api/agent/swaphard/files/download-folder'); } finally { filepreview.resolve = real; }
  assert.equal(r.status, 200);
  assert.ok(r.body.length < Number(r.headers['content-length']), 'the zip should end short of the length it promised');
  assert.ok(!r.body.includes(Buffer.from(SECRET)), 'the secret was sent through a hard link');
});

test('iteration 1: a name with a backslash (legal on macOS) is not listed, so it can neither fail its own preview nor sink the folder zip', { skip: process.platform === 'win32' || (!HAVE_PY && 'python3 is not on this machine') }, async () => {
  const dir = path.join(SANDBOX, 'workers', 'bslash', 'Files');
  fs.mkdirSync(path.join(dir, 'd\\e'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a\\b.txt'), 'odd');
  fs.writeFileSync(path.join(dir, 'd\\e', 'in.txt'), 'odd');
  fs.writeFileSync(path.join(dir, 'ok.txt'), 'fine');
  const b = json(await rawGet('/api/agent/bslash/files/browse'));
  assert.deepEqual([b.dirs.map((d) => d.name), b.files.map((f) => f.name)], [[], ['ok.txt']]);
  const z = await rawGet('/api/agent/bslash/files/download-folder');
  assert.equal(z.status, 200, 'one odd name sank the zip: ' + z.body.toString().slice(0, 120));
  assert.deepEqual(readZip(z.body).entries.map((e) => e[0]), ['Files/', 'Files/ok.txt']);
});

test('iteration 1: a Files that is a file answers 409 with its reason, never the 404 the page reads as "no folder of its own"', async () => {
  fs.mkdirSync(path.join(SANDBOX, 'workers', 'ffile'), { recursive: true });
  fs.writeFileSync(path.join(SANDBOX, 'workers', 'ffile', 'Files'), 'a file');
  const r = await rawGet('/api/agent/ffile/files/browse');
  assert.equal(r.status, 409);
  assert.match(json(r).because, /file, not a folder/);
  assert.equal((await rawGet('/api/agent/nobody-6724/files/browse')).status, 404, 'CONTROL: no such agent is still 404');
});

test('iteration 1: a folder swapped for a link while it is being read is not listed (no outside names, sizes or dates)', () => {
  const dir = path.join(SANDBOX, 'race-list');
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sub', 'mine.txt'), 'x');
  const real = fs.opendirSync;
  fs.opendirSync = (p, ...rest) => {
    if (String(p).endsWith(path.sep + 'sub')) {
      fs.renameSync(p, p + '-moved');
      fs.symlinkSync(OUTSIDE, p);
    }
    return real(p, ...rest);
  };
  let got;
  try { got = projects.listDir(dir, 'sub', 'here', { maxDepth: 8 }); } finally { fs.opendirSync = real; }
  assert.equal(got.ok, false, 'the outside folder was listed: ' + JSON.stringify(got));
  assert.doesNotMatch(JSON.stringify(got), /secret\.txt/);
});

test('iteration 1: a client that stops reading the zip is let go after the stall time (no response and open file held forever)', { timeout: 5000 }, async () => {
  /* Measured: over loopback the kernel's socket buffers can take a whole test-sized zip from a paused client, so the
     stall is shown on the sender itself, with a response that never drains (CONTROL: one that drains is not cut). */
  const { _setZipStallForTest, zipPut } = require('./server');
  const { EventEmitter } = require('node:events');
  const fakeRes = (drains) => {
    const r = new EventEmitter();
    r.destroyed = false; r.writableEnded = false;
    r.write = () => { if (drains) setTimeout(() => r.emit('drain'), 10); return false; };
    r.destroy = () => { r.destroyed = true; r.emit('close'); };
    return r;
  };
  _setZipStallForTest(100);
  try {
    const stuck = fakeRes(false);
    const started = Date.now();
    await assert.rejects(zipPut(stuck, Buffer.alloc(1)), /connection closed/);
    assert.equal(stuck.destroyed, true, 'a response that takes nothing was kept');
    assert.ok(Date.now() - started < 2000, 'let go long after the stall time');
    const moving = fakeRes(true);
    await zipPut(moving, Buffer.alloc(1));
    assert.equal(moving.destroyed, false, 'CONTROL: a response that drains was cut');
    assert.equal(moving.listenerCount('close'), 0, 'a finished write left its close listener behind');
  } finally { _setZipStallForTest(null); }
});

test('iteration 2: the 1,000 cap counts what is SHOWN, so hidden names cannot crowd out the real ones; past it, the answer says so and gives the limit', () => {
  const dir = path.join(SANDBOX, 'cap-count');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < projects.BROWSE_MAX_ENTRIES + 5; i++) fs.writeFileSync(path.join(dir, '.h' + i), '');
  fs.writeFileSync(path.join(dir, 'real-a.txt'), 'a');
  fs.writeFileSync(path.join(dir, 'real-b.txt'), 'b');
  const few = projects.listDir(dir, '', 'here', { maxDepth: 8 });
  assert.deepEqual(few.files.map((f) => f.name), ['real-a.txt', 'real-b.txt']);
  assert.equal(few.truncated, undefined, 'two shown files are not "more than the limit"');
  for (let i = 0; i < projects.BROWSE_MAX_ENTRIES; i++) fs.writeFileSync(path.join(dir, 'f' + i + '.txt'), '');
  const many = projects.listDir(dir, '', 'here', { maxDepth: 8 });
  assert.equal(many.files.length, projects.BROWSE_MAX_ENTRIES);
  assert.equal(many.truncated, true);
  assert.equal(many.limit, projects.BROWSE_MAX_ENTRIES);
});

test('iteration 2: a name holding U+FFFD (what Node makes of a name that is not UTF-8 on Linux) is not listed', () => {
  const dir = path.join(SANDBOX, 'fffd');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'odd\uFFFD.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'ok.txt'), 'y');
  assert.deepEqual(projects.listDir(dir, '', 'here', { maxDepth: 8 }).files.map((f) => f.name), ['ok.txt']);
});

test('iteration 2 + 3: the zip limit COUNTS: one held open fills a place of one; the page\u2019s look never says busy about its own download; a freed place is used', { timeout: 120000 }, async () => {
  const { _setZipLimitForTest } = require('./server');
  const files = path.join(SANDBOX, 'workers', 'held', 'Files');
  fs.mkdirSync(path.join(files, 'big'), { recursive: true });
  fs.mkdirSync(path.join(files, 'small'), { recursive: true });
  // Big enough that a paused client cannot take it all into socket buffers (measured: 32 MB could be, 80 MB is not).
  fs.writeFileSync(path.join(files, 'big', 'huge.bin'), Buffer.alloc(80 * 1024 * 1024, 7));
  fs.writeFileSync(path.join(files, 'small', 'a.txt'), 'a');
  const held = [];
  const hold = (dir) => new Promise((resolve) => {
    const u = new URL(base + '/api/agent/held/files/download-folder?dir=' + encodeURIComponent(dir));
    const req = require('node:http').request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET', agent: false }, (res) => {
      res.pause();   // a download under way that takes nothing more for now
      held.push(req);
      resolve(res.statusCode);
    });
    req.on('error', () => {});
    req.end();
  });
  const get = (dir, h) => rawGet('/api/agent/held/files/download-folder?' + (h ? 'check=1&' : '') + 'dir=' + encodeURIComponent(dir), h ? {} : { 'sec-fetch-mode': 'navigate' });
  try {
    _setZipLimitForTest(1);
    assert.equal(await hold('big'), 200, 'premise: the first zip streams');
    // The page's order: the download itself (a navigation), then its look.
    assert.equal((await get('small', false)).status, 204, 'with the one place taken, the download is refused (silently, to a navigation)');
    const look = await get('small', true);
    assert.equal(look.status, 429, 'the look must say why that download did not start');
    assert.match(json(look).because, /already under way/);
    // The defect iteration 3 measured: the download ACCEPTED, and its look then counted against it.
    _setZipLimitForTest(2);
    assert.equal(await hold('big'), 200, 'the second place is used');
    const ownLook = await get('big', true);
    assert.equal(ownLook.status, 204, 'the look said busy about the very download that is running: ' + ownLook.body);
    for (const r of held.splice(0)) r.destroy();
    _setZipLimitForTest(1);
    let freed = 0;
    for (let i = 0; i < 50 && freed !== 200; i++) { freed = (await get('small', false)).status; if (freed !== 200) await new Promise((r) => setTimeout(r, 100)); }
    assert.equal(freed, 200, 'a place was never given back after its download ended');
  } finally {
    for (const r of held) r.destroy();
    _setZipLimitForTest(null);
    fs.rmSync(path.join(files, 'big'), { recursive: true, force: true });
  }
});

test('iteration 4: a refusal on record does not make the look say busy once a place has freed', { timeout: 120000 }, async () => {
  const { _setZipLimitForTest } = require('./server');
  const files = path.join(SANDBOX, 'workers', 'freed', 'Files');
  fs.mkdirSync(path.join(files, 'big'), { recursive: true });
  fs.mkdirSync(path.join(files, 'small'), { recursive: true });
  fs.writeFileSync(path.join(files, 'big', 'huge.bin'), Buffer.alloc(80 * 1024 * 1024, 7));
  fs.writeFileSync(path.join(files, 'small', 'a.txt'), 'a');
  let heldReq = null;
  const held = await new Promise((resolve) => {
    const u = new URL(base + '/api/agent/freed/files/download-folder?dir=big');
    heldReq = require('node:http').request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET', agent: false }, (res) => { res.pause(); resolve(res.statusCode); });
    heldReq.on('error', () => {});
    heldReq.end();
  });
  try {
    _setZipLimitForTest(1);
    assert.equal(held, 200, 'premise');
    assert.equal((await rawGet('/api/agent/freed/files/download-folder?dir=small', { 'sec-fetch-mode': 'navigate' })).status, 204, 'premise: refused, so on record');
    assert.equal((await rawGet('/api/agent/freed/files/download-folder?check=1&dir=small')).status, 429, 'CONTROL: while still full, the look says busy');
    heldReq.destroy();
    let look = 0;
    for (let i = 0; i < 30 && look !== 204; i++) { look = (await rawGet('/api/agent/freed/files/download-folder?check=1&dir=small')).status; if (look !== 204) await new Promise((r) => setTimeout(r, 100)); }
    assert.equal(look, 204, 'a place is free, and the look still said busy from the old refusal');
  } finally {
    heldReq.destroy();
    _setZipLimitForTest(null);
    fs.rmSync(path.join(files, 'big'), { recursive: true, force: true });
  }
});

test('iteration 4: a text preview cut inside a UTF-8 character ends on a whole one', async () => {
  const dir = path.join(SANDBOX, 'workers', 'utf', 'Files');
  fs.mkdirSync(dir, { recursive: true });
  const n = filepreview.TEXT_PREVIEW_BYTES;
  fs.writeFileSync(path.join(dir, 'euro.txt'), Buffer.concat([Buffer.alloc(n - 1, 'a'), Buffer.from('\u20ac and more')]));   // the euro sign straddles the cut
  const r = await rawGet('/api/agent/utf/files/preview?name=euro.txt');
  assert.equal(r.status, 200);
  assert.equal(r.headers['x-kosmos-preview-cut'], '1');
  assert.equal(r.body.length, n - 1, 'the partial character was sent');
  assert.ok(!r.body.toString('utf8').includes('\ufffd'), 'the start ends in a replacement mark');
  fs.writeFileSync(path.join(dir, 'whole.txt'), Buffer.concat([Buffer.alloc(n - 3, 'a'), Buffer.from('\u20ac'), Buffer.from('tail')]));
  assert.equal((await rawGet('/api/agent/utf/files/preview?name=whole.txt')).body.length, n, 'CONTROL: a cut between characters keeps every byte');
});

test('iteration 3: the zip walk has a read budget that hidden names count against; the browse list says which limit stopped it', () => {
  const dir = path.join(SANDBOX, 'scan-budget');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 12; i++) fs.writeFileSync(path.join(dir, '.h' + i), '');
  fs.writeFileSync(path.join(dir, 'real.txt'), 'r');
  const walk = projects.walkListedDir(dir, '', 'here', { maxDepth: 8, maxScan: 5 });
  assert.equal(walk.ok, false);
  assert.equal(walk.tooBig, true);
  assert.match(walk.because, /too many names/);
  assert.equal(projects.walkListedDir(dir, '', 'here', { maxDepth: 8, maxScan: 50 }).ok, true, 'CONTROL');
  const cut = projects.listDir(dir, '', 'here', { maxDepth: 8, maxScan: 5 });
  assert.equal(cut.truncated, true);
  assert.equal(cut.scanCut, true, 'a list stopped by its read budget must say so, not quote the shown limit');
  assert.equal(cut.limit, undefined);
});

/* The folder gate has two layers, and each must hold ALONE (a race can defeat either one): the lstat walk (no segment a
   link) and the resolved path equal to the walked one. The board's own filesystem seam stands each one up by itself. */
const asIs = { realpath: (p) => fs.realpathSync.native(p), stat: (p) => fs.statSync(p), access: (p) => fs.accessSync(p, fs.constants.R_OK) };
test('the folder gate’s lstat walk ALONE refuses a link (realpath answering the walked path, as when a link is swapped back)', () => {
  projects.setFsWorldForTests({ ...asIs, lstat: (p) => fs.lstatSync(p), realpath: (p) => p });
  try {
    assert.equal(projects.resolveListedDir(FILES, 'reports', 'here', { maxDepth: 8 }).ok, true, 'CONTROL');
    for (const dir of ['linkout', 'linkin']) assert.equal(projects.resolveListedDir(FILES, dir, 'here', { maxDepth: 8 }).ok, false, dir);
  } finally { projects.setFsWorldForTests(null); }
});
test('the folder gate’s resolved-path check ALONE refuses a link (lstat having seen a real folder, as when one is swapped in after it)', () => {
  const asFolder = (p) => { const s = fs.statSync(p); return { isDirectory: () => s.isDirectory(), isFile: () => s.isFile(), isSymbolicLink: () => false, dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs }; };
  projects.setFsWorldForTests({ ...asIs, lstat: asFolder });
  try {
    assert.equal(projects.resolveListedDir(FILES, 'reports', 'here', { maxDepth: 8 }).ok, true, 'CONTROL');
    for (const dir of ['linkout', 'linkin']) assert.equal(projects.resolveListedDir(FILES, dir, 'here', { maxDepth: 8 }).ok, false, dir);
  } finally { projects.setFsWorldForTests(null); }
});

test('browse and the zip are refused to another website, and need the board token on a board that enforces it', async () => {
  for (const u of ['/api/agent/brow/files/browse', '/api/agent/brow/files/download-folder?check=1']) {
    const r = await rawGet(u, { 'sec-fetch-site': 'cross-site' });
    assert.equal(r.status, 403, u);
    assert.equal((await rawGet(u, { 'sec-fetch-site': 'same-origin' })).status === 403, false, 'CONTROL: same-origin ' + u);
  }
  const TOK = 'BOARDTOKEN_6724_0123456789abcdef';
  const was = { on: boardAuthState.on, token: boardAuthState.token };
  boardAuthState.on = true;
  boardAuthState.token = TOK;
  try {
    for (const u of ['/api/agent/brow/files/browse', '/api/agent/brow/files/download-folder']) {
      assert.equal((await rawGet(u)).status, 403, 'served without the board token: ' + u);
      assert.equal((await rawGet(u, { 'x-kosmos-board-token': TOK })).status, 200, 'refused with the board token: ' + u);
    }
  } finally {
    boardAuthState.on = was.on;
    boardAuthState.token = was.token;
  }
});

test('POST is not the verb for browse or the zip', async () => {
  for (const verb of ['browse', 'download-folder']) {
    const r = await fetch(base + '/api/agent/brow/files/' + verb, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 405, verb);
    assert.match((await r.json()).because, /use GET/);
  }
});
