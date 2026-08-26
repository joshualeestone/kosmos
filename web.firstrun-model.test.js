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
     are about the page rather than about this step.
     ⚠️ RAISED 16000 -> 18000 when the Claude install confirm was added to this
     step (its panel, its reveal contract, and the note recording the provider
     order). The bound is a drifted-anchor tripwire, not a size budget: what it
     has to catch is a slice that ran into the rest of the page, and the
     `id="create-model"` assertion below is the sharper half of that. Raise it
     again if this step legitimately grows; do NOT remove it, and do not raise
     it to a number that would swallow the create form. Measured after the
     confirm landed: ~16.4k. */
  assert.ok(STEP.length > 200 && STEP.length < 18000, 'the slice is ' + STEP.length + ' chars, so it is not this step');
  assert.match(STEP, /Your agents run on your own subscription/, 'the slice does not contain the model step');
  assert.ok(!STEP.includes('id="create-model"'), 'the slice ran past this step into the create form');
});

test('Claude stays at full weight, the one with an OAuth connect', () => {
  /* A wide window: the row now carries Claude's real inlined vendor SVG
     between the opening tag and the name, thousands of characters where an
     empty aria-hidden span used to sit. */
  assert.match(STEP, /class="llm on"[\s\S]{0,6000}<b>Claude<\/b>/,
    'the model a person can actually pick is no longer the prominent row');
  assert.match(STEP, /id="fr-llm-connect"/, 'the Connect button left the step');
});

test('OpenAI is choosable too, with its own key-entry connect', () => {
  /* #944-adjacent: OpenAI already works via Settings' pasted-key flow, so
     first-run stopped claiming otherwise. Its own reveal/submit is distinct
     from Claude's OAuth button, not a relabel of it. */
  // Anchored on OpenAI's own row start (its pmark), not just any "llm on":
  // a wide unanchored window cleared Claude's row by only ~100 chars, so a
  // modest markup shortening could have let this pass with OpenAI dimmed.
  assert.match(STEP, /class="llm on"><span class="llm-m pmark live" data-pmark="openai"[\s\S]{0,4500}<b>GPT<\/b>/,
    'OpenAI is not shown at full weight alongside Claude');
  assert.match(STEP, /id="fr-openai-connect"/, 'the OpenAI Connect button is missing');
  assert.match(STEP, /id="fr-openai-key"/, 'the OpenAI key field is missing');
  assert.match(STEP, /id="fr-openai-go"/, 'the OpenAI Add button is missing');
  assert.match(STEP, /id="fr-openai-flow" hidden/, 'the key-entry reveal should start hidden');

  // The outcome line must live OUTSIDE the flow it reports on: the connected
  // paint hides the whole form (flow.hidden = true) and then writes here, so
  // a message inside the flow lands in a display:none subtree and the
  // aria-live announcement never fires (challenge-loop iteration 2's real
  // find). Structural check: between the flow's open tag and the message,
  // the flow's own divs must all have closed.
  const flowStart = STEP.indexOf('id="fr-openai-flow"');
  const msgStart = STEP.indexOf('id="fr-openai-msg"');
  assert.ok(flowStart !== -1 && msgStart !== -1, 'flow and message both exist');
  const between = STEP.slice(flowStart, msgStart);
  const opens = (between.match(/<div\b/g) || []).length;
  const closes = (between.match(/<\/div>/g) || []).length;
  assert.ok(closes > opens,
    'the outcome line #fr-openai-msg sits inside #fr-openai-flow, where the connected paint hides it');
});

test('no disclosure survives: all six providers render in the open', () => {
  assert.ok(!/<details/.test(STEP), 'a collapsed disclosure came back');
  assert.ok(!/<summary/.test(STEP), 'a collapsed disclosure came back');
  for (const name of ['Claude', 'Gemini', 'GPT', 'Llama', 'Qwen', 'Mistral']) {
    assert.ok(STEP.includes(name), name + ' is missing from the step');
  }
  /* Four coming-soon rows (Gemini, Llama, Qwen, Mistral), all at the same
     `.llm off` weight as before. OpenAI moved out of this group (#944-
     adjacent): it already works via Settings, so first-run stopped saying
     otherwise. */
  assert.equal((STEP.match(/class="llm off"/g) || []).length, 4,
    'expected exactly the four coming-soon providers at .llm off weight');
  assert.equal((STEP.match(/class="soon"/g) || []).length, 4,
    'expected a "Coming soon" pill on each of the four still-unavailable providers');
});

