'use strict';
/**
 * The `told` verdict says nothing on the screen, and every staleness state has
 * to be given an answer by hand (#1213).
 *
 * 🛑 THE DEFECT, AS JOSH MET IT ON 2026-08-27. An amber banner on an agent's
 * page whose two halves contradicted each other:
 *
 *   "This might not be what the agent is actually running. Agents read this
 *    file when they start. Kosmos put it on Test 10, and told it on its screen."
 *
 * The headline is the `unknown` arm, whose entire job is to say WE CANNOT TELL.
 * The sentence under it is Kosmos reporting an action it performed itself and
 * confirming it delivered it. Kosmos knew exactly what had happened; it did it.
 * And the `unknown` arm carries no remedy, so there was no Restart button and
 * nothing to click, which is the rest of what he reported.
 *
 * 🔑 THE CAUSE IS A FOURTH STATE THAT NEITHER RENDERER KNEW (PigeonPete).
 * `projects.toldOverride` (#732) rewrites a `stale` verdict into `told` when the
 * edit was Kosmos's own AND the agent was told on its screen. Its own comment:
 * "it knows, and the restart button would be theatre." Both banner renderers
 * test `=== 'stale'` and fall through on everything else, and `renderStale`'s
 * fallthrough is the `unknown` arm. So a state added SPECIFICALLY to suppress an
 * unnecessary alarm rendered as the loudest alarm in the app.
 *
 * ⚠️ WHAT THIS FILE PROTECTS IS NOT THE WORDING, IT IS EXHAUSTIVENESS. The
 * table below must name an outcome for every value in `instructions.STALENESS`.
 * Add a fifth state to that object and this suite fails until somebody decides,
 * by hand, what the two renderers do with it. That is the only thing that would
 * have caught this one: the branches were fine, the vocabulary had two homes,
 * and nothing compared them.
 *
 *   node --test web.told-banner.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const nodePath = require('path');
const page = require('./test-support/page.js');
const fleet = require('./test-support/fleet.js');
const instructions = require('./engine/instructions');

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));

/* One agent, so `CURRENT` is something the board would actually hold. The
   restart button reads its session name off it. */
const CARD = fleet.install([fleet.agent('brigitte')]).agents[0];
test.after(() => fleet.restore());

const ESC = (x) => String(x == null ? '' : x)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The real `setLive` and the real `renderStale`, over one stub element.
    ⚠️ The two properties are LINKED, as in a real node: a stub that let a
    `textContent` clear leave `innerHTML` alone would supply the very behaviour
    the code under test is supposed to provide (web.stale-banner.test.js). */
function panel() {
  const el = {
    hidden: true,
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    get textContent() { return this._html.replace(/<[^>]*>/g, ''); },
    set textContent(v) { this._html = String(v); },
  };
  const fn = new Function('document', 'esc', 'CURRENT', `
    ${page.lift(SCRIPT, 'setLive')}
    ${page.lift(SCRIPT, 'staleWords')}
    ${page.lift(SCRIPT, 'renderStale')}
    return renderStale;`)(
    { getElementById: (id) => (id === 'd-instr-stale' ? el : null) },
    ESC,
    CARD,
  );
  return { el, render: fn };
}

/** The member row's verdict cell, and the card's badge. Neither has any dep
    beyond `esc`. */
const memberCell = new Function('esc', `
  ${page.lift(SCRIPT, 'pjMemberHasIt')}
  return pjMemberHasIt;`)(ESC);
const badge = new Function('esc', 'icon', `
  ${page.lift(SCRIPT, 'staleWords')}
  ${page.lift(SCRIPT, 'staleBadge')}
  return staleBadge;`)(ESC, () => '<svg></svg>');

const KOSMOS_EDIT = { who: 'kosmos', because: 'Kosmos put it on Test 10' };
const BASE = { editedAt: '2026-08-27T20:36:20Z', startedAt: '2026-08-27T20:20:38Z' };

/* The banner as the engine composes it for a told verdict, sentence and all --
   `toldOverride` appends the trailing clause Josh photographed. */
const TOLD = { ...BASE, state: 'told', wroteBy: KOSMOS_EDIT,
  because: 'Kosmos put it on Test 10, and told it on its screen',
  toldAt: '2026-08-27T20:36:25Z' };

/**
 * What each staleness state does on each of the three surfaces.
 *
 * 🛑 EVERY VALUE IN `instructions.STALENESS` MUST HAVE A ROW HERE. That is the
 * guard, and it is the whole file: a fifth state cannot be added and quietly
 * inherit a fallthrough, because the suite fails until a person writes down
 * what it should do.
 */
const EXPECTED = {
  current: { banner: 'silent', member: 'silent', badge: 'silent' },
  stale:   { banner: 'stale',  member: 'silent', badge: 'mark'   },
  unknown: { banner: 'unknown', member: 'cannot-tell', badge: 'silent' },
  /* It knows. Nothing to say and nothing to do; see the renderer's comment for
     why this is silence rather than a calmer sentence. */
  told:    { banner: 'silent', member: 'silent', badge: 'silent' },
};

