'use strict';

/**
 * #570: the unsigned Windows package, and the ways it can go wrong silently.
 *
 *   node --test tools.build-windows-570.test.js
 *
 * 🛑 THE BUILDER HAS NEVER RUN ON WINDOWS AND NEITHER HAVE I. So these pin the
 * things that are checkable from a Mac and would otherwise be found by somebody
 * double-clicking a broken zip: what ships, what the launcher says, and whether
 * the two build scripts can drift apart.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const WIN = fs.readFileSync('tools/build-kosmos-windows.sh', 'utf8');
const MAC = fs.readFileSync('tools/build-kosmos-bundle.sh', 'utf8');

/**
 * Every repo file a builder stages.
 *
 * 🛑 IT KEYS ON THE DESTINATION, NOT THE SOURCE, and both of my earlier versions
 * were wrong in opposite directions. Anchoring on `cp ` read only the FIRST
 * source per line, so `cp "$REPO/server.js" "$REPO/package.json" ...` hid
 * `package.json` in both builders: symmetric, so the comparison still "worked"
 * while not covering a file it names. Widening to every `"$REPO/..."` then swept
 * in BUILD INPUTS the app never ships (`tools/macos-floor`,
 * `native-app/main.swift`).
 * ⇒ "What ships in the app" is a claim about the DESTINATION. A copy into
 * `$STAGE/app` ships; a read of a repo file does not.
 */
