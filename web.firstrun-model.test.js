'use strict';

/**
 * The first-run model step shows all six models, always, each at full
 * weight with its real vendor mark — replacing #262's one-prominent-row
 * plus a collapsed "More models" disclosure.
 *
 * ⭐ REVERSED BY JOSH, 2026-08-25 21:08 CDT: "I want to show all of the
 * models. That's more important to me than having the button above the
 * fold. It's not like it's unreasonable to have to scroll down... we could
 * make the button show and the modal stuff could scroll behind it even."
 *
 * 🛑 #262's OWN MEASUREMENT STILL HOLDS AND IS NOT WHAT CHANGED: six full
 * rows put this card at 1003px, and Continue sits 300px below the fold at
 * 950/800/700 if the card just grows. What changed is which fix that number
 * drives. #262 hid five rows to keep Continue on-screen; the fix now is a
 * sticky footer (`#firstrun .fr-box`/`.fr-body`), so Continue stays visible
 * on every step of the wizard while the body scrolls under it — six rows and
 * an always-visible Continue are no longer in tension.
 *
 * Ruled by Mona Lisa, from the design pack's real vendor marks (#876).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const STEP = PAGE.slice(PAGE.indexOf('id="fr-pane-3"'), PAGE.indexOf('id="fr-sub"'));

test('the step is a real slice of the model pane', () => {
  /* The whole file would satisfy every assertion below, since the slice
     upper bound accounts for six inlined vendor SVGs (~11.5k chars measured),
     not just the create form's shorter disclosure. Without this the tests
     are about the page rather than about this step. */
  assert.ok(STEP.length > 200 && STEP.length < 16000, 'the slice is ' + STEP.length + ' chars, so it is not this step');
  assert.match(STEP, /Your agents run on your own subscription/, 'the slice does not contain the model step');
  assert.ok(!STEP.includes('id="create-model"'), 'the slice ran past this step into the create form');
});

test('the one choosable model stays at full weight', () => {
  /* A wide window: the row now carries Claude's real inlined vendor SVG
     between the opening tag and the name, thousands of characters where an
     empty aria-hidden span used to sit. */
  assert.match(STEP, /class="llm on"[\s\S]{0,6000}<b>Claude<\/b>/,
    'the model a person can actually pick is no longer the prominent row');
  assert.match(STEP, /id="fr-llm-connect"/, 'the Connect button left the step');
});

test('no disclosure survives: all six providers render in the open', () => {
  assert.ok(!/<details/.test(STEP), 'a collapsed disclosure came back');
  assert.ok(!/<summary/.test(STEP), 'a collapsed disclosure came back');
  for (const name of ['Claude', 'Gemini', 'GPT', 'Llama', 'Qwen', 'Mistral']) {
    assert.ok(STEP.includes(name), name + ' is missing from the step');
  }
  /* Five coming-soon rows, all at the same `.llm off` weight as before —
     the difference from #262 is that they are no longer hidden, not that
     they changed shape. */
  assert.equal((STEP.match(/class="llm off"/g) || []).length, 5,
    'expected exactly the five coming-soon providers at .llm off weight');
  assert.equal((STEP.match(/class="soon"/g) || []).length, 5,
    'expected a "Coming soon" pill on each of the five unavailable providers');
});

test('every provider carries a real, inlined vendor mark', () => {
  for (const key of ['claude', 'gemini', 'openai', 'meta', 'qwen', 'mistral']) {
    const marker = new RegExp('data-pmark="' + key + '"[^>]*>\\s*<svg');
    assert.match(STEP, marker, key + ' has no inline SVG mark');
  }
  /* Claude is the one live, coloured mark; the other five are dimmed, and
     dimming is done by CSS filter (see the .pmark.dim rule) rather than by
     omitting the mark, so a vendor's real colours never leak through on a
     provider nobody can pick yet. */
  assert.match(STEP, /class="llm-m pmark live" data-pmark="claude"/, 'Claude is not the live mark');
  assert.equal((STEP.match(/class="llm-m pmark dim"/g) || []).length, 5,
    'expected all five coming-soon marks to be dimmed');
});