const sampleFor = (state) => {
  if (state === 'told') return TOLD;
  if (state === 'stale') return { ...BASE, state, wroteBy: KOSMOS_EDIT };
  if (state === 'unknown') return { ...BASE, state, wroteBy: null, because: 'we cannot tell when this agent last started' };
  return { ...BASE, state };
};

test('the instruments are reading the real page and the real vocabulary', () => {
  /* ⭐ A POSITIVE CONTROL BEFORE ANY ABSENCE IS CLAIMED. Every assertion below
     about a state saying NOTHING is equally satisfied by a lift that returned a
     signature, a page that failed to load, or an empty state list. */
  assert.ok(SCRIPT.length > 40000, `the page's script read back only ${SCRIPT.length} bytes`);
  assert.equal(typeof memberCell, 'function');
  assert.ok(Object.values(instructions.STALENESS).length >= 4,
    'the staleness vocabulary came back with fewer than four states, so the exhaustiveness check below has nothing to enforce');
  for (const known of ['current', 'stale', 'unknown', 'told']) {
    assert.ok(Object.values(instructions.STALENESS).includes(known), `STALENESS lost ${known}`);
  }
  /* And the loud arm really is reachable, so "silent" means something. */
  const { el, render } = panel();
  render(sampleFor('unknown'));
  assert.match(el.innerHTML, /This might not be what the agent is actually running/,
    'the alarming banner could not be produced at all, so no test here could show its absence');
});

test('every staleness state has a decided outcome on every surface (#1213)', () => {
  for (const state of Object.values(instructions.STALENESS)) {
    assert.ok(EXPECTED[state],
      `staleness state '${state}' has no row in EXPECTED. A new state must be given an answer on all three surfaces by hand -- `
      + `falling through is what put the loudest banner in the app under a sentence that said Kosmos knew exactly what it had done (#1213).`);
  }
});

test('a told verdict says nothing on the agent page, and never the not-knowing headline', () => {
  const { el, render } = panel();
  /* Painted stale first, so the clear path is exercised rather than a node that
     was never filled -- the failure `web.stale-banner.test.js` records needed
     three states to appear. */
  render(sampleFor('stale'));
  assert.equal(el.hidden, false);
  render(TOLD);
  assert.equal(el.hidden, true, 'the told banner stayed on screen');
  assert.equal(el.innerHTML, '', 'the told banner left content behind, which is the empty-amber-bar defect');
  render(sampleFor('stale'));
  assert.match(el.innerHTML, /data-restart-agent/,
    'the banner did not come back after a told cleared it, so the clear went around setLive rather than through it');
});

test('the sentence Josh photographed can no longer appear under the not-knowing headline', () => {
  const { el, render } = panel();
  render(TOLD);
  const html = el.innerHTML;
  assert.doesNotMatch(html, /This might not be what the agent is actually running/);
  assert.doesNotMatch(html, /told it on its screen/,
    'the told sentence is still being printed, so the contradiction survives in some form');
  assert.doesNotMatch(html, /data-restart-agent/,
    'a Restart button on a told verdict is the theatre the engine exists to avoid');
});

test('the stale banner is untouched: its words, its button and its unknown arm all still work', () => {
  const { el, render } = panel();
  render(sampleFor('stale'));
  assert.match(el.innerHTML, /Kosmos put it on Test 10/, 'the Kosmos-words sentence (#323) was lost');
  assert.match(el.innerHTML, /Restart it so it knows/);
  assert.match(el.innerHTML, /data-restart-agent/);
  render(sampleFor('unknown'));
  assert.match(el.innerHTML, /This might not be what the agent is actually running/);
  assert.doesNotMatch(el.innerHTML, /data-restart-agent/, 'the unknown arm must not offer a remedy');
  render(sampleFor('current'));
  assert.equal(el.hidden, true);
});

test('the member row and the card badge agree that told needs no mark', () => {
  assert.equal(memberCell({ instructions: TOLD }), '',
    'the member row spoke for a told verdict');
  assert.equal(badge({ instructions: TOLD }), '',
    'the card drew a warning mark for an agent that has been told');
  /* The contrast, without which the two lines above pass for a broken lift. */
  assert.match(badge({ instructions: sampleFor('stale') }), /card-stale/,
    'the badge could not be produced for a genuinely stale agent, so its absence above proves nothing');
  assert.match(memberCell({ instructions: sampleFor('unknown') }), /We cannot tell whether it has this yet/,
    'the member cell could not be produced at all, so its silence above proves nothing');
});

test('the engine names told through the shared vocabulary, not a bare literal', () => {
  /* 🔑 THE ROOT CAUSE, GUARDED. `told` was introduced in engine/projects.js as a
     string literal, so engine/instructions.js's STALENESS never learned it and
     no consumer of that list could discover it. */
  const src = fs.readFileSync(nodePath.join(__dirname, 'engine', 'projects.js'), 'utf8');
  const at = src.indexOf('function toldOverride');
  assert.ok(at > -1, 'toldOverride moved or was renamed');
  const body = src.slice(at, at + 1400);
  assert.match(body, /STALENESS\.TOLD/,
    'toldOverride is naming its state with a bare literal again, which is how it stayed invisible to every reader of STALENESS');
});
