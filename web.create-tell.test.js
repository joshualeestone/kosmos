'use strict';

/**
 * 🪦 THE CREATED-PING CHECKBOX IS GONE, AND THIS FILE IS ITS MARKER.
 *
 * It used to hold seven tests about `createTellPaint` and the three states of
 * the create-screen checkbox. Josh removed the setting on 2026-08-26, item 3:
 * "the 'Let the Kosmos team know when you create an agent' - they both need to
 * be removed." Both surfaces went: the Settings row first, then this one.
 *
 * ⭐ THE FILE IS KEPT RATHER THAN DELETED so that anyone who puts the control
 * back gets a red from the file named after it, instead of a green suite and a
 * silent send. Deleting it would leave the strongest signal about this decision
 * in a commit message nobody reads.
 *
 * The real guarantee now lives in engine/ping.test.js, which asserts the
 * control's ABSENCE and that the send defaults OFF together, because absence
 * alone is only half: a removed control over a default-on send is worse than
 * what he complained about and cannot be fixed by the person.
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

test('the create-screen ping control, and its painter, are gone', () => {
  for (const gone of ['id="create-tell"', 'id="create-tell-wrap"', 'id="create-tell-note"',
    'function createTellPaint', 'refreshCreateTell']) {
    assert.equal(PAGE.includes(gone), false,
      gone + ' is back. If that is deliberate, engine/ping.js must stop defaulting the send ON in the same change.');
  }
});

test('the create screen itself is still there, so the absences above mean something', () => {
  assert.match(PAGE, /id="create-go"/);
  assert.match(PAGE, /id="create-instr"/);
});

test('and the create request no longer reads a control that does not exist', () => {
  /* The submit builder did `getElementById('create-tell').checked`. With the
     box gone that is a throw on the last click of the flow every new person
     walks, which is the worst place in the product to put one. */
  assert.doesNotMatch(PAGE, /getElementById\('create-tell'\)/);
  assert.match(PAGE, /b\.tellKosmos = false;/,
    'the create request stopped saying false explicitly, so the server default (true) takes over');
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
