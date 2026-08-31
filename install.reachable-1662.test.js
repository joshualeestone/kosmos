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
    const u = new URL(req.url, 'http://x');
    const ranged = Boolean(req.headers.range);
    /* Three shapes, because three different things need proving:
         /real.tar.gz   a normal download, HEAD answers
         /head405...    a host that REFUSES HEAD but serves GET. This is the
                        ONLY shape that exercises the range-GET fallback: with
                        a HEAD-answering host, reachable() returns on the HEAD
                        arm and the fallback is never reached. Measured by
                        mutation: deleting the fallback entirely left every
                        other arm in this file green.
         /html200       a 200 carrying an HTML body, which is the captive
                        portal / misconfigured host. An earlier version of this
                        file claimed to test it and did not: the path fell to
                        the default branch and was served as 404, making the
                        arm a duplicate of the cannot-exist case. */
    const isReal = u.pathname === '/real.tar.gz' || u.pathname === '/head405.tar.gz';
    const refusesHead = u.pathname === '/head405.tar.gz';
    const html200 = u.pathname === '/html200';
    if (refusesHead && req.method === 'HEAD') {
      res.writeHead(405, { 'content-length': '0', allow: 'GET' });
      return res.end();
    }
    const body = isReal ? GZ : ERR;
    /* `ct=` lets an arm choose the header without changing the body, so the
       case-insensitivity and no-header arms vary ONE thing. `ct=none` omits
       the header entirely, which is what curl reports for file:// too. */
    const want = u.searchParams.get('ct');
    const type = isReal ? (want || 'application/gzip') : 'text/html; charset=utf-8';
    const slice = ranged ? body.subarray(0, 1) : body;
    const headers = { 'content-length': String(slice.length) };
    if (!(isReal && want === 'none')) headers['content-type'] = type;
    if (ranged) headers['content-range'] = `bytes 0-0/${body.length}`;
    const code = ranged ? 206 : ((isReal || html200) ? 200 : 404);
    res.writeHead(code, headers);
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
  /* `sh`, not `bash`: install/setup.sh ships #!/bin/sh and the repo's own
     test:shell checks it with `sh -n`. Pinning the text under the wrong
     interpreter would pass on a bashism the shipped installer cannot run. */
  const { stdout } = await run('sh', ['-c', script, 'sh', url], { encoding: 'utf8' });
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

test('#1662: an HTML body served with a genuine 200 is not a download either', async () => {
  /* 🛑 THE ARM THAT DID NOT TEST WHAT IT SAID. This used to request
     `/index.html`, which the fixture served as a 404, so it was a duplicate of
     the cannot-exist case and the captive-portal shape was never covered
     anywhere in this file. `/html200` returns a real 200 with an HTML body:
     the status says yes and the content-type is the ONLY discriminator, which
     is the whole reason this guard judges the type. */
  assert.equal(await reachable(`${base}/html200`), 'NO',
    'a 200 carrying an HTML body passed as a download: status alone was trusted');
});

test('#1662: a host that REFUSES HEAD is still reachable, via the range-GET fallback', async () => {
  /* 🛑 THE ONLY ARM THAT EXERCISES THE FALLBACK, and without it the fallback
     had NO must-pass coverage at all. Measured by mutation: deleting the
     range-GET arm from install/setup.sh entirely left every other test in this
     file green, because a HEAD-answering fixture returns on the HEAD arm and
     never reaches line two. The fallback's one documented reason is a static
     origin that rejects HEAD (405) while serving GET fine, so that is the
     shape the fixture now provides. */
  assert.equal(await reachable(`${base}/head405.tar.gz`), 'YES',
    'a host that refuses HEAD was called unreachable: the range-GET fallback is not working, '
    + 'and every install from such an origin would abort');
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
const zlib = require('node:zlib');

test('#1662: a file:// URL is reachable, because the install gate drives the release path over it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1662-file-'));
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