test('every provider carries a real, inlined vendor mark', () => {
  for (const key of ['claude', 'gemini', 'openai', 'meta', 'qwen', 'mistral']) {
    const marker = new RegExp('data-pmark="' + key + '"[^>]*>\\s*<svg');
    assert.match(STEP, marker, key + ' has no inline SVG mark');
  }
  /* Claude and OpenAI are the two live marks now; the other four are
     dimmed, and dimming is done by CSS filter (see the .pmark.dim rule)
     rather than by omitting the mark, so a vendor's real colours never leak
     through on a provider nobody can pick yet. OpenAI's own SVG is already
     solid black (no currentColor to carry a tint), so "live" for it just
     means the grayscale/opacity filter lifts, not a colour change. */
  assert.match(STEP, /class="llm-m pmark live" data-pmark="claude"/, 'Claude is not a live mark');
  assert.match(STEP, /class="llm-m pmark live" data-pmark="openai"/, 'OpenAI is not a live mark');
  assert.equal((STEP.match(/class="llm-m pmark dim"/g) || []).length, 4,
    'expected all four still-coming-soon marks to be dimmed');
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

test('frPaintOpenai marks the row Connected, told directly or by asking the machine', async () => {
  const page = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const at = page.indexOf('async function frPaintOpenai(');
  assert.notEqual(at, -1, 'frPaintOpenai moved; re-point this test');
  let d = 0; let i = page.indexOf('{', page.indexOf(')', at));
  for (; i < page.length; i++) { if (page[i] === '{') d++; else if (page[i] === '}') { d--; if (!d) break; } }
  const body = page.slice(at, i + 1);

  const makeEls = () => ({
    'fr-openai-connect': { textContent: 'Connect', disabled: false, attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; } },
    'fr-openai-flow': { hidden: false },
    'fr-openai-msg': { textContent: '' },
    'fr-openai-key': { value: 'half-typed-key' },
  });

  // Told directly (the Add handler's own path -- no fetch needed). The
  // message reports the ACTION, since this call is right after it happened.
  let els = makeEls();
  // eslint-disable-next-line no-new-func
  await new Function('document', 'fetch', 'known', body + '\nreturn frPaintOpenai(known);')(
    { getElementById: (id) => els[id] || null },
    () => { throw new Error('should not have fetched -- known was supplied'); },
    { connected: true, keyTail: 'ab12', justAdded: true },
  );
  assert.equal(els['fr-openai-connect'].textContent, 'Connected');
  assert.equal(els['fr-openai-connect'].disabled, true);
  assert.equal(els['fr-openai-flow'].hidden, true, 'the key form should close once connected');
  assert.match(els['fr-openai-msg'].textContent, /^Added/, 'told-directly should report the action, not just the state');
  assert.match(els['fr-openai-msg'].textContent, /ab12/, 'the confirmation should name the key tail it was told');

  // Asked the machine (pane-3 entry, nothing known yet) -- an OpenAI account
  // already exists. The message reports the STATE, not a fictional action:
  // this call did not just add anything, and must not claim it did.
  els = makeEls();
  const fakeFetch = async () => ({ ok: true, json: async () => ({ accounts: [{ provider: 'openai', keyTail: 'cd34', connection: { state: 'connected', because: 'OpenAI confirmed this key still works' } }] }) });
  // eslint-disable-next-line no-new-func
  await new Function('document', 'fetch', body + '\nreturn frPaintOpenai();')(
    { getElementById: (id) => els[id] || null },
    fakeFetch,
  );
  assert.equal(els['fr-openai-connect'].textContent, 'Connected');
  assert.ok(!/^Added/.test(els['fr-openai-msg'].textContent),
    'stepping back to this pane and forward again must not claim an Add that did not happen this visit');
  // The connected paint hides the flow, so the disclosure must say closed
  // (challenge-loop iteration 4: aria-expanded was set true on reveal and
  // never reset), and a half-typed key must not sit parked in the hidden
  // password field on this path (the justAdded path clears it on success).
  assert.equal(els['fr-openai-connect'].attrs['aria-expanded'], 'false',
    'the disclosure still claims to be expanded over a hidden flow');
  assert.equal(els['fr-openai-key'].value, '',
    'a half-typed key was left parked in the hidden field');

  // The stated contract is SAME warning copy as Settings ("a person who has
  // already done this once in Settings recognises it here") -- hold the two
  // strings identical so an edit to one screen cannot silently un-pair the
  // other (challenge-loop iteration 5).
  const hints = page.match(/Paste an OpenAI API key\.[^<]*/g) || [];
  assert.ok(hints.length >= 2, 'expected the key hint copy on both screens');
  assert.equal(hints[0], hints[1],
    'Settings and first-run no longer share the same key warning copy');
  assert.match(els['fr-openai-msg'].textContent, /connected/, 'should still say it is connected');
  assert.match(els['fr-openai-msg'].textContent, /cd34/);

  // Asked the machine, a real answer of "nothing there" -- a DEFINITE no,
  // not an unknown, so the row must repaint back to Connect. This is the
  // reverse transition frPaintSubscription's own tests already hold Claude
  // to ("AND BACK AGAIN"); caught missing here in challenge-loop iteration 1.
  els = makeEls();
  Object.assign(els['fr-openai-connect'], { textContent: 'Connected', disabled: true });
  els['fr-openai-flow'] = { hidden: true };
  const emptyFetch = async () => ({ ok: true, json: async () => ({ accounts: [] }) });
  // eslint-disable-next-line no-new-func
  await new Function('document', 'fetch', body + '\nreturn frPaintOpenai();')(
    { getElementById: (id) => els[id] || null },
    emptyFetch,
  );
  assert.equal(els['fr-openai-connect'].textContent, 'Connect',
    'a definite empty answer must repaint back to Connect, not leave a stale Connected standing');
  assert.equal(els['fr-openai-connect'].disabled, false);

  // A read FAILURE, by contrast, is not a "no" -- the row must stay exactly
  // as it was (never turn "we could not tell" into "no", #881's contract).
  els = makeEls();
  Object.assign(els['fr-openai-connect'], { textContent: 'Connected', disabled: true });
  els['fr-openai-flow'] = { hidden: true };
  const failFetch = async () => ({ ok: false });
  // eslint-disable-next-line no-new-func
  await new Function('document', 'fetch', body + '\nreturn frPaintOpenai();')(
    { getElementById: (id) => els[id] || null },
    failFetch,
  );
  assert.equal(els['fr-openai-connect'].textContent, 'Connected',
    'a failed read must not overwrite a known Connected state with a guess');

  // A ROW IS NOT A CONNECTION (challenge-loop iteration 5): a row whose
  // per-account verdict is 'none' is a key OpenAI positively rejected.
  // Painting Connected off mere row presence hid the form over a dead key
  // with no way to enter a fresh one. It must paint Connect, keep the form
  // reachable, and say why.
  els = makeEls();
  const deadFetch = async () => ({ ok: true, json: async () => ({ accounts: [{ provider: 'openai', keyTail: 'ef56', connection: { state: 'none', because: 'OpenAI did not accept this key' } }] }) });
  // eslint-disable-next-line no-new-func
  await new Function('document', 'fetch', body + '\nreturn frPaintOpenai();')(
    { getElementById: (id) => els[id] || null },
    deadFetch,
  );
  assert.equal(els['fr-openai-connect'].textContent, 'Connect',
    'a positively rejected key still wears Connected');
  assert.equal(els['fr-openai-connect'].disabled, false,
    'the way to enter a fresh key was taken away over a dead one');
  assert.match(els['fr-openai-msg'].textContent, /did not accept/,
    'the dead key should say why the row reads Connect over an account that exists');

  // And a row whose verdict is 'unknown' is could-not-tell, the same
  // honest-unknown as a failed read: leave the row exactly as it was,
  // in BOTH directions.
  els = makeEls();
  Object.assign(els['fr-openai-connect'], { textContent: 'Connected', disabled: true });
  els['fr-openai-flow'] = { hidden: true };
  const unknownFetch = async () => ({ ok: true, json: async () => ({ accounts: [{ provider: 'openai', keyTail: 'gh78', connection: { state: 'unknown', because: 'we could not check this account' } }] }) });
  // eslint-disable-next-line no-new-func
  await new Function('document', 'fetch', body + '\nreturn frPaintOpenai();')(
    { getElementById: (id) => els[id] || null },
    unknownFetch,
  );
  assert.equal(els['fr-openai-connect'].textContent, 'Connected',
    'an unknown verdict must not overwrite a known Connected state');

  // SUPERSESSION (challenge-loop iteration 2's real find): the pane-entry
  // read can be slow (/api/accounts verifies each account live, up to 8s)
  // while a successful Add paints immediately. A read that started BEFORE
  // the Add must not land AFTER it and repaint the row back to Connect off
  // its pre-add answer -- that invites a second paste of the same key and a
  // duplicate account. Both calls run in ONE extraction scope so they share
  // the function's own token.
  els = makeEls();
  let releaseRead;
  const gate = new Promise((res) => { releaseRead = res; });
  const slowEmptyFetch = async () => { await gate; return { ok: true, json: async () => ({ accounts: [] }) }; };
  // eslint-disable-next-line no-new-func
  const both = new Function('document', 'fetch', 'known',
    body + '\nconst read = frPaintOpenai(); const add = frPaintOpenai(known); return Promise.all([read, add]);')(
    { getElementById: (id) => els[id] || null },
    slowEmptyFetch,
    { connected: true, keyTail: 'ab12', justAdded: true },
  );
  releaseRead();
  await both;
  assert.equal(els['fr-openai-connect'].textContent, 'Connected',
    'a pre-add read resolving late repainted a just-connected row back to Connect');
  assert.equal(els['fr-openai-connect'].disabled, true);
});
