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
/* Tolerates comment lines between the two functions. An earlier version
   required a bare blank line there, and adding a doc comment above
   `reachable()` broke the match -- which the assertion below caught
   immediately, reporting 0 arms rather than silently measuring nothing.
   That is the behaviour that arm exists for, so it is kept strict. */
const BLOCK_RE = /_reachable_is_download\(\)\s*\{[\s\S]*?\n\}\n(?:[ \t]*#[^\n]*\n|[ \t]*\n)*reachable\(\)\s*\{[\s\S]*?\n\}\n/;
const FN = SRC.match(BLOCK_RE);

const BIGBODY = require('node:crypto').randomBytes(4 * 1024 * 1024);
const BYTES_SENT = {};
const SEEN = [];        /* {path, method, ranged} per request, so an arm can assert HOW it was probed, not just the verdict */   /* keyed BY PATH: a single counter would let one arm read another's bytes if node:test ever runs these concurrently */
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
    const bigGzip = u.pathname === '/bigrange.tar.gz';
    const bigHtml = u.pathname === '/bightml.tar.gz';
    if (bigGzip || bigHtml) {
      if (req.method === 'HEAD') { res.writeHead(405, { 'content-length': '0' }); return res.end(); }
      // NOTE: Range deliberately IGNORED, which is the shape under test.
      const type = bigGzip ? 'application/gzip' : 'text/html; charset=utf-8';
      res.writeHead(200, { 'content-type': type, 'content-length': String(BIGBODY.length) });
      /* Written in chunks and COUNTED, so an arm can assert the cap actually
         stopped the transfer. Sending it in one `res.end()` would tell us
         nothing: the point is how much crossed the wire before curl gave up. */
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
const GUARD_RE = /if ! reachable "\$url"; then\n[\s\S]*?\n\s*fi\n/g;
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
f
echo "rc=$?"
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

/* ---- the THIRD call site: the versioned-artifact probe -------------------
 * Raised by three separate reviewers. The two `if ! reachable "$url"` guards
 * are covered above; this one is different in kind. It is an EXISTENCE PROBE
 * selecting WHICH url to download, and a false NO here does not stop the
 * install, it silently falls through to the unversioned name -- the exact
 * cache-collision hazard the surrounding comment was written against.
 * Measured before this existed: deleting `&& reachable …` from that line left
 * all 20 arms green while changing which URL gets downloaded.
 */
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
