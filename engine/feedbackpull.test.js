'use strict';
/**
 * #2296: the collect -> triage bridge. Drives the REAL feedbackpull.pull with an
 * INJECTED transport (canned blobs), against a sandboxed data root, so nothing
 * touches the network or the real secrets map. Asserts the written .md is
 * byte-shaped like a locally-authored report (so triage reads it unchanged), the
 * token-missing case is handled, malformed blobs are skipped, and a re-run is
 * idempotent.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Sandbox the data root BEFORE requiring, like feedbacksend.test.js.
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'feedbackpull-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');

const fp = require('./feedbackpull');
const feedback = require('./feedback');

const TOKEN = 'vercel_blob_rw_testtoken';
// A canned collected corpus: two installs on one day + one on another.
const REC = (install, date, body) => ({ install, date, generated_at: date + 'T12:00:00.000Z', consent: { given: true, version: 'v1' }, body });
function transportFor(records) {
  const byUrl = {};
  const blobs = records.map((r, i) => { const url = 'https://blob.example/' + i + '.json'; byUrl[url] = JSON.stringify(r); return { url, pathname: 'feedback/x' + i + '.json' }; });
  return { list: async () => blobs, get: async (u) => byUrl[u] };
}

test.afterEach(() => fp.setTransport(null));

test('token not filed -> ok:false, a clear message, nothing written', async () => {
  const dir = path.join(SB, 'd-notoken');
  // An explicit empty token forces the not-filed path deterministically (no
  // dependence on whether this machine has the target filed), and asserts the
  // list is never attempted without a token.
  fp.setTransport({ list: async () => { throw new Error('should not list without a token'); }, get: async () => '' });
  const r = await fp.pull(dir, { token: '' });
  assert.equal(r.ok, false);
  assert.match(r.because, /token is not filed/);
  assert.equal(r.written, 0);
  assert.ok(!fs.existsSync(dir) || fs.readdirSync(dir).length === 0);
});

test('pull writes each collected report as a triage-readable .md', async () => {
  const dir = path.join(SB, 'd-write');
  fp.setTransport(transportFor([
    REC('inst-aaa', '2026-09-04', 'the + button did nothing\n\nand the list was empty'),
    REC('inst-bbb', '2026-09-04', 'heading rendering broke'),
    REC('inst-aaa', '2026-09-05', 'much better today'),
  ]));
  const r = await fp.pull(dir, { token: TOKEN });
  assert.equal(r.ok, true);
  assert.equal(r.written, 3);
  assert.equal(r.skipped, 0);
  const files = fs.readdirSync(dir).sort();
  assert.deepEqual(files, ['2026-09-04__inst-aaa.md', '2026-09-04__inst-bbb.md', '2026-09-05__inst-aaa.md']);
  // The written file is byte-shaped like feedback.js's own write: triage's
  // stripFrontmatter recovers the body, and frontmatterDate recovers the day
  // (the filename is not a bare YYYY-MM-DD.md, so --since relies on this).
  const raw = fs.readFileSync(path.join(dir, '2026-09-04__inst-aaa.md'), 'utf8');
  assert.equal(feedback.frontmatterDate(raw), '2026-09-04');
  const body = feedback.stripFrontmatter(raw);
  assert.match(body, /the \+ button did nothing/);
  assert.match(body, /and the list was empty/);   // the paragraph break survived
  assert.ok(!/consent/.test(raw), 'the consent object must not leak into the .md');
});

test('a malformed blob is skipped, not written as a corrupt report', async () => {
  const dir = path.join(SB, 'd-bad');
  fp.setTransport({
    list: async () => [{ url: 'u1' }, { url: 'u2' }, { url: 'u3' }],
    get: async (u) => (u === 'u1' ? 'not json' : u === 'u2' ? JSON.stringify({ install: 'x', date: '2026-09-04' }) /* no body */ : JSON.stringify(REC('good', '2026-09-04', 'real body'))),
  });
  const r = await fp.pull(dir, { token: TOKEN });
  assert.equal(r.ok, true);
  assert.equal(r.written, 1);
  assert.equal(r.skipped, 2);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['2026-09-04__good.md']);
});

test('pull is idempotent: a re-run rewrites the same files, no duplicates', async () => {
  const dir = path.join(SB, 'd-idem');
  fp.setTransport(transportFor([REC('inst-aaa', '2026-09-04', 'first')]));
  await fp.pull(dir, { token: TOKEN });
  fp.setTransport(transportFor([REC('inst-aaa', '2026-09-04', 'updated body')]));
  const r = await fp.pull(dir, { token: TOKEN });
  assert.equal(r.written, 1);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['2026-09-04__inst-aaa.md']);
  assert.match(feedback.stripFrontmatter(fs.readFileSync(path.join(dir, '2026-09-04__inst-aaa.md'), 'utf8')), /updated body/);
});

