'use strict';

/**
 * #2570 on the page: the SECOND confirm.
 *
 * The route half is covered by server.disconnect-stop-2570.test.js. This pins
 * the handler that offers the stop, in the same source-pattern style as
 * web.accounts-badge.test.js and its siblings: the shared Disconnect/Delete
 * handler lives inside a `for` loop over the account rows and cannot be reached
 * without the whole page, so these assert on its source.
 *
 * 🛑 THE PROPERTY THAT MATTERS MOST IS A NEGATIVE ONE: the flag must ride on
 * the SECOND press only. A page that always sent `stopAgents` would pass any
 * test that merely looked for the string.
 *
 *   node --test web.disconnect-stop-2570.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync(process.env.STOP_PAGE || 'web/index.html', 'utf8');

/* The row handler, bounded by BRACE MATCHING from the loop header rather than
   by a trailing text anchor.

   🛑 THE TEXT-ANCHOR VERSION WAS 457,000 CHARACTERS, roughly a third of the
   page. Its closing anchor ("the removed list's door") sits far below the loop,
   so every assertion below was really searching most of web/index.html: a match
   proved the string existed SOMEWHERE, not that it was in this handler, and
   `lastIndexOf('} catch')` landed in an unrelated function 400KB later. Measured
   when the catch-block arm went red against a fix that was demonstrably present.
   Brace matching cannot drift that way: it ends where the loop ends. */
