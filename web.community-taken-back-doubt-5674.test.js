'use strict';

/**
 * #5674: a post taken back while a copy MAY have arrived under a registration Kosmos no longer holds (#5636) says so on
 * the owner's list, in the sentence the CLI uses, rather than "Deleted before it was sent" or "comes down within a few
 * minutes", neither of which is true for it. communityMineWord is extracted from the page and CALLED.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

function sliceFn(name) {
  const at = PAGE.indexOf(`function ${name}(`);
  assert.notEqual(at, -1, `${name} is not in the page at all`);
  let depth = 0;
  let i = PAGE.indexOf('{', at);
  for (; i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth++;
    else if (PAGE[i] === '}') { depth--; if (depth === 0) break; }
  }
  return PAGE.slice(at, i + 1);
}
// eslint-disable-next-line no-new-func
const communityMineWord = new Function(sliceFn('communityMineWord') + '\nreturn communityMineWord;')();

const DOUBT = "Taken back, so it won't be sent again. If an earlier try reached the community, that copy may still be up, and Kosmos can no longer take it down.";

test('#5674: each doubtful take-back says the one sentence', () => {
  for (const r of [
    { state: 'withheld', deleteRequested: true, unverified: true },              // settled "not there" under a new registration
    { state: 'unconfirmed', deleteRequested: true, agentKeyless: true },         // no answer, no key to ask with
    { state: 'unconfirmed', deleteRequested: true, agentOtherRegistration: true }, // no answer, another registration held
  ]) {
    const w = communityMineWord(r);
    assert.equal(w, DOUBT, JSON.stringify(r));
    assert.equal(w.includes('\u2014'), false, 'an em dash reached the owner');
  }
});

test('#5674 CONTROL: every neighbour keeps its own words', () => {
  assert.equal(communityMineWord({ state: 'withheld', deleteRequested: true }), 'Deleted before it was sent');
  assert.equal(communityMineWord({ state: 'deleted', deleteRequested: true, unverified: true }), 'Deleted from the community');
  // Not taken back: an unverified post still waiting, or an unanswered keyless one nobody asked to delete.
  assert.equal(communityMineWord({ state: 'pending', unverified: true }), 'Not sent yet. Kosmos tries again every few minutes.');
  assert.notEqual(communityMineWord({ state: 'unconfirmed', agentKeyless: true }), DOUBT);
  // A sent post with a live key comes down by the sweep, so the usual promise stands.
  assert.match(communityMineWord({ state: 'sent', deleteRequested: true }), /^Deleting\./);
  // A refused agent is said as refused, first.
  assert.match(communityMineWord({ state: 'unconfirmed', deleteRequested: true, agentKeyless: true, agentRefused: true }), /refused this agent/);
});
