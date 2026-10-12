'use strict';

/**
 * kosmos#5970: `--body-file <path>` (and `--body-file=<path>`) on the Mac CLI's `feedback write`, `community post`,
 * `community comment`, `community edit` and `community endorse`, the same input path the Windows CLI takes (#5946).
 * The file is decoded by its byte order mark (UTF-8, UTF-16 LE or BE; none means UTF-8) and refused when it is
 * missing, over the board's limit, not text, or blank, and the flag is refused given twice, with no path, or beside
 * words. The community verbs run against a stub board (the #4913 endorse test's shape), so no real board and no
 * network; feedback write runs against a faked install (the #2037 test's shape) and a dead feedback URL.
 *
 *   node --test cli.body-file-5970.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const TOKEN = 'ab'.repeat(16);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-bodyfile-5970-'));
const FILES = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-bodyfile-5970-files-'));
process.on('exit', () => {
  for (const d of [DATA, FILES]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});
const envFor = (port, extra = {}) => ({ ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42', KOSMOS_AGENT_TOKEN: TOKEN, ...extra });

let n = 0;
function file(content) {
  const p = path.join(FILES, `body-${++n}.txt`);
  fs.writeFileSync(p, content);
  return p;
}

function runCli(args, env, input = '') {
  return new Promise((resolve, reject) => {
    const child = execFile(CLI, args, { env, timeout: 30000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
    child.stdin.end(input);
  });
}

function withStubBoard(fn, reply = { status: 200, body: { ok: true, status: 'published', text: 'Done.' } }) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/community/')) {
      const chunks = [];
      req.on('data', (d) => chunks.push(d));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = null;
        if (raw) { try { body = JSON.parse(raw); } catch { body = { _unparsable: raw }; } }
        seen.push({ method: req.method, url: req.url, body });
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply.body));
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port, seen); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

const WRITTEN = "Line one, with $HOME, `ticks` and it's an apostrophe.\nLine two: café.";

test('#5970: community comment --body-file sends the file as written, before or after the post id, in both spellings', () => withStubBoard(async (port, seen) => {
  const p = file(WRITTEN + '\n');
  const a = await runCli(['community', 'comment', '--body-file', p, 'post-1'], envFor(port));
  assert.equal(a.code, 0, a.stdout + a.stderr);
  const b = await runCli(['community', 'comment', 'post-1', `--body-file=${p}`], envFor(port));
  assert.equal(b.code, 0, b.stdout + b.stderr);
  const c = await runCli(['community', 'comment', 'post-1', '--reply-to', 'c-9', '--body-file', p], envFor(port));
  assert.equal(c.code, 0, c.stdout + c.stderr);
  assert.equal(seen.length, 3, 'control: the stub did not see every request');
  for (const s of seen) {
    assert.equal(s.url, '/api/community/service-comment');
    assert.equal(s.body.servicePostId, 'post-1', 'the flag took the post id\'s place');
    assert.equal(s.body.body, WRITTEN, 'the file did not arrive as written');
  }
  assert.equal(seen[2].body.serviceParentId, 'c-9');
}));

test('#5970: the file wins over stdin, which is not read', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['community', 'comment', 'post-1', '--body-file', file('From the file.')], envFor(port), 'From the pipe.');
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen[0].body.body, 'From the file.');
}));

test('#5970: a file is decoded by its byte order mark (UTF-8, UTF-16 LE, UTF-16 BE), and CRLF arrives as LF', () => withStubBoard(async (port, seen) => {
  const crlf = WRITTEN.replace(/\n/g, '\r\n') + '\r\n';
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(crlf, 'utf16le')]);
  const be = Buffer.from(le); be.swap16(); be[0] = 0xfe; be[1] = 0xff;
  const bom8 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(crlf, 'utf8')]);
  for (const [name, bytes] of [['utf-8 with BOM', bom8], ['utf-16le', le], ['utf-16be', be], ['plain utf-8 CRLF', Buffer.from(crlf, 'utf8')]]) {
    const out = await runCli(['community', 'comment', 'post-1', '--body-file', file(bytes)], envFor(port));
    assert.equal(out.code, 0, `${name}: ${out.stdout}${out.stderr}`);
    assert.equal(seen[seen.length - 1].body.body, WRITTEN, `${name}: the decoded text is not what was written`);
  }
}));

test('#5970: community post, edit and endorse take --body-file too', () => withStubBoard(async (port, seen) => {
  const p = file(WRITTEN);
  const post = await runCli(['community', 'post', '--channel', 'engineering', '--topic', 'A title', '--body-file', p], envFor(port));
  assert.equal(post.code, 0, post.stdout + post.stderr);
  assert.equal(seen[0].url, '/api/community/post');
  assert.equal(seen[0].body.body, WRITTEN);
  assert.equal(seen[0].body.topic, 'A title');
  assert.equal(seen[0].body.channel, 'engineering');

  const edit = await runCli(['community', 'edit', 'post', 'id-1', '--topic', 'New title', '--body-file', p], envFor(port));
  assert.equal(edit.code, 0, edit.stdout + edit.stderr);
  assert.equal(seen[1].url, '/api/community/service-edit');
  assert.deepEqual([seen[1].body.kind, seen[1].body.id, seen[1].body.body, seen[1].body.topic], ['post', 'id-1', WRITTEN, 'New title']);

  const edit2 = await runCli(['community', 'edit', '--body-file', p, 'comment', 'id-2'], envFor(port));
  assert.equal(edit2.code, 0, edit2.stdout + edit2.stderr);
  assert.deepEqual([seen[2].body.kind, seen[2].body.id, seen[2].body.body], ['comment', 'id-2', WRITTEN], 'the flag before kind and id took their places');

  const endorse = await runCli(['community', 'endorse', 'Theo Nguyen', '5', '--body-file', p], envFor(port));
  assert.equal(endorse.code, 0, endorse.stdout + endorse.stderr);
  assert.equal(seen[3].url, '/api/community/endorse');
  assert.deepEqual([seen[3].body.name, seen[3].body.stars, seen[3].body.text], ['Theo Nguyen', 5, WRITTEN]);
}));

test('#5970: past --, "--body-file" is words, not the flag', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['community', 'comment', 'post-1', '--', '--body-file', 'is', 'a', 'flag'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen[0].body.body, '--body-file is a flag');
}));

test('#5970: every refusal exits 2, names the problem, and sends nothing', () => withStubBoard(async (port, seen) => {
  const good = file('Fine words.');
  const big = path.join(FILES, 'big.txt');
  fs.writeFileSync(big, '');
  fs.truncateSync(big, 6291456 + 1);   // one byte over POST_BODY_MAX_BYTES, sparse, so the test stays fast
  const cases = [
    ['words plus file', ['community', 'comment', 'post-1', '--body-file', good, 'and', 'words'], /as words OR with --body-file, not both/],
    ['twice', ['community', 'comment', 'post-1', '--body-file', good, '--body-file', good], /given twice/],
    ['twice, mixed spellings', ['community', 'post', `--body-file=${good}`, '--body-file', good], /given twice/],
    ['no path', ['community', 'comment', 'post-1', '--body-file'], /needs the path of a file/],
    ['empty path', ['community', 'comment', 'post-1', '--body-file='], /needs the path of a file/],
    ['an option as the path', ['community', 'comment', 'post-1', '--body-file', '--reply-to'], /--body-file needs a value, and --reply-to is an option/],
    ['missing file', ['community', 'comment', 'post-1', '--body-file', path.join(FILES, 'nope.txt')], /Nothing was sent: there is no file Kosmos can read at/],
    ['a folder', ['community', 'comment', 'post-1', '--body-file', FILES], /there is no file Kosmos can read at/],
    ['not UTF-8', ['community', 'comment', 'post-1', '--body-file', file(Buffer.from([0x68, 0x69, 0xc3, 0x28]))], /is not UTF-8 text/],
    ['a NUL', ['community', 'comment', 'post-1', '--body-file', file(Buffer.from('a\0b'))], /is not UTF-8 text/],
    ['over the cap', ['community', 'comment', 'post-1', '--body-file', big], /over the 6 MB the board accepts/],
    ['empty', ['community', 'comment', 'post-1', '--body-file', file('')], /Nothing was sent: .* is empty/],
    ['blank', ['community', 'post', '--body-file', file(' \r\n\t\n')], /Nothing was posted: .* is empty/],
    ['edit, words plus file', ['community', 'edit', 'post', 'id-1', '--body-file', good, 'more'], /not both/],
    ['endorse, words plus file', ['community', 'endorse', 'Theo', '5', '--body-file', good, 'more'], /not both/],
  ];
  for (const [name, args, re] of cases) {
    const out = await runCli(args, envFor(port));
    assert.equal(out.code, 2, `${name}: exit ${out.code}: ${out.stdout}${out.stderr}`);
    assert.match(out.stdout + out.stderr, re, `${name}: the refusal did not say why`);
  }
  assert.equal(seen.length, 0, 'a refused command still reached the board');
  // Control: the same stub does see a good one, so the zero above is not a stub that sees nothing.
  const ok = await runCli(['community', 'comment', 'post-1', '--body-file', good], envFor(port));
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  assert.equal(seen.length, 1);
}));

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-bodyfile-home-'));
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.symlinkSync(path.join(__dirname, 'engine'), path.join(home, 'app', 'engine'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-bodyfile-data-'));
  process.on('exit', () => { for (const d of [home, data]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });
  return { home, data };
}
// A dead loopback for the send, never installkosmos.com (as cli.feedback-2037.test.js).
const fbEnv = (h) => ({ ...process.env, KOSMOS_HOME: h.home, AGENT_WORKFORCE_DATA: h.data, KOSMOS_PORT: '9', AGENT_WORKFORCE_FEEDBACK_URL: 'http://127.0.0.1:9/api/feedback' });
const runBash = (args, env) => new Promise((resolve, reject) => {
  const child = execFile('bash', [CLI, ...args], { env, timeout: 20000 }, (err, stdout, stderr) => {
    if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code. ' + (stderr || ''))); return; }
    resolve({ code: err ? err.code : 0, both: `${stdout}${stderr}` });
  });
  child.stdin.end();
});

test('#5970: feedback write --body-file saves the file as the report; a refusal saves nothing', async () => {
  const h = makeHome();
  const w = await runBash(['feedback', 'write', '--body-file', file(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('## Did not work\r\n- X `y` $z\r\n', 'utf16le')]))], fbEnv(h));
  assert.equal(w.code, 0, w.both);
  const s = await runBash(['feedback', 'show'], fbEnv(h));
  assert.match(s.both, /## Did not work\n- X `y` \$z/, 'the UTF-16 report was not saved as written');

  const h2 = makeHome();
  const r = await runBash(['feedback', 'write', '--body-file', file('Saved?'), 'and words'], fbEnv(h2));
  assert.equal(r.code, 2, r.both);
  assert.match(r.both, /not both/);
  const l = await runBash(['feedback', 'list'], fbEnv(h2));
  assert.equal(l.both.trim(), '', 'a refused write still created a report');
});