test('the tier label and its separator match the rest of the product', () => {
  assert.match(STEP, /<p class="smore-t">Runs on this computer<\/p>/,
    'the "Runs on this computer" tier heading is missing or changed shape');
  /* The house never ships an em dash in PRODUCT-FACING TEXT (code comments
     are a different convention and use them freely, including several in
     this very step's own build comments) -- so this strips HTML comments
     before checking, the same scoping the disclosure-only slice used to get
     for free by starting past them. */
  const visible = STEP.replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(!/&mdash;|—/.test(visible), 'an em dash reached text a person actually reads on this step');
  assert.match(visible, /&middot;/, 'the separator changed to something the sibling rows do not use');
});

test('the sticky footer keeps Continue on screen while the body scrolls behind it', () => {
  const boxAt = PAGE.indexOf('#firstrun .fr-box {');
  assert.notEqual(boxAt, -1, '#firstrun .fr-box rule moved; re-point this test');
  const boxRule = PAGE.slice(boxAt, PAGE.indexOf('}', boxAt));
  assert.match(boxRule, /display:\s*flex/, '.fr-box is not a flex container');
  assert.match(boxRule, /flex-direction:\s*column/, '.fr-box is not a flex column');
  assert.match(boxRule, /max-height:/, '.fr-box has no bounded height, so it can grow past the viewport again');

  const bodyAt = PAGE.indexOf('#firstrun .fr-body {');
  assert.notEqual(bodyAt, -1, '#firstrun .fr-body rule moved; re-point this test');
  const bodyRule = PAGE.slice(bodyAt, PAGE.indexOf('}', bodyAt));
  assert.match(bodyRule, /overflow-y:\s*auto/, '.fr-body no longer scrolls internally');

  const actsAt = PAGE.indexOf('#firstrun .fr-acts {');
  assert.notEqual(actsAt, -1, '#firstrun .fr-acts rule moved; re-point this test');
  const actsRule = PAGE.slice(actsAt, PAGE.indexOf('}', actsAt));
  assert.match(actsRule, /flex:\s*0 0 auto/, 'Continue\'s row can still shrink away inside the flex column');
});

test('the Connect button says Connected once it is, and stops saying it if we lose sight of that', () => {
  /**
   * 🛑 WHAT THIS IS FOR. The button was static markup reading "Connect"
   * whatever the state, directly above a verdict row that could say "A Claude
   * subscription is connected". The first person outside this team to reach
   * this screen asked Josh whether she was connected (2026-08-22). Two answers
   * on one screen, and the button is the louder one.
   *
   * ⚠️ THE SECOND HALF IS THE ONE THAT MATTERS MORE. A recheck can move from
   * connected to `unknown`, and a button still reading "Connected" is this
   * screen's cardinal sin with the states swapped: "we could not tell" must
   * never render as an answer, in either direction.
   */
  const page = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const at = page.indexOf('function frPaintSubscription(');
  assert.notEqual(at, -1, 'frPaintSubscription moved; re-point this test');
  let d = 0; let i = page.indexOf('{', page.indexOf(')', at));
  for (; i < page.length; i++) { if (page[i] === '{') d++; else if (page[i] === '}') { d--; if (!d) break; } }
  const body = page.slice(at, i + 1);

  const btn = { textContent: 'Connect', disabled: false };
  const els = { 'fr-llm-connect': btn, 'fr-sub': { innerHTML: '' } };
  const run = (subscription) => {
    // eslint-disable-next-line no-new-func
    new Function('document', 'FR', 'frCheckRow', 'frActions', 'frGo', 'frRecheck',
      body + '\nfrPaintSubscription();')(
      { getElementById: (id) => els[id] || null },
      { subscription },
      () => '', () => {}, () => {}, () => {},
    );
  };

  run({ state: 'connected', plan: 'Claude Max' });
  assert.equal(btn.textContent, 'Connected', 'a connected machine is still offered Connect');
  assert.equal(btn.disabled, true, 'the button still invites a press with nothing to do');

  /* ⚠️ AND BACK AGAIN. Without this the test passes on a one-way change, which
     is the version that leaves "Connected" standing over "we could not tell". */
  run({ state: 'unknown', because: 'we could not read the settings' });
  assert.equal(btn.textContent, 'Connect', 'a state we cannot read still claims it is connected');
  assert.equal(btn.disabled, false, 'the way to connect was taken away on a state that is not an answer');

  run({ state: 'none' });
  assert.equal(btn.textContent, 'Connect');
  assert.equal(btn.disabled, false);
});
