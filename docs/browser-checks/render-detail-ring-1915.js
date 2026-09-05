'use strict';
/**
 * #1915: the memory ring on the agent DETAIL avatar, on a screen.
 *
 * The regression Josh reported was the ring MISSING on the detail page while the
 * data path was healthy (the MEMORY panel read 30% correctly, the avatar was a
 * plain circle). The fix (#1924) added `detailRing()` + a `#d-ring` element + the
 * one wire line in `openDetail` + the `.dring` CSS. `web.detail-ring-1915.test.js`
 * already executes `detailRing()` in isolation and pins the arc geometry, which is
 * enough to prove the FUNCTION draws the right arc.
 *
 * What that source test CANNOT see is the exact class of regression this card was:
 * the arc reaching the actual page. `detailRing()` can be perfect while the wire
 * line is dropped from `openDetail`, or the `.dring` rule is removed and the ring
 * collapses to zero size, and the isolated test stays green through both. This
 * check drives the REAL `openDetail` on the REAL page with a known reading and
 * reads the rendered `#d-ring`: the ring reaches the page, its arc length tracks
 * the reading, and the element is actually laid out (not a present-but-unstyled
 * node). A node-exists test would have passed throughout the original regression;
 * this asserts the drawn, laid-out arc, so it can return the dangerous answer.
 *
 * 🔑 THE READING IS INJECTED, NOT COMPUTED. A fixture pane carries no context
 * percent (that comes from a real Claude session the sandbox has none of), so the
 * reading is set on the open agent's own object in `LAST` and `openDetail` is
 * re-driven through its real wire -- the same path production takes when a poll
 * hands it a fresh context. This is the same technique render-detail-header-1841.js
 * uses for states the fixture cannot arrange (drive the real painter with the
 * object the engine would emit, assert the real DOM).
 *
 * RED arm (what makes the green mean anything): dropping the one `openDetail` wire
 * line reds all eight "a reading renders a ring" arms (measured -- the exact #1915
 * regression class: `detailRing` intact, nothing reaching the page), while the
 * unknown-reading arm and the "no page errors" arm correctly stay green. A fixed
 * (non-reading-driven) arc reds the "arc changes with the reading" arm. (The
 * laid-out arm is a softer presence check: `#d-ring` keeps a non-zero rect in both
 * regressions discussed here -- 100x100 from the `.dring` CSS box when the wire is
 * dropped and the span is empty, its svg content's size when the `.dring` sizing
 * itself is removed -- so it reds on neither. It is a coarse "the container is on
 * the page" assertion; the wire-drop is caught by the hasSvg / band / arc arms, and
 * a `.dring` CSS-size regression is caught by nothing here.)
 *
 *   node docs/browser-checks/render-detail-ring-1915.js            # headed
 *   HEADED=0 node docs/browser-checks/render-detail-ring-1915.js   # headless
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-detail-ring-1915.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dr-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dr-workers-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dr-config-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dr-launch-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dr-projects-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

// The ring geometry the page uses: R and the circumference the dasharray is a
// fraction of. Computed identically to detailRing() so the expected arc length
// is the page's own arithmetic, not a transcribed constant.
const R = 47;
const C = 2 * Math.PI * R;
const near = (a, b) => Math.abs(a - b) <= 0.5;

(async () => {
  fleet.install([
    fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' }),
  ]);

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(URL, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.waitForSelector('[data-agent="beatrix"]', { timeout: 8000 });
    await page.click('[data-agent="beatrix"]');
    await page.waitForSelector('#panel-detail:not([hidden])');
    await page.waitForTimeout(300);

    // Set a reading on the open agent's own LAST entry and re-drive the real
    // openDetail wire, both in one evaluate so no 5s poll can interleave, then
    // read the rendered ring. `dashFirst` is the drawn arc length.
    async function ringFor(ctx) {
      await page.evaluate((c) => {
        const sn = CURRENT.sessionName;
        const a = LAST.find((x) => x.sessionName === sn);
        if (a) a.context = c;
        openDetail(sn);
      }, ctx);
      await page.waitForTimeout(150);
      return page.evaluate(() => {
        const wrap = document.getElementById('d-ring');
        const svg = wrap.querySelector('svg');
        const fg = wrap.querySelector('circle.gf');
        const rect = wrap.getBoundingClientRect();
        const dash = fg ? fg.getAttribute('stroke-dasharray') : null;
        return {
          hasSvg: !!svg,
          fgClass: fg ? fg.getAttribute('class') : null,
          dashFirst: dash ? parseFloat(dash) : null,
          w: rect.width, h: rect.height,
          empty: wrap.innerHTML.trim() === '',
        };
      });
    }

    // ── A 30% reading: the ring reaches the page in the ok band, arc tracks it,
    //    and the element is actually laid out (the regression class). ──────────
    const ok = await ringFor({ percent: 30 });
    chk(ok.hasSvg, 'a 30% reading renders a ring on the detail avatar (the regression was no ring at all)');
    chk(/\bok\b/.test(ok.fgClass || ''), 'the 30% ring is the ok band', ok.fgClass);
    chk(ok.dashFirst !== null && near(ok.dashFirst, 0.30 * C),
      'the 30% arc length tracks the reading', ok.dashFirst + ' vs ' + (0.30 * C).toFixed(2));
    chk(ok.w > 0 && ok.h > 0, 'the ring is laid out on the page, not a zero-size node', ok.w + 'x' + ok.h);

    // ── A 70% reading: warn band, arc tracks it, and DIFFERENT from 30% -- a
    //    fixed arc would pass every node test and fail here. ───────────────────
    const warn = await ringFor({ percent: 70 });
    chk(/\bwarn\b/.test(warn.fgClass || ''), 'the 70% ring is the warn band', warn.fgClass);
    chk(warn.dashFirst !== null && near(warn.dashFirst, 0.70 * C),
      'the 70% arc length tracks the reading', warn.dashFirst + ' vs ' + (0.70 * C).toFixed(2));
    chk(warn.dashFirst !== null && ok.dashFirst !== null && warn.dashFirst !== ok.dashFirst,
      'the arc geometry changes with the reading (a fixed arc passes a node test and fails this)',
      ok.dashFirst + ' -> ' + warn.dashFirst);

    // ── An 88% reading: high band, arc tracks it. ────────────────────────────
    const high = await ringFor({ percent: 88 });
    chk(/\bhigh\b/.test(high.fgClass || ''), 'the 88% ring is the high band', high.fgClass);
    chk(high.dashFirst !== null && near(high.dashFirst, 0.88 * C),
      'the 88% arc length tracks the reading', high.dashFirst + ' vs ' + (0.88 * C).toFixed(2));

    // ── An unknown reading draws NO ring (the honest unknown, matching the
    //    board rows and the MEMORY panel), not a zero-length arc. ─────────────
    const unk = await ringFor(null);
    chk(!unk.hasSvg && unk.empty, 'an unknown reading draws no ring at all, not a zero-length one', JSON.stringify(unk));

    chk(errs.length === 0, 'no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    try { await server.close(); } catch { /* server may already be down */ }
  }

  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nALL PASS');
})().catch((e) => { console.error(e); process.exit(1); });
