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
  // Force token() to resolve to null deterministically (independent of whether
  // this machine happens to have the target filed): no PATH and a HOME with no
  // .local/bin means neither secrets-map.sh candidate is found.
  const savedPath = process.env.PATH; const savedHome = process.env.HOME;
  process.env.PATH = ''; process.env.HOME = path.join(SB, 'empty-home');
  fp.setTransport({ list: async () => { throw new Error('should not list without a token'); }, get: async () => '' });
  try {
    const r = await fp.pull(dir, {});   // no opts.token -> resolves via token() -> null
    assert.equal(r.ok, false);
    assert.match(r.because, /token is not filed/);
    assert.equal(r.written, 0);
    assert.ok(!fs.existsSync(dir) || fs.readdirSync(dir).length === 0);
  } finally {
    process.env.PATH = savedPath; process.env.HOME = savedHome;
  }
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