function staged(src) {
  const out = new Set();
  for (const line of src.split('\n')) {
    if (!/^\s*cp /.test(line)) continue;
    if (!/"\$STAGE\/app/.test(line)) continue;
    for (const m of line.matchAll(/"\$REPO\/([^"]+)"/g)) out.add(m[1]);
  }
  if (/for f in "\$REPO"\/engine\/\*\.js/.test(src)) out.add('engine/*.js');
  return out;
}

/**
 * Files the Mac bundle stages and the Windows one deliberately does not, each
 * with the reason it is absent rather than a pattern that hides it.
 *
 * 🛑 AN EXPLICIT LIST, NOT A REGEX, and that is the whole point. A regex like
 * `/icns|install|hook/` would have swallowed `install/setup.sh` without anybody
 * deciding anything, and `install/setup.sh` is the Mac's SELF-UPDATE path. Its
 * absence is a real limitation of the Windows build and it should cost somebody
 * a sentence, not vanish into a character class.
 */
const DELIBERATELY_MAC_ONLY = {
  'assets/Kosmos.icns': 'a macOS icon format; Windows needs .ico and there is no artwork for it yet',
  'install/kosmos-report-hook.sh': 'a bash hook for Claude Code, which this package does not install',
};
/* 🛑 THIS LIST SHRANK TWICE AND BOTH TIMES THE STALE-REASON CHECK BELOW MADE ME
   DO IT. It carried `install/kosmos` and `install/setup.sh`, which the Mac
   builder stages into `$STAGE/bin` rather than `$STAGE/app` -- so they were
   never app-staging differences at all, and a reason explaining a difference
   that does not exist is a comment that will mislead somebody.
   📌 THE FACT WORTH KEEPING FROM THE SETUP.SH ENTRY IS NOT ABOUT STAGING AND HAS
   MOVED TO THE BUILDER'S OWN HEADER: the Windows package has NO update path.
   A person updates it by downloading the zip again. */

test('🛑 the two builders stage the same app, or one platform silently ships less', () => {
  /* #731 is what this is for: the codex bridge was resolved by the engine and
     never staged, and served 0.5.23 could not create a single agent while the
     refusal blamed something else. A second builder doubles the chance of that,
     and it is the kind of gap nobody notices until a user hits it. */
  const w = staged(WIN);
  const m = staged(MAC);
  assert.ok(w.size >= 5, 'the Windows builder stages almost nothing; the scan is broken, not the build');
  assert.ok(m.size >= 5, 'the Mac builder stages almost nothing; the scan is broken, not the build');
  const missing = [...m].filter((f) => !w.has(f) && !(f in DELIBERATELY_MAC_ONLY));
  assert.deepEqual(missing, [],
    'the Mac bundle stages files the Windows one does not, and no reason is recorded for them: '
    + missing.join(', ') + '. Add each to DELIBERATELY_MAC_ONLY with WHY, or stage it.');
  /* And the reasons must still describe reality: a file that is no longer staged
     by EITHER builder should lose its entry rather than sit here explaining an
     absence nobody is choosing any more. */
  const stale = Object.keys(DELIBERATELY_MAC_ONLY).filter((f) => !m.has(f));
  assert.deepEqual(stale, [], 'these reasons explain files the Mac builder no longer stages: ' + stale.join(', '));
});

test('the port is READ from server.js, never typed into the launcher', () => {
  /* ⭐ MY FIRST VERSION TYPED 4319 BECAUSE I GUESSED. The real default is 16180,
     so the launcher would have opened a browser on a dead port while the board
     sat there working: two copies of one fact, and the copy a PERSON sees would
     have been the wrong one. */
  assert.match(WIN, /PORT_DEFAULT="\$\(sed/, 'the launcher port is not read out of server.js');
  assert.match(WIN, /could not read the board's default port/, 'an unreadable port does not fail the build');
  const typed = [...WIN.matchAll(/127\.0\.0\.1:([0-9]+)/g)].map((x) => x[1]);
  assert.deepEqual(typed, [], 'a port number is typed into the builder: ' + typed.join(', '));
});

test('every launcher line is CRLF, because cmd.exe does not forgive LF', () => {
  /* A .cmd with Unix endings gets a trailing carriage return on every token and
     the command simply does not resolve. Written on a Mac, so this is the single
     most likely thing to be wrong on first contact. */
  const printfs = [...WIN.matchAll(/printf '([^']*)'/g)].map((m) => m[1])
    .filter((x) => x.includes('\\n'));
  assert.ok(printfs.length >= 15, 'the launcher scan found almost nothing; it is broken');
  const lf = printfs.filter((x) => !x.includes('\\r\\n'));
  assert.deepEqual(lf, [], 'these launcher lines end LF rather than CRLF: ' + lf.join(' | '));
});

test('the runtime is checksum-verified and a mismatch kills the build', () => {
  /* An unsigned installer already asks somebody to click through a warning.
     Shipping an unverified runtime inside it would ask them to trust something
     we did not check ourselves. */
  assert.match(WIN, /SHASUMS256\.txt/, 'the node download is not checked against nodejs.org');
  assert.match(WIN, /checksum mismatch/, 'a mismatched runtime does not stop the build');
  assert.match(WIN, /nodejs\.org lists no checksum/, 'a MISSING checksum line passes silently, which is the same hole');
});

test('the zip contents check does not pipe into grep -q under pipefail', () => {
  /* ⭐ IT DID, AND IT REPORTED A GOOD BUILD AS BROKEN. `grep -q` exits the instant
     it matches, `unzip` is killed by SIGPIPE, and pipefail makes the pipeline's
     status the failure rather than the match. It only bit on EARLY matches, so
     it looked reliable: the entries near the end of the listing passed.
     Measured, three arms: pipefail + grep -q FAILS, without pipefail OK,
     captured first OK. */
  const at = WIN.indexOf('LISTING=');
  assert.ok(at > -1, 'the listing is no longer captured before it is searched');
  const after = WIN.slice(at);
  assert.doesNotMatch(after, /unzip -l [^\n]*\| *grep -q/,
    'the contents check pipes unzip into grep -q again, which fails on a correct package');
});

test('the package tells the truth about itself', () => {
  assert.match(WIN, /"signed": false/, 'the manifest does not record that this build is unsigned');
  assert.match(WIN, /"agents_supported": false/, 'the manifest claims agents work, which they do not');
  assert.match(WIN, /AGENTS DO NOT WORK IN THIS BUILD/, 'the README does not warn that agents are dark');
  assert.match(WIN, /Windows protected your PC/, 'the README does not warn about the unsigned warning');
});

test('🛑 the warning reaches her BEFORE the launcher does, which a README cannot', () => {
  /* The SmartScreen dialog appears on the double-click, before a single line we
     ship has run. Nothing INSIDE the package can speak at that moment. The one
     surface that exists is the folder listing, so the warning has to be in a
     FILENAME and that filename has to sort first.
     ⚠️ MY FIRST VERSION WAS `READ ME FIRST...` AND I WROTE IN THE COMMENT THAT
     IT SORTED ABOVE `Kosmos.cmd`. It does not: `K` comes before `R`. I found it
     by printing the sorted listing rather than by re-reading my own sentence. */
  assert.match(WIN, /! READ ME FIRST - Windows will warn you\.txt/,
    'the warning is not in a filename, so it cannot reach her before the dialog does');
  const names = ['! READ ME FIRST - Windows will warn you.txt', 'Kosmos.cmd', 'manifest.json', 'open-board.cmd'];
  assert.equal([...names].sort()[0], names[0],
    'the warning filename no longer sorts first, so the launcher is the first thing she sees');
  /* The dialog's only visible button is the wrong one. */
  assert.match(WIN, /Don\\047t run/, 'the README does not name the button she must NOT press');
  assert.match(WIN, /More info/, 'the README does not name the way past');
  /* Mark of the Web: a file arriving inside a downloaded zip can be blocked by
     something that is a property of HOW IT ARRIVED, not of what it contains. */
  assert.match(WIN, /came from another computer/, 'the README does not cover the blocked-file case');
  assert.match(WIN, /Unblock/, 'the README does not say how to unblock it');
});

test('an ABSOLUTE outdir lands where the caller asked, not under the repo', () => {
  /* 🛑 IT DID NOT. `"$REPO/$OUT"` with an absolute `$OUT` produced
     `/Users/.../agent-workforce//tmp/x`, created it, wrote a 36 MB zip into it,
     and PRINTED THAT PATH as if it were what you asked for.
     ⇒ Nothing failed. The artifact simply was not where the caller said, and my
     verification script looked in the requested directory, found nothing, and
     reported the bundled runtime CORRUPTED. A wrong location surfaced as a
     wrong CHECKSUM, which is as far from the cause as a symptom gets.
     ⚠️ Absolute wins and relative stays repo-relative, so `dist` is unchanged. */
  assert.match(WIN, /case "\$OUT" in/, 'the outdir is not classified, so an absolute path is joined to the repo root');
  assert.match(WIN, /\/\*\)\s*OUTDIR="\$OUT"/, 'an absolute outdir is not taken as-is');
  assert.match(WIN, /OUTDIR="\$REPO\/\$OUT"/, 'a relative outdir is no longer repo-relative, which changes every existing call');
  assert.doesNotMatch(WIN, /mkdir -p "\$REPO\/\$OUT"/, 'the old join is still there');
});

test('CONTROL: these assertions are reading the file they think they are', () => {
  /* Every test above would pass on an empty string for at least one of its
     arms. This is the arm that proves the file was read at all. */
  assert.ok(WIN.length > 4000, 'the Windows builder is suspiciously short');
  assert.ok(MAC.length > 10000, 'the Mac builder is suspiciously short');
  assert.match(WIN, /build-kosmos-windows|win-\$ARCH/, 'this is not the Windows builder');
});
