'use strict';

/**
 * #1927 -- message flattening belongs at the PANE, not the STORE.
 *
 * The defect: a message was flattened to a single line at the store write, for
 * a constraint that only the pane has (a newline typed into a pane is Enter, so
 * a paragraph break submits half a message and fires the agent early). Every
 * destination lost paragraphs, including the operator's HTML view.
 *
 * These tests pin the boundary that fixes it, and each store/security assertion
 * has a CONTROL that could return the dangerous answer on the OLD code:
 *   - the STORE keeps `\n\n` (old code returned spaces),
 *   - the PANE delivery form still has NO newline (must not regress),
 *   - validation still REFUSES an ESC while ACCEPTING a multiline message.
 *
 * ⚠️ Sandbox is set BEFORE requiring chat, and dry-run is armed, exactly as
 * chat.test.js does it: this is the one module that types into a live session,
 * and a test that escaped the seam would put fixture text into a real agent.
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-msgnl-1927-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');

const chat = require('./chat');

const NL = String.fromCharCode(10);
const ESC = String.fromCharCode(27); // U+001B -- the security-relevant one
const TAB = String.fromCharCode(9);
const CR = String.fromCharCode(13);

test('storeText keeps a paragraph break, but caps and normalises the rest', () => {
  // The blank line survives (this is the whole point).
  assert.equal(chat.storeText('a' + NL + NL + 'b'), 'a' + NL + NL + 'b');
  // Three-or-more newlines collapse to a single blank line.
  assert.equal(chat.storeText('a' + NL + NL + NL + NL + 'b'), 'a' + NL + NL + 'b');
  // Tab and CR are pane-hostile too: tab -> space, CRLF/CR -> LF.
  assert.equal(chat.storeText('a' + TAB + TAB + 'b'), 'a b');
  assert.equal(chat.storeText('a' + CR + NL + 'b'), 'a' + NL + 'b');
  assert.equal(chat.storeText('a' + CR + 'b'), 'a' + NL + 'b');
  // Ends are trimmed.
  assert.equal(chat.storeText('  ' + NL + 'a' + NL + '  '), 'a');
});

test('the STORE retains the paragraph break (control: old code returned spaces)', () => {
  const kept = chat.appendMessage('nl-store', 'casey', {
    text: 'first line' + NL + NL + 'second paragraph',
    delivery: { state: chat.DELIVERY.PLACED },
  });
  assert.equal(kept.recorded, true);
  const back = chat.readThread('nl-store', 'casey');
  assert.equal(back.messages.length, 1);
  // The dangerous answer this control can return: 'first line  second paragraph'
  // (what the pre-#1927 cleanMessage store write produced).
  assert.ok(
    back.messages[0].text.includes(NL + NL),
    'the stored record must retain the blank line between paragraphs',
  );
  assert.equal(back.messages[0].text, 'first line' + NL + NL + 'second paragraph');
});

test('the PANE-delivered form still has NO newline (the boundary must not regress)', () => {
  // cleanMessage is what deliver() types into a pane. A newline here would be
  // an Enter mid-message -- the exact early-submit this flattening prevents.
  const flat = chat.cleanMessage('first line' + NL + NL + 'second paragraph');
  assert.ok(!flat.includes(NL), 'the pane form must not contain a newline');
  assert.equal(flat, 'first line second paragraph');
});

test('validation ACCEPTS a multiline message', () => {
  assert.equal(
    chat.messageProblem('para one' + NL + NL + 'para two'),
    null,
    'a legitimate multiline message must be accepted now that the store keeps it',
  );
});

test('validation still REFUSES an ESC and every non-newline control char (security control)', () => {
  // ESC is the reason the CONTROL check exists: typed with tmux -l it is the
  // Escape KEY, which cancels a live prompt. Exempting \n must NOT exempt this.
  assert.equal(
    typeof chat.messageProblem('hello' + ESC + 'world'),
    'string',
    'an ESC in the text must still be refused',
  );
  // A bell (U+0007), a vertical tab (U+000B, adjacent to the exempted \n at
  // U+000A), and a DEL (U+007F) are all still refused -- proving the range is
  // split tightly around \n and nothing else leaked through.
  assert.equal(typeof chat.messageProblem('a' + String.fromCharCode(7) + 'b'), 'string');
  assert.equal(typeof chat.messageProblem('a' + String.fromCharCode(11) + 'b'), 'string');
  assert.equal(typeof chat.messageProblem('a' + String.fromCharCode(127) + 'b'), 'string');
  // And the accept case still works, so the refusals above are not a blanket no.
  assert.equal(chat.messageProblem('an ordinary line'), null);
});

test('a stored ESC would round-trip, so the refusal is the only guard -- and it holds', () => {
  // This documents WHY messageProblem must catch ESC: storeText does not strip
  // it (only whitespace is normalised), so if validation let ESC through it
  // would be recorded and later typed. The refusal above is what prevents that.
  assert.ok(chat.storeText('a' + ESC + 'b').includes(ESC),
    'storeText preserves ESC (it is messageProblem that refuses it, not the cleaner)');
});