test('an install id with hostile chars is sanitised in the filename', async () => {
  const dir = path.join(SB, 'd-inst');
  fp.setTransport(transportFor([REC('../../etc/passwd', '2026-09-04', 'x')]));
  const r = await fp.pull(dir, { token: TOKEN });
  assert.equal(r.written, 1);
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1);
  // The real safety property: no separator, and the written path cannot escape
  // the target dir (a `..` substring with no separator cannot traverse).
  assert.ok(!files[0].includes('/') && !files[0].includes(path.sep), 'no separator in the filename: ' + files[0]);
  assert.equal(path.dirname(path.resolve(dir, files[0])), path.resolve(dir), 'the file must land directly inside the target dir');
});

test('the REAL transport (defaultList/defaultGet) lists with the token, pages, and fetches each blob', async () => {
  const http = require('node:http');
  const seenAuth = [];
  const seenPaths = [];
  const recs = {
    '/b1.json': REC('inst-aaa', '2026-09-04', 'from page one'),
    '/b2.json': REC('inst-bbb', '2026-09-05', 'from page two'),
  };
  const srv = http.createServer((req, res) => {
    seenPaths.push(req.url);
    if (req.url.startsWith('/?prefix=')) {
      seenAuth.push(req.headers.authorization || '');
      res.setHeader('content-type', 'application/json');
      // page 1 -> hasMore + cursor; page 2 (has cursor=c1) -> final. Exercises paging.
      if (/cursor=c1/.test(req.url)) res.end(JSON.stringify({ blobs: [{ url: BASE + '/b2.json' }], hasMore: false }));
      else res.end(JSON.stringify({ blobs: [{ url: BASE + '/b1.json' }], hasMore: true, cursor: 'c1' }));
      return;
    }
    if (recs[req.url]) { seenGetAuth.push(req.headers.authorization || ''); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(recs[req.url])); return; }
    res.statusCode = 404; res.end('no');
  });
  const seenGetAuth = [];
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:' + srv.address().port;
  const savedApi = process.env.AGENT_WORKFORCE_BLOB_API;
  process.env.AGENT_WORKFORCE_BLOB_API = BASE;
  const dir = path.join(SB, 'd-realtransport');
  try {
    fp.setTransport(null);  // use the REAL defaultList/defaultGet, not an injected stub
    const r = await fp.pull(dir, { token: 'tok-123' });
    assert.equal(r.ok, true);
    assert.equal(r.written, 2, 'both pages were fetched and written');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['2026-09-04__inst-aaa.md', '2026-09-05__inst-bbb.md']);
    assert.ok(seenAuth.every((a) => a === 'Bearer tok-123'), 'every list request carried the Bearer token: ' + JSON.stringify(seenAuth));
    assert.ok(seenPaths.some((p) => /prefix=feedback%2F/.test(p)), 'the list URL carried the feedback/ prefix: ' + JSON.stringify(seenPaths));
    assert.ok(seenPaths.some((p) => /cursor=c1/.test(p)), 'the second page was requested with the cursor');
    // kosmos#3878: the report GETs carry the token too (the private store answers 403 without it).
    assert.deepEqual(seenGetAuth, ['Bearer tok-123', 'Bearer tok-123'], 'every report GET carried the Bearer token');
  } finally {
    if (savedApi === undefined) delete process.env.AGENT_WORKFORCE_BLOB_API; else process.env.AGENT_WORKFORCE_BLOB_API = savedApi;
    await new Promise((r) => srv.close(r));
  }
});

test('a newline in a stored header field cannot shift the frontmatter boundary', () => {
  // generated_at is only length-capped server-side, not charset-filtered; a
  // newline + a fake fence must not break out of the header.
  const md = fp.toMarkdown({ install: 'inst', date: '2026-09-04', generated_at: '2026-09-04T00:00:00Z\n---\ninjected: evil', body: 'real body' });
  assert.equal(feedback.frontmatterDate(md), '2026-09-04', 'the real date is still read');
  assert.equal(feedback.stripFrontmatter(md).trim(), 'real body', 'the body boundary is intact, no injected header leaked into the body');
  assert.ok(!/injected: evil/.test(feedback.stripFrontmatter(md)), 'the injected fence did not open a second header');
});

