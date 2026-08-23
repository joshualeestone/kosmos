'use strict';
/**
 * The found-agents row: what it draws, and whether the handlers can find it.
 *
 * 🛑 THE FAILURE THIS IS SHAPED AROUND is a handler reaching for an element the
 * paint does not build. It has shipped here before: a wrapper was deleted, one
 * line in a click handler still read its `hidden` flag, and the page rendered
 * perfectly because the throw was on the PRESS. This list is worse than the form
 * was, because the press somebody would meet it on is Undo -- the control they
 * reach for when they think they have made a mistake.
 *
 * 🔑 SO IT ASKS THE QUESTION IN BOTH DIRECTIONS: everything the script reaches
 * for on this row must exist in what the row paints, and the row must paint the
 * undo control hidden rather than build it on success. An element that is
 * already there cannot be the element a later edit forgets to create.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scriptOf, liftAll } = require('./test-support/page');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = scriptOf(PAGE);

/** The real `frPaintFound`, run against a stub that records what it wrote. */
function paint(agents) {
  const box = { innerHTML: '' };
  const title = { textContent: '' };
  const sandbox = {
    document: { getElementById: (id) => (id === 'fr-fleet' ? box : title) },
    FR_FOUND: { ok: true, agents },
    frActions() {},
    frFinish() {},
    showTab() {},
  };
  const src = liftAll(SCRIPT, ['esc', 'frPaintFound']);
  const run = new Function('document', 'FR_FOUND', 'frActions', 'frFinish', 'showTab',
    `${src}\nfrPaintFound();`);
  run(sandbox.document, sandbox.FR_FOUND, sandbox.frActions, sandbox.frFinish, sandbox.showTab);
  return { html: box.innerHTML, title: title.textContent };
}

const ONE = [{ name: 'mike', role: 'Copywriter', dir: '/Users/x/work/mike' }];

test('the undo control is painted hidden, beside the add button', () => {
  const { html } = paint(ONE);
  assert.match(html, /class="fr-foundundo"|class="btn fr-foundundo"/,
    'the row paints no undo control, so the success arm has nothing to reveal');
  /* ⚠️ HIDDEN AT PAINT. Built visible, it would offer to undo an add nobody made. */
  const undo = html.match(/<button[^>]*fr-foundundo[^>]*>/)[0];
  assert.match(undo, /\bhidden\b/, 'the undo control is painted visible');
  /* And in the controls column, which is what puts it beside Added rather than
     under the row. */
  const act = html.match(/<span class="fr-foundact">([\s\S]*?)<\/span>\s*<p/);
  assert.ok(act, 'the row has no controls column, so the buttons are not on the right');
  assert.match(act[1], /fr-foundgo/);
  assert.match(act[1], /fr-foundundo/);
});

test('the row carries the name the undo route is called with', () => {
  const { html } = paint(ONE);
  assert.match(html, /data-found-name="mike"/,
    'the row records no name, so Undo has nothing to send');
  assert.match(html, /data-found-dir="[^"]*mike"/);
});

test('everything the script reaches for on this row is something the row paints', () => {
  /* The reference check, in the direction that actually breaks: a selector in a
     handler naming a class the paint stopped emitting. */
  const { html } = paint(ONE);
  const painted = new Set();
  for (const m of html.matchAll(/class="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) painted.add(c);
  const attrs = new Set([...html.matchAll(/\bdata-([a-z-]+)=/g)].map((m) => m[1]));

  const wanted = new Set([...SCRIPT.matchAll(/\.(fr-found[a-z0-9-]*)\b/g)].map((m) => m[1]));
  // ⚠️ THE DENOMINATOR. "All 0 selectors resolve" reads exactly like "all 6 do".
  assert.ok(wanted.size >= 4, `only ${wanted.size} row selectors found in the script; the extractor stopped matching`);
  const missing = [...wanted].filter((c) => !painted.has(c));
  assert.deepEqual(missing, [], 'the script reaches for classes this row does not paint: ' + missing.join(', '));

  /* Dataset keys are read camel-cased and written hyphenated, so the two halves
     of this one are never spelled the same and a grep for either misses. */
  const keys = new Set([...SCRIPT.matchAll(/dataset\.found([A-Za-z]+)/g)]
    .map((m) => 'found-' + m[1][0].toLowerCase() + m[1].slice(1).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())));
  assert.ok(keys.size >= 2, `only ${keys.size} dataset keys found; the extractor stopped matching`);
  /* `foundLabel` is written by the success arm rather than painted, so it is the
     one key that is legitimately absent from the markup. */
  const missingKeys = [...keys].filter((k) => k !== 'found-label' && !attrs.has(k));
  assert.deepEqual(missingKeys, [], 'the script reads row data the row does not carry: ' + missingKeys.join(', '));
});

test('CONTROL: the reference check can see a selector that is not painted', () => {
  /* A check that cannot fail is the defect it is guarding against. */
  const { html } = paint(ONE);
  const painted = new Set();
  for (const m of html.matchAll(/class="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) painted.add(c);
  assert.equal(painted.has('fr-foundnothere'), false,
    'the extractor claims a class the row never paints, so it cannot detect a missing one');
});

/* The folder-path rule (drawn only when two rows share a name) is pinned in
   server.test.js against the real first-run harness; not duplicated here. */

test('the row is painted with an empty status line', () => {
  /* Josh had the success sentence removed: the button reading "Added" is the
     receipt, and this screen is one somebody presses four buttons on. The
     element stays for the failure arm, which is the one with something a person
     must act on, and empty it takes no room.
     ⚠️ ASKED OF THE PAINT, NOT OF THE SCRIPT'S TEXT. A check for the deleted
     sentence would match the comment recording why it went, which is the trap
     this file has hit before. */
  const { html } = paint(ONE);
  assert.match(html, /class="fr-foundsaid"[^>]*><\/p>/, 'the status line is painted with words in it');
});
