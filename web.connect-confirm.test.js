'use strict';

/**
 * The install confirm on the first-run model step (Josh, 2026-08-26 14:44 and
 * 14:59). One pin per ruling, so none of them can be reverted silently.
 *
 *   node --test web.connect-confirm.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');

/* Comments stripped before any count, because a comment quoting a call would
   otherwise satisfy an assertion about code. That hole was real in a sibling
   suite today: an indexOf found a comment naming a declaration before the
   declaration itself, and the test failed with a true-sounding message about
   the wrong thing. */
const CODE = PAGE.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

test('pressing Connect on Claude cannot reach the download without a confirm', () => {
  const handler = CODE.slice(CODE.indexOf("const b = e.target.closest('#fr-llm-connect')"), CODE.indexOf("const b = e.target.closest('#fr-llm-connect')") + 1400);
  assert.ok(handler.length > 100, 'the Connect handler moved; this test is measuring nothing');

  /* 🛑 THE NEGATIVE ONE, and it is the point of the file. The old handler
     called frConnectStart() directly. If the confirm branch is ever removed or
     short-circuited, the FIRST reachable statement becomes the download again.
     So: the gate must appear BEFORE the start call in the handler body. */
  const gate = handler.indexOf('frClaudeInstallNeeded()');
  const start = handler.indexOf('frConnectStart()');
  assert.ok(gate > 0, 'the Connect handler no longer asks whether an install is needed -- it can download without asking');
  assert.ok(start > 0, 'the Connect handler no longer starts the flow at all');
  assert.ok(gate < start, 'the download call now precedes the confirm gate: pressing Connect downloads before asking, which is the defect this exists to prevent');
  assert.match(handler, /return;/, 'the confirm branch no longer returns, so it falls through into the download it was meant to defer');
});

test('the confirm names the size, because being told once the bar moves is too late to decline', () => {
  const box = PAGE.match(/<div id="fr-claude-confirm"[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(box, 'the confirm panel is gone');
  /* Rough, not exact. Josh, 15:27: a person "doesnt care if its 108 or 127MB..
     they just want to know its making progress installing". The sentence has to
     say it is big enough to wait for; the bar says it is moving. */
  assert.match(box[0], /large download/, 'the confirm no longer says the download is large -- a person cannot decide to wait for something they have not been warned about');
  assert.match(box[0], /around 230MB/, 'the rough size is gone; it is what lets someone choose to do this on better wifi');
  assert.doesNotMatch(box[0], /\b231MB\b|\b109MB\b/, 'an exact byte figure came back: it serves nobody reading it and is one more number that has to stay true');
  assert.match(box[0], /install Claude Code first/, 'the confirm no longer says what is being installed');
  assert.doesNotMatch(box[0], /minutes|minute/, 'a time estimate came back: Josh dropped it (15:07, "that seems hard") and we cannot know a person\'s connection, so any figure is a promise the product breaks');
  assert.match(box[0], /id="fr-claude-confirm-go"/, 'the Confirm button is gone');
  assert.match(box[0], /id="fr-claude-confirm-no"/, 'the Not now escape is gone -- a confirm with no way out is an announcement');
});

test('the reveal is announced, not just drawn', () => {
  assert.match(PAGE, /id="fr-llm-connect" aria-expanded="false" aria-controls="fr-claude-confirm"/,
    'the Connect button lost its expanded/controls contract, so a screen reader is not told a panel opened beneath it');
  const handler = CODE.slice(CODE.indexOf("const b = e.target.closest('#fr-llm-connect')"), CODE.indexOf("const b = e.target.closest('#fr-llm-connect')") + 1400);
  assert.match(handler, /setAttribute\('aria-expanded'/, 'aria-expanded is never updated, so it lies after the first press');
  assert.match(handler, /\.focus\(\)/, 'focus never moves into the revealed panel: pressing Connect by keyboard appears to do nothing');
});

test('a Mac that already has Claude Code is not asked to install it', () => {
  const fn = CODE.slice(CODE.indexOf('function frClaudeInstallNeeded()'), CODE.indexOf('function frClaudeInstallNeeded()') + 700);
  assert.ok(fn.length > 100, 'frClaudeInstallNeeded is gone; the confirm can no longer skip when nothing would download');
  /* Unknown must default to ASKING. Asking unnecessarily costs one click;
     not asking is the thing Josh called total chaos. */
  assert.match(fn, /if \(!checks\) return true;/, 'an unreadable machine answer no longer defaults to asking -- it would download silently');
  assert.match(fn, /if \(!row\) return true;/, 'a missing Claude Code row no longer defaults to asking');
});

test('the provider rows read Claude, GPT, Gemini', () => {
  const rows = [...PAGE.matchAll(/data-pmark="(claude|openai|gemini)"[^>]*role="img"/g)].map((m) => m[1]);
  assert.deepEqual(rows.slice(0, 3), ['claude', 'openai', 'gemini'],
    'the provider order changed: Josh asked for Claude, GPT, Gemini, and Gemini is a Coming soon row that should not sit between the only two that work');
});

test('a connected provider row goes green with a check, and does not read as disabled', () => {
  /* ⚠️ ASSERTED AGAINST THE ONE OWNER, not a second mechanism. A first draft of
     this added frMarkProviderConnected beside frPaintSubscription, which
     already owned the button's state and is already executed by a stub in
     web.firstrun-model. Two things writing one element is the drift shape this
     codebase keeps finding; the green treatment was folded into the existing
     block instead. The behavioural pins live in that suite, which RUNS the
     painter; these are the presentation facts it cannot see. */
  const css = PAGE.slice(PAGE.indexOf('.connect-b.is-connected'), PAGE.indexOf('.connect-b.is-connected') + 200);
  assert.match(css, /background: #1f7a4d/, 'the connected fill is gone or changed; white-on-#1f7a4d was measured at 5.32:1 and clears the 4.5 text floor');
  assert.match(css, /color: #ffffff/, 'the connected label is no longer white, so the measured 5.32:1 no longer applies');
  /* ⚠️ Anchored on the SPECIFIC element. A first draft anchored on
     `const connectBtn = document.getElementById` and matched frPaintOpenai's
     identically-named local first -- the same wrong-anchor failure this suite
     has now hit three times. */
  const at = CODE.indexOf("const connectBtn = document.getElementById('fr-llm-connect')");
  assert.ok(at > 0, 'the Claude connect button block moved; this test is measuring nothing');
  const block = CODE.slice(at, at + 600);
  assert.match(block, /classList\.toggle\('is-connected', done\)/, 'the green is no longer tied to the same `done` the label is, so the two can disagree');
  assert.ok(!/frMarkProviderConnected/.test(CODE), 'a second mechanism for the connected row is back; frPaintSubscription owns this');
});

test('no screen claims every agent thinks with Claude', () => {
  /* An agent set to GPT runs on Codex and never touches the Claude binary.
     The sentence was true when Claude was the only provider and became false
     without anyone editing it -- which is why it is pinned rather than just
     fixed. */
  assert.doesNotMatch(CODE, /Your agents think with Claude/,
    'a screen asserts that every agent thinks with Claude; a GPT agent runs on Codex, and this sentence is what taught Josh that Kosmos needs Claude Code');
});