function handler() {
  const start = PAGE.indexOf("for (const btn of box.querySelectorAll('[data-forget], [data-remove]'))");
  assert.ok(start >= 0, 'the account-row loop moved or was renamed; restate this pin');
  const open = PAGE.indexOf('{', start);
  assert.ok(open > start, 'the loop body brace is gone; restate this pin');
  let depth = 0, end = -1;
  for (let i = open; i < PAGE.length; i++) {
    const c = PAGE[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > open, 'could not find the end of the loop body, so the window is unbounded');
  const fn = PAGE.slice(start, end);
  /* Braces inside strings, regexes and comments are counted too, so this is a
     heuristic bound rather than a parse. It is checked, not assumed: the window
     must be big enough to hold the handler and small enough not to be the page. */
  assert.ok(fn.length > 2000 && fn.length < 40000,
    `the extracted handler is ${fn.length} chars, which is not a handler-sized window`);
  assert.ok(fn.indexOf('data-forget') > 0 && fn.indexOf('stopFor') > 0,
    'the window does not contain the handler it claims to');
  return fn;
}

test('#2570: the request carries stopAgents ONLY when the row is armed to stop', () => {
  const fn = handler();
  assert.match(fn, /stopFor \? \{ stopAgents: true, stopNames: stopFor \} : \{\}/,
    'the flag is no longer conditional on the second-press state, so every disconnect may be stopping agents');
  /* And it carries the set the confirm NAMED, which is what lets the route refuse
     an agent that appeared between the two presses. */
  assert.match(fn, /stopNames: stopFor/,
    'the request no longer sends the agreed set, so a newly-created agent can be stopped unnamed');
  /* The control: an unconditional `stopAgents: true` anywhere in this handler
     would defeat the line above without changing it. */
  /* Counted in its CODE form, because the doc comments above quote the flag by
     name and a bare substring count reads those as extra call sites. A count that
     includes prose is not a count of call sites.
     📌 The pattern follows the code: this was a braced single-key object until the
     consent set was added, and matching the old shape would have counted ZERO
     while the flag was still being sent -- a vacuous pass, which is why the
     assertion below states the expected count rather than a floor. */
  const sites = fn.match(/stopAgents: true, stopNames: stopFor/g) || [];
  assert.equal(sites.length, 1,
    `the handler has ${sites.length} places that send stopAgents; exactly one, inside the stopFor ternary, is correct`);
});

test('#2570: the second confirm is offered only after the server names the agents', () => {
  const fn = handler();
  assert.match(fn, /out\.usedBy/, 'the offer no longer keys on the server naming the agents');
  /* The guard still refuses to re-offer after a FAILED stop, and now has exactly
     one documented exception: the server saying the agent set changed under the
     person, where pressing again agrees to the new set rather than retrying a
     failure. */
  assert.match(fn, /!\(out && out\.stopUnavailable === true\)/,
    'the guard no longer suppresses the offer when the route says a stop is impossible here');
  assert.match(fn, /\(!stopFor \|\| \(out && out\.consentStale === true\)\)/,
    'the re-offer guard changed shape: check it still refuses to loop on a failed stop');
  assert.match(fn, /Disconnect and stop/, 'the second confirm lost its wording');
});

/* 🛑 ONE HANDLER SERVES BOTH CONTROLS. The delete row's own confirm is "Delete
   for good?" precisely because that act is irreversible, so a hardcoded
   "Disconnect and stop ..." would put the softer verb on the button that
   rmSyncs the account, and armLabel would then compose an accessible name
   carrying two contradictory verbs. */
test('#2570: the second confirm takes its verb from the ROW, not from this feature', () => {
  const fn = handler();
  assert.match(fn, /const stopVerb = isRemove \?/,
    'the second confirm no longer branches on isRemove, so the delete row says "Disconnect"');
  assert.match(fn, /'Delete for good and stop '/, 'the delete row lost its own wording');
  /* And the sentence under it splits the same way: after a delete there is no
     account directory left, so "you can restore them" would be a promise the
     product cannot keep. */
  assert.ok(fn.indexOf("' Press again to delete this account for good and stop '") > 0,
    'the offer sentence promises the same way back on both doors');
});

/* Reachable: press 1 arms, press 2 is refused and latches the offer, press 3
   hits a partial-stop 400 and lands in the catch. The button reads "Disconnect"
   again, and if the latch survives, the NEXT ordinary two-press cycle sends
   stopAgents behind a plain "Disconnect?" confirm. Blur would clear it, but the
   catch calls btn.focus(), so no blur ever comes. */
test('#2570: a failed stop does not leave the offer latched behind a plain confirm', () => {
  const fn = handler();
  const cat = fn.slice(fn.lastIndexOf('} catch (err) {'));
  assert.ok(cat.length > 200, 'the catch block moved; restate this pin');
  assert.match(cat, /armed = false; stopFor = null;/,
    'the catch disarms the button but keeps stopFor, so the next cycle stops agents unasked');
});

/* 🛑 WCAG 2.5.3, Label in Name. The armed accessible name used to be built from
   the CONFIRM constant, of which there is one; there are now two armed states,
   so a name built from the constant would announce "Disconnect?" while the
   button reads "Disconnect and stop 2 agents?". Speech input operates the words
   on screen. */
test('#2570: the armed accessible name comes from the visible text, not from the one CONFIRM constant', () => {
  const fn = handler();
  assert.match(fn, /aria-label', on \? btn\.textContent \+ ' ' \+ REST_LABEL : REST_LABEL/,
    'the armed name is built from something other than the visible text again');
});

test('#2570: blurring the row forgets the stop offer, exactly as it forgets the arm', () => {
  const fn = handler();
  const blur = fn.slice(fn.indexOf("addEventListener('blur'"), fn.indexOf("addEventListener('click'"));
  assert.ok(blur.length > 40, 'the blur handler moved; restate this pin');
  assert.match(blur, /stopFor = null/,
    'a blurred row keeps its stop offer, so a later single press can stop agents the person never confirmed');
});

/* A person who presses the second confirm has been told what it does. A person
   who reads only the sentence has not, unless the sentence says it too. */
test('#2570: the offer sentence says the stop is reversible, and names the condition', () => {
  const fn = handler();
  /* Not a bare /restore/i: that matched the word anywhere in a 457KB window and
     would still match a sentence that promised a way back without saying what it
     depends on. The launch file points at `.claude-<label>` by absolute path, so
     the account has to come back under the SAME name for a restore to land
     anywhere useful. */
  assert.ok(fn.indexOf('back from the removed list once you add this account again under the same name') > 0,
    'the offer either drops the way back, or promises one without its condition');
});
