'use strict';

/**
 * One pin per ruling Josh made on 2026-08-26 that had none.
 *
 * 🛑 WHY THIS FILE EXISTS, AND IT IS NOT TIDINESS. Item 6 was deleted, landed
 * (e9cb7976), and CAME BACK -- because a later branch was cut from a sha before
 * the deletion and its copy of the block won the merge. Nothing failed. The
 * suite was green either side, because no test asserted the sentence's ABSENCE,
 * and the commit log still said the work was done.
 *
 * ⭐ AN UNASSERTED RULING IS NOT SHIPPED, IT IS BORROWED. There are ~49 live
 * worktrees on this repo, so for any unguarded deletion the branch that undoes
 * it already exists. That is the mechanism behind "he keeps re-reporting things
 * we fixed": he is not misremembering, and we were not lying.
 *
 * ⚠️ THIS IS THE MERGE-TIME HALF. tools/served-markers.json is the ship-time
 * half and reads the bytes on the CDN. They catch different failures on
 * purpose: this one stops the old branch at the PR, that one catches a build
 * that never included the fix. Item 6 came back through the merge, which is the
 * gap this file closes.
 *
 * 📌 EVERY ABSENT-ASSERTION BELOW WAS NEGATIVE-CONTROLLED: the string was found
 * in git history at the commit that removed it, so the check is known to be
 * capable of failing. An absence check on a string that never existed is green
 * for ever and guards nothing, which is the more comfortable kind of nothing.
 * One candidate was dropped that way -- see the item 4 note at the bottom.
 *
 *   node --test web.ruling-guards.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync('web/index.html', 'utf8');

/* 🔑 THE SHARED STRIPPER, NOT A PRIVATE COPY. This file carried its own inline
   three-regex version until test-support/code-only.js landed on main the same
   morning. Two copies of one fact is the defect this codebase keeps paying
   for: the shared one already encodes a measurement mine did not (line
   comments only where the line BEGINS with one, because web/index.html carries
   many https:// URLs and a naive //.*$ truncates live code after every one of
   them, hiding a real occurrence and turning an absence check green for the
   worst possible reason).
   ⚠️ Swapped and then re-controlled, not swapped and assumed. All eight
   negative controls were re-run against the shared implementation. */
const { codeOnly } = require('./test-support/code-only');

/* Absence checks read stripped source; house style here is to delete copy WITH
   a comment quoting what was deleted, so a raw search can never pass. The
   present-checks below read the raw page instead: a marker you expect to SEE
   should be in the live source anyway, and stripping first would let one pass
   on nothing. */
const CODE = codeOnly(PAGE);

/* 🔑 A FLOOR ON THE POPULATION, same reasoning as check-served.js. If the read
   or the strip broke, every absence below passes for the wrong reason and the
   file reports all-clear at exactly the moment it is blind. */
test('the instrument is reading something', () => {
  assert.ok(PAGE.length > 500000, `web/index.html read back only ${PAGE.length} bytes; every absence check below would pass for the wrong reason`);
  assert.ok(CODE.length > PAGE.length * 0.10, `stripping comments left only ${CODE.length} of ${PAGE.length} bytes; the strip is broken`);
});

/* --------------------------------------------------------------------------
   Items 8, 9 and 10 -- the connect panel belongs under Claude
   -------------------------------------------------------------------------- */

/**
 * 🛑 THE ONE HE SAW THREE TIMES, AS THREE COMPLAINTS. The download progress bar
 * (8), the setup messages (9) and "Claude Max 20 is connected" (10) all
 * rendered at the BOTTOM of the provider list -- far from the row he had just
 * pressed, and below four providers he had not chosen. His words: "it is
 * showing below all of the models in the wrong spot".
 *
 * 🔑 ONE BUG, THREE SYMPTOMS: all three render into #fr-sub, so moving that one
 * container fixed all three and no JavaScript changed.
 *
 * ⚠️ WHICH IS EXACTLY WHY IT NEEDS A GUARD OF ITS OWN SHAPE. A present-marker
 * for "fr-sub" passes whether the container sits under Claude or under Mistral.
 * The ruling is about PLACEMENT, and placement is an ORDER property. Substring
 * checks cannot express it, so until this test the fix was unguarded while
 * looking guarded.
 */
