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

/* The row handler, bounded by two anchors that are part of the feature rather
   than line numbers: the loop header that builds it, and the removed-list door
   that follows it. */
function handler() {
  const start = PAGE.indexOf("for (const btn of box.querySelectorAll('[data-forget], [data-remove]'))");
  assert.ok(start >= 0, 'the account-row loop moved or was renamed; restate this pin');
  const end = PAGE.indexOf("/* The removed list's door", start);
  assert.ok(end > start, 'the closing anchor moved; restate this pin');
  const fn = PAGE.slice(start, end);
  assert.ok(fn.length > 2000, 'the extracted handler looks too short; the slice bounds probably moved');
  return fn;
}

test('#2570: the request carries stopAgents ONLY when the row is armed to stop', () => {
  const fn = handler();
  assert.match(fn, /stopFor \? \{ stopAgents: true \} : \{\}/,
    'the flag is no longer conditional on the second-press state, so every disconnect may be stopping agents');
  /* The control: an unconditional `stopAgents: true` anywhere in this handler
     would defeat the line above without changing it. */
  /* Counted in its CODE form (braced), because the doc comment above the line
     quotes the flag by name and a bare substring count reads that as a second
     call site. A count that includes prose is not a count of call sites. */
  const sites = fn.match(/\{\s*stopAgents:\s*true\s*\}/g) || [];
  assert.equal(sites.length, 1,
    `the handler has ${sites.length} places that send stopAgents; exactly one, inside the stopFor ternary, is correct`);
});

test('#2570: the second confirm is offered only after the server names the agents', () => {
  const fn = handler();
  assert.match(fn, /out\.usedBy/, 'the offer no longer keys on the server naming the agents');
  assert.match(fn, /if \(blocking\.length && !stopFor\)/,
    'the guard against re-offering after a failed stop is gone, so a person can be looped against a failure');
  assert.match(fn, /Disconnect and stop/, 'the second confirm lost its wording');
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
test('#2570: the offer sentence says the stop is reversible', () => {
  const fn = handler();
  assert.match(fn, /restore/i, 'the offer no longer tells the person the agents can be restored');
});
