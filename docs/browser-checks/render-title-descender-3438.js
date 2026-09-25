// Browser-check-surface: pj-one-name pjtitle dname
'use strict';

/**
 * #3438 (Josh, 2026-09-22): the project-detail title clipped its descenders (the
 * "g" in "Sourcing" was cut off at the bottom) because #pj-one-name has
 * overflow: hidden (for the one-line width ellipsis) over a line-box shorter than
 * its 1.25rem glyphs. Same class of bug as #3415 on the agent name; same fix, a
 * proportional line-height that clears descenders.
 *
 * The tell is VERTICAL, not horizontal (that is #1303 / render-long-title.js): the
 * line-box height must be at least the glyph height including the descender. This
 * asserts the computed line-height is not shorter than the font (>= 1.15x), while
 * KEEPING the overflow:hidden + nowrap that gives the width ellipsis. The fixture
 * name carries descenders so a screenshot shows the fix; the geometry assertion is
 * name-independent, so it is red-capable on the pre-fix page regardless.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-title-descender-3438.js
 *
 * A screenshot of the title crop is written to $SHOT_DIR (default: a temp dir).
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-td-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-td-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-td-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-td-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-td-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const projects = require('../../engine/projects');
const srv = require('../../server.js');

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'td-shots-'));
const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

// Descenders on purpose: the "g" Josh saw clipped, plus more, so the screenshot
// is unambiguous. A normal name the product can hold.
const NAME = process.env.TITLE_NAME || 'Research & Sourcing (paging)';

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'Research Assistant' })]);
  const proj = projects.create({ name: NAME });

  const server = await srv.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: 'light' });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.evaluate(() => fetch('/api/style', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layout: 'consolidated' }),
    }).then((r) => r.text()));
    await page.reload({ waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.waitForSelector('.pj-row', { state: 'visible', timeout: 10000 });

    await page.click('[data-project="' + proj.id + '"]');
    await page.waitForTimeout(700);
    await page.waitForSelector('#pj-one-name', { state: 'visible', timeout: 8000 });

    const m = await page.evaluate(() => {
      const name = document.getElementById('pj-one-name');
      if (!name) return { missing: true };
      const cs = getComputedStyle(name);
      const fontPx = parseFloat(cs.fontSize);
      const lhRaw = cs.lineHeight;                 // 'normal' or a px value
      const lhPx = lhRaw === 'normal' ? fontPx * 1.2 : parseFloat(lhRaw);
      return {
        text: name.textContent,
        fontPx, lhRaw, lhPx,
        ratio: lhPx / fontPx,
        overflow: cs.overflow || cs.overflowY,
        whiteSpace: cs.whiteSpace,
        clientHeight: name.clientHeight,
      };
    });
    console.log('\n  title metrics: ' + JSON.stringify(m) + '\n');

    chk(!m.missing, 'the project-detail title renders');
    if (!m.missing) {
      // THE FIX: the line-box is tall enough for descenders. On the pre-fix page
      // the inherited line-box is shorter than the 1.25rem glyphs (ratio < 1),
      // which is what clipped the "g"; the fix makes it >= 1.15.
      chk(m.ratio >= 1.15,
        'the title line-box clears descenders (line-height >= 1.15x font size)',
        'ratio=' + m.ratio.toFixed(3) + ' (lh=' + m.lhPx + 'px, font=' + m.fontPx + 'px)');
      // The fix must NOT regress the one-line width ellipsis (#2838): overflow
      // hidden + nowrap stay, so a long name still truncates rather than wrapping.
      chk(m.overflow === 'hidden', 'overflow:hidden is preserved (width ellipsis intact)', m.overflow);
      chk(m.whiteSpace === 'nowrap', 'the title stays on one line', m.whiteSpace);
    }
    chk(errs.length === 0, 'no page errors', errs.join(' | '));

    const shot = path.join(OUT, (process.env.SHOT_LABEL || 'title') + '.png');
    const box = await page.evaluate(() => {
      const el = document.querySelector('.pjmidhead') || document.getElementById('pj-one-name');
      const r = el.getBoundingClientRect();
      return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: Math.min(900, r.width + 16), height: r.height + 16 };
    });
    await page.screenshot({ path: shot, clip: box }).catch(() => {});
    console.log('  screenshot: ' + shot);
    await page.close();
  } finally {
    await browser.close();
    server.close();
    fleet.restore();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
