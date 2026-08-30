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
  const attrs = {};
  return {
    hidden: false,
    textContent: '',
    attrs,
    setAttribute(k, v) { attrs[k] = v; },
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
  const list = opts.list || el();
  const toggle = opts.toggle || el();
  const calls = [];
  /* ⚠️ `adoptRowsHtml` AND `cssId` JOINED WHEN THE ADOPT PROMPT SHIPPED (#1531).
     `paintFoundBoard` calls the first and it calls the second, and a lifted function
     whose callees are missing throws `not defined` rather than failing an assertion,
     which reads like a broken harness rather than a missing name. */
  const src = liftAll(SCRIPT, ['esc', 'foundRowsHtml', 'adoptRowsHtml', 'cssId', 'paintFoundBoard']);
  const run = new Function('document', 'fetch', 'onAgentsTab', 'calls', `
    ${src}
    /* 🛑 DECLARED, NOT ASSIGNED. The page keeps these beside the function; a
       lift takes the function alone, so assigning them here would silently
       create GLOBALS -- which leak between tests and make the signature
       assertions depend on the order they run in. Reading one first is what
       caught that: an undeclared read throws, an undeclared write does not. */
    let FOUND_SIG = ${JSON.stringify(opts.sig === undefined ? null : opts.sig)};
    let FOUND_OPEN = ${opts.open === undefined ? 'true' : JSON.stringify(opts.open)};
    return paintFoundBoard();
  `);
  await run(
    {
      getElementById: (id) => (
        id === 'found-wrap' ? wrap : id === 'found-list' ? list : id === 'found-toggle' ? toggle : null),
    },
    async (url) => { calls.push(url); return opts.res || { ok: true, json: async () => ({ ok: true, agents }) }; },
    () => opts.onTab !== false,
    calls,
  );
  return { wrap, list, toggle, calls };
}

const LOOSE = { dir: '/w/anna', name: 'Anna', role: 'Copywriter', already: false };
const KEPT = { dir: '/w/bob', name: 'Bob', role: 'Editor', already: true };

test('it offers only the agents Kosmos does not already have', async () => {
  const { wrap, list, toggle } = await paint([LOOSE, KEPT]);
  assert.equal(wrap.hidden, false);
  assert.match(list.innerHTML, /Anna/);
  assert.doesNotMatch(list.innerHTML, /Bob/,
    'an agent Kosmos already looks after is offered back to the person who added it');
  assert.match(toggle.textContent, /^We found an agent on your computer\. (Show|Hide) it$/,
    'the sentence does not count the rows drawn (one row, singular)');
});

test('it is a fold, shut until somebody opens it', async () => {
  /* Josh, 2026-08-23: its own expandable area. A list that opens itself every
     time the board loads is a list that has to be dismissed. */
  const { wrap, list, toggle } = await paint([LOOSE], { open: false });
  assert.equal(wrap.hidden, false, 'the fold itself is hidden, so there is nothing to open');
  assert.equal(list.hidden, true, 'the list is open before anybody asked for it');
  assert.match(toggle.textContent, /\. Show (it|them)$/);
  assert.doesNotMatch(toggle.textContent, /\d/, 'a number is back in the sentence; Josh ruled none');
  assert.equal(toggle.attrs['aria-expanded'], 'false');

  const open = await paint([LOOSE], { open: true });
  assert.equal(open.list.hidden, false);
  assert.match(open.toggle.textContent, /\. Hide (it|them)$/);
  assert.equal(open.toggle.attrs['aria-expanded'], 'true');
});

test('nothing to add means no panel at all', async () => {
  const { wrap, list } = await paint([KEPT]);
  assert.equal(wrap.hidden, true);
  assert.equal(list.innerHTML, '', 'the panel is hidden but still holds a list');
});

test('a look that failed leaves the panel alone rather than emptying it', async () => {
  /* 🛑 THE DIRECTION THAT MATTERS. This whole feature exists because a silence
     was read as an all-clear. A 500 that clears the panel tells somebody with
     agents that they have none, which is the original defect with a new cause. */
  const list = el();
  list.innerHTML = '<div>a list that is already on screen</div>';
  await paint([], { list, res: { ok: false, json: async () => ({}) } });
  assert.match(list.innerHTML, /already on screen/, 'a failed look wiped the panel');
});

test('it does not repaint over a row somebody has pressed', async () => {
  /* The five-second poll would otherwise rebuild the list mid-press and throw
     away every "Added" on the screen. */
  const list = el();
  list.innerHTML = '<div class="fr-foundrow done">pressed</div>';
  const { calls } = await paint([LOOSE], { list });
  assert.match(list.innerHTML, /pressed/, 'a pressed row was repainted away');
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
  const list = el();
  list.innerHTML = '<div>first paint</div>';
  const { wrap } = await paint([LOOSE], { list, sig: '/w/anna' });
  assert.match(list.innerHTML, /first paint/, 'the same list was painted again');
  assert.equal(wrap.hidden, false);
});

test('a changed list IS rebuilt', async () => {
  /* CONTROL for the test above: a signature check that never lets anything
     through is indistinguishable from a panel that never paints. */
  const list = el();
  list.innerHTML = '<div>first paint</div>';
  await paint([LOOSE], { list, sig: '/w/somebody-else' });
  assert.doesNotMatch(list.innerHTML, /first paint/, 'a different list did not repaint');
  assert.match(list.innerHTML, /Anna/);
});

test('leaving the Agents tab hides the found-agents block (it followed a person to every other tab)', () => {
  const fs2 = require('node:fs');
  const page = fs2.readFileSync(require('node:path').join(__dirname, 'web', 'index.html'), 'utf8');
  const script = page.slice(page.lastIndexOf('<script>'));
  const st = script.slice(script.indexOf('function showTab('), script.indexOf('function showTab(') + 5000);
  const off = st.slice(st.indexOf('if (!agents) {'), st.indexOf('} else {', st.indexOf('if (!agents) {')));
  assert.match(off, /getElementById\('found-wrap'\)\.hidden = true;/, 'the found block is not hidden when the tab changes; it was on every screen but Agents on 0.5.21');
  assert.match(off, /getElementById\('removed-wrap'\)\.hidden = true;/, 'CONTROL: the removed block, hidden the same way, is not in this slice');
});
