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

    // Render one fixture's card into a detached node and read the render facts.
    const read = (over) => {
      const a = Object.assign({}, base, over);
      const d = document.createElement('div');
      d.innerHTML = card(a);
      const el = d.firstElementChild;
      const pill = el.querySelector('.astate');
      const also = el.querySelector('.alsowork');
      const dots = also ? also.querySelectorAll('.act i').length : 0;
      return {
        cardClass: el.className,
        pillClass: pill ? pill.className : null,
        pillLabel: pill ? ((pill.querySelector('b') || {}).textContent || '') : null,
        hasAlso: !!also,
        alsoDots: dots,
        alsoText: also ? also.textContent.replace(/\s+/g, ' ').trim() : null,
        // the badge is a SIBLING of the pill, not nested inside it (so it cannot
        // dilute the "Answer" call-to-action Josh made the pill's loudest thing).
        alsoIsSibling: !!(also && pill && also.parentElement === pill.parentElement && also !== pill),
      };
    };

    return {
      needsOn:  read({ state: 'needs_you', activeWhileWaiting: true }),
      needsOff: read({ state: 'needs_you', activeWhileWaiting: false }),
      blockedOn: read({ state: 'blocked', activeWhileWaiting: true }),
      workingOff: read({ state: 'working', activeWhileWaiting: false }),
    };
  }, BASE);

  await browser.close();

  const problems = [];
  if (r.error) {
    problems.push(r.error);
  } else {
    const { needsOn, needsOff, blockedOn, workingOff } = r;

    // 1. flag ON, needs_you: the badge is present, is the reused .act glyph (3 dots),
    //    carries the "Working now" label, and sits BESIDE the pill (not inside it).
    if (!needsOn.hasAlso) problems.push('a needs_you agent with activeWhileWaiting has NO working affordance (.alsowork)');
    if (needsOn.hasAlso && needsOn.alsoDots !== 3) problems.push('the working affordance is not the board .act glyph (want 3 dots, got ' + needsOn.alsoDots + ')');
    if (needsOn.hasAlso && !/working now/i.test(needsOn.alsoText || '')) problems.push('the working affordance has no readable "Working now" label, got ' + JSON.stringify(needsOn.alsoText));
    if (needsOn.hasAlso && !needsOn.alsoIsSibling) problems.push('the working affordance is nested inside the pill, not a sibling (it must not dilute the Answer button)');

    // 2. CONTROL: flag OFF on the SAME needs_you agent -> NO badge, and the flag
    //    changed ONLY the badge: the pill class, its label, and the card ground
    //    are IDENTICAL either way (coexistence is additive, never a state change).
    if (needsOff.hasAlso) problems.push('CONTROL FAILED: a needs_you agent WITHOUT activeWhileWaiting still shows .alsowork (the flag is not gating it)');
    if (needsOn.pillClass !== needsOff.pillClass) problems.push('activeWhileWaiting changed the state PILL class (' + needsOff.pillClass + ' -> ' + needsOn.pillClass + '); it must be additive');
    if (needsOn.pillLabel !== needsOff.pillLabel) problems.push('activeWhileWaiting changed the state LABEL (' + JSON.stringify(needsOff.pillLabel) + ' -> ' + JSON.stringify(needsOn.pillLabel) + '); it must be additive');
    if (needsOn.cardClass !== needsOff.cardClass) problems.push('activeWhileWaiting changed the card GROUND class (' + needsOff.cardClass + ' -> ' + needsOn.cardClass + '); state owns the ground');
    // and the needs_you pill really is the red "attn" treatment (so the "unchanged" above is unchanged from the right thing).
    if (!/st-attn/.test(needsOn.pillClass || '')) problems.push('the needs_you pill is not st-attn (got ' + needsOn.pillClass + '); the fixture is not exercising the needs_you treatment');

    // 3. flag ON, blocked: the badge appears there too (paused pill) -> driven by
    //    the FLAG, not scoped to the red needs_you pill.
    if (!blockedOn.hasAlso) problems.push('a BLOCKED agent with activeWhileWaiting has no .alsowork (the render is wrongly scoped to needs_you only)');
    if (blockedOn.hasAlso && !/st-paused/.test(blockedOn.pillClass || '')) problems.push('the blocked fixture is not the paused treatment (got ' + blockedOn.pillClass + ')');

    // 4. CONTROL: a plain WORKING agent (flag off) is NOT given the badge.
    if (workingOff.hasAlso) problems.push('CONTROL FAILED: a plain working agent shows .alsowork (it should read as working via its own pill, not be double-marked)');
    if (!/st-working/.test(workingOff.pillClass || '')) problems.push('the working fixture is not st-working (got ' + workingOff.pillClass + ')');
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-workindicator-2146: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-workindicator-2146: OK (activeWhileWaiting paints the working glyph alongside needs_you/blocked, additively, without changing state/label/ground)');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