// #3060: the CLI entrypoint. The module exported pull() but nothing on the fleet
// (macOS) called it -- the feedback verbs live only in the Windows agent CLI --
// so `node engine/feedbackpull.js <dir>` loaded the module and wrote 0 reports at
// exit 0, reading as a fetch-path bug when the bug was a MISSING ENTRYPOINT. runCli
// takes an opts pass-through purely so these tests inject a token (exercising the
// CLI path without the real secrets map); the real main block passes none.
function captureStd(fn) {
  const out = []; const err = [];
  const so = process.stdout.write.bind(process.stdout);
  const se = process.stderr.write.bind(process.stderr);
  process.stdout.write = (s) => { out.push(String(s)); return true; };
  process.stderr.write = (s) => { err.push(String(s)); return true; };
  return Promise.resolve()
    .then(fn)
    .then((code) => { process.stdout.write = so; process.stderr.write = se; return { code, out: out.join(''), err: err.join('') }; })
    .catch((e) => { process.stdout.write = so; process.stderr.write = se; throw e; });
}

test('#3060: runCli --dir pulls the reports, writes them, prints a summary, exits 0', async () => {
  const dir = path.join(SB, 'cli-dir');
  fp.setTransport(transportFor([REC('inst-aaa', '2026-09-04', 'one'), REC('inst-bbb', '2026-09-05', 'two')]));
  const { code, out } = await captureStd(() => fp.runCli(['--dir', dir], { token: TOKEN }));
  assert.equal(code, 0);
  assert.match(out, /pulled 2 report\(s\)/);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['2026-09-04__inst-aaa.md', '2026-09-05__inst-bbb.md']);
});

test('#3060: runCli accepts a bare positional dir (the exact repro form) and writes >0', async () => {
  const dir = path.join(SB, 'cli-positional');
  fp.setTransport(transportFor([REC('inst-aaa', '2026-09-04', 'one')]));
  const { code } = await captureStd(() => fp.runCli([dir], { token: TOKEN }));
  assert.equal(code, 0);
  assert.equal(fs.readdirSync(dir).length, 1);
});

test('#3060: runCli with no filed token exits 1 and says so on stderr, writes nothing', async () => {
  const dir = path.join(SB, 'cli-notoken');
  fp.setTransport({ list: async () => { throw new Error('should not list without a token'); }, get: async () => '' });
  const { code, err } = await captureStd(() => fp.runCli(['--dir', dir], { token: '' }));
  assert.equal(code, 1);
  assert.match(err, /token is not filed/);
  assert.ok(!fs.existsSync(dir) || fs.readdirSync(dir).length === 0);
});

test('#3060: runCli --dir with no path is a usage error (exit 2)', async () => {
  const { code, err } = await captureStd(() => fp.runCli(['--dir'], { token: TOKEN }));
  assert.equal(code, 2);
  assert.match(err, /--dir needs a path/);
});

test('#3060: runCli rejects the directory given more than once, symmetric with two positionals (exit 2)', async () => {
  // A bare positional then --dir must NOT silently overwrite; both "already have
  // a dir" forms error the same way.
  const mixed = await captureStd(() => fp.runCli(['mydir', '--dir', 'other'], { token: TOKEN }));
  assert.equal(mixed.code, 2);
  assert.match(mixed.err, /more than once/);
  const twoFlags = await captureStd(() => fp.runCli(['--dir', 'a', '--dir', 'b'], { token: TOKEN }));
  assert.equal(twoFlags.code, 2);
  assert.match(twoFlags.err, /more than once/);
  const twoPositional = await captureStd(() => fp.runCli(['a', 'b'], { token: TOKEN }));
  assert.equal(twoPositional.code, 2);
  assert.match(twoPositional.err, /unexpected argument/);
});

test('#3060: runCli --help prints usage and exits 0', async () => {
  const { code, out } = await captureStd(() => fp.runCli(['--help'], { token: TOKEN }));
  assert.equal(code, 0);
  assert.match(out, /usage: node engine\/feedbackpull\.js/);
});

test('#3060: a list failure with the token filed surfaces the real error, not a generic empty (distinguishes fetch-failed from token-absent)', async () => {
  const dir = path.join(SB, 'listfail');
  fp.setTransport({ list: async () => { throw new Error('blob list HTTP 401'); }, get: async () => '' });
  const r = await fp.pull(dir, { token: TOKEN });
  assert.equal(r.ok, false);
  assert.equal(r.written, 0);
  assert.match(r.because, /blob list HTTP 401/, 'the underlying error is surfaced');
  assert.match(r.because, /not a missing token/, 'it distinguishes a store/network fault from an absent token');
});

