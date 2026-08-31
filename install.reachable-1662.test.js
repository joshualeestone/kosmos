'use strict';
/* #1662: the installer's reachability check must be able to say NO.
 *
 * The shipped `reachable()` accepted every URL, including names that cannot
 * exist, because its fallback asks the host for the first byte of its own 404
 * page and gets `206 text/html, 1 byte` -- a success. Measured against
 * installkosmos.com on 2026-08-31: an impossible name PASSED.
 *
 * 🛑 THE ONLY PROOF THAT MATTERS IS THE MUST-FAIL ARM. The broken version
 * passed on real files too, so a test that only checks "it finds the tarball"
 * would have been green throughout the outage. The server below therefore
 * serves its 404 page WITH RANGE SUPPORT, reproducing the exact condition,
 * and the decisive assertion is that a missing name is refused.
 *
 * The function is extracted from install/setup.sh and run under bash, so this
 * pins the SHIPPED text rather than a copy that could drift from it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

const SETUP = path.join(__dirname, 'install', 'setup.sh');
const SRC = fs.readFileSync(SETUP, 'utf8');

/* Extraction, asserted rather than assumed: if the shape moves, this test must
   FAIL loudly, never quietly measure nothing. */
const BLOCK_RE = /_reachable_is_download\(\)\s*\{[\s\S]*?\n\}\n\nreachable\(\)\s*\{[\s\S]*?\n\}\n/;
const FN = SRC.match(BLOCK_RE);

const GZ = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const ERR = Buffer.from('<!doctype html><html><body>Not here</body></html>');

let server; let base;

test.before(async () => {
  server = http.createServer((req, res) => {
    const ranged = Boolean(req.headers.range);
    const isReal = req.url.startsWith('/real.tar.gz');
    const body = isReal ? GZ : ERR;
    /* `ct=` lets an arm choose the header without changing the body, so the
       case-insensitivity and no-header arms vary ONE thing. `ct=none` omits
       the header entirely, which is what curl reports for file:// too. */
    const want = new URL(req.url, 'http://x').searchParams.get('ct');
    const type = isReal ? (want || 'application/gzip') : 'text/html; charset=utf-8';
    /* The defect's exact shape for the non-real path: the error page answers a
       range request with a 206 and one byte. A status-only check reads that as
       success. content-length and content-range MUST be set or curl waits for
       a body that never ends, and a timeout would make every arm "fail" for
       the wrong reason -- which it did on the first run of this file. */
    const slice = ranged ? body.subarray(0, 1) : body;
    const headers = { 'content-length': String(slice.length) };
    if (!(isReal && want === 'none')) headers['content-type'] = type;
    if (ranged) headers['content-range'] = `bytes 0-0/${body.length}`;
    res.writeHead(ranged ? 206 : (isReal ? 200 : 404), headers);
    if (req.method === 'HEAD') { res.end(); return; }
    res.end(slice);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server && server.close());

/* 🛑 ASYNC ON PURPOSE, AND THIS IS NOT STYLE. `execFileSync` BLOCKS THE EVENT
   LOOP, so the in-process server below can never answer the curl that is
   waiting on it: the two deadlock and every arm burns its full 15s timeout.
   Measured on the first run of this file -- three arms "passed" and one
   failed, and the passes were TIMEOUTS, not refusals. A must-fail arm that
   fails because nothing answered is not evidence of anything. */
async function reachable(url) {
  const script = `${FN[0]}\nif reachable "$1"; then echo YES; else echo NO; fi\n`;
  const { stdout } = await run('bash', ['-c', script, 'bash', url], { encoding: 'utf8' });
  return stdout.trim();
}

test('#1662: the extraction actually found the shipped function', () => {
  assert.ok(FN, 'reachable() could not be extracted from install/setup.sh, so this file measured nothing');
});

test('#1662: a download that CANNOT EXIST is refused, even though the host 206s its error page', async () => {
  assert.equal(await reachable(`${base}/zzz-cannot-exist.tar.gz`), 'NO',
    'reachable() accepted a name that cannot exist: the 404 page impersonated a download, '
    + 'and the installer\'s "could not reach the download" message is dead code again');
});

test('#1662: a real gzip download is still found (the check did not become useless)', async () => {
  assert.equal(await reachable(`${base}/real.tar.gz`), 'YES',
    'reachable() refused a genuine tarball, which would block every install');
});

test('#1662: an HTML body served with a 200 is not a download either', async () => {
  /* The 404 page wearing a success code, which is what a misconfigured host or
     a captive portal produces. Status is not the question; the type is. */
  assert.equal(await reachable(`${base}/index.html`), 'NO',
    'an HTML page passed as a download');
});

/* ---- what a blind reviewer caught, and it was nearly shipped ---------------
 * The first version of this guard demanded a KNOWN BINARY content-type. That
 * is stricter-looking and wrong, and it broke the project's own install gate:
 * `curl` on a `file://` URL succeeds and reports an EMPTY content-type, and
 * tools/test-install.sh drives the entire release path over `file://` on
 * purpose. An allowlist refuses a genuine tarball there.
 *
 * ⭐ THE COST IS ASYMMETRIC, which is the whole reason the predicate refuses
 * textual types instead of demanding binary ones: a false YES only means this
 * pre-check did not help and curl fails a few lines later with its own error,
 * which is the behaviour before the guard existed. A false NO blocks the
 * install outright behind "Check your internet connection".
 */
const os2 = require('node:os');
const zlib = require('node:zlib');

test('#1662: a file:// URL is reachable, because the install gate drives the release path over it', async () => {
  const dir = fs.mkdtempSync(path.join(os2.tmpdir(), 'aw-1662-file-'));
  try {
    const f = path.join(dir, 'real.tar.gz');
    fs.writeFileSync(f, zlib.gzipSync(Buffer.from('hello')));
    assert.equal(await reachable(`file://${f}`), 'YES',
      'a genuine gzip on file:// was refused. curl reports an EMPTY content-type for file://, '
      + 'so any predicate that DEMANDS a binary type breaks tools/test-install.sh, which drives '
      + 'the whole download path over file:// deliberately');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#1662: content-type matching is case-insensitive, per RFC 9110 section 8.3', async () => {
  const r = await reachable(`${base}/real.tar.gz?ct=Application%2FGZIP`);
  assert.equal(r, 'YES', 'a genuine tarball was refused because its header was capitalised');
});

test('#1662: a download with NO content-type header at all is accepted', async () => {
  /* Refusing here would be a false NO, which blocks an install. The status
     check already rejects a connection that failed. */
  const r = await reachable(`${base}/real.tar.gz?ct=none`);
  assert.equal(r, 'YES', 'a real download with no content-type header was refused');
});
