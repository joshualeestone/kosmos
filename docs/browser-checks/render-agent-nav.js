'use strict';
/**
 * The agent page's left nav, on a screen (agent-page-nav, 2026-08-23).
 *
 * `node --test` can prove the seven sections exist in the markup and that each
 * box is inside the right one. It cannot prove that clicking a pill puts that
 * section on screen and takes the others off it, that the pill reads as "on",
 * or that the page still draws in both themes with a sticky column beside it.
 * This can.
 *
 * ⚠️ THE SERVER RUNS IN THIS PROCESS WITH A FIXTURE FLEET, and every state root
 * is a temp dir. The board's reads come from `test-support/fleet`, which
 * replaces the pane source and the capture in `engine/status`, so nothing here
 * looks at the operator's live tmux. The check clicks nav pills and nothing
 * else: no Save, no Restart, no Remove.
 *
 * 🔑 VISIBILITY IS A RECTANGLE, NEVER `offsetParent`. A section that is
 * `display:none` has a zero rect; one that is on screen has height. The check
 * leads with a control: before anything is clicked, the six non-Talk sections
 * must measure zero, or "the clicked one is visible" proves nothing.
 *
 *   node docs/browser-checks/render-agent-nav.js            # headed
 *   HEADED=0 node docs/browser-checks/render-agent-nav.js   # headless
 *   SHOT_DIR=... to keep the screenshots somewhere.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-nav-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-nav-workers-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-nav-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'nav-shots-'));
const SECTIONS = ['talk', 'model', 'memory', 'instr', 'profile', 'term', 'remove'];
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  fleet.install([
    fleet.agent('april', { state: 'needs_you', displayName: 'April', role: 'a researcher' }),
    fleet.agent('mikey', { state: 'idle', displayName: 'Mikey', role: 'a bookkeeper' }),
    fleet.stranger('casey', { state: 'idle' }),
  ]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: theme });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(URL, { waitUntil: 'networkidle' });
      if (!(await page.$('#firstrun[hidden]'))) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
      await page.waitForSelector('[data-agent="april"]', { timeout: 8000 });
      await page.click('[data-agent="april"]');
      await page.waitForSelector('#panel-detail:not([hidden])');
      await page.waitForTimeout(800);

      const rects = () => page.evaluate((keys) => {
        const out = {};
        for (const k of keys) {
          const el = document.querySelector('#panel-detail .dsec[data-sec="' + k + '"]');
          const r = el.getBoundingClientRect();
          out[k] = { h: r.height, hidden: el.hidden };
        }
        return out;
      }, SECTIONS);

      // Control: the landing is Talk and only Talk.
      let r = await rects();
      chk(r.talk.h > 0, `[${theme}] landing: Talk has height`, String(r.talk.h));
      chk(SECTIONS.filter((k) => k !== 'talk').every((k) => r[k].h === 0),
        `[${theme}] control: the other six sections measure zero before any click`,
        JSON.stringify(Object.fromEntries(SECTIONS.map((k) => [k, r[k].h]))));

      const names = await page.evaluate(() => ({
        talk: document.getElementById('d-nav-talk').textContent,
        remove: document.getElementById('d-nav-remove').textContent,
        go: document.getElementById('d-model-go').textContent,
      }));
      chk(names.talk === 'Talk to April', `[${theme}] the Talk pill names the agent`, names.talk);
      chk(names.remove === 'Remove April', `[${theme}] the Remove pill names the agent`, names.remove);
      chk(names.go === 'Change & Restart April', `[${theme}] the model button names the agent`, names.go);

      // The needs-you dot: April is asking a question, so Talk carries it.
      const dot = await page.evaluate(() => {
        const b = document.querySelector('#d-nav button[data-go="talk"]');
        return { attr: b.hasAttribute('data-dot'), drawn: getComputedStyle(b.querySelector('.dot')).display };
      });
      chk(dot.attr && dot.drawn === 'block', `[${theme}] the Talk pill carries the needs-you dot`, JSON.stringify(dot));

      for (const k of SECTIONS) {
        await page.click('#d-nav button[data-go="' + k + '"]');
        await page.waitForTimeout(150);
        r = await rects();
        const onlyThis = SECTIONS.every((j) => (j === k ? r[j].h > 0 : r[j].h === 0));
        chk(onlyThis, `[${theme}] click ${k}: that section is on screen and the six others are not`,
          JSON.stringify(Object.fromEntries(SECTIONS.map((j) => [j, r[j].h]))));
        const pill = await page.evaluate((key) => {
          const b = document.querySelector('#d-nav button[data-go="' + key + '"]');
          const on = [...document.querySelectorAll('#d-nav button.on')].map((x) => x.dataset.go);
          return { current: b.getAttribute('aria-current'), on, focus: document.activeElement && document.activeElement.dataset.sec };
        }, k);
        chk(pill.current === 'true' && pill.on.length === 1 && pill.on[0] === k,
          `[${theme}] click ${k}: exactly that pill is on and aria-current`, JSON.stringify(pill));
        chk(pill.focus === k, `[${theme}] click ${k}: focus moved into the section`, String(pill.focus));
        await page.screenshot({ path: path.join(OUT, `${theme}-${k}.png`), fullPage: false });
      }

      // Deep-link: openDetail(name, section) lands on that section. No caller
      // passes one yet (the stale-instructions mark is the candidate), so the
      // parameter is exercised here or nowhere.
      await page.evaluate(() => openDetail('april', 'instr'));
      await page.waitForTimeout(200);
      r = await rects();
      chk(r.instr.h > 0 && SECTIONS.filter((j) => j !== 'instr').every((j) => r[j].h === 0),
        `[${theme}] openDetail(name, 'instr') lands on Instructions`, JSON.stringify(Object.fromEntries(SECTIONS.map((j) => [j, r[j].h]))));
      await page.evaluate(() => openDetail('april', 'no-such-section'));
      await page.waitForTimeout(100);
      r = await rects();
      chk(r.talk.h > 0, `[${theme}] an unknown section falls back to Talk`, String(r.talk.h));
      // Capture count: opening on Talk must not capture; arriving at Terminal
      // captures once; a deep-link to Terminal captures once, not twice.
      await page.evaluate(() => {
        window.__caps = 0;
        const f = window.fetch;
        window.fetch = function (u, o) { if (String(u).includes('/window')) window.__caps += 1; return f.call(this, u, o); };
      });
      // Read straight after the call: the capture's fetch fires synchronously
      // on these paths, and a longer wait lets the five-second tick's own
      // (correct) capture land in the count and read as a double.
      let caps = await page.evaluate(() => { window.__caps = 0; openDetail('april'); return window.__caps; });
      chk(caps === 0, `[${theme}] opening on Talk captures no window`, String(caps));
      caps = await page.evaluate(() => { window.__caps = 0; detailGo('term'); return window.__caps; });
      chk(caps === 1, `[${theme}] arriving at Terminal captures once`, String(caps));
      caps = await page.evaluate(() => { window.__caps = 0; openDetail('april', 'term'); return window.__caps; });
      chk(caps === 1, `[${theme}] a deep-link to Terminal captures once, not twice`, String(caps));
      await page.waitForTimeout(300);

      // The terminal box is no longer gated by Engineering mode on this page.
      await page.click('#d-nav button[data-go="term"]');
      await page.waitForTimeout(300);
      const term = await page.evaluate(() => ({
        box: document.getElementById('d-window-box').hidden,
        cap: getComputedStyle(document.getElementById('d-window')).maxHeight,
      }));
      chk(term.box === false, `[${theme}] the window box shows with Engineering mode off`, JSON.stringify(term));
      chk(term.cap === '560px', `[${theme}] the window cap is 560px on this box`, term.cap);

      // Narrow: the nav becomes a row above the content, and nothing overflows.
      await page.setViewportSize({ width: 420, height: 900 });
      await page.waitForTimeout(300);
      const narrow = await page.evaluate(() => {
        const nav = document.getElementById('d-nav').getBoundingClientRect();
        const sec = document.querySelector('#panel-detail .dsec:not([hidden])').getBoundingClientRect();
        return { navBottom: nav.bottom, secTop: sec.top, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
      });
      chk(narrow.navBottom <= narrow.secTop + 1, `[${theme}] at 420px the nav sits above the section`, JSON.stringify(narrow));
      chk(!narrow.overflow, `[${theme}] at 420px the page does not scroll sideways`);
      await page.screenshot({ path: path.join(OUT, `${theme}-narrow.png`), fullPage: false });

      // An agent Kosmos cannot tie to its name has no window box; the Terminal
      // pill must still open onto a sentence, never onto nothing.
      await page.setViewportSize({ width: 1400, height: 950 });
      await page.click('#detail-back');
      await page.waitForSelector('[data-agent="casey"]', { timeout: 8000 });
      await page.click('[data-agent="casey"]');
      await page.waitForSelector('#panel-detail:not([hidden])');
      await page.waitForTimeout(600);
      await page.click('#d-nav button[data-go="term"]');
      await page.waitForTimeout(200);
      const untied = await page.evaluate(() => ({
        box: document.getElementById('d-window-box').hidden,
        empty: document.getElementById('d-term-empty').getBoundingClientRect().height,
        sec: document.querySelector('#panel-detail .dsec[data-sec="term"]').getBoundingClientRect().height,
      }));
      const reading = await page.evaluate(() => document.getElementById('d-term-reading').getBoundingClientRect().height);
      chk(reading === 0, `[${theme}] the untied agent is not told its window is being read`, String(reading));
      chk(untied.box === true, `[${theme}] control: the untied agent has no window box`, JSON.stringify(untied));
      chk(untied.empty > 0 && untied.sec > 0, `[${theme}] the untied agent's Terminal section says why it is empty`, JSON.stringify(untied));
      await page.screenshot({ path: path.join(OUT, `${theme}-term-untied.png`), fullPage: false });

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