test('items 8, 9, 10 -- the connect panel sits inside the Claude row, above GPT', () => {
  const at = (id) => {
    const i = PAGE.indexOf('id="' + id + '"');
    assert.ok(i > 0, `#${id} is gone from the page; the connect flow's containers moved or were renamed`);
    return i;
  };

  const claude = at('fr-llm-connect');   // Claude's own Connect button
  const gpt = at('fr-openai-connect');   // the next provider row down

  /* Everything the Claude connect flow paints into, in the order a person
     meets it. Each must fall strictly between Claude's button and GPT's. */
  for (const id of ['fr-claude-confirm', 'fr-sub', 'fr-sub-msg', 'fr-conn-say']) {
    const i = at(id);
    assert.ok(i > claude, `#${id} renders ABOVE Claude's Connect button; the panel has to follow the row it reports on`);
    assert.ok(i < gpt, `#${id} renders BELOW the GPT row -- this is Josh's items 8/9/10 exactly: "it is showing below all of the models in the wrong spot"`);
  }

  /* The order among themselves: confirm, then the panel, then its message line.
     A person meets the question before the answer. */
  assert.ok(at('fr-claude-confirm') < at('fr-sub'), 'the install confirm now renders after the panel it gates');
  assert.ok(at('fr-sub') < at('fr-sub-msg'), 'the message line now renders above the panel it belongs to');

  /* 🛑 AND THE ABSOLUTE FLOOR HE ACTUALLY COMPLAINED ABOUT. Below the last
     provider row is where all three of these lived. Naming Mistral rather than
     GPT means this still catches the regression if a provider is inserted
     between Claude and GPT some day. */
  const lastRow = PAGE.indexOf('data-pmark="mistral"');
  assert.ok(lastRow > 0, 'the last provider row moved; cannot locate the bottom of the list');
  assert.ok(at('fr-sub') < lastRow, 'the connect panel is below the last provider row again -- the exact placement Josh reported as items 8, 9 and 10');
});

/**
 * 🔑 ONE SINK, OR THE ORDER TEST ABOVE PROVES NOTHING. The placement assertion
 * is only worth having if #fr-sub is where the flow actually paints. A second
 * container would move the pixels back to the bottom of the screen while every
 * assertion above stayed green.
 *
 * ⭐ THIS IS THE ENUMERATION, NOT THE COMMENT. The block comment beside #fr-sub
 * claims all three symptoms render there. That is a claim about behaviour; the
 * writer list IS the behaviour. Counted rather than believed.
 */
test('items 8, 9, 10 -- the panel has exactly one sink, so placement is the whole story', () => {
  /* Every id the connect flow reads. Some are the static containers pinned
     above; the rest are sub-elements of the panel itself. */
  const sinks = new Set();
  const re = /getElementById\(\s*'(fr-(?:sub|conn)[a-z-]*)'\s*\)/g;
  let m;
  while ((m = re.exec(CODE)) !== null) sinks.add(m[1]);

  const staticPinned = new Set(['fr-sub', 'fr-sub-msg', 'fr-conn-say']);

  /* 🔑 THE PROPERTY, AND IT IS NOT "THE LIST I EXPECTED". Anything the flow
     paints into that is NOT one of the pinned static containers must have its
     markup BUILT INSIDE frPaintConnect -- the one function whose sink is
     #fr-sub. Built there, it is part of the panel's innerHTML and inherits the
     panel's position, so the order test above governs it too.

     ⚠️ Written as a list first, which was wrong: four legitimate sub-elements
     (the code input, its button, the URL line, the progress line) failed it
     immediately. A list asserts the membership I happened to know about on the
     morning I wrote it and turns every honest addition into a red test. The
     containment property is what actually keeps items 8/9/10 fixed, and it
     accepts a fifth sub-element without being edited. */
  const pStart = CODE.indexOf('function frPaintConnect(st) {');
  assert.ok(pStart > 0, 'frPaintConnect moved or was renamed; the panel painter is the thing this test is about');
  const pEnd = CODE.indexOf('\nfunction ', pStart + 10);
  assert.ok(pEnd > pStart, 'could not find the end of frPaintConnect');
  const painter = CODE.slice(pStart, pEnd);
  assert.match(painter, /const box = document\.getElementById\('fr-sub'\)/, "frPaintConnect no longer paints into #fr-sub, so nothing below tells you where the panel renders");

  /* 🛑 EVERY OCCURRENCE, NOT AT LEAST ONE, AND THE DIFFERENCE IS THE WHOLE
     GUARD. This read `painter.includes(id)` first. That version passed a
     negative control where a second, static <div id="fr-conn-bar"> was added
     below the last provider row: the painter still built its own copy, the
     assertion was satisfied, and the progress bar had a home at the bottom of
     the screen -- Josh's item 8, verbatim, with this test green.
     ⇒ Caught by mutating the page and re-running, not by reading the test.
     Six of seven controls fired on the first attempt; this was the seventh. */
  const outside = (id) => {
    const hits = [];
    let i = CODE.indexOf('id="' + id + '"');
    while (i > -1) { if (i < pStart || i >= pEnd) hits.push(i); i = CODE.indexOf('id="' + id + '"', i + 1); }
    return hits;
  };

  for (const id of sinks) {
    if (staticPinned.has(id)) continue;
    assert.ok(painter.includes('id="' + id + '"'),
      `#${id} is painted into by the connect flow but its markup is not built inside frPaintConnect, so #fr-sub no longer decides where it renders`);
    assert.deepEqual(outside(id), [],
      `#${id} also has markup OUTSIDE frPaintConnect, so it has a home in the DOM of its own at whatever position that home happens to be. That is items 8/9/10 coming back while the order test above stays green, because the order test can only see the containers it knows to look for`);
  }

  /* The progress bar specifically: Josh's item 8 was this element, rendering
     somewhere other than under the row he pressed. */
  assert.ok(painter.includes('id="fr-conn-bar"'), 'the download progress bar is no longer built by the panel painter');
  assert.deepEqual(outside('fr-conn-bar'), [], 'the download progress bar has static markup of its own; item 8 is back');
});