test('#3878: the token is never sent to a report URL on a host other than the blob store', async () => {
  const http = require('node:http');
  const seen = [];
  const other = http.createServer((req, res) => { seen.push(req.headers.authorization || ''); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(REC('inst-x', '2026-09-04', 'x'))); });
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  const api = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ blobs: [{ url: 'http://localhost:' + other.address().port + '/r.json' }], hasMore: false }));
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  const savedApi = process.env.AGENT_WORKFORCE_BLOB_API;
  process.env.AGENT_WORKFORCE_BLOB_API = 'http://127.0.0.1:' + api.address().port;
  try {
    fp.setTransport(null);
    const r = await fp.pull(path.join(SB, 'd-foreign'), { token: 'tok-secret' });
    assert.equal(r.written, 1, 'the report is still fetched, only without the credential');
    assert.deepEqual(seen, [''], 'the store token reached a host that is not the blob store');
  } finally {
    if (savedApi === undefined) delete process.env.AGENT_WORKFORCE_BLOB_API; else process.env.AGENT_WORKFORCE_BLOB_API = savedApi;
    await new Promise((r) => api.close(r)); await new Promise((r) => other.close(r));
  }
});

test('#3878: a pull that lists reports but can read none is NOT ok, and says why', async () => {
  fp.setTransport({
    list: async () => [{ url: 'https://s.blob.vercel-storage.com/a.json' }, { url: 'https://s.blob.vercel-storage.com/b.json' }],
    get: async () => { throw new Error('blob GET HTTP 403'); },
  });
  const r = await fp.pull(path.join(SB, 'd-unreadable'), { token: 'tok' });
  assert.equal(r.ok, false);
  assert.equal(r.written, 0);
  assert.match(r.because, /none was pulled: 2 reports could not be read, 2 of them refused although the token was sent .* \(last error: blob GET HTTP 403\)/);
  // Control: one readable report makes it a success again (a partial pull is not a failure).
  let n = 0;
  fp.setTransport({
    list: async () => [{ url: 'https://s.blob.vercel-storage.com/a.json' }, { url: 'https://s.blob.vercel-storage.com/b.json' }],
    get: async () => { n += 1; if (n === 1) throw new Error('blob GET HTTP 403'); return JSON.stringify(REC('inst-ok', '2026-09-04', 'ok')); },
  });
  const r2 = await fp.pull(path.join(SB, 'd-partial'), { token: 'tok' });
  assert.equal(r2.ok, true);
  assert.equal(r2.written, 1);
});

test('#3878: the token goes only to https Vercel Blob hosts or the configured API origin', () => {
  const saved = process.env.AGENT_WORKFORCE_BLOB_API;
  process.env.AGENT_WORKFORCE_BLOB_API = 'https://blob.vercel-storage.com';
  try {
    for (const yes of [
      'https://x.private.blob.vercel-storage.com/feedback/a.json',
      'https://abc.public.blob.vercel-storage.com/a',
      'https://X.Private.BLOB.Vercel-Storage.com/a',
      'https://blob.vercel-storage.com/?prefix=feedback%2F',
    ]) assert.equal(fp.tokenMayGoTo(yes), true, yes);
    for (const no of [
      'http://x.private.blob.vercel-storage.com/a',
      'https://evilblob.vercel-storage.com/a',
      'https://blob.vercel-storage.com.evil.com/a',
      'https://blob.vercel-storage.com@evil.com/a',
      'https://x.blob.vercel-storage.com./a',
      'https://vercel-storage.com/a',
      'https://example.com/a',
      'not a url',
      '',
    ]) assert.equal(fp.tokenMayGoTo(no), false, no);
  } finally {
    if (saved === undefined) delete process.env.AGENT_WORKFORCE_BLOB_API; else process.env.AGENT_WORKFORCE_BLOB_API = saved;
  }
});

test('#3878: a partial pull says how many reports could not be read; only a 401/403 counts as refused', async () => {
  let n = 0;
  fp.setTransport({
    list: async () => [1, 2, 3].map((i) => ({ url: 'https://s.blob.vercel-storage.com/' + i + '.json' })),
    get: async () => { n += 1; if (n < 3) throw new Error('blob GET HTTP 403'); return JSON.stringify(REC('inst-p', '2026-09-04', 'p')); },
  });
  const r = await fp.pull(path.join(SB, 'd-mostly'), { token: 'tok' });
  assert.equal(r.ok, true);
  assert.equal(r.written, 1);
  assert.equal(r.unreadable, 2);
  assert.match(r.lastGetError, /403/);
  fp.setTransport({
    list: async () => [{ url: 'https://s.blob.vercel-storage.com/gone.json' }],
    get: async () => { throw new Error('blob GET HTTP 404'); },
  });
  const r404 = await fp.pull(path.join(SB, 'd-gone'), { token: 'tok' });
  assert.equal(r404.ok, false);
  assert.doesNotMatch(r404.because, /refused although/, 'a 404 (deleted between list and GET) is not a refusal');
  fp.setTransport({
    list: async () => [{ url: 'https://s.blob.vercel-storage.com/x.json' }],
    get: async () => { throw new Error('blob GET HTTP 403'); },
  });
  const denied = await fp.pull(path.join(SB, 'd-denied'), { token: 'tok' });
  assert.match(denied.because, /1 report could not be read, 1 of them refused although the token was sent/);
  // A private-host listing refused with the token: no refile advice (the listing came from
  // this token's own store), which the code WOULD emit if it wrongly treated it as stale.
  assert.doesNotMatch(denied.because, /refile/, 'a token that listed the store must not be told to refile');
});

