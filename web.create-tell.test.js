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
 * 🛑 PRESENCE IS CHECKED ON CODE, NEVER ON PROSE. House style here explains a
 * decision by QUOTING what changed and who ruled it, so a control and its
 * explanation live in the same file by construction. A presence assertion over
 * the raw text would match a comment mentioning the id and report the thing as
 * present even if the real markup were gone, so the checks run over codeOnly().
 *
 * ⚠️ LINE COMMENTS ONLY WHERE THE LINE BEGINS WITH ONE, and the restriction is
 * load-bearing (Mona Lisa, measured): this page carries many `https://` URLs,
 * and a naive `//.*$` truncates live code after every one of them. That would
 * HIDE a real occurrence. Under-stripping gives a false FAIL somebody
 * investigates; over-stripping gives a false PASS nobody ever looks at.
 */
function codeOnly(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
}
const PAGE = codeOnly(RAW);

const page = require('./test-support/page');
const SCRIPT = page.scriptOf(RAW);
const lift = (name) => page.lift(SCRIPT, name);

/* The real painter run against stub elements, so what is asserted is what the
   function actually writes rather than a restatement of it. */
function paint(answer) {
  const els = {
    'create-tell': { disabled: null, checked: null },
    'create-tell-note': { textContent: null },
  };
  // eslint-disable-next-line no-new-func
  new Function('document', lift('createTellPaint') + '\ncreateTellPaint(' + JSON.stringify(answer) + ');')(
    { getElementById: (id) => els[id] });
  return { box: els['create-tell'], note: els['create-tell-note'].textContent };
}

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

test('the box is NOT checked in the markup (#258): consent is painted from a read, not hard-coded', () => {
  /* A `checked` attribute in the static markup would show a tick for the whole
     first frame, before any read has happened, on the screen where the claim is
     made - the #258 flash-of-consent defect. createTellPaint sets checked from
     the real read; the markup must start unchecked. */
  const at = PAGE.search(/id="create-tell"/);
  assert.ok(at > -1, 'the checkbox lost its id, so this test is reading nothing');
  const tag = PAGE.slice(PAGE.lastIndexOf('<', at), PAGE.indexOf('>', at) + 1);
  assert.match(tag, /^<input\b/, 'that id is no longer on an input');
  assert.ok(!/\schecked\b/.test(tag),
    'the box is hard-coded checked in the markup, claiming consent before anything has been read (#258)');
  // Positive control: the same read finds an attribute that IS present, so a
  // slice that had silently gone empty could not pass the line above.
  assert.match(tag, /type="checkbox"/, 'CONTROL: the tag this test read is not the checkbox');
});

test('the standing answer being ON leaves the box checked, usable, and silent', () => {
  const { box, note } = paint({ on: true, ok: true });
  assert.equal(box.checked, true);
  assert.equal(box.disabled, false, 'an ON setting disabled the box the person is meant to use');
  assert.equal(note, '', 'a note appeared on the state that needs no explanation');
});

test('the standing answer being OFF disables the box and says where it was answered', () => {
  const { box, note } = paint({ on: false, ok: true });
  assert.equal(box.checked, false, 'the box claimed a consent the engine will refuse');
  assert.equal(box.disabled, true, 'the box invites a click that changes nothing');
  assert.match(note, /Turned off in Settings/,
    'the row is dead and does not say why, which is worse than hiding it');
});

test('an unread setting is treated as could-not-read, never as ON (#2047)', () => {
  /* The engine refuses on `!pref.on`, and an unread preference is not on. All of
     null, a non-ok body, and a body with no boolean `on` are could-not-read, so
     each disables the box and says nothing is sent - never a confident tick. */
  for (const answer of [null, { ok: false }, {}]) {
    const { box, note } = paint(answer);
    assert.equal(box.checked, false, 'an unread setting rendered as consent: ' + JSON.stringify(answer));
    assert.equal(box.disabled, true, 'an unread setting offered a box to tick: ' + JSON.stringify(answer));
    assert.match(note, /could not read/, 'an unread setting did not say it could not be read: ' + JSON.stringify(answer));
  }
});

test('the three states say three different things (positive control on the painter)', () => {
  /* A painter that ignored its argument would satisfy every assertion above on
     whichever single answer it produced. This fails on such a painter. */
  const notes = [paint({ on: true, ok: true }).note, paint({ on: false, ok: true }).note, paint(null).note];
  assert.equal(new Set(notes).size, 3, 'two of the three states read identically: ' + JSON.stringify(notes));
});

test('refreshCreateTell guards a non-ok read (#2047), and the form re-reads on every open', () => {
  /* The create-page copy of the standing answer must be 403-SAFE: a non-ok GET
     draws could-not-read, never a confident Off. Pinned on the source so the
     guard cannot be silently deleted, matching the sibling refreshers' pins in
     notify.test.js. And openCreate must re-read on every open, or a value learned
     once goes stale on the one screen where it is acted on. */
  assert.match(lift('refreshCreateTell'), /if \(!res\.ok\)/,
    'refreshCreateTell does not guard on a non-ok read (#2047: a 403 would draw a false Off)');
  assert.match(lift('refreshCreateTell'), /createTellPaint\(null\)/,
    'refreshCreateTell no longer starts from could-not-read, so a slow fetch shows a stale claim');
  assert.match(lift('openCreate'), /refreshCreateTell\(\)/,
    'opening the create form no longer re-reads the setting');
});

test('nothing on the create page writes the standing setting', () => {
  /* Unchecking here is about this one agent. The standing answer is changed in
     Settings and nowhere else; a create-page write would turn a per-agent
     decision into a permanent one. */
  assert.doesNotMatch(lift('createTellPaint'), /fetch\(/,
    'the painter performs a request');
  assert.doesNotMatch(lift('refreshCreateTell'), /method:\s*'POST'|method:\s*"POST"/,
    'the create-page refresh writes the standing preference');
});

test('CONTROL: the stripper removes prose and keeps code', () => {
  /* Without this, codeOnly() could return '' (or the input unchanged) and every
     presence check above would pass for the wrong reason. Both directions pinned. */
  const kept = codeOnly('<!-- id="create-tell" -->\n/* id="create-tell" */\n// id="create-tell"\nconst real = "id=\\"create-tell\\"";');
  assert.doesNotMatch(kept.split('const real')[0], /create-tell/,
    'the stripper left a commented mention behind, so checks can be fooled by prose');
  assert.match(kept, /const real/, 'the stripper ate real code');
  /* And a URL survives: a naive line-comment strip would cut this in half. */
  assert.match(codeOnly('const u = "https://example.com/x"; // note'), /example\.com\/x/,
    'the strip truncated live code after a URL, which HIDES occurrences');
});
