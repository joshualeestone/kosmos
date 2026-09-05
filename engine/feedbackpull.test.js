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
    if (recs[req.url]) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(recs[req.url])); return; }
    res.statusCode = 404; res.end('no');
  });
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