test('#3878: one summary for every CLI, including the could-not-be-read line', () => {
  assert.deepEqual(fp.summaryLines({ written: 3, skipped: 0, dir: '/d' }), ['pulled 3 report(s) to /d']);
  assert.deepEqual(fp.summaryLines({ written: 1, skipped: 2, unreadable: 2, lastGetError: 'blob GET HTTP 403', dir: '/d' }),
    ['pulled 1 report(s) (2 skipped) to /d', '2 reports could not be read (last error: blob GET HTTP 403)']);
  // The Mac and Windows commands print THIS, not their own copy of the sentence.
  const repo = path.join(__dirname, '..');
  const mac = fs.readFileSync(path.join(repo, 'install', 'kosmos'), 'utf8');
  const win = fs.readFileSync(path.join(repo, 'tools', 'windows', 'kosmos-cli.js'), 'utf8');
  const self = fs.readFileSync(path.join(repo, 'engine', 'feedbackpull.js'), 'utf8');
  for (const [name, src] of [['install/kosmos', mac], ['tools/windows/kosmos-cli.js', win]]) {
    assert.match(src, /summaryLines\(r\)/, name + ' does not print the shared summary');
    assert.doesNotMatch(src, /["']pulled ["'] *\+ *r\.written/, name + ' still words the summary itself');
  }
  assert.equal((self.match(/'pulled ' \+ r\.written/g) || []).length, 1, 'the summary is worded more than once in the engine');
});

test('#3878: refusals are counted even when the last failure was a 404', async () => {
  let n = 0;
  fp.setTransport({
    list: async () => [1, 2, 3].map((i) => ({ url: 'https://s.blob.vercel-storage.com/' + i + '.json' })),
    get: async () => { n += 1; throw new Error(n < 3 ? 'blob GET HTTP 403' : 'blob GET HTTP 404'); },
  });
  const r = await fp.pull(path.join(SB, 'd-mixed'), { token: 'tok' });
  assert.equal(r.ok, false);
  assert.match(r.because, /last error: blob GET HTTP 404/);
  assert.match(r.because, /2 of them refused although/, 'two 403s then a 404 must still be reported as refusals');
});

test('#3878: the counts are the message: some unreadable and some malformed is said as both', async () => {
  let n = 0;
  fp.setTransport({
    list: async () => [1, 2, 3].map((i) => ({ url: 'https://s.blob.vercel-storage.com/' + i + '.json' })),
    get: async () => { n += 1; if (n === 1) throw new Error('blob GET HTTP 403'); return '{not json'; },
  });
  const r = await fp.pull(path.join(SB, 'd-mixed-bad'), { token: 'tok' });
  assert.equal(r.ok, false);
  assert.match(r.because, /1 report could not be read.*; 2 reports malformed/);
});

test('#3878: a refusal after the token was withheld names the host, not the token', async () => {
  const http = require('node:http');
  const api = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ blobs: [{ url: 'http://localhost:' + other.address().port + '/r.json' }], hasMore: false }));
  });
  const other = http.createServer((req, res) => { res.statusCode = 403; res.end('no'); });
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  const savedApi = process.env.AGENT_WORKFORCE_BLOB_API;
  process.env.AGENT_WORKFORCE_BLOB_API = 'http://127.0.0.1:' + api.address().port;
  try {
    fp.setTransport(null);
    const r = await fp.pull(path.join(SB, 'd-withheld'), { token: 'tok' });
    assert.equal(r.ok, false);
    assert.match(r.because, /blob GET HTTP 403, token withheld from host localhost\)/);
    assert.doesNotMatch(r.because, /refused although/, 'the token was never sent, so it must not be blamed');
  } finally {
    if (savedApi === undefined) delete process.env.AGENT_WORKFORCE_BLOB_API; else process.env.AGENT_WORKFORCE_BLOB_API = savedApi;
    await new Promise((r) => api.close(r)); await new Promise((r) => other.close(r));
  }
});

