'use strict';
// Browser-check-surface: pj-post pj-say
/*
 * kosmos (Josh, 2026-09-21): the PROJECT composers read cleaner as a filled field with NO
 * stroke. This asserts the resting border is GONE on the two project composers -- the room
 * post box (#pj-post, inside .pjmid .composer) and the project agent-say box (#pj-say) -- in
 * BOTH the tab and consolidated layouts, and in BOTH themes.
 *
 * WHY A BROWSER. The removal is a scoped CSS override (`.pjmid .composer .composerbox,
 * .pj-say.composerbox { border: 0 }`) layered over the base `.composerbox` border. A source
 * grep can see the rule text but not whether it actually WINS at render time against the base
 * rule's specificity, nor that it wins in the consolidated layout too. Only a computed
 * border-width tells you the stroke is really gone.
 *
 * THE CONTROL IS THE SCOPING. The agent-dialogue composer (#d-say, `.dmbar composerbox`) must
 * KEEP its border -- if the override had over-reached to the base rule, that border would be 0
 * too and this check reds. So it proves the removal is scoped to the project composers, not
 * the whole app. (The base-rule text itself is separately guarded by web.focus-ring-1303d.)
 *
 * HERMETIC: loads web/index.html over file://, seeds one project, renders pj-one-view. Reds on
 * origin/main, where the project composers still carry the 1px --k-rule border.
 *
 * WHY BOTH LAYOUTS. The override selector is layout-independent today, so tab and consolidated
 * currently resolve the same computed border. The consolidated arm is kept deliberately as a
 * tripwire: if a future consolidated-only composer rule re-adds a border (there are already
 * consolidated-scoped .pjmid .composer overrides in this file), this arm reds while the tab arm
 * stays green. It is defensive coverage of a real seam, not redundant belt-and-suspenders.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-composer-stroke.js
 * HEADED by default; HEADED=0 on a console-less machine.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-composer-stroke: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = 'file://' + nodePath.join(nodePath.resolve(__dirname, '..', '..'), 'web', 'index.html');

const problems = [];
let pass = 0;
function ok(name, cond, detail) { if (cond) pass += 1; else problems.push(name + (detail ? ' -- ' + detail : '')); }

// Seed a project and open its one-view in the given layout, then read the computed
// top-border-width of the two project composers and the agent-dialogue control.
async function readBorders(page, layout) {
  return page.evaluate((lay) => {
    const mk = (id, name) => ({ id, name, parent: null, parentName: null, parentArchived: false, archived: false, summary: {}, agents: [], description: '', unread: 0 });
    try {
      PROJECTS = [mk('k', 'Kosmos')];
      PJ_SORT = 'az';
      PJ_CURRENT = 'k';
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.documentElement.setAttribute('data-layout', lay);
      showTab('projects');
      if (typeof pjView === 'function') pjView('one');
      const bw = (el) => el ? Math.round(parseFloat(getComputedStyle(el).borderTopWidth)) : null;
      const boxOf = (id) => { const e = document.getElementById(id); return e ? e.closest('.composerbox') : null; };
      return {
        consolidated: document.body.classList.contains('consolidated'),
        post: bw(boxOf('pj-post')),
        say: bw(boxOf('pj-say')),
        dsay: bw(boxOf('d-say')),   // control: the agent-dialogue composer keeps its border
      };
    } catch (e) { return { err: e && e.message ? e.message : String(e) }; }
  }, layout);
}

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-composer-stroke: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }

  for (const theme of ['light', 'dark']) {
    const t = '[' + theme + ']';
    for (const layout of ['tabs', 'consolidated']) {
      // consolidated view is offered at >= 960px; give it room.
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: theme });
      page.on('pageerror', (e) => problems.push(t + ' pageerror: ' + e.message));
      await page.goto(PAGE);
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
      const r = await readBorders(page, layout);
      const lt = t + '[' + layout + ']';
      ok(lt + ' render setup succeeded', r && r.err == null && r.post != null && r.say != null, JSON.stringify(r));
      ok(lt + ' the room post composer (#pj-post) has no stroke', r && r.post === 0, JSON.stringify(r));
      ok(lt + ' the agent-say composer (#pj-say) has no stroke', r && r.say === 0, JSON.stringify(r));
      // Control: the agent-dialogue composer keeps its border, proving the removal is scoped.
      ok(lt + ' CONTROL the agent-dialogue composer (#d-say) keeps its border', r && r.dsay != null && r.dsay > 0, JSON.stringify(r));
      await page.close();
    }
  }

  await browser.close();
  if (problems.length) {
    console.error('render-composer-stroke: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-composer-stroke: ' + pass + ' passed (the project composers #pj-post and #pj-say render with no border in tab + consolidated views, both themes; the agent-dialogue composer #d-say keeps its border, proving the removal is scoped). problems: none');
  process.exit(0);
})().catch((e) => { console.error('FAIL  render-composer-stroke: ' + (e && e.message ? e.message.split('\n')[0] : e)); process.exit(1); });
