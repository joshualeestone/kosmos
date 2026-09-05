'use strict';

/**
 * ✅ THE CREATED-PING CHECKBOX IS BACK, AND THIS FILE ASSERTS IT.
 *
 * It held seven tests, then became a tombstone when Josh removed the control on
 * 2026-08-26, and is restored now that he reversed that on 2026-09-05 (via
 * Splinter: "we need that back in for sure", "I've never said flip it off",
 * #2020/#2013). The file named after the control asserts the control: its
 * markup, its painter, and the create request reading it again.
 *
 * The coupling guarantee (control present AND send default ON, together) lives
 * in engine/ping.test.js. This file covers the create-page surface itself: that
 * the checkbox, its painter, and the checkbox read are all present, so a partial
 * restore that forgets one of them goes red in the file named after the control.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const RAW = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

/**
 * 🛑 ABSENCE IS CHECKED ON CODE, NEVER ON PROSE. House style here explains a
 * removal by QUOTING what was removed and who ruled it, so a deletion and its
 * own explanation live in the same file by construction. An absence assertion
 * over the raw text therefore matches the comment describing the deletion and
 * reports the thing as still present.
 *
 * ⚠️ I WROTE BOTH HALVES OF THIS THE SAME NIGHT AND ONLY ONE OF THEM STRIPPED.
 * engine/ping.test.js guards the same deletion and strips `<!-- -->`; this file
 * read the raw page. Same claim, same evening, two different levels of care.
 *
 * ⚠️ LINE COMMENTS ONLY WHERE THE LINE BEGINS WITH ONE, and the restriction is
 * load-bearing (Mona Lisa, measured): this page carries many `https://` URLs,
 * and a naive `//.*$` truncates live code after every one of them. That would
 * HIDE a real occurrence and turn an absence check green for the worst possible
 * reason. Under-stripping gives a false FAIL somebody investigates;
 * over-stripping gives a false PASS nobody ever looks at.
 */
function codeOnly(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
}
const PAGE = codeOnly(RAW);

test('the create-screen ping control, and its painter, are present', () => {
  for (const present of ['id="create-tell"', 'id="create-tell-wrap"', 'id="create-tell-note"',
    'function createTellPaint', 'refreshCreateTell']) {
    assert.ok(PAGE.includes(present),
      present + ' is missing. Restoring this control means all of its pieces: the markup, the painter, and the read.');
  }
});

test('the create screen itself is still there, so the presences above mean something', () => {
  assert.match(PAGE, /id="create-go"/);
  assert.match(PAGE, /id="create-instr"/);
});

test('and the create request reads the control, only sending false when it is unticked', () => {
  /* The submit builder reads `getElementById('create-tell').checked` and sends
     tellKosmos:false only when the box is unticked - the server defaults the
     field to true, so a ticked box (or an older client) sends. The read must be
     GUARDED by the checked test: an unconditional `b.tellKosmos = false` would
     silence the ping for everyone regardless of the box. */
  assert.match(PAGE, /getElementById\('create-tell'\)\.checked/,
    'the create request no longer reads the checkbox');
  assert.match(PAGE, /if \(!document\.getElementById\('create-tell'\)\.checked\) b\.tellKosmos = false;/,
    'tellKosmos:false is not guarded by the unticked box, so it fires unconditionally');
});

test('CONTROL: the stripper removes prose and keeps code', () => {
  /* Without this, codeOnly() could return '' (or the input unchanged) and every
     absence above would pass for the wrong reason. Both directions pinned. */
  const kept = codeOnly('<!-- id="create-tell" -->\n/* id="create-tell" */\n// id="create-tell"\nconst real = "id=\\"create-tell\\"";');
  assert.doesNotMatch(kept.split('const real')[0], /create-tell/,
    'the stripper left a commented mention behind, so absence checks can be fooled by prose');
  assert.match(kept, /const real/, 'the stripper ate real code');
  /* And a URL survives: a naive line-comment strip would cut this in half. */
  assert.match(codeOnly('const u = "https://example.com/x"; // note'), /example\.com\/x/,
    'the strip truncated live code after a URL, which HIDES occurrences');
});
