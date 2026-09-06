'use strict';

/**
 * kosmos#2146 (Angel, the render half): a needs_you/blocked agent that is ALSO
 * actively working must show the board's working glyph ALONGSIDE its pending
 * state -- coexistence, not precedence. The engine half (#2169, PigeonPete)
 * emits the additive `activeWhileWaiting` boolean on the card payload when a
 * sticky needs_you/blocked agent has a fresh post-ask work signal that
 * reconcileReport otherwise suppresses. THIS check pins the RENDER of that flag:
 * a `.alsowork` affordance (the reused `.act` dots + a "Working now" label)
 * appears WITHOUT changing the state pill, its label, or the card's ground
 * treatment -- because a precedence flip would reintroduce the false-calm the
 * sticky needs_you exists to prevent.
 *
 * ⚠️ WHY A BROWSER. The card is built in JS by the page's own `card()`; the
 * affordance and the "state is unchanged" property are DOM facts a source grep
 * cannot see. HERMETIC: loads web/index.html over file://, boots no server, and
 * calls the page's real `card()` with fixture agents. It does NOT depend on the
 * engine -- the render is verified on its own contract (the `activeWhileWaiting`
 * field), which is the right scope for the render half.
 *
 * The controls that make the passes mean something (each can return the
 * dangerous answer):
 *  - flag OFF on the SAME needs_you agent: `.alsowork` must be ABSENT, and the
 *    pill class + label + card ground must be IDENTICAL to the flag-ON card, so
 *    the flag's ONLY effect is the additive badge (not a state/label change),
 *  - flag ON on a BLOCKED agent: the badge appears there too (paused pill), so
 *    the render is driven by the FLAG, not scoped to the red needs_you pill,
 *  - a plain WORKING agent (flag off) is NOT given the badge -- a working card
 *    already reads as working via its own pill, and must not be double-marked.
 *
 * Reds on the pre-#2146 page (no `.alsowork` anywhere). Perturb-verified.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-workindicator-2146.js
 * HEADED by default; HEADED=0 on a console-less machine.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-workindicator-2146: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

const BASE = {
  name: 'April', sessionName: 'april', displayName: 'April', role: 'a researcher',
  present: true, running: true, modelName: 'Opus 5', context: null, stateConfidence: 'reported',
};

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-workindicator-2146: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate((base) => {
    if (typeof card !== 'function') return { error: 'card is not a function (pre-render page?)' };
    if (typeof lrow !== 'function') return { error: 'lrow is not a function (pre-render page?)' };

    // Render one fixture through a renderer into a detached node and read the
    // render facts. `pillSel` differs per surface (the grid card's state cell is
    // .astate; the list row's is .lstate) -- THE LIST IS HALF THE BOARD, so both
    // renderers must carry the coexistence signal (a card-only fix is the
    // recurring one-renderer debt this file names).
    const read = (render, pillSel, over) => {
      const a = Object.assign({}, base, over);
      const d = document.createElement('div');
      d.innerHTML = render(a);
      const el = d.firstElementChild;
      const pill = el.querySelector(pillSel);
      const also = el.querySelector('.alsowork');
      const dots = also ? also.querySelectorAll('.act i').length : 0;
      // Read the state LABEL with the badge stripped out. The list row puts the
      // badge INSIDE .lstate, so reading the raw cell text would fold "Working
      // now" into the label and make the additive-label control falsely fail;
      // the grid card's pill never contains the badge, so this is a no-op there.
      let pillLabel = null;
      if (pill) {
        const clone = pill.cloneNode(true);
        const inner = clone.querySelector('.alsowork');
        if (inner) inner.remove();
        pillLabel = (clone.querySelector('b') || clone).textContent.replace(/\s+/g, ' ').trim();
      }
      return {
        rootClass: el.className,
        pillClass: pill ? pill.className : null,
        pillLabel,
        hasAlso: !!also,
        alsoDots: dots,
        alsoText: also ? also.textContent.replace(/\s+/g, ' ').trim() : null,
        // Placement differs by surface and both are deliberate: the grid card
        // puts the badge BELOW the pill (not inside it, so it cannot dilute the
        // Answer button), the list row puts it INSIDE the .lstate cell (the
        // sanctioned second-line shape, never an eighth grid child).
        alsoInsidePill: !!(also && pill && pill.contains(also)),
        // DOM ORDER: the badge must FOLLOW the pill, never precede it -- a
        // regression that rendered it above the pill (card) is caught here.
        // compareDocumentPosition's FOLLOWING bit (4) is set both when `also` is
        // a later sibling (card) and when it is contained-after (lrow), so this
        // one predicate is correct on both surfaces.
        alsoAfterPill: !!(also && pill && (pill.compareDocumentPosition(also) & 4)),
      };
    };
    const cardRead = (over) => read(card, '.astate', over);
    const rowRead = (over) => read(lrow, '.lstate', over);

    return {
      // grid card
      needsOn:  cardRead({ state: 'needs_you', activeWhileWaiting: true }),
      needsOff: cardRead({ state: 'needs_you', activeWhileWaiting: false }),
      blockedOn: cardRead({ state: 'blocked', activeWhileWaiting: true }),
      workingOff: cardRead({ state: 'working', activeWhileWaiting: false }),
      // list row (the other half of the board)
      rowNeedsOn:  rowRead({ state: 'needs_you', activeWhileWaiting: true }),
      rowNeedsOff: rowRead({ state: 'needs_you', activeWhileWaiting: false }),
      rowBlockedOn: rowRead({ state: 'blocked', activeWhileWaiting: true }),
      rowWorkingOff: rowRead({ state: 'working', activeWhileWaiting: false }),
    };
  }, BASE);

  // Consolidated-view arm: the list row is restyled in the consolidated layout,
  // which deliberately HIDES every decorative glyph inside .lstate and shrinks it.
  // The badge's dots nest a level deeper than the direct-child hide rule, so
  // without a dedicated rule they reappear; and the badge's fixed font-size would
  // out-size the consolidated label. This needs COMPUTED styles in the LIVE DOM
  // under the consolidated classes, which the detached-node reads above cannot see.
  const cons = await page.evaluate((base) => {
    const a = Object.assign({}, base, { name: 'Baron', sessionName: 'baron', state: 'needs_you', activeWhileWaiting: true });
    const host = document.createElement('div'); host.id = '__cons'; host.innerHTML = lrow(a);
    document.body.appendChild(host);
    // Probe the .act SPAN, which the consolidated rule sets to display:none.
    // (Reading a child <i> is wrong: a node's own computed display stays its
    // cascaded value even when an ancestor is display:none, so the <i> would
    // read visible and never catch the hide.)
    const dotSpan = host.querySelector('.alsowork .act');
    const also = host.querySelector('.alsowork');
    const lstate = host.querySelector('.lstate');
    const read = () => ({
      dotDisplay: dotSpan ? getComputedStyle(dotSpan).display : '__no-dot__',
      alsoSize: also ? getComputedStyle(also).fontSize : null,
      lstateSize: lstate ? getComputedStyle(lstate).fontSize : null,
    });
    // Default (non-consolidated) layout: the control -- dots visible.
    document.documentElement.removeAttribute('data-layout');
    document.body.classList.remove('consolidated');
    const normal = read();
    // Consolidated layout.
    document.documentElement.setAttribute('data-layout', 'consolidated');
    document.body.classList.add('consolidated');
    const consolidated = read();
    document.documentElement.removeAttribute('data-layout');
    document.body.classList.remove('consolidated');
    host.remove();
    return { normal, consolidated };
  }, BASE);

  await browser.close();

  const problems = [];
  if (r.error) {
    problems.push(r.error);
  } else {
    // The surface-AGNOSTIC battery: badge presence, the additive property, the
    // controls. It never reads a state CLASS, because the two surfaces encode
    // state differently -- the card carries st-* on its pill, the list row
    // carries the ground on its .lrow ROOT and its .lstate cell has no st-*
    // class at all. State-treatment sanity is checked per surface below.
    //   insideExpected: card places the badge BELOW the pill (false), the list
    //   row INSIDE .lstate (true) -- both deliberate.
    const battery = (S, on, off, blockedOn, workingOff, insideExpected) => {
      // 1. flag ON: badge present, reused .act glyph (3 dots), "Working now" label, correct placement.
      if (!on.hasAlso) problems.push(S + ': a needs_you agent with activeWhileWaiting has NO working affordance (.alsowork)');
      if (on.hasAlso && on.alsoDots !== 3) problems.push(S + ': the working affordance is not the board .act glyph (want 3 dots, got ' + on.alsoDots + ')');
      if (on.hasAlso && !/working now/i.test(on.alsoText || '')) problems.push(S + ': the working affordance has no readable "Working now" label, got ' + JSON.stringify(on.alsoText));
      if (on.hasAlso && on.alsoInsidePill !== insideExpected) problems.push(S + ': the working affordance placement is wrong (inside state cell=' + on.alsoInsidePill + ', want ' + insideExpected + ')');
      if (on.hasAlso && !on.alsoAfterPill) problems.push(S + ': the working affordance precedes the state pill in DOM order (it must follow it, never render above/before it)');

      // 2. CONTROL: flag OFF on the SAME needs_you agent -> NO badge, and the flag
      //    changed ONLY the badge: the state-cell class, the label, and the ground
      //    class are IDENTICAL either way (coexistence is additive, not a state change).
      if (off.hasAlso) problems.push(S + ': CONTROL FAILED: a needs_you agent WITHOUT activeWhileWaiting still shows .alsowork (the flag is not gating it)');
      if (on.pillClass !== off.pillClass) problems.push(S + ': activeWhileWaiting changed the state-cell class (' + off.pillClass + ' -> ' + on.pillClass + '); it must be additive');
      if (on.pillLabel !== off.pillLabel) problems.push(S + ': activeWhileWaiting changed the state LABEL (' + JSON.stringify(off.pillLabel) + ' -> ' + JSON.stringify(on.pillLabel) + '); it must be additive');
      if (on.rootClass !== off.rootClass) problems.push(S + ': activeWhileWaiting changed the ground class (' + off.rootClass + ' -> ' + on.rootClass + '); state owns the ground');

      // 3. flag ON, blocked: the badge appears there too -> driven by the FLAG, not scoped to needs_you.
      if (!blockedOn.hasAlso) problems.push(S + ': a BLOCKED agent with activeWhileWaiting has no .alsowork (the render is wrongly scoped to needs_you only)');

      // 4. CONTROL: a plain WORKING agent (flag off) is NOT given the badge.
      if (workingOff.hasAlso) problems.push(S + ': CONTROL FAILED: a plain working agent shows .alsowork (it should read as working via its own state, not be double-marked)');
    };

    battery('card', r.needsOn, r.needsOff, r.blockedOn, r.workingOff, false);
    battery('lrow', r.rowNeedsOn, r.rowNeedsOff, r.rowBlockedOn, r.rowWorkingOff, true);

    // Surface-SPECIFIC state-treatment sanity: proves the "unchanged" checks above
    // are unchanged from the RIGHT thing, and that each fixture exercises the state
    // it names. Card carries state on the pill (st-*); lrow on the .lrow root ground.
    if (!/st-attn/.test(r.needsOn.pillClass || '')) problems.push('card: the needs_you pill is not st-attn (got ' + r.needsOn.pillClass + ')');
    if (!/st-working/.test(r.workingOff.pillClass || '')) problems.push('card: the working pill is not st-working (got ' + r.workingOff.pillClass + ')');
    if (!/\battn\b/.test(r.rowNeedsOn.rootClass || '')) problems.push('lrow: the needs_you row ground is not attn (got ' + r.rowNeedsOn.rootClass + ')');
    if (!/\bworking\b/.test(r.rowWorkingOff.rootClass || '')) problems.push('lrow: the working row ground is not working (got ' + r.rowWorkingOff.rootClass + ')');

    // Consolidated view: the badge obeys the "no decorative glyph, words at row size"
    // rule -- its dots are display:none and its label inherits the .lstate size.
    if (cons.consolidated.dotDisplay !== 'none') problems.push('consolidated: the working dots are visible (display=' + cons.consolidated.dotDisplay + '); the consolidated view must not get the dot back');
    if (cons.consolidated.alsoSize && cons.consolidated.lstateSize && cons.consolidated.alsoSize !== cons.consolidated.lstateSize) problems.push('consolidated: the "Working now" label (' + cons.consolidated.alsoSize + ') does not match the consolidated .lstate size (' + cons.consolidated.lstateSize + ')');
    // CONTROL: in the NORMAL (non-consolidated) layout the dots ARE visible -- proves
    // the hide above is the consolidated rule, not a global display:none.
    if (cons.normal.dotDisplay === 'none') problems.push('consolidated CONTROL FAILED: the working dots are hidden even in the normal layout (a global hide, not the consolidated rule)');
  }

  console.log('  ' + JSON.stringify({ ...r, cons }));
  if (problems.length) {
    console.error('render-workindicator-2146: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-workindicator-2146: OK (activeWhileWaiting paints the working glyph alongside needs_you/blocked, additively, without changing state/label/ground)');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