/* --------------------------------------------------------------------------
   Items 5 and 11 -- no big button until something is connected
   -------------------------------------------------------------------------- */

/**
 * The primary used to read "Connect Claude" before anything was chosen, on a
 * screen offering four providers -- a fifth way to start Claude specifically --
 * and "Continue anyway" once a connection was under way, which invites you to
 * leave before the thing you started has finished.
 */
test('items 5 and 11 -- the model step offers a skip link, not a primary button', () => {
  const paint = CODE.indexOf("frActions(null, { label: 'Skip connecting a model'");
  assert.ok(paint > 0, "the model step no longer paints a link-style skip; items 5 and 11 asked for a small text link in place of the primary");
  assert.match(CODE.slice(paint, paint + 200), /link:\s*true/, 'the skip is no longer a link -- item 5 asked for a text link, and a second primary is the thing he objected to');
  assert.ok(!/frActions\(\s*\{[^}]*label:\s*'Connect Claude'/.test(CODE), 'a "Connect Claude" primary is back on the model step (items 5 and 11)');
  /* 🛑 SCOPED TO THE PRIMARY SLOT, AND THE FIRST VERSION OF THIS LINE WAS NOT.
     A flat search for "Continue anyway" fails on two arms that are correct: the
     stuck and interrupted panels offer "Try again" as the primary and
     "Continue anyway" beside it, which is a person choosing to leave a failure
     behind rather than being invited past a download in flight. What Josh
     objected to (item 5) was "Continue anyway" as the BIG button while a
     connection was under way. frActions takes the primary first, so the slot
     is what to assert, not the words. */
  assert.ok(!/frActions\(\s*\{[^}]*label:\s*'Continue anyway'/.test(CODE),
    '"Continue anyway" is the primary button again -- item 5: no primary until a model is actually connected');
});

/* --------------------------------------------------------------------------
   Items 12 and 13 -- the copy that reported on us
   -------------------------------------------------------------------------- */

/**
 * ⚠️ NEGATIVE CONTROL FOR EVERY STRING BELOW: each was located in the diff of
 * e9cb7976 ("First-run: delete the copy that reports on us"), so each of these
 * assertions is known to be able to fail. They are pinned as the SHORTEST
 * distinctive fragment, because the surrounding sentence is assembled across
 * several string concatenations and a longer literal would never match the
 * source even while the copy was on screen.
 */
test('item 12 -- the "you can carry on either way" note stays deleted', () => {
  assert.ok(!CODE.includes('You can carry on either way'),
    'item 12 is back. Deleted in e9cb7976; it returns whenever a branch cut before that sha wins a merge, which is exactly how item 6 came back twice');
});

test('item 13 -- the remnant copy on the create-first-agent screen stays deleted', () => {
  /* The snags note. Josh named the sleep warning inside it -- "this computer
     goes to sleep after 1 minute... Let's delete that whole message" -- but the
     sleep sentence itself is a check TITLE, supplied at runtime. The container
     is the only literal, so the container is what can be pinned. */
  assert.ok(!CODE.includes('An agent made now may not run until'),
    'the outstanding-snags note is back on the create-agent screen (item 13). The sleep warning he read on his own screen renders inside it');

  /* The could-not-check note. He did not name this one; it is the same
     sentence as the one he did name, in a different costume -- it exists only
     to say we did not manage to look. Pinned so its return is a decision
     somebody makes rather than a merge nobody notices. */
  assert.ok(!CODE.includes('We did not get to look over this computer'),
    'the could-not-check note is back (item 13, by his stated rule: "If we can\'t look for agents on their computer, let\'s not indicate that")');
});

/* --------------------------------------------------------------------------
   ⚠️ ITEM 4 IS NOT HERE, AND THAT IS A FINDING RATHER THAN AN OMISSION
   --------------------------------------------------------------------------
   "Nothing to do." is deleted, correctly, from install/pkg-scripts/installing.html
   -- the .pkg installer's own page. It has NEVER been in web/index.html, so an
   assertion in this file would have been green from the day it was written and
   would have guarded nothing.

   🛑 IT CANNOT BE GUARDED AT SHIP TIME EITHER. tools/check-served.js extracts
   app/web/index.html and app/bin/kosmos-app from the tarball and reads only
   those. The installer page is not in that population, so no check we own can
   see it. That is the same shape as the tool's own `_cannot_see` note about
   native surfaces, one file wider than the note admits.

   ⇒ Left unguarded ON PURPOSE and reported, rather than pinned in the wrong
   file where it would read as covered. A green assertion in the wrong
   population is worse than a missing one: the missing one still looks missing.
   -------------------------------------------------------------------------- */
