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

// Seed a project and open its one-view in the given layout, then read, for the two project
// composers and the agent-dialogue control: the computed top-border-width AND whether the box
// has a VISIBLE boundary against the bar behind it (a distinct, non-transparent background).
// The boundary read is the #3369 lesson: border:0 alone can leave the box invisible when its
// fill equals its container's (light theme: both --k-surface white). A recessed --k-sunk fill
// restores the boundary, and this asserts that, not merely that the stroke is gone.
async function readBorders(page, layout, plus) {
  return page.evaluate((args) => {
    const lay = args.lay, plus = args.plus;
    const mk = (id, name) => ({ id, name, parent: null, parentName: null, parentArchived: false, archived: false, summary: {}, agents: [], description: '', unread: 0 });
    try {
      PROJECTS = [mk('k', 'Kosmos')];
      PJ_SORT = 'az';
      PJ_CURRENT = 'k';
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.documentElement.setAttribute('data-layout', lay);
      showTab('projects');
      if (typeof pjView === 'function') pjView('one');
      // Set plus-active LAST, after showTab/pjView (which can call syncPlusChrome and toggle the
      // class), so it holds through the read. In plus-active the bar's `body:not(.plus-active)`
      // #000 override does NOT apply, which is exactly the "box and bar could match" case the
      // recessed fill defends against, so this arm is the plus regression tripwire.
      if (plus) document.body.classList.add('plus-active');
      const bw = (el) => el ? Math.round(parseFloat(getComputedStyle(el).borderTopWidth)) : null;
      const boxOf = (id) => { const e = document.getElementById(id); return e ? e.closest('.composerbox') : null; };
      const bg = (el) => el ? getComputedStyle(el).backgroundColor : null;
      const transparent = 'rgba(0, 0, 0, 0)';
      // A project composer has a VISIBLE boundary if its own background is set (not transparent)
      // AND differs from the bar/container immediately behind it. With border:0 that fill is the
      // only boundary, so this is what "the field is still visible" means.
      const boundary = (id) => {
        const box = boxOf(id); if (!box) return null;
        const boxBg = bg(box);
        const container = box.parentElement;   // the composer bar (pj-post) / section (pj-say)
        const contBg = bg(container);
        return { boxBg, contBg, distinct: boxBg !== transparent && boxBg !== contBg };
      };
      // #2868 drag affordance: on drag-over the box wears .composerbox.dragging, whose gold tint
      // must still win over the new recessed fill. The fill rule is :not(.dragging) exactly so it
      // does not outrank the drag rule; assert the drag-over background is the gold tint, not the
      // recessed fill. (web.composer-drop-2868.test.js only matches CSS source text, not the cascade.)
      const postBox = boxOf('pj-post');
      let dragBg = null;
      if (postBox) { postBox.classList.add('dragging'); dragBg = getComputedStyle(postBox).backgroundColor; postBox.classList.remove('dragging'); }
      return {
        consolidated: document.body.classList.contains('consolidated'),
        plusActive: document.body.classList.contains('plus-active'),
        post: bw(boxOf('pj-post')),
        say: bw(boxOf('pj-say')),
        dsay: bw(boxOf('d-say')),   // control: the agent-dialogue composer keeps its border
        postBoundary: boundary('pj-post'),
        sayBoundary: boundary('pj-say'),
        dragBg: dragBg,   // #2868: gold tint must win on drag-over, not the recessed fill
      };
    } catch (e) { return { err: e && e.message ? e.message : String(e) }; }
  }, { lay: layout, plus: !!plus });
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

  // Three theme states: light, dark, and plus-active (dark scheme + the paid navy reskin). Plus
  // is included because the bar's `body:not(.plus-active)` #000 override does NOT apply there, so
  // it is one of the combos the recessed fill defends -- verifying it here, not only by hand.
  const THEMES = [
    { name: 'light', scheme: 'light', plus: false },
    { name: 'dark', scheme: 'dark', plus: false },
    { name: 'plus', scheme: 'dark', plus: true },
  ];
  for (const theme of THEMES) {
    const t = '[' + theme.name + ']';
    for (const layout of ['tabs', 'consolidated']) {
      // consolidated view is offered at >= 960px; give it room.
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: theme.scheme });
      page.on('pageerror', (e) => problems.push(t + ' pageerror: ' + e.message));
      await page.goto(PAGE);
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
      const r = await readBorders(page, layout, theme.plus);
      const lt = t + '[' + layout + ']';
      ok(lt + ' render setup succeeded', r && r.err == null && r.post != null && r.say != null, JSON.stringify(r));
      // Self-verify the two dimensions this arm claims to exercise, so a silently-inactive layout
      // or plus state cannot re-test a combo already covered while reporting as this one.
      if (layout === 'consolidated') ok(lt + ' the consolidated layout actually activated', r && r.consolidated === true, JSON.stringify(r && { consolidated: r.consolidated }));
      if (theme.plus) ok(lt + ' plus-active actually activated', r && r.plusActive === true, JSON.stringify(r && { plusActive: r.plusActive }));
      ok(lt + ' the room post composer (#pj-post) has no stroke', r && r.post === 0, JSON.stringify(r));
      ok(lt + ' the agent-say composer (#pj-say) has no stroke', r && r.say === 0, JSON.stringify(r));
      // #3369: no stroke must not mean no boundary. With border:0 the fill is the only boundary, so
      // assert each project composer's background is DECLARED distinct from the bar behind it. This
      // is a declared-value check (getComputedStyle returns --k-sunk's own rgba, not the composited
      // pixel), which catches the exact regression that occurred -- border:0 with an inherited
      // --k-surface fill equal to the container. It does NOT prove perceptual contrast (a near-zero
      // alpha fill would pass); that is an accepted limit, and the fill token is design-owned.
      ok(lt + ' the room post composer (#pj-post) keeps a visible boundary (fill declared-distinct from its bar)', r && r.postBoundary && r.postBoundary.distinct === true, JSON.stringify(r && r.postBoundary));
      ok(lt + ' the agent-say composer (#pj-say) keeps a visible boundary (fill declared-distinct from its bar)', r && r.sayBoundary && r.sayBoundary.distinct === true, JSON.stringify(r && r.sayBoundary));
      // #2868: the file-drag gold tint must still win over the recessed fill on drag-over.
      ok(lt + ' the drag-over affordance (#2868 gold tint) still wins over the recessed fill', r && r.dragBg === 'rgba(214, 166, 46, 0.06)', JSON.stringify(r && { dragBg: r.dragBg }));
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
  console.log('render-composer-stroke: ' + pass + ' passed (the project composers #pj-post and #pj-say render with no border AND a fill declared-distinct from the bar behind them, in tab + consolidated views across light, dark and plus-active; the agent-dialogue composer #d-say keeps its border, proving the removal is scoped). problems: none');
  process.exit(0);
})().catch((e) => { console.error('FAIL  render-composer-stroke: ' + (e && e.message ? e.message.split('\n')[0] : e)); process.exit(1); });
