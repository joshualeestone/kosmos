'use strict';
/**
 * Josh, 2026-08-26 item 7, from a live run: "when I opened the ChatGPT one, it
 * should have automatically collapsed the Claude one but it left the Claude one
 * open."
 *
 * ⚠️ WHAT THIS COVERS AND WHAT IT DOES NOT, said here rather than implied.
 * The helper is DRIVEN for real against a DOM stand-in, so its behaviour is
 * tested. The WIRING -- that both openers call it -- is asserted against the
 * source, because running either opener whole would drag in the confirm
 * sentence, the poll and the paint. Two halves, two methods, and the weaker
 * one is named.
 *
 *   node --test web.provider-collapse.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = PAGE.slice(PAGE.lastIndexOf('<script>') + 8, PAGE.lastIndexOf('</script>'));

function world(claudeOpen, openaiOpen) {
  const els = {
    'fr-claude-confirm': { hidden: !claudeOpen },
    'fr-openai-flow': { hidden: !openaiOpen },
    'fr-openai-confirm': { hidden: true },
    'fr-openai-connect': { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } },
  };
  const closed = [];
  const src = SCRIPT.slice(SCRIPT.indexOf('function frCollapseProviders(keep) {'));
  const body = src.slice(0, src.indexOf('\n}\n') + 3);
  assert.ok(body.includes('frCollapseProviders'), 'the helper moved; re-anchor this test');
  const ctx = {
    document: { getElementById: (id) => els[id] || null },
    frClaudeConfirmClose: () => { closed.push('claude'); els['fr-claude-confirm'].hidden = true; },
    console,
  };
  vm.runInNewContext(body, ctx);
  return { ctx, els, closed };
}

test('opening OpenAI collapses an open Claude panel', () => {
  const w = world(true, false);
  w.ctx.frCollapseProviders('openai');
  assert.equal(w.els['fr-claude-confirm'].hidden, true, 'the Claude panel stayed open');
  assert.deepEqual(w.closed, ['claude'],
    'it hid Claude directly instead of using frClaudeConfirmClose, so FR_CONFIRM_OPENER '
    + 'and aria-expanded are left claiming a panel nobody has open');
});

test('opening Claude collapses an open OpenAI panel, and resets its aria-expanded', () => {
  const w = world(false, true);
  w.ctx.frCollapseProviders('claude');
  assert.equal(w.els['fr-openai-flow'].hidden, true, 'the OpenAI panel stayed open');
  assert.equal(w.els['fr-openai-connect'].attrs['aria-expanded'], 'false',
    'the OpenAI button still says aria-expanded=true for a panel that is now closed');
});

test('opening Claude also collapses GPT\'s CONFIRM panel, not just its key form', () => {
  /* ⚠️ GPT gained a second panel (the prerequisite confirm) an hour after this
     helper was written. A collapse that knew only about the key form left the
     confirm open under Claude's -- the exact thing this exists to prevent,
     reintroduced by the change that added the panel. */
  const w = world(false, false);
  w.els['fr-openai-confirm'].hidden = false;
  w.ctx.frCollapseProviders('claude');
  assert.equal(w.els['fr-openai-confirm'].hidden, true, "GPT's confirm panel stayed open");
  assert.equal(w.els['fr-openai-connect'].attrs['aria-expanded'], 'false');
});

test('it never closes the panel it was asked to keep', () => {
  const a = world(true, false);
  a.ctx.frCollapseProviders('claude');
  assert.equal(a.els['fr-claude-confirm'].hidden, false, 'it closed the panel being opened');
  assert.deepEqual(a.closed, [], 'it called Claude close on the panel it was keeping');

  const b = world(false, true);
  b.ctx.frCollapseProviders('openai');
  assert.equal(b.els['fr-openai-flow'].hidden, false, 'it closed the panel being opened');
});

test('a panel that is already shut is not closed again', () => {
  // frClaudeConfirmClose restores aria-expanded on whichever button opened the
  // panel. Calling it for a panel nobody opened moves that state for no reason.
  const w = world(false, false);
  w.ctx.frCollapseProviders('openai');
  assert.deepEqual(w.closed, [], 'it closed an already-closed Claude panel');
});

test('both openers actually call it (source, and this is the weaker half)', () => {
  const claude = SCRIPT.slice(SCRIPT.indexOf('function frClaudeConfirmOpen(opener) {'));
  assert.match(claude.slice(0, 700), /frCollapseProviders\('claude'\)/,
    'the Claude opener does not collapse the others');
  const openai = SCRIPT.slice(SCRIPT.indexOf("document.getElementById('fr-openai-connect').addEventListener"));
  assert.match(openai.slice(0, 400), /frCollapseProviders\('openai'\)/,
    'the OpenAI opener does not collapse the others');
});
