// Browser-check-surface: d-sec-talk
'use strict';

/**
 * The agent page is full-width, with a dialogue that fills the page (#2012).
 *
 * Josh asked for the agent page to stop being "a small box in a mostly-empty
 * window": true full width, and a much bigger dialogue. Mona Lisa's spec
 * (kosmos-agent-page-fullwidth-2012-design-spec.md) diagnosed the build as a
 * design-vs-built gap: `#panel-detail .dbody` capped the content column at a
 * fixed 34rem (~544px) and `#d-window` capped the dialogue at 560px.
 *
 * 🛑 THESE ARE COMPARISONS AGAINST THE OLD BUILDS, NOT PROPERTIES OF ONE ELEMENT.
 * Each assertion is written so it would have FAILED on an earlier build:
 *   - the content column renders far wider than the old 544px cap,
 *   - the identity header is a NARROW LEFT column beside the content (#3385),
 *     not the full-width banner it was before -- so its width is bounded and it
 *     sits to the left of the content column (the pre-#3385 banner spanned the
 *     whole width and would fail both),
 *   - #d-window's max-height resolves well past 560px (was exactly 560px),
 *   - the message body carries a finite ~66ch measure (was unbounded).
 * A check that only read the new values without a control would pass on any
 * layout; the "far wider than 544", "narrow + left of the content" and ">560"
 * forms are the control.
 *
 * #3385 moved the header out of a full-width banner into the 220px .dleft
 * identity column (grid-template-columns: 220px minmax(0,1fr)); assertion 2 was
 * updated from "header max-width:none && headWidth > 800" to the left-column
 * reality. The #2012 win it guards -- the CONTENT/dialogue filling the width --
 * is unchanged and still asserted (1 and 3).
 *
 *   node docs/browser-checks/render-agentpage-fullwidth-2012.js            # headed
 *   HEADED=0 node docs/browser-checks/render-agentpage-fullwidth-2012.js   # headless
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-agentpage-fullwidth-2012.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Every mktemp root is collected so the finally can remove ALL of them, not
// just DATA -- a check that leaks four temp dirs per run is its own small mess.
const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fw-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  fleet.install([
    fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' }),
  ]);

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    // A wide window: the whole point is the extra width the old cap wasted.
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(URL, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.waitForSelector('[data-agent="beatrix"]', { timeout: 8000 });
    await page.click('[data-agent="beatrix"]');
    await page.waitForSelector('#panel-detail:not([hidden])');
    await page.waitForTimeout(300);

    const m = await page.evaluate(() => {
      const panel = document.getElementById('panel-detail');
      const dbody = panel.querySelector('.dbody');
      const dsecs = panel.querySelector('.dsecs');
      const dhead = panel.querySelector('.dhead');
      const dheadRect = dhead.getBoundingClientRect();
      const dsecsRect = dsecs ? dsecs.getBoundingClientRect() : null;
      const dwin = document.getElementById('d-window');
      // Inject a message body inside the panel so its measure cap resolves,
      // then read and remove it (a conversation-less fixture has no .msg-b).
      const probe = document.createElement('div');
      probe.className = 'msg-b';
      const talk = document.getElementById('d-sec-talk') || dsecs || panel;
      talk.appendChild(probe);
      const probeMax = getComputedStyle(probe).maxWidth;
      probe.remove();
      return {
        viewport: window.innerWidth,
        contentWidth: dsecs ? Math.round(dsecs.getBoundingClientRect().width) : null,
        dbodyCols: getComputedStyle(dbody).gridTemplateColumns,
        headMaxWidth: getComputedStyle(dhead).maxWidth,
        headWidth: Math.round(dheadRect.width),
        headRight: Math.round(dheadRect.right),
        secsLeft: dsecsRect ? Math.round(dsecsRect.left) : null,
        winMaxHeight: getComputedStyle(dwin).maxHeight,
        msgMaxWidth: probeMax,
      };
    });

    // 1. The content column is far wider than the old 544px cap (the control).
    chk(m.contentWidth !== null && m.contentWidth > 800,
      'the dialogue/content column fills the width (far past the old 544px cap)',
      'contentWidth=' + m.contentWidth + ' cols=' + m.dbodyCols);

    // 2. The identity header is a NARROW LEFT column beside the content (#3385),
    //    not the pre-#3385 full-width banner. Control: the old banner had
    //    headWidth > 800 and spanned the width, so it fails both a bounded
    //    width and "sits to the left of the content column".
    chk(m.headWidth > 0 && m.headWidth < 400 && m.secsLeft !== null && m.headRight <= m.secsLeft + 1,
      'the identity header is a narrow left column beside the content (not a full-width banner)',
      'headWidth=' + m.headWidth + ' headRight=' + m.headRight + ' secsLeft=' + m.secsLeft);

    // 3. The dialogue fills the page: max-height resolves well past 560px.
    const winPx = parseFloat(m.winMaxHeight);
    chk(Number.isFinite(winPx) && winPx > 560,
      'the dialogue (#d-window) max-height fills the page, past the old 560px cap',
      'winMaxHeight=' + m.winMaxHeight);

    // 4. Prose keeps a measure: the message body has a finite ~66ch cap, not none.
    const msgPx = parseFloat(m.msgMaxWidth);
    chk(m.msgMaxWidth !== 'none' && Number.isFinite(msgPx) && msgPx > 300 && msgPx < 800,
      'the message body keeps a readable measure (~66ch), not the full wide column',
      'msgMaxWidth=' + m.msgMaxWidth);

    chk(errs.length === 0, 'no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }

  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall agent-page full-width checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
