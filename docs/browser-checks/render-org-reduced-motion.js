'use strict';

/**
 * #1870: the org chart must SETTLE under prefers-reduced-motion, in the real DOM.
 *
 * #1738 fixed the org chart overlapping under prefers-reduced-motion (the old
 * path skipped the relaxation entirely and left a reduced-motion user with
 * whatever the seed gave, permanently overlapping if it was dense) and guarded
 * it with a node test (org-reduced-motion-settle-1738.test.js) that lifts the
 * real orgStep, seeds an overlapping field and asserts the synchronous settle
 * resolves it. This is the rendered-DOM belt-and-suspenders that guard asked
 * for: it drives the actual page under emulated reduced motion and asserts no
 * two discs overlap.
 *
 * 🛑 WHY A SEPARATE, DENSE BOARD (boot_board_org), NOT THE render-org-chart
 * FIXTURE. render-org-chart runs against write_fleet_rich = five FLAT agents,
 * whose static orgPlace is 0 overlaps (Baron measured). A reduced-motion arm on
 * that fixture is GREEN on main, GREEN after the fix and GREEN on a revert:
 * aimed at the arm where the defect does not exist. This check needs a board
 * whose static orgPlace actually overlaps, so the settle is LOAD-BEARING. That
 * board is a manager with eight direct reports (which static orgPlace packs into
 * a ~69deg arc so the discs sit ~33px apart, well inside their 44px diameter)
 * plus two second-level reports for depth. A denser write_fleet_rich cannot be
 * reused: render-org-chart's fill-band assertion is keyed to node count.
 *
 * 🔑 NON-VACUITY IS GUARDED TWO WAYS. (1) Perturbation, measured and recorded on
 * the PR: reverting orgLiveSettle to the pre-#1738 static path turns this red
 * (7 overlapping pairs, min centre distance 33px) while it is green on main. (2)
 * In-check, so a future fixture flattening cannot make it vacuously pass: the
 * tightest pair must sit at the sim's floor (min centre distance <= DENSE_MAX),
 * which only happens when the ring was overcrowded and the settle expanded it.
 * A flat five-agent board leaves the tightest pair 114px apart and fails that.
 *
 * The board this needs is the one tools/browser-checks.sh boots with
 * boot_board_org (a manager + eight reports + two deeper); with such a board on
 * $PORT the check runs standalone:
 *   NODE_PATH="/Users/agent1/work/pw-runtime/node_modules" \
 *     KOSMOS_URL="http://127.0.0.1:$PORT" node docs/browser-checks/render-org-reduced-motion.js
 *
 * ⚠️ HEADED by default; HEADED=0 on a machine with no console session.
 */
const { chromium } = require('playwright');
const fs = require('fs');

/* No two 44px discs may overlap: centre distance below the diameter is a real
   intersection. The sim's minGap is 52, so the resting field clears this with
   margin. */
const DISC_MIN = 44;
/* The settle is load-bearing only if it packed the ring to the sim's floor.
   Measured after settle: the dense board sits at 52, a flat board at 114. This
   ceiling passes the packed board and reds a fixture too sparse to have
   overlapped in the first place. */
const DENSE_MAX = 64;

(async () => {
  const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17491';
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  /* The whole point: emulate a reduced-motion user at the context, so
     window.matchMedia('(prefers-reduced-motion: reduce)').matches is true and
     orgLiveStart takes the synchronous-settle branch rather than the animation. */
  const ctx = await b.newContext({ viewport: { width: 1400, height: 950 }, reducedMotion: 'reduce' });
  const fails = [];
  const say = (ok, l, x) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (x ? '  ' + x : '')); if (!ok) fails.push(l); };
  const pg = await ctx.newPage();
  await pg.goto(URL, { waitUntil: 'networkidle' });
  if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
  await pg.waitForTimeout(1200);
  await pg.click('[data-scope="agents"] .vt[data-layout="org"]');
  /* The settle is synchronous, so the positions are final the moment the view
     paints; this wait only covers the paint and a possible poll repaint (which
     re-settles from the settled positions and stays separated). */
  await pg.waitForTimeout(1500);

  const m = await pg.evaluate((diameter) => {
    const map = document.getElementById('orgmap');
    const nodes = [...map.querySelectorAll('.onode')];
    /* The disc a person sees is `.face`; measure its centre, not the button's
       (the button's box grows with the absolutely-positioned callout). */
    const faces = nodes.map((n) => {
      const rc = n.querySelector('.face').getBoundingClientRect();
      return { cx: (rc.left + rc.right) / 2, cy: (rc.top + rc.bottom) / 2, w: rc.width };
    });
    let pairs = 0; let minC = Infinity; const worst = [];
    for (let i = 0; i < faces.length; i += 1) {
      for (let j = i + 1; j < faces.length; j += 1) {
        const cd = Math.hypot(faces[i].cx - faces[j].cx, faces[i].cy - faces[j].cy);
        minC = Math.min(minC, cd);
        if (cd < diameter) { pairs += 1; if (worst.length < 6) worst.push(Math.round(cd)); }
      }
    }
    return { nodes: nodes.length, faceW: faces[0] ? Math.round(faces[0].w) : null,
      pairs, minC: faces.length > 1 ? Math.round(minC) : null, worst };
  }, DISC_MIN);

  /* A broken or empty board must red loudly, not pass with nothing to overlap.
     The dense fixture draws eleven nodes; require enough to have crowded a ring. */
  say(m.nodes >= 9, 'the dense board drew', String(m.nodes) + ' nodes');
  say(m.pairs === 0,
    'no two discs overlap under reduced motion, so the settle ran',
    m.pairs + ' overlapping pairs' + (m.worst.length ? ' (centres ' + m.worst.join(',') + ')' : ''));
  say(m.minC !== null && m.minC >= DISC_MIN,
    'the tightest pair clears a disc diameter', m.minC + 'px');
  say(m.minC !== null && m.minC <= DENSE_MAX,
    'the ring is packed to the sim floor, so the settle was load-bearing', m.minC + 'px');

  try { fs.mkdirSync('/tmp/orgshots', { recursive: true }); } catch { /* best effort */ }
  await pg.screenshot({ path: '/tmp/orgshots/org-reduced-motion.png', clip: { x: 0, y: 110, width: 1400, height: 780 } });
  await ctx.close();
  await b.close();
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'all good');
  process.exit(fails.length ? 1 : 0);
})();
