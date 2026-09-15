'use strict';

/**
 * The light and dark control, rendered (#284).
 *
 * 🔑 Josh, 2026-08-22: "I don't want auto. Let's take auto off of it so we have
 * just the sun and the moon", with the pack screenshot of gold marking the
 * active one, "the same height as the grid, list, and org chart viewers", and
 * "the light/dark mode is to the far right and the agent status is to the left
 * of it. Right now we're showing it in the reverse way."
 *
 * [Superseded in part by #2194, 2026-09-04: the board-view toggle was moved past
 * the light/dark switcher, so the switcher is no longer the far-right control.
 * Josh's 08-22 words are kept verbatim as the record. This check's own geometry
 * arm (the status stamp is to the LEFT of the switcher) is unaffected and still
 * holds; only the "far right" description above no longer matches the layout.]
 *
 * ⚠️ ALL FOUR OF THOSE ARE GEOMETRY OR PAINT, so they are asserted on a rendered
 * page rather than in the markup. The one that markup cannot answer at all is
 * the highlight: with `Auto` gone, nothing is stored until somebody picks, so
 * the lit half has to be READ from what the page is actually in.
 *
 *   AGENT_WORKFORCE_DATA=/tmp/tt PORT=17401 node server.js &
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" \
 *     KOSMOS_URL=http://127.0.0.1:17401 node docs/browser-checks/render-theme-toggle.js /tmp/toggleshots
 *
 * ⚠️ HEADED by default. `HEADED=0` on a machine with no console session.
 */

const { chromium } = require('playwright');
const path = require('node:path');

const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17401';
const OUT = process.argv[2] || '/tmp/toggleshots';
const fails = [];

(async () => {
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  for (const theme of ['light', 'dark']) {
    const pg = await b.newPage({ viewport: { width: 1400, height: 400 }, colorScheme: theme });
    await pg.goto(URL, { waitUntil: 'networkidle' });
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
    await pg.waitForTimeout(900);

    // #3051: the light/dark control and the agent-status stamp moved into the
    // upper-right user menu (#userpop). Open it before measuring. The theme-highlight
    // logic (read from the Mac, gold fill) is unchanged; the old header geometry (the
    // stamp to the LEFT of the picker, and the height matched to the view toggle) is
    // retired -- in the menu the stamp sits BELOW the picker, which this asserts instead.
    await pg.click('#userpop-btn');
    await pg.waitForTimeout(200);

    const seen = await pg.evaluate(() => {
      const pick = document.querySelector('.themepick');
      const opts = [...pick.querySelectorAll('.themeopt')];
      const on = opts.find((o) => o.getAttribute('aria-checked') === 'true');
      const stamp = document.getElementById('checked');
      const pr = pick.getBoundingClientRect();
      const sr = stamp.getBoundingClientRect();
      return {
        count: opts.length,
        onIs: on ? on.dataset.themeSet : null,
        onBg: on ? getComputedStyle(on).backgroundColor : null,
        pickH: Math.round(pr.height),
        stampTop: Math.round(sr.top),
        pickBottom: Math.round(pr.bottom),
      };
    });
    const say = (ok, label, extra) => {
      console.log((ok ? 'PASS  ' : 'FAIL  ') + theme + ': ' + label + (extra ? '  ' + extra : ''));
      if (!ok) fails.push(theme + ': ' + label);
    };
    say(seen.count === 2, 'two options', String(seen.count));
    /* The control has never been touched here, so this is the Mac answering. */
    say(seen.onIs === theme, 'the highlighted half is what the page is in', String(seen.onIs));
    say(seen.onBg === 'rgb(227, 179, 65)', 'the active half is filled gold', seen.onBg);
    /* #3051: the picker renders as a real box inside the open menu, and the
       agent-status stamp sits BELOW it (menu order: Settings, Appearance, Board
       view, Agent status). */
    say(seen.pickH > 0, 'the light/dark control renders in the open menu', String(seen.pickH));
    say(seen.stampTop >= seen.pickBottom, 'the agent-status stamp is below the picker', seen.stampTop + ' >= ' + seen.pickBottom);

    await pg.screenshot({ path: path.join(OUT, 'toggle-' + theme + '.png'), clip: { x: 900, y: 0, width: 500, height: 400 } });
    await pg.close();
  }
  await b.close();
  console.log(fails.length ? '\nFAILED: ' + fails.join(', ') : '\nall good');
  process.exit(fails.length ? 1 : 0);
})();