test('#3878: a partial pull keeps its refusal count in the summary', () => {
  assert.deepEqual(fp.summaryLines({ written: 1, skipped: 3, unreadable: 3, denied: 2, lastGetError: 'blob GET HTTP 404', dir: '/d' }),
    ['pulled 1 report(s) (3 skipped) to /d', '3 reports could not be read, 2 of them refused although the token was sent (the read path may need a different URL or auth form) (last error: blob GET HTTP 404)']);
});

test('#3878: reports listed from a PUBLIC blob store carry the conditional public-store note', async () => {
  fp.setTransport({
    list: async () => [{ url: 'https://abc.public.blob.vercel-storage.com/feedback/a.json' }],
    get: async () => JSON.stringify(REC('inst-pub', '2026-09-26', 'old store')),
  });
  const r = await fp.pull(path.join(SB, 'd-public'), { token: 'tok' });
  assert.equal(r.ok, true);
  assert.equal(r.fromPublicStore, true);
  assert.match(fp.summaryLines(r).join('\n'), /listed from a PUBLIC blob store\. That is expected until.*migration.*refile vercel-blob-feedback/);
  // Control: the private store's host carries no such note.
  fp.setTransport({
    list: async () => [{ url: 'https://abc.private.blob.vercel-storage.com/feedback/a.json' }],
    get: async () => JSON.stringify(REC('inst-priv', '2026-09-26', 'new store')),
  });
  const r2 = await fp.pull(path.join(SB, 'd-private'), { token: 'tok' });
  assert.equal(r2.fromPublicStore, false);
  assert.doesNotMatch(fp.summaryLines(r2).join('\n'), /PUBLIC/);
});

test('#3878: a pull that FAILS on a public-store listing still carries the public-store note', async () => {
  fp.setTransport({
    list: async () => [{ url: 'https://abc.public.blob.vercel-storage.com/feedback/a.json' }],
    get: async () => { throw new Error('blob GET HTTP 404'); },
  });
  const r = await fp.pull(path.join(SB, 'd-public-fail'), { token: 'tok' });
  assert.equal(r.ok, false);
  assert.equal(r.fromPublicStore, true);
  assert.match(r.because, /listed from a PUBLIC blob store.*refile vercel-blob-feedback/);
});

test('#3878: an empty listing says so and points at the token, a non-empty one does not', () => {
  assert.match(fp.summaryLines({ written: 0, skipped: 0, total: 0, dir: '/d' }).join('\n'), /no reports were listed.*vercel-blob-feedback/);
  assert.doesNotMatch(fp.summaryLines({ written: 2, skipped: 0, total: 2, dir: '/d' }).join('\n'), /no reports were listed/);
});

test('#3878: the public-store flag is anchored to the blob host, not any ".public." host', async () => {
  fp.setTransport({
    list: async () => [{ url: 'https://x.public.example.com/feedback/a.json' }],
    get: async () => JSON.stringify(REC('inst-x', '2026-09-26', 'x')),
  });
  const r = await fp.pull(path.join(SB, 'd-notblob'), { token: 'tok' });
  assert.equal(r.fromPublicStore, false);
});

test('#3878: the failure message and the success summary say "could not be read" with the same words', async () => {
  fp.setTransport({
    list: async () => [{ url: 'https://s.private.blob.vercel-storage.com/a.json' }],
    get: async () => { throw new Error('blob GET HTTP 403'); },
  });
  const failed = await fp.pull(path.join(SB, 'd-same-words'), { token: 'tok' });
  const clause = fp.summaryLines({ written: 0, skipped: 1, total: 1, unreadable: 1, denied: 1, lastGetError: 'blob GET HTTP 403', dir: '/d' })[1];
  assert.ok(failed.because.includes(clause), 'the failure message words the clause differently:\n' + failed.because + '\n' + clause);
});

test('#3878: a report GET that redirects to another origin does not carry the token there', async () => {
  const http = require('node:http');
  const seenAtB = [];
  const b = http.createServer((req, res) => { seenAtB.push(req.headers.authorization || ''); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(REC('inst-r', '2026-09-26', 'r'))); });
  await new Promise((r) => b.listen(0, '127.0.0.1', r));
  const a = http.createServer((req, res) => {
    if (req.url.startsWith('/?prefix=')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ blobs: [{ url: 'http://127.0.0.1:' + a.address().port + '/r.json' }], hasMore: false })); return; }
    res.statusCode = 302; res.setHeader('location', 'http://localhost:' + b.address().port + '/r.json'); res.end();
  });
  await new Promise((r) => a.listen(0, '127.0.0.1', r));
  const savedApi = process.env.AGENT_WORKFORCE_BLOB_API;
  process.env.AGENT_WORKFORCE_BLOB_API = 'http://127.0.0.1:' + a.address().port;
  try {
    fp.setTransport(null);
    const r = await fp.pull(path.join(SB, 'd-redirect'), { token: 'tok-redirect' });
    assert.equal(r.written, 1, 'the redirected report is still fetched');
    assert.deepEqual(seenAtB, [''], 'the token followed a cross-origin redirect');
  } finally {
    if (savedApi === undefined) delete process.env.AGENT_WORKFORCE_BLOB_API; else process.env.AGENT_WORKFORCE_BLOB_API = savedApi;
    await new Promise((r) => a.close(r)); await new Promise((r) => b.close(r));
  }
});

