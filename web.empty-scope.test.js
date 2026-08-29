'use strict';

/**
 * An empty screen may say what WE have, never what the COMPUTER has.
 *
 * 🛑 THE ORG VIEW WAS THE ONE EXCEPTION IN THE WHOLE PAGE. It drew
 * "No agents on this computer yet." as a fact. It is a reading, and it can be
 * false: `discover.js` skips an agent with no transcript, and the org view's
 * own filter drops one with no sessionName. Both are real agents somebody made.
 * The screen then tells them they have none.
 *
 * ⭐ THE FIX WAS NOT A NEW IDIOM, IT WAS THE ONE ALREADY HERE. Every other
 * machine-scoped sentence on this page is hedged the honest way, and they were
 * written by different hands at different times:
 *
 *     "We cannot read the agents on this computer right now."
 *     "We cannot see any agents on this computer right now."
 *     "Looking for the agents on this computer…"
 *
 * Each says what we could not do. None asserts what is not there.
 *
 * 🔑 SO THE RULE IS SCOPED, NOT TOTAL. "On this computer" is fine and must stay
 * fine: Kosmos really does read whether Claude Code is installed, and hedging a
 * fact we hold makes the product sound unsure of things it knows. What is
 * forbidden is narrow: asserting a COUNT OF AGENTS as a property of the machine.
 * A guard that banned the phrase outright would fail ~30 honest lines and be
 * bypassed within a week.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

/**
 * Sentences that claim a NUMBER of agents (including zero) as a fact about the
 * machine.
 *
 * ⚠️ IT IS THE QUANTITY THAT IS FORBIDDEN, NOT THE LOCATION. The first version
 * of this matcher flagged four lines that are true and worth keeping:
 *
 *     "Your agents live on this computer"
 *     "Your agents run on your own subscription, on this computer"
 *     "OpenAI picks its own model"
 *
 * Those are locality promises, and locality is the product's whole selling
 * point. A guard that made us hedge them would cost more than the bug it caught.
 * So the trigger is a quantity word bound to "agents": no / none / any / a
 * number. Hedged forms ("we cannot see any…") are excluded separately, because
 * they are claims about our reading rather than about the machine.
 */
function machineScopedAgentClaims(text) {
  const out = [];
  const re = /((?:\bno\b|\bnone\b|\bany\b|\b\d+\b)[^.<>"']{0,30}?agents?[^.<>"']{0,60}?on this computer)/gi;
  for (const m of text.matchAll(re)) {
    /* 🛑 THE HEDGE SITS BEFORE THE QUANTITY WORD, so it must be read from the
       text preceding the match, not from the match. Reading only the match
       flagged all three honest lines: the "cannot" in "we cannot see any
       agents…" falls outside a window that starts at "any". */
    const lead = text.slice(Math.max(0, m.index - 60), m.index);
    const s = m[1];
    if (/cannot|could not|can't|looking for|unable|not sure/i.test(lead + ' ' + s)) continue;
    out.push(s.trim());
  }
  return out;
}

test('CONTROL: the matcher fires on the sentence this file exists to forbid', () => {
  /* Without this, a matcher that silently matches nothing would pass the real
     assertion below by emptiness, and the guard would be decorative. Prove it
     can return the dangerous answer before trusting it to return the safe one. */
  const bad = machineScopedAgentClaims('<p>No agents on this computer yet.</p>');
  assert.equal(bad.length, 1, 'matcher failed to catch the original defect');

  /* And prove the hedge is what spares a line, not luck. */
  const good = machineScopedAgentClaims('<p>We cannot see any agents on this computer right now.</p>');
  assert.equal(good.length, 0, 'matcher would flag the honest idiom');
});

test('CONTROL: the page parses and still says "on this computer" for things we do read', () => {
  /* An absence assertion over a page we failed to load passes for the wrong
     reason. The phrase must remain common: it is correct for the install
     checks, and a page that had deleted it everywhere would pass by emptiness. */
  assert.ok(PAGE.length > 500000, 'page did not load');
  const all = (PAGE.match(/on this computer/gi) || []).length;
  assert.ok(all >= 10, `expected the honest phrase to remain common, found ${all}`);
});

test('no screen asserts a count of agents as a fact about the computer', () => {
  const claims = machineScopedAgentClaims(PAGE);
  assert.deepEqual(
    claims,
    [],
    'A screen states what is on the computer. Say what is in Kosmos, or say what we could not read:\n  ' +
      claims.join('\n  '),
  );
});
