'use strict';
/**
 * The Settings page's left nav, on a screen (settings-nav, 2026-08-23).
 *
 * Same shape as render-agent-nav.js and for the same reason: the text tests
 * can prove the eleven sections exist and which box is in which; only a
 * browser can prove a click puts that section on screen and takes the others
 * off it, in both themes, at phone width, and in the 56 to 60rem band where
 * the nav sits beside a fluid section, with the centred pair measured above
 * 60rem. Leads with a control (ten sections at zero height before any
 * click), measures by rectangle.
 *
 * The server runs in this process against a fixture fleet with every state
 * root a temp dir; the check clicks nav pills, saves the name field twice (a
 * new name, then back), and resizes the window; the theme comes from the
 * page's colorScheme.
 *
 *   node docs/browser-checks/render-settings-nav.js            # headed
 *   HEADED=0 node docs/browser-checks/render-settings-nav.js   # headless
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-snav-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-snav-workers-'));
// Sandboxed whole or the board refuses to start (#634): the four dirs and an inert tmux.
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-snav-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-snav-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-snav-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
/* A person on record, so the Your name field has something to show and a
   save has something to carry (the other two fields travel whole). Written
   into the sandboxed data root above, never the real one. */
require('../../engine/you').save({ name: 'Josh', does: 'runs the company', know: null });

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'snav-shots-'));
const SECTIONS = ['you', 'accounts', 'connect', 'gskills', 'policy', 'talking', 'mac', 'updates', 'plus', 'styles', 'advanced'];
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' })]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: theme });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(URL, { waitUntil: 'networkidle' });
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
      await page.click('.tab[data-tab="settings"]');
      await page.waitForSelector('#panel-settings:not([hidden])');
      await page.waitForTimeout(1500);

      const rects = () => page.evaluate((keys) => {
        const out = {};
        for (const k of keys) {
          const el = document.getElementById('s-sec-' + k);
          out[k] = el.getBoundingClientRect().height;
        }
        return out;
      }, SECTIONS);

      let r = await rects();
      chk(r.you > 0, `[${theme}] landing: You has height`, String(r.you));
      // The name round trip: read into the field, saved whole, the agents told.
      const before = await page.evaluate(() => ({ v: document.getElementById('you-name').value, off: document.getElementById('you-name').disabled }));
      chk(before.v === 'Josh' && before.off === false, `[${theme}] the name on record is in the field`, JSON.stringify(before));
      await page.fill('#you-name', 'Joshua');
      await page.click('#you-name-save');
      await page.waitForFunction(() => /Saved|could not|did not/.test(document.getElementById('you-name-msg').textContent), null, { timeout: 8000 });
      const saved = await page.evaluate(() => document.getElementById('you-name-msg').textContent);
      chk(saved === 'Saved. Told 1 running agent.', `[${theme}] the name saves and the one running fixture agent is counted`, saved);
      // The control that can fail: the agent's own file carries the new name.
      const told = fs.readFileSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, 'april', 'CLAUDE.md'), 'utf8');
      chk(/Joshua/.test(told), `[${theme}] the fixture agent's instructions were rewritten with the new name`, told.slice(0, 80).replace(/\n/g, ' '));
      const rec = await (await page.request.get(URL + '/api/you')).json();
      chk(rec.you && rec.you.name === 'Joshua' && rec.you.does === 'runs the company',
        `[${theme}] the record carries the other field whole after a name-only save`, JSON.stringify(rec.you));
      await page.fill('#you-name', 'Josh'); await page.click('#you-name-save');
      await page.waitForFunction(() => /^Saved\. Told/.test(document.getElementById('you-name-msg').textContent), null, { timeout: 8000 });
      chk(SECTIONS.filter((k) => k !== 'you').every((k) => r[k] === 0),
        `[${theme}] control: the other ten sections measure zero before any click`, JSON.stringify(r));

      for (const k of SECTIONS) {
        await page.click('#s-nav button[data-go="' + k + '"]');
        await page.waitForTimeout(150);
        r = await rects();
        chk(SECTIONS.every((j) => (j === k ? r[j] > 0 : r[j] === 0)),
          `[${theme}] click ${k}: that section is on screen and the ten others are not`, JSON.stringify(r));
        const pill = await page.evaluate((key) => {
          const b = document.querySelector('#s-nav button[data-go="' + key + '"]');
          const on = [...document.querySelectorAll('#s-nav button.on')].map((x) => x.dataset.go);
          return { current: b.getAttribute('aria-current'), on, focus: document.activeElement && document.activeElement.dataset.sec };
        }, k);
        chk(pill.current === 'true' && pill.on.length === 1 && pill.on[0] === k,
          `[${theme}] click ${k}: exactly that pill is on and aria-current`, JSON.stringify(pill));
        chk(pill.focus === k, `[${theme}] click ${k}: focus moved into the section`, String(pill.focus));
        await page.screenshot({ path: path.join(OUT, `settings-${theme}-${k}.png`), fullPage: false });
      }

      // The switches resolved and are measurable from inside their sections.
      /* 📌 tell-toggle and notify-toggle went with the telemetry rows Josh
         removed on 2026-08-26 (item 3). Naming a switch that is not on the
         page made this check red on a product doing exactly what he asked. */
      const WHERE = { 'lim-toggle': 'talking', 'auto-toggle': 'updates', 'eng-toggle': 'advanced' };
      for (const id of Object.keys(WHERE)) {
        await page.click('#s-nav button[data-go="' + WHERE[id] + '"]');
        await page.waitForTimeout(150);
        const sw = await page.evaluate((id) => {
          const e = document.getElementById(id);
          return { hidden: e.hidden, checked: e.getAttribute('aria-checked'), h: e.getBoundingClientRect().height };
        }, id);
        chk(sw.hidden === false && sw.h > 10 && (sw.checked === 'true' || sw.checked === 'false'),
          `[${theme}] ${id} is on screen in ${WHERE[id]} with a real position`, JSON.stringify(sw));
      }

      // Above 60rem (the page opened at 1400): the nav and a 34rem section as
      // one centred pair, equal gutters either side. This is the regime the
      // 60rem rule hands over to; without an assertion here only a
      // screenshot would show it going.
      const pair = await page.evaluate(() => {
        const nav = document.getElementById('s-nav').getBoundingClientRect();
        const sec = document.querySelector('#panel-settings .dsec:not([hidden])').getBoundingClientRect();
        const vw = document.documentElement.clientWidth;
        return { navWidth: nav.width, secWidth: sec.width, leftGutter: nav.left, rightGutter: vw - sec.right };
      });
      chk(pair.navWidth > 0 && Math.abs(pair.secWidth - 544) <= 1, `[${theme}] at 1400px the section is the 34rem measure`, JSON.stringify(pair));
      chk(Math.abs(pair.leftGutter - pair.rightGutter) <= 4, `[${theme}] at 1400px the nav and section sit as one centred pair`, JSON.stringify(pair));

      // The band between the phone rule (56rem) and the centred pair (60rem):
      // the nav stays beside a FLUID section that starts at the gutter. This
      // is the only place that width is rendered; the phone fix restated the
      // Settings rule inside the 56rem block and must not reach up here.
      await page.setViewportSize({ width: 920, height: 900 });
      await page.waitForTimeout(300);
      const band = await page.evaluate(() => {
        const nav = document.getElementById('s-nav').getBoundingClientRect();
        const sec = document.querySelector('#panel-settings .dsec:not([hidden])').getBoundingClientRect();
        return { navWidth: nav.width, navRight: nav.right, secLeft: sec.left, secWidth: sec.width, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
      });
      // navWidth > 0: a detached or display:none nav has a zero rect, and 0 <= anything
      chk(band.navWidth > 0 && band.navRight <= band.secLeft + 1, `[${theme}] at 920px the nav sits beside the section`, JSON.stringify(band));
      chk(band.secWidth > 544 + 1, `[${theme}] at 920px the section is fluid, wider than the 34rem pair`, JSON.stringify(band));
      chk(!band.overflow, `[${theme}] at 920px the page does not scroll sideways`);

      // Narrow: the nav becomes a row above the content, and nothing overflows.
      await page.setViewportSize({ width: 420, height: 900 });
      await page.waitForTimeout(300);
      const narrow = await page.evaluate(() => {
        const nav = document.getElementById('s-nav').getBoundingClientRect();
        const sec = document.querySelector('#panel-settings .dsec:not([hidden])').getBoundingClientRect();
        return { navHeight: nav.height, navBottom: nav.bottom, secTop: sec.top, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
      });
      chk(narrow.navHeight > 0 && narrow.navBottom <= narrow.secTop + 1, `[${theme}] at 420px the nav sits above the section`, JSON.stringify(narrow));
      chk(!narrow.overflow, `[${theme}] at 420px the page does not scroll sideways`);
      await page.screenshot({ path: path.join(OUT, `settings-${theme}-narrow.png`), fullPage: false });

      chk(errs.length === 0, `[${theme}] no page errors`, errs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
    fleet.restore();
  }
  console.log('screenshots: ' + OUT);
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
