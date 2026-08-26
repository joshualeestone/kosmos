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

test('NO caller can reach the download without passing the confirm gate', () => {
  /* 🛑 THE PROPERTY, NOT THE SHAPE. An earlier version put the gate in ONE
     listener and asserted the order of statements inside it. That passed while
     the button a clean Mac actually presses -- the footer primary in the `none`
     arm -- called the worker directly and downloaded 231MB with no warning.
     A gate in a listener is a gate one new call site forgets. */
  const worker = 'frConnectStartConfirmed';
  const entry = CODE.slice(CODE.indexOf('async function frConnectStart(opts)'), CODE.indexOf('async function frConnectStart(opts)') + 500);
  assert.ok(entry.length > 100, 'the gated entry moved or was renamed');
  assert.match(entry, /frClaudeInstallNeeded\(\)/, 'the entry no longer asks whether an install is needed');
  assert.match(entry, /frClaudeConfirmOpen\(\)/, 'the entry no longer opens the confirm');
  assert.match(entry, new RegExp('return ' + worker + '\\(\\)'), 'the entry no longer reaches the worker at all');

  /* Every mention of the worker outside its own declaration must be that one
     call. If a second appears, something reaches the download around the gate. */
  const calls = (CODE.match(new RegExp(worker + '\\(', 'g')) || []).length;
  assert.equal(calls, 2, `${worker} is called from ${calls - 1} place(s); exactly one (the gated entry) is allowed, or a caller can download without asking`);

  /* The retries pass confirmed:true deliberately -- a person re-trying a failed
     attempt has already agreed. Anything else calling the ENTRY is fine, since
     the entry gates. */
  assert.match(CODE, /frConnectStart\(\{ confirmed: true \}\)/, 'the post-attempt retries lost their confirmed flag and will re-ask on every retry');
});

test('the confirm names the size, because being told once the bar moves is too late to decline', () => {
  const box = PAGE.match(/<div id="fr-claude-confirm"[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(box, 'the confirm panel is gone');
  /* Rough, not exact. Josh, 15:27: a person "doesnt care if its 108 or 127MB..
     they just want to know its making progress installing". The sentence has to
     say it is big enough to wait for; the bar says it is moving. */
  assert.match(box[0], /install Claude Code first/, 'the confirm no longer says what is being installed');
  /* 🔑 THE SIZE IS ASKED FOR, NOT TYPED. A number written into markup goes stale
     the day the vendor changes the file. The sentence is built at reveal time
     from what the engine is about to fetch, with an honest floor when it cannot
     answer. */
  assert.doesNotMatch(box[0], /\d+\s?MB/, 'a size is hardcoded in the markup again -- it will go stale and lie on the screen where trust is decided');
  const fn = CODE.slice(CODE.indexOf('function frClaudeConfirmSentence'), CODE.indexOf('function frClaudeConfirmSentence') + 600);
  assert.match(fn, /It is a large download\.'/, 'the no-size floor is gone: with no answer from the engine the box would say nothing about magnitude');
  assert.match(fn, /It is a large download, about '/, 'the sentence no longer states a magnitude when one is known');
  assert.doesNotMatch(fn, /minutes/, 'a time estimate came back: Josh dropped it and we cannot know a connection');
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

test('the install check reads an engine answer, and asks when there is none', () => {
  const fn = CODE.slice(CODE.indexOf('function frClaudeInstallNeeded()'), CODE.indexOf('function frClaudeInstallNeeded()') + 400);
  assert.ok(fn.length > 50, 'frClaudeInstallNeeded is gone');
  /* 🛑 NO /api/machine LOOKUP. A previous version searched the machine checks
     for a Claude Code row. It guessed the row shape, so it never matched and
     could only return true; and even a correct lookup is the wrong grain,
     because installedCheck reports Claude Code and tmux in ONE row. */
  assert.doesNotMatch(fn, /FR_MACHINE|checks/, 'the machine-checks lookup is back: its rows cannot answer this question at any shape, because one row covers Claude Code and tmux together');
  assert.match(fn, /willInstall/, 'the engine answer is no longer read');
  assert.match(fn, /return true;/, 'the unknown case no longer defaults to asking -- it would download silently');
});

test('the provider rows read Claude, GPT, Gemini', () => {
  const rows = [...PAGE.matchAll(/data-pmark="(claude|openai|gemini)"[^>]*role="img"/g)].map((m) => m[1]);
  assert.deepEqual(rows.slice(0, 3), ['claude', 'openai', 'gemini'],
    'the provider order changed: Josh asked for Claude, GPT, Gemini, and Gemini is a Coming soon row that should not sit between the only two that work');

  /* 🛑 SOURCE ORDER IS NOT VISIBLE ORDER, and this assertion shipped without
     the difference. The reorder briefly put the Gemini row INSIDE
     #fr-openai-flow, which is `hidden` -- so the list showed five rows, Gemini
     appeared only inside the API-key form, and the order check above passed the
     whole time because the substrings were in the right sequence.
     🔑 THE MEASURE IS NET DEPTH, not a count of opens against closes. A first
     draft compared those two totals and could not fire: the GPT row's own
     closing tag and the form's inner rows inflate the close count past the
     single unclosed open. Between two SIBLINGS every tag that opens also
     closes, so the net is zero; a positive net means the second row sits
     inside something the first one did not. */
  const rowRe = (id) => new RegExp('<div class="llm[^"]*"><span class="llm-m[^"]*" data-pmark="' + id + '"');
  const gpt = PAGE.search(rowRe('openai'));
  const gem = PAGE.search(rowRe('gemini'));
  assert.ok(gpt > 0 && gem > gpt, 'could not locate the GPT and Gemini ROWS in order; this guard is measuring nothing');
  const between = PAGE.slice(gpt, gem);
  const depth = (between.match(/<div\b/g) || []).length - (between.match(/<\/div>/g) || []).length;
  assert.equal(depth, 0,
    `the Gemini row is nested ${depth} level(s) deeper than the GPT row: it sits inside a container that never closes between them (#fr-openai-flow is \`hidden\`), so it will not render in the provider list`);
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
