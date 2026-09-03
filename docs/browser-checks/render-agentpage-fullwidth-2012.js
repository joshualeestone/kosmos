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
 * 🛑 THESE ARE COMPARISONS AGAINST THE OLD CAPS, NOT PROPERTIES OF ONE ELEMENT.
 * Each assertion is written so it would have FAILED on the pre-#2012 build:
 *   - the content column renders far wider than the old 544px cap,
 *   - the header's max-width is `none` (was calc(...+34rem)),
 *   - #d-window's max-height resolves well past 560px (was exactly 560px),
 *   - the message body carries a finite ~66ch measure (was unbounded).
 * A check that only read the new values without a control would pass on any
 * layout; the "far wider than 544" and ">560" forms are the control.
 *
 *   node docs/browser-checks/render-agentpage-fullwidth-2012.js            # headed
 *   HEADED=0 node docs/browser-checks/render-agentpage-fullwidth-2012.js   # headless
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-agentpage-fullwidth-2012.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fw-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fw-workers-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fw-config-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fw-launch-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fw-projects-'));
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
        headWidth: Math.round(dhead.getBoundingClientRect().width),
        winMaxHeight: getComputedStyle(dwin).maxHeight,
        msgMaxWidth: probeMax,
      };
    });

    // 1. The content column is far wider than the old 544px cap (the control).
    chk(m.contentWidth !== null && m.contentWidth > 800,
      'the dialogue/content column fills the width (far past the old 544px cap)',
      'contentWidth=' + m.contentWidth + ' cols=' + m.dbodyCols);

    // 2. The header spans full width: its max-width is none (was calc(...34rem)).
    chk(m.headMaxWidth === 'none' && m.headWidth > 800,
      'the header spans the full width (max-width:none), aligned with the body',
      'headMaxWidth=' + m.headMaxWidth + ' headWidth=' + m.headWidth);

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
    fs.rmSync(SANDBOX, { recursive: true, force: true });
  }

  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall agent-page full-width checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
