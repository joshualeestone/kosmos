// Browser-check-surface: detail-said svc-door dmoff pj-folder-state rolelimit d-untied d-withdrawn
'use strict';
/**
 * #3692: no solid left bars (Josh's rule, 2026-09-24). Each card, note and warning that used
 * to carry a stripe down its left edge is built on a real board, in light and dark, and its
 * computed style must show the same border on all four sides and no inset shadow that draws
 * only a left edge. web.no-left-bars-3692.test.js guards the stylesheet text; this proves the
 * rules the browser actually applies, including theme overrides.
 *
 * Leads with two controls that must detect a bar (a quote, which keeps its left rule by
 * design, and an element given an inset left shadow), so a pass cannot come from a measure
 * that sees nothing. Saves a sheet of the fixed elements per theme.
 *
 *   node docs/browser-checks/render-no-left-bars-3692.js            # headed
 *   HEADED=0 node docs/browser-checks/render-no-left-bars-3692.js   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-nlb-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-nlb-workers-'));
// Sandboxed whole or the board refuses to start (#634): the four dirs and an inert tmux.
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-nlb-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-nlb-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-nlb-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'nlb-shots-'));
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

/* The fixed elements: [label, markup placed in the sheet]. Each marked data-nlb. */
const SAMPLES = [
  ['.detail-said', '<div class="detail-said" data-nlb>what the agent said, in the detail view</div>'],
  ['.svc-door', '<div class="svc-door" data-nlb><b>Service door</b> a note about a connection</div>'],
  ['.dmoff', '<div class="dmoff" data-nlb>Direct messages are off for this agent.</div>'],
  ['.msg-valve', '<div class="msg-valve" data-nlb>A valve note in a message row.</div>'],
  ['.pj-warn', '<div class="pj-warn" data-nlb>A project warning.</div>'],
  ['.rst-list li', '<ul class="rst-list"><li data-nlb>A restore list item.</li></ul>'],
  ['.pj-folder-state.bad', '<p class="pj-folder-state bad" data-nlb>This folder cannot be read.</p>'],
  ['.pj-question', '<div class="pj-question" data-nlb>A question for you from the project.</div>'],
  ['.pj-msg.unsure', '<div class="pj-msg unsure" data-nlb>A message Kosmos is unsure was delivered.</div>'],
  ['.rolelimit', '<span class="rolelimit" data-nlb>What this role cannot do.</span>'],
  ['.note', '<div class="note" data-nlb>A note.</div>'],
];

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' })]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const ringByTheme = {};
  try {
    /* [label, the browser's colour scheme, an explicit data-theme]: the dark overrides live twice,
       under the prefers-color-scheme media query and under :root[data-theme="dark"]. */
    for (const [theme, scheme, explicit] of [['light', 'light', null], ['dark', 'dark', null], ['dark-explicit', 'light', 'dark']]) {
      const page = await browser.newPage({ viewport: { width: 1000, height: 1100 }, colorScheme: scheme });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(URL, { waitUntil: 'networkidle' });
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }

      if (explicit) await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, explicit);
      const res = await page.evaluate((samples) => {
        /* A left bar: a left border wider than the others, or an inset shadow offset only in x. */
        function bar(el) {
          const cs = getComputedStyle(el);
          const w = ['Top', 'Right', 'Bottom', 'Left'].map((s) => parseFloat(cs['border' + s + 'Width']) || 0);
          const shadow = cs.boxShadow || 'none';
          const insetX = shadow.split(/,(?![^(]*\))/).some((s) => {
            if (!/inset/.test(s)) return false;
            const n = s.replace(/rgba?\([^)]*\)/, '').match(/-?\d*\.?\d+px/g) || [];
            return n.length >= 2 && parseFloat(n[0]) !== 0 && parseFloat(n[1]) === 0;
          });
          /* What replaced the bar: an even border, a visible background, or a full inset ring. */
          const bg = cs.backgroundColor || '';
          const alpha = /rgba?\(([^)]*)\)/.exec(bg);
          const tinted = !!alpha && (alpha[1].split(',').length < 4 || parseFloat(alpha[1].split(',')[3]) > 0);
          const ring = shadow.split(/,(?![^(]*\))/).some((s) => /inset/.test(s) && /\b0px 0px 0px [1-9]/.test(s.replace(/rgba?\([^)]*\)/, '')));
          const sidesEqual = w.every((x) => x === w[0]);
          return { widths: w, sidesEqual, insetX, shadow, bg, marked: (sidesEqual && w[0] > 0) || tinted || ring };
        }
        document.body.classList.remove('consolidated');
        const sheet = document.createElement('div');
        sheet.id = 'nlb-sheet';
        sheet.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;padding:24px;display:flex;flex-direction:column;gap:12px;background:var(--bg, Canvas);';
        const ctl = '<div class="dm-b"><div class="mdq" data-nlb-ctl="quote">a quote keeps its rule</div></div>' +
          '<div data-nlb-ctl="shadow" style="box-shadow: inset 3px 0 0 red; padding: 6px">an inset left shadow</div>' +
          '<div class="pj-msg" data-nlb-ctl="plainmsg">a plain room message, to compare the unsure tint with</div>';
        sheet.innerHTML = ctl + samples.map((s) => s[1]).join('');
        document.body.appendChild(sheet);
        const ctlEl = (k) => sheet.querySelector('[data-nlb-ctl="' + k + '"]');
        const out = { controls: { quote: bar(ctlEl('quote')), shadow: bar(ctlEl('shadow')), plainmsg: bar(ctlEl('plainmsg')) }, samples: [] };
        const els = [...sheet.querySelectorAll('[data-nlb]')];
        els.forEach((el, i) => out.samples.push({ label: samples[i][0], ...bar(el) }));
        /* Elements the page already has, measured in place (hidden is fine for computed style). */
        for (const id of ['d-untied', 'd-withdrawn']) {
          const el = document.getElementById(id);
          out.samples.push({ label: '#' + id, missing: !el, ...(el ? bar(el) : {}) });
        }
        /* The roadmap needs-you row: roadmap body class, and #pj-list in its list form (the
           roadmap rules exclude .asgrid, the grid view). `roadmap` proves those rules applied:
           the roadmap row has no border, so a pass cannot come from the grid row's styles. */
        document.body.classList.add('pj-roadmap');
        const list = document.getElementById('pj-list');
        const row = document.createElement('div');
        row.className = 'pj-row attn';
        if (list) { list.classList.remove('asgrid'); list.appendChild(row); }
        const rb = list ? bar(row) : {};
        out.samples.push({ label: 'roadmap .pj-row.attn', missing: !list, ...rb });
        out.roadmap = list ? { widths: rb.widths, ringed: /inset/.test(rb.shadow) } : null;
        return out;
      }, SAMPLES);

      chk(res.controls.quote.widths[3] > res.controls.quote.widths[1], `[${theme}] control: the quote's left rule is seen as a left bar`, JSON.stringify(res.controls.quote.widths));
      chk(res.controls.shadow.insetX, `[${theme}] control: an inset left shadow is seen as a left bar`, res.controls.shadow.shadow);
      chk(res.samples.length === SAMPLES.length + 3, `[${theme}] every fixed element was measured`, String(res.samples.length));
      ringByTheme[theme] = res.samples.find((s) => s.label === 'roadmap .pj-row.attn').shadow;
      chk(res.roadmap && res.roadmap.widths.every((w) => w === 0) && res.roadmap.ringed,
        `[${theme}] the roadmap rules applied to the needs-you row (no border, an inset ring)`, JSON.stringify(res.roadmap));
      for (const s of res.samples) {
        chk(!s.missing && s.sidesEqual && !s.insetX, `[${theme}] ${s.label} has no left bar`, JSON.stringify({ widths: s.widths, shadow: s.shadow }));
        chk(!s.missing && s.marked, `[${theme}] ${s.label} is still marked (an even border, a tint or a ring)`, JSON.stringify({ widths: s.widths, bg: s.bg, shadow: s.shadow }));
      }
      const unsure = res.samples.find((s) => s.label === '.pj-msg.unsure');
      chk(unsure && unsure.bg !== res.controls.plainmsg.bg, `[${theme}] the unsure room message is tinted differently from a plain one`, JSON.stringify({ unsure: unsure && unsure.bg, plain: res.controls.plainmsg.bg }));
      await page.screenshot({ path: path.join(OUT, `no-left-bars-${theme}.png`), fullPage: false });
      chk(errs.length === 0, `[${theme}] no page errors`, errs.join(' | '));
      await page.close();
    }
    /* The explicit dark theme reaches its own override: the same ring colour as the media-query
       dark, and not the light one (which it would fall back to if that override were missing). */
    chk(ringByTheme['dark-explicit'] === ringByTheme.dark && ringByTheme['dark-explicit'] !== ringByTheme.light,
      'data-theme="dark" takes the dark roadmap ring, not the light one', JSON.stringify(ringByTheme));
  } finally {
    await browser.close();
    server.close();
    fleet.restore();
  }
  console.log('screenshots: ' + OUT);
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
