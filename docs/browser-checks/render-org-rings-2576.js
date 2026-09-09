// Browser-check-surface: orgmap
'use strict';
/**
 * #2576 + #2577: the Agents org-chart node ring, on a screen.
 *
 * #2576 (context ring on EVERY node) and #2577 (needs-you moves off the ring to a
 * corner badge) share the org-node render, so they ship and are checked together.
 * The regression class this guards is exactly the one the cards describe: the org
 * node used to draw a partial-arc STATE ring (`.onode::after`), which sat where a
 * context gauge would and so no node ever showed context. The fix makes the outer
 * ring the CONTEXT gauge (orgRing, the same pctOf/memBand/.gt/.gf the grid, list
 * and detail views draw) on every node, and moves needs-you to a top-right corner
 * badge (ONODE_WARN, the list row's exact glyph) so both signals show at once.
 *
 * A node-exists test cannot see this: `web.org-view.test.js` proves orgRing draws
 * the right arc in isolation and pins the render wiring, but a ring computed into a
 * node that never lays it out, or a badge whose CSS collapses it, stays green there.
 * This drives the REAL paintOrg on the REAL page with known readings and reads the
 * rendered nodes: a context ring on every node with a known reading (arc tracking
 * the reading), a badge on the needs-you node ONLY, and NO `::after` state arc on
 * any node.
 *
 * 🔑 THE READINGS ARE INJECTED, NOT COMPUTED. A fixture agent carries no context
 * percent (that comes from a real Claude session the sandbox has none of), so the
 * readings are set on each agent's own LAST entry and paintOrg is re-driven through
 * its real path -- the same technique render-detail-ring-1915.js uses.
 *
 * RED arms (what makes the green mean anything), all measured:
 *   - Reverting the node render to `class="onode' + ring` + the `.onode.attn::after`
 *     rule reds BOTH the "badge on needs-you only" arm (no `.owarn` is drawn) and
 *     the "no ::after arc" arm (the needs-you node's `::after` content becomes `""`).
 *   - A fixed (non-reading-driven) orgRing arc reds the "arc tracks the reading" arm.
 *   - Dropping `orgRing(a)` from the node reds the "ring on every node" arm.
 *   - The unknown-reading node correctly shows NO ring, so a ring drawn for unknown
 *     context (a zero-length arc instead of nothing) reds the unknown arm.
 *
 *   node docs/browser-checks/render-org-rings-2576.js            # headed
 *   HEADED=0 node docs/browser-checks/render-org-rings-2576.js   # headless
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-org-rings-2576.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-or-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-or-workers-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-or-config-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-or-launch-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-or-projects-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

// The ring geometry the page uses, computed identically to orgRing() so the
// expected arc length is the page's own arithmetic, not a transcribed constant.
const R = 47;
const C = 2 * Math.PI * R;
const near = (a, b) => Math.abs(a - b) <= 0.5;

(async () => {
  fleet.install([
    fleet.agent('ada', { state: 'needs_you', displayName: 'Ada', role: 'Reviewer' }),
    fleet.agent('bram', { state: 'working', displayName: 'Bram', role: 'Builder' }),
    fleet.agent('cleo', { state: 'idle', displayName: 'Cleo', role: 'Scout' }),
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
    await page.waitForTimeout(600);
    // Into the org (network) layout, the same control render-org-chart.js uses.
    await page.click('[data-scope="agents"] .vt[data-layout="org"]');
    await page.waitForTimeout(600);
    await page.waitForSelector('#orgmap .onode', { timeout: 8000 });

    // Set a known reading on each agent's LAST entry and re-drive the real
    // paintOrg (one evaluate, so no 5s poll interleaves), then read every node.
    async function nodesWith(readings) {
      await page.evaluate((rs) => {
        for (const [sn, ctx] of Object.entries(rs)) {
          const a = (LAST || []).find((x) => x.sessionName === sn);
          if (a) a.context = ctx;
        }
        // A live poll may have re-derived identical HTML and short-circuited;
        // clearing the cache forces the repaint the readings call for.
        ORG_HTML = null;
        paintOrg();
      }, readings);
      await page.waitForTimeout(150);
      return page.evaluate(() => [...document.querySelectorAll('#orgmap .onode')].map((n) => {
        const ring = n.querySelector('svg.oring');
        const rr = ring ? ring.getBoundingClientRect() : null;
        const gf = n.querySelector('svg.oring circle.gf');
        const dash = gf ? gf.getAttribute('stroke-dasharray') : null;
        const warn = n.querySelector('svg.owarn');
        const wr = warn ? warn.getBoundingClientRect() : null;
        return {
          agent: n.getAttribute('data-agent'),
          hasRing: !!ring,
          // The regression class the source test cannot see: a ring computed into
          // a node that never lays it out. Assert the rendered size, like
          // render-detail-ring-1915.js does for the detail avatar's ring.
          ringLaidOut: !!(rr && rr.width > 0 && rr.height > 0),
          gfClass: gf ? gf.getAttribute('class') : null,
          dashFirst: dash ? parseFloat(dash) : null,
          hasWarn: !!warn,
          warnLaidOut: !!(wr && wr.width > 0 && wr.height > 0),
          afterContent: getComputedStyle(n, '::after').content,
        };
      }));
    }

    // ── Phase 1: every node has a known reading, so every node shows the context
    //    ring; ada (needs_you) also shows the corner badge, the others do not. ──
    const p1 = await nodesWith({ ada: { percent: 30 }, bram: { percent: 70 }, cleo: { percent: 88 } });
    const by = Object.fromEntries(p1.map((n) => [n.agent, n]));

    chk(p1.length === 3, 'the org chart drew all three nodes', String(p1.length));
    chk(p1.every((n) => n.hasRing), 'the context ring is on EVERY node (#2576)',
      p1.map((n) => n.agent + ':' + n.hasRing).join(' '));
    chk(p1.every((n) => n.ringLaidOut), 'every context ring is laid out on the page, not a zero-size node',
      p1.map((n) => n.agent + ':' + n.ringLaidOut).join(' '));

    chk(by.ada && near(by.ada.dashFirst, 0.30 * C) && /\bok\b/.test(by.ada.gfClass || ''),
      "ada's ring is the 30% ok-band arc", by.ada && by.ada.dashFirst + ' / ' + by.ada.gfClass);
    chk(by.bram && near(by.bram.dashFirst, 0.70 * C) && /\bwarn\b/.test(by.bram.gfClass || ''),
      "bram's ring is the 70% warn-band arc", by.bram && by.bram.dashFirst + ' / ' + by.bram.gfClass);
    chk(by.cleo && near(by.cleo.dashFirst, 0.88 * C) && /\bhigh\b/.test(by.cleo.gfClass || ''),
      "cleo's ring is the 88% high-band arc", by.cleo && by.cleo.dashFirst + ' / ' + by.cleo.gfClass);

    // The badge: needs-you ONLY, exactly once, and actually laid out (#2577).
    chk(by.ada && by.ada.hasWarn, 'the needs-you node shows the corner badge (#2577)');
    chk(by.ada && by.ada.warnLaidOut, 'the badge is laid out, not a zero-size node',
      by.ada && JSON.stringify({ w: by.ada.warnLaidOut }));
    chk(by.bram && !by.bram.hasWarn && by.cleo && !by.cleo.hasWarn,
      'a working / idle node shows NO badge, ring only');
    chk(p1.filter((n) => n.hasWarn).length === 1, 'exactly one node carries the needs-you badge',
      String(p1.filter((n) => n.hasWarn).length));

    // The old red partial-arc STATE ring is gone from every node: with the
    // `.onode::after` rule removed, `::after` has no content. A re-added arc would
    // set content to `""` on the needs-you node -- the exact regression this guards.
    chk(p1.every((n) => n.afterContent === 'none'),
      'no node draws the old ::after state arc (the ring is now the gauge)',
      p1.map((n) => n.agent + ':' + n.afterContent).join(' '));

    // ── Phase 2: unknown context draws NO ring (the honest unknown), not a
    //    zero-length arc -- matching the list row, detail and MEMORY panel. ──────
    const p2 = await nodesWith({ ada: null, bram: { percent: 70 }, cleo: { percent: 88 } });
    const ada2 = p2.find((n) => n.agent === 'ada');
    chk(ada2 && !ada2.hasRing, 'unknown context draws no ring at all, not a zero-length one',
      ada2 && JSON.stringify(ada2));
    // The badge is state-driven, not reading-driven: ada is still needs_you here.
    chk(ada2 && ada2.hasWarn, 'the badge survives an unknown reading (it tracks state, not context)');

    chk(errs.length === 0, 'no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    try { await server.close(); } catch { /* server may already be down */ }
  }

  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nALL PASS');
})().catch((e) => { console.error(e); process.exit(1); });
