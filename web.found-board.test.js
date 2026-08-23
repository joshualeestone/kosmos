'use strict';
/**
 * The board's panel for agents on this Mac that Kosmos is not looking after.
 *
 * 🛑 IT EXISTS BECAUSE SETUP IS A ONE-TIME SCREEN. The find-your-agents list
 * shipped inside first run, and every person it was written for -- somebody with
 * agents Kosmos could not see -- had already finished first run. Their only
 * route to it was to uninstall and set up again.
 *
 * 🔑 THE ASSERTIONS ARE ABOUT WHAT IT REFUSES TO DO. Painting a list is easy to
 * get right; the two ways this panel can hurt somebody are offering agents they
 * already have, and repainting over rows they are in the middle of pressing.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scriptOf, liftAll } = require('./test-support/page');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = scriptOf(PAGE);

/** A stub element whose markup and text stay in step, as a real one's do. */
function el() {
  let html = '';
  return {
    hidden: false,
    get innerHTML() { return html; },
    set innerHTML(v) { html = String(v); },
    /* The panel asks whether any row has been pressed. The rows it would find
       are in `html`, so the answer is derived from the markup rather than
       invented -- a stub that always answered null would make the guard
       untestable in the direction that matters. */
    querySelector(sel) {
      if (/\.fr-foundrow\.done/.test(sel)) return /class="fr-foundrow[^"]*\bdone\b/.test(html) ? {} : null;
      if (/fr-foundgo:disabled/.test(sel)) return /<button[^>]*fr-foundgo[^>]*disabled/.test(html) ? {} : null;
      return null;
    },
  };
}

async function paint(agents, opts = {}) {
  const wrap = opts.wrap || el();
  const calls = [];
  const src = liftAll(SCRIPT, ['esc', 'foundRowsHtml', 'paintFoundBoard']);
  const run = new Function('document', 'fetch', 'onAgentsTab', 'calls', `
    ${src}
    /* 🛑 DECLARED, NOT ASSIGNED. The page keeps this beside the function; a lift
       takes the function alone, so assigning it here would silently create a
       GLOBAL -- which leaks between tests and makes the signature assertions
       depend on the order they run in. Reading it first is what caught that:
       an undeclared read throws, an undeclared write does not. */
    let FOUND_SIG = ${JSON.stringify(opts.sig === undefined ? null : opts.sig)};
    return paintFoundBoard();
  `);
  await run(
    { getElementById: (id) => (id === 'found-wrap' ? wrap : null) },
    async (url) => { calls.push(url); return opts.res || { ok: true, json: async () => ({ ok: true, agents }) }; },
    () => opts.onTab !== false,
    calls,
  );
  return { wrap, calls };
}

const LOOSE = { dir: '/w/anna', name: 'Anna', role: 'Copywriter', already: false };
const KEPT = { dir: '/w/bob', name: 'Bob', role: 'Editor', already: true };

test('it offers only the agents Kosmos does not already have', async () => {
  const { wrap } = await paint([LOOSE, KEPT]);
  assert.equal(wrap.hidden, false);
  assert.match(wrap.innerHTML, /Anna/);
  assert.doesNotMatch(wrap.innerHTML, /Bob/,
    'an agent Kosmos already looks after is offered back to the person who added it');
  assert.match(wrap.innerHTML, /There is an agent on this Mac/,
    'the count is not the number of rows drawn');
});

test('nothing to add means no panel at all', async () => {
  const { wrap } = await paint([KEPT]);
  assert.equal(wrap.hidden, true);
  assert.equal(wrap.innerHTML, '', 'the panel is hidden but still holds a list');
});

test('a look that failed leaves the panel alone rather than emptying it', async () => {
  /* 🛑 THE DIRECTION THAT MATTERS. This whole feature exists because a silence
     was read as an all-clear. A 500 that clears the panel tells somebody with
     agents that they have none, which is the original defect with a new cause. */
  const wrap = el();
  wrap.innerHTML = '<div class="pj-empty">a list that is already on screen</div>';
  await paint([], { wrap, res: { ok: false, json: async () => ({}) } });
  assert.match(wrap.innerHTML, /already on screen/, 'a failed look wiped the panel');
  assert.equal(wrap.hidden, false);
});

test('it does not repaint over a row somebody has pressed', async () => {
  /* The five-second poll would otherwise rebuild the list mid-press and throw
     away every "Added" on the screen. */
  const wrap = el();
  wrap.innerHTML = '<div class="fr-foundrow done">pressed</div>';
  const { calls } = await paint([LOOSE], { wrap });
  assert.match(wrap.innerHTML, /pressed/, 'a pressed row was repainted away');
  assert.equal(calls.length, 0, 'it asked the machine before checking whether it may paint');
});

test('it is not drawn on another tab', async () => {
  const { wrap, calls } = await paint([LOOSE], { onTab: false });
  assert.equal(wrap.hidden, true);
  assert.equal(calls.length, 0);
});

test('an unchanged list is not rebuilt', async () => {
  /* Rebuilding identical markup every five seconds is what steals focus from a
     button somebody is tabbing to. */
  const wrap = el();
  wrap.innerHTML = '<div class="pj-empty">first paint</div>';
  await paint([LOOSE], { wrap, sig: '/w/anna' });
  assert.match(wrap.innerHTML, /first paint/, 'the same list was painted again');
  assert.equal(wrap.hidden, false);
});

test('a changed list IS rebuilt', async () => {
  /* CONTROL for the test above: a signature check that never lets anything
     through is indistinguishable from a panel that never paints. */
  const wrap = el();
  wrap.innerHTML = '<div class="pj-empty">first paint</div>';
  await paint([LOOSE], { wrap, sig: '/w/somebody-else' });
  assert.doesNotMatch(wrap.innerHTML, /first paint/, 'a different list did not repaint');
  assert.match(wrap.innerHTML, /Anna/);
});
