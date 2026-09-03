'use strict';

/**
 * The first-run Accessibility step (fr-pane-5) copy + button style (#1940).
 *
 * Josh's ask, Mona Lisa's design: the copy names the exact action ("Turn on
 * 'Tmux' in Accessibility"), the "Open Accessibility settings" button uses the
 * gold-outline `fr-sleepbtn` style (matching the sleep-settings button), and the
 * "This one is optional" line is gone (Continue already lets a skipper move on).
 *
 * 🛑 ASSERTED IN A REAL RENDER, not by grepping the file: the button's COMPUTED
 * style must actually be the gold-outline one (a class name in the markup that
 * no rule matches would pass a source grep and fail on screen), and the copy is
 * read off the rendered pane. Each arm is written so it would FAIL on the
 * pre-#1940 markup (old copy present, plain `.btn` background, optional line
 * present), so the check discriminates.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-a11y-copy-1940.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-a11y-'));
const ROOTS = [SANDBOX];
const mkroot = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-a11y-' + t)); ROOTS.push(d); return d; };
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const srv = require('../../server.js');
const fleet = require('../../test-support/fleet');
const { stepForAnchor } = require('./lib-firstrun-steps.js');

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-shots-'));
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  // Install a fixture fleet so the server's tmux reads answer from the fixture,
  // never the operator's live fleet (AGENT_WORKFORCE_TMUX_BIN is /bin/echo, which
  // stubs writes but whose reads would otherwise fall through -- the guard in
  // engine/status.tmux-bin.test.js catches a /bin/echo check with no fleet.install).
  fleet.install([fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix' })]);
  const server = await srv.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 820 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    // Discover the Accessibility step from its own anchor (#1214/#1801 renumbered
    // the panes; a hard-coded 5 would rot), then deep-link straight to it.
    await page.goto(`${BASE}/?first-run=1`, { waitUntil: 'domcontentloaded' });
    const step = await stepForAnchor(page, '#fr-a11y-open');
    await page.goto(`${BASE}/?first-run=1&fr-step=${step}`, { waitUntil: 'networkidle' });
    // Derive the pane id from the discovered step too (not a hard-coded 5), so a
    // future renumber moves the whole check together.
    await page.waitForSelector(`#fr-pane-${step}:not([hidden])`, { timeout: 8000 });
    await page.waitForTimeout(250);

    const m = await page.evaluate((paneStep) => {
      const pane = document.getElementById('fr-pane-' + paneStep);
      const btn = document.getElementById('fr-a11y-open');
      const cs = getComputedStyle(btn);
      // A plain .btn control in the SAME #firstrun context: the gold-outline check
      // must be a COMPUTED-style comparison, not a class-name read -- a phantom
      // `fr-sleepbtn` (class present, no rule) would compute to this plain style.
      const plain = document.createElement('button');
      plain.className = 'btn';
      (pane || document.body).appendChild(plain);
      const plainBg = getComputedStyle(plain).backgroundColor;
      plain.remove();
      return {
        paneText: pane.textContent.replace(/\s+/g, ' ').trim(),
        btnHasSleep: btn.classList.contains('fr-sleepbtn'),
        btnBg: cs.backgroundColor,
        btnBorder: cs.borderColor || cs.borderTopColor,
        plainBtnBg: plainBg,
      };
    }, step);

    chk(/Turn on 'Tmux' in Accessibility to enable this/.test(m.paneText),
      "the copy names the exact action (Turn on 'Tmux' in Accessibility)", m.paneText.slice(0, 90));
    chk(!/Kosmos agents can work in your other applications/.test(m.paneText),
      'the old copy is gone', m.paneText.slice(0, 60));
    chk(m.btnHasSleep && m.btnBg === 'rgba(0, 0, 0, 0)' && m.btnBg !== m.plainBtnBg,
      'the Open-Accessibility button RENDERS the gold-outline fr-sleepbtn style (transparent bg, distinct from a plain filled .btn) -- computed, so a phantom class would red',
      'bg=' + m.btnBg + ' plainBtn=' + m.plainBtnBg);
    chk(!/This one is optional/.test(m.paneText),
      'the pushy "This one is optional / now-or-later" framing is gone');
    chk(/You can turn this on anytime in Settings, under Keeping agents running/.test(m.paneText),
      'the reworded where-to-do-it-later pointer stays (#1214 out, kept per Mona Lisa without the "optional" framing)');

    await page.screenshot({ path: path.join(OUT, `fr-pane-${step}-a11y.png`) });
    console.log('screenshot: ' + path.join(OUT, `fr-pane-${step}-a11y.png`));
    chk(errs.length === 0, 'no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
    fleet.restore();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }

  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall fr-pane-5 accessibility-copy checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