test('#3906: a pull whose every listed report is malformed is NOT ok, and says so', async () => {
  fp.setTransport({
    list: async () => [{ url: 'https://s.private.blob.vercel-storage.com/a.json' }, { url: 'https://s.private.blob.vercel-storage.com/b.json' }],
    get: async () => '{not json',
  });
  const r = await fp.pull(path.join(SB, 'd-all-bad'), { token: 'tok' });
  assert.equal(r.ok, false);
  assert.equal(r.written, 0);
  assert.match(r.because, /the store listed 2 reports and none was pulled: 2 reports malformed \(not a valid report, or no url\)\./);
  assert.doesNotMatch(r.because, /could not be read/, 'nothing was unreadable here');
  // A listing entry with no string url is counted the same way.
  fp.setTransport({ list: async () => [{ pathname: 'feedback/x.json' }], get: async () => { throw new Error('should not GET'); } });
  const r2 = await fp.pull(path.join(SB, 'd-no-url'), { token: 'tok' });
  assert.equal(r2.ok, false);
  assert.match(r2.because, /1 report malformed/);
  assert.doesNotMatch(r2.because, /could not be read/);
  // Controls: one good report among bad ones is still a (partial) success; nothing listed is not a failure.
  let n = 0;
  fp.setTransport({
    list: async () => [1, 2].map((i) => ({ url: 'https://s.private.blob.vercel-storage.com/' + i + '.json' })),
    get: async () => { n += 1; return n === 1 ? '{not json' : JSON.stringify(REC('inst-ok', '2026-09-26', 'ok')); },
  });
  const good = await fp.pull(path.join(SB, 'd-one-good'), { token: 'tok' });
  assert.equal(good.ok, true);
  assert.equal(good.written, 1);
  assert.equal(good.skipped, 1);
  fp.setTransport({ list: async () => [], get: async () => '' });
  assert.equal((await fp.pull(path.join(SB, 'd-empty'), { token: 'tok' })).ok, true);
});

