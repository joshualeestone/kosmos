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
  const desc = opts.desc || el();
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
    /* #2651: the panel is gated behind DISCOVERY_OPENED (an explicit "Look for agents"
       press). Default it OPEN here so the rendering tests below exercise the panel's
       behaviour as before; a test passes opened:false to assert the gate itself. */
    let DISCOVERY_OPENED = ${opts.opened === undefined ? 'true' : JSON.stringify(opts.opened)};
    /* #2651: paintFoundBoard WRITES this on the body.dismissed branch. Declared (not
       assigned as a global) for the same reason as the others above: an undeclared write
       would silently leak a global, per this file's own doctrine. No test here exercises
       the dismissed branch yet; the declaration keeps a future one honest. */
    let DISCOVERY_DISMISSED = false;
    return paintFoundBoard();
  `);
  await run(
    {
      getElementById: (id) => (
        id === 'found-wrap' ? wrap : id === 'found-list' ? list : id === 'found-toggle' ? toggle
          : id === 'found-desc' ? desc : null),
    },
    async (url) => { calls.push(url); return opts.res || { ok: true, json: async () => ({ ok: true, agents }) }; },
    () => opts.onTab !== false,
    calls,
  );
  return { wrap, list, toggle, desc, calls };
}

const LOOSE = { dir: '/w/anna', name: 'Anna', role: 'Copywriter', already: false };
const KEPT = { dir: '/w/bob', name: 'Bob', role: 'Editor', already: true };

test('it offers only the agents Kosmos does not already have', async () => {
  const { wrap, list, toggle, desc } = await paint([LOOSE, KEPT]);
  assert.equal(wrap.hidden, false);
  assert.match(list.innerHTML, /Anna/);
  assert.doesNotMatch(list.innerHTML, /Bob/,
    'an agent Kosmos already looks after is offered back to the person who added it');
  // #2660-sibling: the sentence lives in the plain description now, the Show/Hide
  // verb in its own button. The sentence still does not count the rows (singular).
  assert.match(desc.textContent, /^We found an agent on your computer\.$/,
    'the sentence does not count the rows drawn (one row, singular)');
  assert.match(toggle.textContent, /^(Show|Hide) it$/, 'the button carries the Show/Hide verb, singular');
});

test('it is a fold, shut until somebody opens it', async () => {
  /* Josh, 2026-08-23: its own expandable area. A list that opens itself every
     time the board loads is a list that has to be dismissed. */
  const { wrap, list, toggle, desc } = await paint([LOOSE], { open: false });
  assert.equal(wrap.hidden, false, 'the fold itself is hidden, so there is nothing to open');
  assert.equal(list.hidden, true, 'the list is open before anybody asked for it');
  assert.match(toggle.textContent, /^Show (it|them)$/);
  assert.doesNotMatch(desc.textContent, /\d/, 'a number is back in the sentence; Josh ruled none');
  assert.equal(toggle.attrs['aria-expanded'], 'false');

  const open = await paint([LOOSE], { open: true });
  assert.equal(open.list.hidden, false);
  assert.match(open.toggle.textContent, /^Hide (it|them)$/);
  assert.equal(open.toggle.attrs['aria-expanded'], 'true');
});

test('nothing to add means no panel at all', async () => {
  const { wrap, list } = await paint([KEPT]);
  assert.equal(wrap.hidden, true);
  assert.equal(list.innerHTML, '', 'the panel is hidden but still holds a list');
});

test('#2651: it stays hidden and fetches nothing until discovery is opened', async () => {
  /* Landing on the Agents page must not auto-scan-and-show the found panel. With a
     real candidate present, an UNOPENED panel is still hidden and no /api/found-agents
     fetch fires; the user reveals it with the explicit "Look for agents" press
     (DISCOVERY_OPENED). Before #2651 a candidate showed the panel on every poll. */
  const { wrap, list, calls } = await paint([LOOSE], { opened: false });
  assert.equal(wrap.hidden, true, 'the found panel auto-showed on load (the #2651 gate did not hold)');
  assert.equal(list.innerHTML, '', 'the found panel rendered rows before discovery was opened');
  assert.equal(calls.length, 0, 'the found panel fetched /api/found-agents before the user asked to look');
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
  assert.match(off, /getElementById\('found-scan-trigger'\)[\s\S]{0,40}\.hidden = true;/, '#2651: the discovery trigger is not hidden when the tab changes; like its two panels it would otherwise follow the person off the Agents tab');
});

/* #2651: the SCAN panel's DISCOVERY_OPENED gate, the symmetric partner to the found-panel
   gate ("it stays hidden and fetches nothing until discovery is opened") above.
   paintScanBoard is a SEPARATE renderer (its own element ids, its own callees, /api/scan-agents),
   so the found gate test does not touch it; before this the scan half of the gate had only the
   browser check, which prints "SKIPPED" and exits 0 when Playwright is not on NODE_PATH. */
async function paintScan(candidates, opts = {}) {
  const wrap = opts.wrap || el();
  const list = opts.list || el();
  const toggle = opts.toggle || el();
  const desc = opts.desc || el();
  const calls = [];
  const src = liftAll(SCRIPT, ['esc', 'cssId', 'scanRowsHtml', 'paintScanBoard']);
  const run = new Function('document', 'fetch', 'onAgentsTab', 'calls', `
    ${src}
    let SCAN_SIG = ${JSON.stringify(opts.sig === undefined ? null : opts.sig)};
    let SCAN_OPEN = ${opts.open === undefined ? 'true' : JSON.stringify(opts.open)};
    let DISCOVERY_OPENED = ${opts.opened === undefined ? 'true' : JSON.stringify(opts.opened)};
    let DISCOVERY_DISMISSED = false;
    return paintScanBoard();
  `);
  await run(
    {
      getElementById: (id) => (
        id === 'scan-wrap' ? wrap : id === 'scan-list' ? list : id === 'scan-toggle' ? toggle
          : id === 'scan-desc' ? desc : null),
    },
    async (url) => { calls.push(url); return opts.res || { ok: true, json: async () => ({ ok: true, candidates }) }; },
    () => opts.onTab !== false,
    calls,
  );
  return { wrap, list, toggle, desc, calls };
}

const SCAN_CAND = { dir: '/w/unseen', name: 'Unseen', role: 'Unknown', already: false };

test('#2651: the scan panel stays hidden and fetches nothing until discovery is opened', async () => {
  const { wrap, list, calls } = await paintScan([SCAN_CAND], { opened: false });
  assert.equal(wrap.hidden, true, 'the scan panel auto-showed on load (the #2651 gate did not hold)');
  assert.equal(list.innerHTML, '', 'the scan panel rendered rows before discovery was opened');
  assert.equal(calls.length, 0, 'the scan panel fetched /api/scan-agents before the user asked to look');
});

test('#2651 CONTROL: the scan panel DOES open and fetch once discovery is opened', async () => {
  /* Without this the gate test above passes on a panel that never shows at all, exactly the
     failure it is meant to catch. */
  const { wrap, list, calls } = await paintScan([SCAN_CAND], { opened: true });
  assert.equal(wrap.hidden, false, 'the scan panel did not open after discovery was opened');
  assert.match(list.innerHTML, /CLAUDE\.md/, 'the scan panel opened but rendered no candidate note');
  assert.equal(calls.length, 1, 'the scan panel did not fetch /api/scan-agents when opened');
});
