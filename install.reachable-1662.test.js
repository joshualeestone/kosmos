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
const zlib = require('node:zlib');
const run = promisify(execFile);

const SETUP = path.join(__dirname, 'install', 'setup.sh');
const SRC = fs.readFileSync(SETUP, 'utf8');

/* Extraction, asserted rather than assumed: if the shape moves, this test must
   FAIL loudly, never quietly measure nothing. */
/* Tolerates comment lines between the two functions. An earlier version
   required a bare blank line there, and adding a doc comment above
   `reachable()` broke the match -- which the assertion below caught
   immediately, reporting 0 arms rather than silently measuring nothing.
   That is the behaviour that arm exists for, so it is kept strict. */
const BLOCK_RE = /_reachable_is_download\(\)\s*\{[\s\S]*?\n\}\n(?:[ \t]*#[^\n]*\n|[ \t]*\n)*reachable\(\)\s*\{[\s\S]*?\n\}\n/;
const FN = SRC.match(BLOCK_RE);

const BIGBODY = require('node:crypto').randomBytes(4 * 1024 * 1024);
/* Keyed BY PATH rather than a single counter, so an arm reading /bigrange's
   bytes cannot pick up /nolen's. */
const BYTES_SENT = {};
/* {path, method, ranged} per request, so an arm can assert HOW it was probed
   and not just the verdict. Reset in place by the arms that use it. Both this
   and BYTES_SENT assume arms in a file run one at a time, which is node:test's
   default; an earlier comment here claimed per-path keying defended against
   concurrency, which it does not, because SEEN is reset globally two arms
   below. If this file is ever made concurrent, both need scoping, not one. */
const SEEN = [];
const GZ = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const ERR = Buffer.from('<!doctype html><html><body>Not here</body></html>');

let server; let base;

test.before(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const ranged = Boolean(req.headers.range);
    /* Recorded so an arm can assert HOW a URL was probed, not only the
       verdict: the HEAD-vs-GET split and the Range header are the only
       evidence that the fast path and the one-byte fallback are real. */
    SEEN.push({ path: u.pathname, method: req.method, ranged });
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
    /* >1MB, incompressible, so it genuinely exceeds --max-filesize. A first
       attempt used gzip of repeated bytes, which compressed to 5KB and sailed
       under the cap: the fixture measured nothing. */
    /* HEAD answers DEFINITIVELY (404) and the ranged GET then DROPS the
       connection. Reproduces the dead-store defect: the second probe used to
       overwrite the first probe's status, so the 404 the server plainly gave us
       was discarded and the caller blamed the user's network. */
    if (u.pathname === '/headanswers-rangedrops.tar.gz') {
      if (req.method === 'HEAD') { res.writeHead(404, { 'content-length': '0' }); return res.end(); }
      return req.socket.destroy();
    }
    const bigGzip = u.pathname === '/bigrange.tar.gz';
    const bigHtml = u.pathname === '/bightml.tar.gz';
    /* Same shape as bigGzip but with NO content-length, so node sends it
       chunked. This is the response shape --max-filesize is documented NOT to
       act on: the macOS manpage says "the transfer does not start", i.e. the
       decision is made from an ANNOUNCED size. Without one there is nothing to
       decide from. Kept as its own path so an arm can measure what actually
       happens rather than leaving the comment to assert it. */
    const bigNoLen = u.pathname === '/nolen.tar.gz';
    if (bigGzip || bigHtml || bigNoLen) {
      if (req.method === 'HEAD') { res.writeHead(405, { 'content-length': '0' }); return res.end(); }
      // NOTE: Range deliberately IGNORED, which is the shape under test.
      const type = bigHtml ? 'text/html; charset=utf-8' : 'application/gzip';
      const hdrs = { 'content-type': type };
      if (!bigNoLen) hdrs['content-length'] = String(BIGBODY.length);
      res.writeHead(200, hdrs);
      /* Written in chunks and COUNTED, so an arm can assert the cap actually
         stopped the transfer. Sending it in one `res.end()` would tell us
         nothing: the point is how much crossed the wire before curl gave up. */
      /* Three arms exist to make curl hang up mid-transfer, so a write can land
         after the peer resets. Without this the response emits an unhandled
         'error' and the fixture crashes intermittently in exactly the arms whose
         job is being hung up on. */
      res.on('error', () => {});
      let off = 0;
      const CHUNK = 64 * 1024;
      const pump = () => {
        while (off < BIGBODY.length) {
          if (res.destroyed || res.writableEnded) return;
          const end = Math.min(off + CHUNK, BIGBODY.length);
          const ok = res.write(BIGBODY.subarray(off, end));
          off = end;
          BYTES_SENT[u.pathname] = off;
          if (!ok) { res.once('drain', pump); return; }
        }
        res.end();
      };
      pump();
      return;
    }
    /* A 404 carrying a BINARY type. Every other error fixture here is
       text/html, which lets the type rule mask curl's `-f`: this one separates
       them, because without -f curl succeeds on a 404 and the gzip type would
       then be accepted. */
    if (u.pathname === '/gzip404.tar.gz') {
      const b = ranged ? GZ.subarray(0, 1) : GZ;
      const h = { 'content-type': 'application/gzip', 'content-length': String(b.length) };
      if (ranged) h['content-range'] = `bytes 0-0/${GZ.length}`;
      res.writeHead(404, h);
      return res.end(req.method === 'HEAD' ? undefined : b);
    }
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
    /* `headct=` lets HEAD and the ranged GET report DIFFERENT types. Without
       it the fixture cannot distinguish the second-opinion behaviour at all:
       one type for both probes means a mutant that refuses as soon as HEAD
       succeeds gives identical verdicts on every other arm. */
    const headWant = u.searchParams.get('headct');
    const baseType = isReal ? (want || 'application/gzip') : 'text/html; charset=utf-8';
    const type = (req.method === 'HEAD' && headWant) ? headWant : baseType;
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
  /* 🛑 `set -euo pipefail`, BECAUSE THE SHIPPED FILE RUNS UNDER IT
     (the shipped file's `set -euo pipefail`). Without these options the harness cannot see a
     whole class of defect: an unprotected `x=$(cmd)` inside reachable()
     aborts the shell under -e before the range-GET fallback runs, and a
     no-options harness reports a cheerful YES. That is exactly how a real
     latent break reached iteration 3 of this branch's review. */
  const script = `set -euo pipefail\n${FN[0]}\nif reachable "$1"; then echo YES; else echo NO; fi\n`;
  /* `sh`, not `bash`: install/setup.sh ships #!/bin/sh and the repo's own
     test:shell checks it with `sh -n`. Pinning the text under the wrong
     interpreter would pass on a bashism the shipped installer cannot run.
     ⚠️ The fidelity stops there: on macOS /bin/sh is bash in POSIX mode, so a
     bashism that dash would reject still passes here. This closes the obvious
     gap, not every one. */
  const { stdout } = await run('sh', ['-c', script, 'sh', url], { encoding: 'utf8' });
  return stdout.trim();
}

/* 🛑 THE HELPER ABOVE COLLAPSES 1 AND 2, WHICH IS THE WHOLE POINT OF THIS ONE.
   `if reachable; then YES else NO` cannot see the difference between "could not
   connect" and "answered but served no download", and the GUARD arms stub
   reachable() to a chosen verdict. So both halves were tested against
   themselves and never joined: deleting the status-2 lines from setup.sh left
   every arm in this file green while making the new sentence unreachable. That
   is exactly the dead-code defect this card exists to remove, one layer up. */
async function reachableStatus(url) {
  const script = `set -euo pipefail\n${FN[0]}\nrc=0; reachable "$1" || rc=$?; echo "$rc"\n`;
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

/* The arm above is a must-PASS, and this file's own thesis is that a must-FAIL
   is the only thing that proves an instrument works. Without one, "file:// is
   reachable" is equally consistent with a predicate that says YES to
   everything. tools/test-install.sh drives the entire release path over
   file://, and the refusal paths in that gate are exactly what this branch
   makes live for the first time, so the NO direction is the one that matters
   there. Measured: curl -fsIL on a missing file:// path returns rc 37. */
test('#1662: a MISSING file:// path is refused, so the file:// arm has a failing case', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1662-file-none-'));
  try {
    const missing = path.join(dir, 'not-here.tar.gz');
    assert.equal(await reachable(`file://${missing}`), 'NO',
      'a nonexistent file:// path must be refused. If this is YES the file:// arm above proves '
      + 'nothing, because the predicate would be saying YES regardless of whether the artifact '
      + 'exists, and tools/test-install.sh would march on into a download that cannot succeed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* ---- JOINING THE TWO HALVES ------------------------------------------------
 * Everything else either collapses the status (the YES/NO harness) or invents
 * it (the guard harness stubs reachable). These arms run the REAL predicate and
 * read the REAL number, so the sentence-picking above is connected to something
 * that actually produces the value it switches on. */
test('#1662: the REAL reachable() returns 2 when the server answered but sent no download', async () => {
  assert.equal(await reachableStatus(`${base}/html200`), '2',
    'an origin that answers 200 with HTML must yield status 2. If this is 1, every guard prints '
    + '"Check your internet connection" for a server that answered perfectly well, and the '
    + 'status-2 sentence is dead code that only the stubbed guard arms can reach.');
});

test('#1662: the REAL reachable() returns 2 for a hard 404, not just for a 2xx error page', async () => {
  /* The site this installer ships against answers its own 404 with a 206 and an
     HTML body, so rc is 0 there and status 2 was reached by luck of that
     origin's shape. S3, R2 and GitHub Releases return a HARD 404, where -f
     makes curl exit non-zero despite the request completing. Measured on a
     GitHub Releases 404: exit 56, http_code 404. That is the MOST common
     half-published-artifact signature and it was falling through to status 1. */
  assert.equal(await reachableStatus(`${base}/gzip404.tar.gz`), '2',
    'a hard 404 must be status 2: the server answered and told us the artifact is not there. '
    + 'If this is 1 the user is told to check a connection that is working.');
});

test('#1662: an answer seen by HEAD survives a range GET that never completes', async () => {
  /* The two probes each produced a status and the second overwrote the first.
     So a definite 404 from HEAD, followed by a dropped range connection, left
     code 000 and non-zero rc: status 1, and the user was told to check a
     connection about a server that had answered. The fact is now accumulated
     rather than replaced. */
  assert.equal(await reachableStatus(`${base}/headanswers-rangedrops.tar.gz`), '2',
    'HEAD got a 404, so the server answered and the artifact is absent. If this is 1, one probe '
    + 'failing to complete erases what the other probe already established, and the caller prints '
    + 'the network sentence about a reachable server.');
});

test('#1662: the REAL reachable() returns 1 when nothing answered at all', async () => {
  /* Port 1 on loopback: nothing listens, so the request never completes and
     there is no http_code to read. This is the arm that keeps the 4xx rule
     above from swallowing the genuine no-connection case. */
  assert.equal(await reachableStatus('http://127.0.0.1:1/kosmos-arm64.tar.gz'), '1',
    'a refused connection must stay status 1. If this is 2 the connection advice is unreachable '
    + 'and every network failure is blamed on the release.');
});

test('#1662: the REAL reachable() returns 0 for a genuine download, so 0/1/2 are all pinned', async () => {
  assert.equal(await reachableStatus(`${base}/real.tar.gz`), '0',
    'CONTROL: a real gzip must be status 0. Without this the three arms above are consistent '
    + 'with a predicate that never says yes.');
});

test('#1662: content-type matching is case-insensitive, per RFC 9110 section 8.3', async () => {
  /* 🛑 THE ARM MUST BE A CAPITALISED **TEXTUAL** TYPE BEING REFUSED. An earlier
     version asserted `Application/GZIP` -> YES, which is decoration: unknown
     types are accepted anyway, so that arm passed with the lowercasing
     REMOVED. Measured: deleting the `tr` left all 8 tests green, while
     `Text/HTML` flipped NO -> YES. This is the direction that discriminates. */
  assert.equal(await reachable(`${base}/real.tar.gz?ct=Text%2FHTML%3B%20charset%3Dutf-8`), 'NO',
    'a capitalised text/html was accepted: the media-type compare is not case-insensitive, '
    + 'so an error page can impersonate a download just by capitalising its header');
  assert.equal(await reachable(`${base}/real.tar.gz?ct=Application%2FGZIP`), 'YES',
    'a genuine tarball was refused because its header was capitalised');
});

test('#1662: a host that cannot be reached at all is refused, and NOT via the type rule', async () => {
  /* 🛑 THE CURL EXIT STATUS IS A SEPARATE RULE AND IT WAS UNCOVERED. Measured:
     deleting `[ "$1" = 0 ] || return 1` left all 8 tests green, because every
     other failing arm in this fixture also carries text/html, so the type rule
     covered for it. But behaviour genuinely changed: against a closed port the
     shipped predicate answered NO and the mutant answered YES.
     This is the no-network case the installer's "Check your internet
     connection" sentence is written for, so it must have an arm of its own.
     Port 1 refuses instantly; there is no server to wait for. */
  assert.equal(await reachable('http://127.0.0.1:1/kosmos-arm64.tar.gz'), 'NO',
    'an unreachable host was called reachable: the exit-status rule is gone, and the '
    + 'installer would proceed to a download that cannot happen');
});

test('#1662: text/plain is ACCEPTED, because it is nginx default_type for an unmapped extension', async () => {
  /* The refusal is `text/html`, not `text/*`, on purpose. A mirror that has
     not mapped .gz serves a genuine tarball as text/plain, and refusing it
     would block that install behind "Check your internet connection" -- the
     exact false NO this design exists to avoid. KOSMOS_RELEASE_BASE is
     overridable, so a mirror is a real case. */
  assert.equal(await reachable(`${base}/real.tar.gz?ct=text%2Fplain`), 'YES',
    'a genuine tarball served as text/plain was refused, which blocks installs from any '
    + 'origin that has not mapped the .gz extension');
});

/* `application/*+xml` was refused only in the +json direction until iteration 16.
   A structured-syntax-suffix type is textual by construction and is never a
   tarball, so refusing it is the same call as refusing +json; leaving one in and
   the other out was an inconsistency, not a decision. */
test('#1662: a +xml suffix type is refused, matching the +json arm', async () => {
  assert.equal(await reachable(`${base}/real.tar.gz?ct=application%2Frss%2Bxml`), 'NO',
    'application/rss+xml is textual and must be refused, exactly as application/*+json is');
  assert.equal(await reachable(`${base}/real.tar.gz?ct=application%2Fgzip`), 'YES',
    'CONTROL: the same fixture with a real gzip type must still be YES, or this arm is refusing everything');
});

test('#1662: a download with NO content-type header at all is accepted', async () => {
  /* Refusing here would be a false NO, which blocks an install. The status
     check already rejects a connection that failed. */
  const r = await reachable(`${base}/real.tar.gz?ct=none`);
  assert.equal(r, 'YES', 'a real download with no content-type header was refused');
});

test('#1662: reachable() does not abort the shell under set -euo pipefail when HEAD fails', async () => {
  /* 🛑 THE ARM THE NO-OPTIONS HARNESS COULD NOT HAVE. The shipped file runs
     under `set -euo pipefail`, where a bare `_r_ct=$(curl …)` is an
     unprotected simple command: a failing HEAD probe kills the shell before
     the fallback runs. All three current callers are `if`/`&&` conditions
     where -e is suspended, so the break is LATENT, and a test that only ever
     calls reachable() inside an `if` can never surface it.
     This calls it OUTSIDE a condition, against the host the fallback exists
     for, and requires the shell to still be alive afterwards. */
  const script = `set -euo pipefail\n${FN[0]}\nreachable "$1"\necho "SURVIVED rc=$?"\n`;
  const { stdout } = await run('sh', ['-c', script, 'sh', `${base}/head405.tar.gz`], { encoding: 'utf8' });
  assert.match(stdout, /SURVIVED rc=0/,
    'the shell died inside reachable() before the range-GET fallback could run: the HEAD probe '
    + 'is an unprotected assignment under set -e, so a HEAD-refusing host aborts the installer '
    + `instead of falling through. Got: ${JSON.stringify(stdout)}`);
});

test('#1662: EVERY refused media type has an arm, not just text/html', async () => {
  /* 🛑 FIVE OF THE SIX REFUSE-ARMS HAD NO TEST. Measured: deleting
     application/xhtml, application/json, application/problem+json,
     application/xml and text/xml from the case statement left all 11 other
     tests green, because only text/html was ever asserted. This file's own
     thesis is that a check with no failing case is not a check, so the same
     standard has to apply to the list itself.
     application/problem+json (RFC 9457) is the one a JSON API returns for a
     404, which is exactly the error-page-as-download shape. */
  const refused = [
    'application/xhtml+xml',
    'application/json',
    'application/problem+json',
    'application/xml',
    'text/xml',
    'text/html; charset=utf-8',
  ];
  for (const ct of refused) {
    assert.equal(await reachable(`${base}/real.tar.gz?ct=${encodeURIComponent(ct)}`), 'NO',
      `${ct} was accepted as a download, so an error page carrying that type can impersonate one`);
  }
  /* The must-pass half, in the same arm, so a predicate that simply refused
     everything could not pass this test. */
  for (const ct of ['application/gzip', 'application/octet-stream', 'text/plain']) {
    assert.equal(await reachable(`${base}/real.tar.gz?ct=${encodeURIComponent(ct)}`), 'YES',
      `${ct} was refused, which blocks a genuine download`);
  }
});

test('#1662: a textual HEAD does not end it, the ranged GET gets a second opinion', async () => {
  /* 🛑 THE ARM THE FIXTURE COULD NOT PREVIOUSLY EXPRESS. The range-GET arm now
     runs even when HEAD SUCCEEDED with a textual type, where the pre-#1662
     code reached it only after a HEAD failure. That behaviour is deliberate
     and it has a documented cost (against an origin that ignores Range it
     pulls a whole tarball into /dev/null), so something must assert it buys
     anything at all.
     Measured before this arm existed: a mutant returning 1 as soon as the HEAD
     probe succeeded produced IDENTICAL verdicts on all nine other arms, while
     the control mutation was caught. A documented cost with nothing asserting
     the benefit is a cost paid for nothing.
     Here HEAD mis-reports text/html and the ranged GET reports gzip, which is
     a host with a broken HEAD handler serving a genuine tarball. */
  assert.equal(
    await reachable(`${base}/real.tar.gz?headct=${encodeURIComponent('text/html')}&ct=${encodeURIComponent('application/gzip')}`),
    'YES',
    'a genuine tarball was refused on the strength of a single mis-typed HEAD, so the range-GET '
    + 'second opinion is not happening and the cost it pays buys nothing');
});

test('#1662: the FIXTURE serves what each arm asked for, checked at the wire', async () => {
  /* 🛑 A CONTROL THAT SHARES THE INSTRUMENT'S BLINDNESS CERTIFIES THE WRONG
     ANSWER. Every arm in this file -- must-pass and must-fail alike -- routes
     through one server and its `ct=` / `headct=` knobs. If those knobs were
     silently ignored, several arms would still pass, for the wrong reason:
     "text/plain is accepted" would really be testing application/gzip.
     So this asserts the WIRE, not the verdict: it reads the response headers
     directly and requires the server to have served exactly what was asked.
     Without it, the whole file rests on an assumption no arm checks. */
  const probe = async (path, method) => {
    const r = await fetch(base + path, { method });
    return r.headers.get('content-type');
  };
  assert.equal(await probe('/real.tar.gz?ct=application%2Fx-tar', 'GET'), 'application/x-tar',
    'the ct= knob is ignored on GET, so every content-type arm is testing the default instead');
  assert.equal(await probe('/real.tar.gz?ct=Text%2FHTML', 'GET'), 'Text/HTML',
    'the ct= knob does not preserve case, so the case-insensitivity arm proves nothing');
  assert.equal(await probe('/real.tar.gz?ct=none', 'GET'), null,
    'ct=none still sent a content-type, so the no-header arm is testing a header');
  assert.equal(await probe('/real.tar.gz?headct=text%2Fhtml&ct=application%2Fgzip', 'HEAD'), 'text/html',
    'headct= is ignored on HEAD, so the second-opinion arm is not creating the condition it names');
  assert.equal(await probe('/real.tar.gz?headct=text%2Fhtml&ct=application%2Fgzip', 'GET'), 'application/gzip',
    'headct= leaked into the GET, so HEAD and GET are not actually disagreeing');
});

/* ---- the CALLER, not the predicate ----------------------------------------
 * Every arm above tests what reachable() DECIDES. None tested whether a caller
 * ACTS on a NO, and that is the defect this card is actually about: the guard
 * could never fire, so `info "could not reach the download at $url"` was dead
 * code and a person with a missing download got a bare curl error.
 * Three separate reviewers raised this gap; it is the trigger rather than the
 * decision, and nothing in `yarn test` covered it.
 */
/* 🛑 ALL of them, and the COUNT is asserted. There are two identical
   `if ! reachable "$url"` guards in the installer. An earlier version of this
   matched only the first, so mutating that one simply made the extraction pick
   up the second and every arm stayed green -- an arm that looked right and
   could not fail. Measured: disabling one guard left 17/17 passing. */
/* The guard shape changed in iteration 17: `if ! reachable "$url"` became a
   captured status, so each guard can pick a sentence (1 = could not connect,
   2 = answered but served no download). This regex was pinned to the OLD shape
   and went red on that change, which is the assertion doing its job rather than
   a nuisance: it is the one thing standing between a rewritten guard and arms
   that silently test a block that no longer exists. Anchored on the status
   capture, so a future rewrite reddens here too instead of extracting nothing.

   ⚠️ The END anchor is the outer block's own last statement, NOT the first `fi`.
   The guard now contains a NESTED if/else/fi to choose its sentence, and a
   non-greedy match to `fi` stopped at the INNER one: the extracted fragment was
   truncated, unbalanced, and the harness shell died producing empty output,
   which reads as "the guard said nothing" rather than "the regex is wrong". */
const GUARD_RE = /(?:local )?_r_why=0; reachable "\$url" \|\| _r_why=\$\?\n[\s\S]*?rm -rf "\$stage"; return 1\n\s*fi\n/g;
const GUARDS = SRC.match(GUARD_RE) || [];

async function runGuard(reachableVerdict, which) {
  /* The shipped guard block, with reachable() STUBBED to the verdict under
     test. Runs under the file's own shell options. */
  const script = `set -euo pipefail
info(){ printf '%s\\n' "$*"; }
reachable(){ return ${reachableVerdict}; }
stage=$(mktemp -d)
# 🛑 TRAP, because only the NO path reaches the guard's own \`rm -rf "$stage"\`.
# The YES path falls through and leaked a directory PER RUN: measured +2 each
# time, and macOS mktemp ignores TMPDIR (run-tests.sh:84 says so and it is
# true here), so the suite's per-run temp root cannot sweep them.
trap 'rm -rf "$stage"' EXIT
url='https://example.invalid/kosmos-arm64.tar.gz'
f(){
${GUARDS[which]}
  echo FELL-THROUGH
  return 0
}
# 🛑 THE FUNCTION RETURNS 1 ON THE NO PATH AND THIS RUNS UNDER set -e. Calling
# it bare aborted the shell right here, so the rc echo never executed: that line
# was dead output which read like a measurement, and the arms passed only
# because the catch below salvages stdout from the non-zero exit. Capturing the
# status keeps the shell alive and makes rc genuinely observable.
rc=0; f || rc=$?
echo "rc=$rc"
`;
  try {
    const { stdout } = await run('sh', ['-c', script], { encoding: 'utf8' });
    return stdout;
  } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
}

test('#1662: BOTH guard blocks were extracted, and the count is pinned', () => {
  assert.equal(GUARDS.length, 2,
    `expected exactly 2 \`if ! reachable "$url"\` guards in install/setup.sh, found ${GUARDS.length}. `
    + 'If a guard was added or removed, the arms below must cover it too; if extraction broke, '
    + 'they measured nothing.');
});

/* 🛑 THE TWO GUARDS MUST BE IDENTICAL, AND SUBSTRING ASSERTIONS DO NOT ENSURE
   THAT. The arms below pin particular phrases, so drift in any text they do not
   name goes unnoticed: measured, changing "Wait a few minutes and paste the
   install line again." in ONE guard left the whole suite green. I had claimed
   divergence "cannot be silent" on the strength of a perturbation that happened
   to hit an asserted phrase, which is one arm generalised to a rule.

   This is the assertion that actually covers it, and it is cheaper than
   extracting a helper: the blocks are duplicated on purpose, so require them to
   be byte-identical and any drift in either, asserted or not, reddens. */
test('#1662: the two guard blocks are byte-identical, so user-facing copy cannot drift apart', () => {
  assert.equal(GUARDS.length, 2, 'precondition: both guards must have been extracted');
  assert.equal(GUARDS[0], GUARDS[1],
    'the two reachable() guards have diverged. They are duplicated deliberately and carry two '
    + 'lines of user-facing copy each, so a copy edit applied to one and not the other ships two '
    + 'different sentences for one failure. Either fix both, or extract a helper and update this arm.');
});

test('#1662: EVERY guard makes the caller SAY SO and stop on a NO', async () => {
  for (let i = 0; i < GUARDS.length; i += 1) {
  const out = await runGuard(1, i);
  assert.match(out, /could not reach the download at https:\/\/example\.invalid/,
    `the guard fired but said nothing: the sentence written for a missing download is dead code again. Got: ${out}`);
  assert.match(out, /safe to re-run/, 'the recovery half of the sentence is missing');
  assert.doesNotMatch(out, /FELL-THROUGH/,
    `guard ${i} continued past a NO, so it would attempt a download it was just told is not there`);
  }
});

/* ---- the two failures now say different things ------------------------------
 * reachable() returns 1 for "could not connect" and 2 for "answered but served
 * no download". The second is the half-published-CDN case the first call site
 * names, and telling that user to check a working internet connection is wrong
 * advice, because re-running cannot publish a missing artifact. Before this
 * branch the guard could never fire at all, so the wrong sentence was
 * unreachable; this card is what makes it live, which is why the fix belongs
 * here rather than in a follow-up. Each arm asserts the OTHER sentence is
 * ABSENT, so an edit that collapses them back into one message reddens. */
test('#1662: a CONNECTION failure and a SERVED-ERROR failure get different sentences', async () => {
  for (let i = 0; i < GUARDS.length; i += 1) {
    const cannotConnect = await runGuard(1, i);
    assert.match(cannotConnect, /Check your internet connection/,
      `guard ${i}: a connection failure must still advise checking the connection. Got: ${cannotConnect}`);
    assert.doesNotMatch(cannotConnect, /still publishing/,
      `guard ${i}: a connection failure did not reach any server, so it must not blame the release`);

    const servedError = await runGuard(2, i);
    /* 🛑 STATUS 2 HAS TWO CAUSES AND THIS LAYER CANNOT SEPARATE THEM, so the arm
       requires BOTH to be named. A captive portal, a corporate proxy block page
       and an ISP NXDOMAIN redirect all answer 200 with text/html, which is the
       same signature as a half-published CDN. An earlier version of this arm
       asserted the network advice was ABSENT, which did not merely miss the
       portal case: it GUARANTEED the only correct sentence for those users
       could never appear. An assertion can pin a defect in place, and this one
       did. */
    assert.match(servedError, /still publishing/,
      `guard ${i}: must offer the release-still-publishing cause. Got: ${servedError}`);
    assert.match(servedError, /intercepting/,
      `guard ${i}: must ALSO offer the intercepting-network cause. A portal is indistinguishable `
      + `from a half-published CDN here, so naming one cause tells the other half of users `
      + `something false. Got: ${servedError}`);
    assert.doesNotMatch(servedError, /FELL-THROUGH/, `guard ${i} continued past a served-error NO`);
    assert.doesNotMatch(servedError, /could not reach/,
      `guard ${i}: the server DID answer, so "could not reach" contradicts the sentence printed `
      + 'immediately after it. That pair shipped together for one iteration and read as two '
      + 'different diagnoses of one failure');
    assert.match(cannotConnect, /could not reach/,
      `guard ${i}: a genuine connection failure should still say it could not reach the download`);

    /* The rc line only became observable once the harness stopped letting set -e
       abort on the failing call, so pin what it actually shows. BOTH cases
       return 1 to the guard's own caller, deliberately: reachable()'s status 2
       is consumed INSIDE the guard to choose a sentence, and install_kosmos's
       contract upstream stays the single "this failed". I first asserted rc=2
       here and it went red, which is the assertion teaching me my own change:
       the distinction is in the message, not in the return. Pinned so an edit
       that leaks 2 upstream, and changes that contract, reddens here. */
    assert.match(cannotConnect, /rc=1/, `guard ${i}: a connection failure must return 1 to the caller`);
    assert.match(servedError, /rc=1/,
      `guard ${i}: a served-error failure must ALSO return 1 upstream. The status 2 exists only to `
      + 'pick the sentence; leaking it changes what every caller of install_kosmos sees');
  }
});

test('#1662: EVERY guard falls through on a YES, so none is a wall', async () => {
  for (let i = 0; i < GUARDS.length; i += 1) {
  const out = await runGuard(0, i);
  assert.match(out, /FELL-THROUGH/, `a reachable download was blocked by its own guard. Got: ${out}`);
  assert.doesNotMatch(out, /could not reach/,
    `guard ${i} printed a failure sentence on a download that was reachable`);
  }
});

test('#1662: --max-filesize must not refuse a REAL download from a Range-ignoring origin', async () => {
  /* 🛑 THIS ARM EXISTS BECAUSE I SHIPPED THE REGRESSION IT CATCHES. The cap
     was added to bound a residual, and curl exits 63 when it trips. The first
     version let that non-zero reach the predicate, so a genuine download from
     an origin that refuses HEAD and ignores Range was REFUSED with "could not
     reach the download" - the false-NO direction this design calls the worst
     outcome. Measured then: capped NO, uncapped YES.
     A body that EXCEEDS the cap is affirmatively not a small error page, so 63
     is evidence FOR a download. */
  assert.equal(await reachable(`${base}/bigrange.tar.gz`), 'YES',
    'a genuine multi-megabyte download from a HEAD-refusing, Range-ignoring origin was refused: '
    + 'curl exit 63 (max-filesize) is being read as a failure instead of as proof of a large body');
});

test('#1662: but a LARGE textual body is still refused, so 63 is not a blanket yes', async () => {
  /* The pair to the arm above. Mapping 63 to success must hand the decision to
     the TYPE rule, not short-circuit it: curl still reports the content-type on
     63 (measured for both gzip and html). If this ever goes green-for-NO the
     cap has become an unconditional accept. */
  assert.equal(await reachable(`${base}/bightml.tar.gz`), 'NO',
    'a 2MB HTML page was accepted as a download: exit 63 is being treated as an unconditional '
    + 'yes rather than as a successful fetch whose type still has to pass');
});

test('#1662: --max-filesize actually truncates the transfer, it is not decoration', async () => {
  /* 🛑 THE CAP ITSELF HAD NO FAILING ARM. Measured: removing
     `--max-filesize 1048576` left all other tests green, because both big-body
     arms answer identically capped or uncapped. Only the COMPENSATING fix (exit
     63 mapped to success) was asserted, never the cap's own benefit.
     The fixture streams a 4MB body in 64KB chunks and counts what it wrote.

     ⚠️ THE ASSERTION IS "DID NOT SEND THE WHOLE BODY", NOT "SENT SOME". An
     earlier comment here claimed the arm proves the transfer was CUT SHORT; it
     cannot distinguish that from NEVER STARTED, because curl may abort on the
     Content-Length before a byte moves. Both are correct outcomes of the cap,
     and the amount is TCP-buffer dependent. Measured on this machine it is
     genuinely mid-transfer (196608 of 4194304 written), but pinning a lower
     bound would be pinning a buffer size. */
  BYTES_SENT['/bigrange.tar.gz'] = 0;
  assert.equal(await reachable(`${base}/bigrange.tar.gz`), 'YES',
    'precondition: the capped probe should still accept this download');
  const sent = BYTES_SENT['/bigrange.tar.gz'] || 0;
  assert.ok(sent < BIGBODY.length,
    `the probe pulled the ENTIRE ${BIGBODY.length}-byte body (${sent}), so --max-filesize did `
    + 'not stop it. Against a real 48MB tarball that is exactly the cost the cap exists to avoid.');
});

/* The arm above proves the cap fires when the origin ANNOUNCES a length. That
   is the only shape the other cap arms exercise, so on its own the suite cannot
   tell "the cap works" from "the cap works when a length is announced". macOS
   curl documents the option as acting before the transfer starts, which means
   an announced size is what it decides from; this arm pins what actually
   happens when there is none. It deliberately asserts the VERDICT strictly and
   only RECORDS the byte count, because the byte count is the part that is
   allowed to differ across curl versions (the floor OS, 13.5, ships 8.1.x). */
test('#1662: a length-less (chunked) origin still yields the right VERDICT, whatever the cap does', async () => {
  BYTES_SENT['/nolen.tar.gz'] = 0;
  assert.equal(await reachable(`${base}/nolen.tar.gz`), 'YES',
    'a genuine gzip served without content-length must still be reachable. If this is NO, the cap '
    + 'or the exit-63 mapping is refusing a real download on a chunked origin, which is the same '
    + 'class of regression as the --max-filesize BLOCKER this branch already fixed once.');
  const n = BYTES_SENT['/nolen.tar.gz'] || 0;
  assert.ok(n > 0,
    'control: the fixture must actually have sent something, or a passing verdict above proves nothing');
});

/* ---- the THIRD call site: the versioned-artifact probe -------------------
 * Raised by three separate reviewers. The two `if ! reachable "$url"` guards
 * are covered above; this one is different in kind. It is an EXISTENCE PROBE
 * selecting WHICH url to download, and a false NO here does not stop the
 * install, it falls through to the next branch. For any http/https base that
 * is the cache-BUSTED unversioned url (BUST=yes is set before install_kosmos
 * runs), so there is no stale-cache hazard to inherit; the bare unversioned
 * name is reached only for file:// bases, which have no cache. An earlier
 * version of this comment claimed the collision hazard and overstated the cost.
 * Measured before this existed: deleting `&& reachable …` from that line left
 * all 20 arms green while changing which URL gets downloaded.
 */
/* ---- the call-site POPULATION, not just the three we know about ------------
 * Every arm above pins the behaviour of a caller that already exists. None of
 * them notices a FOURTH caller added later, and the cost of that is asymmetric
 * in the direction this design calls its worst outcome: `_reachable_is_download`
 * refuses anything positively textual, so a caller pointed at a JSON or XML url
 * gets a false NO. Verified against the live origin: /dist/latest.json is served
 * `application/json; charset=utf-8`, which this predicate refuses. That is safe
 * today only because the pointer fetch uses bare curl and not reachable().
 *
 * Same idiom as one-derivation.test.js, which reads source to reach a caller
 * nobody has written yet. Comments are stripped first: two of the five textual
 * matches for `reachable "` in this file are inside comments, so counting raw
 * hits would pin the wrong number and pass for the wrong reason. */
test('#1662: reachable() has exactly three call sites, so a fourth is a deliberate act', () => {
  /* Whole-line comments AND trailing inline ones: the census counts textual
     matches, so a single `foo   # see reachable "$url"` would inflate it and
     redden this arm for a reason that has nothing to do with a new caller.
     Stripping from an unquoted ` #` to end-of-line is safe for this purpose
     because a real call site has no `#` before the call. */
  const execOnly = SRC.split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .map((l) => l.replace(/\s#.*$/, ''))
    .join('\n');
  /* NOT `reachable "` : requiring the double quote means `reachable $url` or
     `reachable ${url}` would leave the count at 3 and this arm would pass. The
     arm's entire job is noticing a caller nobody has written yet, so it must not
     assume that caller copies the quoting style of the three that exist. The
     definition line is excluded by requiring a non-brace first character. */
  const sites = execOnly.match(/(^|[^_a-zA-Z])reachable[ \t]+[^ \t{]/gm) || [];
  assert.equal(sites.length, 3,
    `expected 3 reachable() call sites, found ${sites.length}. If you ADDED one: check the url it `
    + 'probes is a DOWNLOAD, not a pointer. _reachable_is_download refuses text/html, json and xml, '
    + 'so a probe aimed at latest.json (served application/json) returns a false NO and, at an abort '
    + 'guard, blocks the install behind "Check your internet connection". If the new site is correct, '
    + 'raise this number and say why in the plan. If you REMOVED one, the arms above are now testing '
    + 'a caller that no longer exists.');
});

const PROBE_RE = /if \[ -n "\$\{TARGET_VERSION:-\}" \] && reachable[\s\S]*?\n\s*fi\n/;
const PROBE = SRC.match(PROBE_RE);

async function runProbe(reachableVerdict, opts = {}) {
  /* Same options as the shipped file and as the other harnesses here. It had
     `set -eu`, which is harmless (no pipelines) but undercuts the fidelity
     argument the other extractors make. */
  const script = `set -euo pipefail
reachable(){ return ${reachableVerdict}; }
KOSMOS_RELEASE_BASE='https://example.invalid/dist'
ARCH=arm64
TARGET_VERSION='${opts.target === undefined ? '9.9.9' : opts.target}'
BUST='${opts.bust || ''}'
url=''; shaurl=''
${PROBE[0]}
echo "url=$url"
`;
  const { stdout } = await run('sh', ['-c', script], { encoding: 'utf8' });
  return stdout.trim();
}

test('#1662: the versioned-artifact probe was extracted from the installer', () => {
  assert.ok(PROBE, 'could not extract the TARGET_VERSION probe from install/setup.sh, '
    + 'so the arms below measured nothing');
});

test('#1662: a reachable versioned artifact IS selected by name', async () => {
  const out = await runProbe(0);
  assert.match(out, /kosmos-9\.9\.9-arm64\.tar\.gz$/,
    `the versioned name was not chosen even though the probe said yes. Got: ${out}`);
});

test('#1662: an UNreachable versioned artifact falls back to the unversioned name', async () => {
  /* This is the branch the fix makes reachable for the first time: before
     #1662 the probe could never return false, so this `else` was dead. */
  const out = await runProbe(1);
  assert.match(out, /kosmos-arm64\.tar\.gz$/,
    `the fallback did not select the plain name. Got: ${out}`);
  assert.doesNotMatch(out, /9\.9\.9/,
    'the versioned name was used despite the probe saying the artifact is not there');
});

/* ---- the branch the COST ARGUMENT actually rests on --------------------------
 * The arm above runs with BUST='' , which setup.sh reaches only for file://
 * bases. Every http/https install sets BUST=yes before install_kosmos runs, so
 * the branch a false NO really falls into is the cache-BUSTED elif, and that is
 * the whole reason the comment can say a false NO here does not inherit a stale
 * cache. That claim had no assertion until now: runProbe already wired the knob
 * and no caller passed it, so the argument rested on a branch nothing exercised. */
test('#1662: on a network base a false NO falls to the CACHE-BUSTED name, not the bare one', async () => {
  const out = await runProbe(1, { bust: 'yes' });
  assert.match(out, /kosmos-arm64\.tar\.gz\?v=9\.9\.9$/,
    'a false NO on an http/https base must select the cache-busted unversioned url. If this is the '
    + 'bare name, the cost of a false NO at this probe is a STALE CACHE after all, and the comment '
    + `at setup.sh ("there is no collision to inherit") is wrong. Got: ${out}`);
});

/* The probe is `[ -n "$TARGET_VERSION" ] && reachable "..."`, and `&&` treats
   ANY non-zero as false, so status 2 must select the same url as status 1. That
   is the claim the status-2 change rests on ("no control flow moves anywhere"),
   and it was asserted nowhere: runProbe had only ever been called with 0 and 1.
   By this file's own standard a component with no exercised case is unasserted. */
test('#1662: status 2 selects the same fallback as status 1, so the new status moves no control flow', async () => {
  const two = await runProbe(2, { bust: 'yes' });
  const one = await runProbe(1, { bust: 'yes' });
  assert.equal(two, one,
    `status 2 must pick the same url as status 1. If these differ, adding the status changed which `
    + `artifact gets downloaded, which the installer comment explicitly promises it does not. `
    + `two=${two} one=${one}`);
  assert.match(two, /kosmos-arm64\.tar\.gz\?v=9\.9\.9$/, `and it must still be the cache-busted name. Got: ${two}`);
});

test('#1662: with no TARGET_VERSION the probe is skipped and the bust value is still present', async () => {
  /* TARGET_VERSION='' short-circuits the `[ -n ... ]` test, so reachable() is
     never called at all. The url must still be cache-busted, via the ${...:-$$}
     fallback, or an unversioned run would serve whatever a CDN cached. */
  const out = await runProbe(1, { bust: 'yes', target: '' });
  assert.match(out, /kosmos-arm64\.tar\.gz\?v=.+$/,
    `an unversioned run must still bust the cache. Got: ${out}`);
  assert.doesNotMatch(out, /\?v=$/, 'the bust value is empty, so the query string busts nothing');
});

/* ---- the probe COMPONENTS, each measured as uncovered before being added ---
 * Deleting the HEAD probe, removing `-r 0-0`, and removing `-f` each left
 * 23/23 green. None changes the verdict on the existing fixtures, so the
 * consequences are efficiency and robustness rather than correctness -- but
 * this file's standard is that a component with no failing case is unasserted.
 */

test('#1662: a host that answers HEAD is resolved WITHOUT a ranged GET', async () => {
  /* The HEAD probe is the fast path. Deleting it entirely left every arm green,
     because a ranged GET reaches the same verdict -- at the cost of pulling up
     to the 1MB cap on every probe. This asserts HOW it was resolved. */
  SEEN.length = 0;
  assert.equal(await reachable(`${base}/real.tar.gz`), 'YES', 'precondition');
  const mine = SEEN.filter((r) => r.path === '/real.tar.gz');
  assert.ok(mine.some((r) => r.method === 'HEAD'), 'no HEAD probe was made at all');
  assert.equal(mine.filter((r) => r.method === 'GET').length, 0,
    'a ranged GET was issued even though HEAD answered: the HEAD probe is gone, so every '
    + 'probe now pulls a body it does not need');
});

test('#1662: the fallback GET asks for ONE BYTE, not the whole artifact', async () => {
  /* `-r 0-0` is what keeps the fallback cheap. Removing it left every arm
     green because the verdict is unchanged; the cost is pulling up to the cap
     from every HEAD-refusing origin. Asserted on the wire, via the Range
     header the fixture records. */
  SEEN.length = 0;
  assert.equal(await reachable(`${base}/head405.tar.gz`), 'YES', 'precondition');
  const gets = SEEN.filter((r) => r.path === '/head405.tar.gz' && r.method === 'GET');
  assert.ok(gets.length > 0, 'no GET was made, so the fallback did not run');
  assert.ok(gets.every((r) => r.ranged),
    'the fallback GET carried no Range header, so it requests the ENTIRE artifact from every '
    + 'origin that refuses HEAD');
});

test('#1662: an error STATUS is refused even when the type looks like a download', async () => {
  /* curl's `-f` is what makes a 4xx a failure. Its contribution is invisible
     against every other fixture here, because they all carry text/html and the
     type rule refuses them anyway. A 404 carrying application/gzip separates
     the two: without -f, curl succeeds and the type rule waves it through. */
  assert.equal(await reachable(`${base}/gzip404.tar.gz`), 'NO',
    'a 404 was accepted because its content-type looked like a download: curl -f is not in '
    + 'play, so status is no longer being judged at all');
});