test('#3906: reports read fine but not saved here are said as a local write failure, with the error', async () => {
  const dir = path.join(SB, 'd-cannot-write');
  fs.mkdirSync(dir, { recursive: true });
  // A directory where the report file (and its .tmp) would go: the write throws.
  const name = fp.fileName(REC('inst-w', '2026-09-26', 'w'));
  fs.mkdirSync(path.join(dir, name + '.tmp'), { recursive: true });
  fp.setTransport({
    list: async () => [{ url: 'https://s.private.blob.vercel-storage.com/w.json' }],
    get: async () => JSON.stringify(REC('inst-w', '2026-09-26', 'w')),
  });
  const r = await fp.pull(dir, { token: 'tok' });
  assert.equal(r.ok, false);
  assert.match(r.because, new RegExp('1 report could not be saved in ' + dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\(last error: '));
  assert.doesNotMatch(r.because, /malformed/, 'a local write failure must not be blamed on the record');
});

test('#3906: a partial pull says how many reports could not be saved here, with the error, in the same words as a failure', async () => {
  const dir = path.join(SB, 'd-partial-write');
  fs.mkdirSync(dir, { recursive: true });
  const bad = REC('inst-bad', '2026-09-26', 'b');
  fs.mkdirSync(path.join(dir, fp.fileName(bad) + '.tmp'), { recursive: true });
  const recs = { 'a.json': REC('inst-good', '2026-09-26', 'g'), 'b.json': bad };
  fp.setTransport({
    list: async () => Object.keys(recs).map((k) => ({ url: 'https://s.private.blob.vercel-storage.com/' + k })),
    get: async (u) => JSON.stringify(recs[u.split('/').pop()]),
  });
  const r = await fp.pull(dir, { token: 'tok' });
  assert.equal(r.ok, true);
  assert.equal(r.written, 1);
  assert.equal(r.unwritten, 1);
  assert.ok(r.lastWriteError, 'the write error was dropped');
  const lines = fp.summaryLines(r);
  assert.ok(lines.some((l) => l.startsWith('1 report could not be saved in ' + dir + ' (last error: ')), lines.join('\n'));
});

test('#3906: unreadable, unsaved and malformed together are each counted once', async () => {
  const dir = path.join(SB, 'd-three-ways');
  fs.mkdirSync(dir, { recursive: true });
  const unsaved = REC('inst-u', '2026-09-26', 'u');
  fs.mkdirSync(path.join(dir, fp.fileName(unsaved) + '.tmp'), { recursive: true });
  fp.setTransport({
    list: async () => ['r', 'u', 'm'].map((k) => ({ url: 'https://s.private.blob.vercel-storage.com/' + k + '.json' })),
    get: async (url) => {
      if (url.endsWith('/r.json')) throw new Error('blob GET HTTP 500');
      if (url.endsWith('/u.json')) return JSON.stringify(unsaved);
      return '{not json';
    },
  });
  const r = await fp.pull(dir, { token: 'tok' });
  assert.equal(r.ok, false);
  assert.match(r.because, /none was pulled: 1 report could not be read \(last error: blob GET HTTP 500\); 1 report could not be saved in .* \(last error: .*\); 1 report malformed \(not a valid report, or no url\)\./);
  assert.deepEqual([r.unreadable, r.unwritten, r.malformed, r.skipped], [1, 1, 1, 3]);
});

test('#3906: every skip is explained on a partial pull too, and both pull results carry the count fields', async () => {
  fp.setTransport({
    list: async () => ['g', 'm'].map((k) => ({ url: 'https://s.private.blob.vercel-storage.com/' + k + '.json' })),
    get: async (u) => (u.endsWith('/g.json') ? JSON.stringify(REC('inst-g', '2026-09-26', 'g')) : '{not json'),
  });
  const ok = await fp.pull(path.join(SB, 'd-partial-bad'), { token: 'tok' });
  assert.equal(ok.ok, true);
  assert.equal(ok.malformed, 1);
  assert.ok(fp.summaryLines(ok).includes('1 report malformed (not a valid report, or no url)'), fp.summaryLines(ok).join('\n'));
  fp.setTransport({ list: async () => [{ url: 'https://s.private.blob.vercel-storage.com/m.json' }], get: async () => '{not json' });
  const failed = await fp.pull(path.join(SB, 'd-all-bad-2'), { token: 'tok' });
  for (const k of ['written', 'skipped', 'unreadable', 'unwritten', 'malformed', 'total', 'dir']) {
    assert.ok(k in failed && k in ok, 'field ' + k + ' is missing from one of the results');
  }
});

test('#3906: the public-store note is a fact about the listing: it follows fromPublicStore on every path', async () => {
  const dir = path.join(SB, 'd-public-unsaved');
  fs.mkdirSync(dir, { recursive: true });
  const rec = REC('inst-pu', '2026-09-26', 'pu');
  fs.mkdirSync(path.join(dir, fp.fileName(rec) + '.tmp'), { recursive: true });
  fp.setTransport({ list: async () => [{ url: 'https://abc.public.blob.vercel-storage.com/feedback/pu.json' }], get: async () => JSON.stringify(rec) });
  const failed = await fp.pull(dir, { token: 'tok' });
  assert.equal(failed.ok, false);
  assert.match(failed.because, /PUBLIC blob store\. That is expected until/);
  fp.setTransport({ list: async () => [{ url: 'https://abc.public.blob.vercel-storage.com/feedback/c.json' }], get: async () => JSON.stringify(REC('inst-pc', '2026-09-26', 'pc')) });
  assert.match(fp.summaryLines(await fp.pull(path.join(SB, 'd-public-clean'), { token: 'tok' })).join('\n'), /PUBLIC blob store/);
  // Control: a private listing never carries it.
  fp.setTransport({ list: async () => [{ url: 'https://abc.private.blob.vercel-storage.com/feedback/p.json' }], get: async () => '{not json' });
  assert.doesNotMatch((await fp.pull(path.join(SB, 'd-private-bad'), { token: 'tok' })).because, /PUBLIC/);
});


test('#3906: a save whose rename fails removes the .tmp it wrote', async () => {
  const dir = path.join(SB, 'd-rename-fails');
  const rec = REC('inst-rn', '2026-09-26', 'rn');
  const dest = path.join(dir, fp.fileName(rec));
  fs.mkdirSync(path.join(dest, 'occupied'), { recursive: true });   // a non-empty directory at the destination
  fp.setTransport({ list: async () => [{ url: 'https://s.private.blob.vercel-storage.com/rn.json' }], get: async () => JSON.stringify(rec) });
  const r = await fp.pull(dir, { token: 'tok' });
  assert.equal(r.ok, false);
  assert.equal(r.unwritten, 1);
  assert.equal(fs.existsSync(dest + '.tmp'), false, 'the .tmp this pull wrote was left behind');
});
