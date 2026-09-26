'use strict';
/**
 * #718 row 5: the app frame's controls are thumb-size on a phone.
 *
 * The sweep measured the frame at 375px with tap targets under 44x44 CSS px on every
 * screen: the K mark 34x34, the Kosmos switcher and You 32px tall, the menu 40x40, the
 * grid / list / org toggles 38x30, and "← All agents" 70x15. Under `max-width: 40rem`
 * each now has a 44x44 box. This drives the REAL page from the REAL server and reads:
 *   - at the four harness phone sizes, every frame control that is showing is at least
 *     44x44, and the ones a phone always shows (the mark, the menu, the three toggles,
 *     both back links) are showing;
 *   - no two of them overlap (a grown box must not take its neighbour's taps);
 *   - the page is no wider than the screen;
 *   - the header is no taller than the same page with the old sizes put back (the grown
 *     boxes are cancelled by negative margins, so the row keeps its height);
 *   - at desktop width (1280) every control keeps its old size.
 *
 * RED arm (measured on main, Chromium and WebKit): the size arms red at every phone size
 * (the mark 34, the toggles 30 tall, the back link 15 tall); the rest stay green.
 *
 * Chromium at phone size is not an Android phone, and WebKit is an engine
 * approximation, not Safari.
 *
 *   node docs/browser-checks/render-frame-phone-718.js            # headed
 *   HEADED=0 node docs/browser-checks/render-frame-phone-718.js   # headless
 *   ENGINES=chromium,webkit HEADED=0 node docs/browser-checks/render-frame-phone-718.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fp-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fp-workers-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fp-config-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fp-launch-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fp-projects-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

let pw;
try { pw = require('playwright'); }
catch {
  console.log('render-frame-phone-718: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

// The gate runs Chromium; ENGINES=chromium,webkit adds WebKit by hand.
const ALL_ENGINES = ['chromium', 'webkit'];
const ASKED = (process.env.ENGINES || 'chromium').split(',').map((s) => s.trim()).filter(Boolean);
const ENGINES = ASKED.filter((e) => ALL_ENGINES.includes(e));
// A misspelt engine would otherwise be dropped silently and the run read as covering it.
if (!ENGINES.length || ENGINES.length !== ASKED.length) {
  console.log('FAIL  render-frame-phone-718: ENGINES names an unknown engine (' + (process.env.ENGINES || '') + '); known: ' + ALL_ENGINES.join(', '));
  process.exit(1);
}
// The mobile-shots harness sizes: iPhone SE, iPhone 15, iPhone 15 Pro Max, a Pixel.
const PHONES = [[375, 667], [393, 852], [430, 932], [412, 915]];
const NAMES = ['ada', 'bram', 'cleo'];

// The frame's controls, by screen. `always` = a phone must show it (a hidden one fails
// instead of being skipped, so a renamed or moved control cannot pass by vanishing).
const HOME = [
  { sel: '#klink', name: 'the K mark', always: true },
  { sel: '#worldsw-btn', name: 'the Kosmos switcher' },
  { sel: '#userpop-btn', name: 'You' },
  { sel: '#burger', name: 'the menu', always: true },
  { sel: '[data-scope="agents"] .vt[data-layout="grid"]', name: 'the grid toggle', always: true },
  { sel: '[data-scope="agents"] .vt[data-layout="list"]', name: 'the list toggle', always: true },
  { sel: '[data-scope="agents"] .vt[data-layout="org"]', name: 'the org toggle', always: true },
];
// The old sizes, put back over the page for the header-height control.
const OLD = '.klink{padding:0!important;margin:0!important}'
  + '.worldsw-btn,.userpop-btn{height:32px!important;margin-block:0!important}'
  + '.burger{width:40px!important;height:40px!important;margin:0!important}'
  + '.vt{width:38px!important;height:30px!important}';

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

function measure(page, list) {
  return page.evaluate((list) => list.map((c) => {
    const el = document.querySelector(c.sel);
    if (!el) return Object.assign({}, c, { missing: true });
    const r = el.getBoundingClientRect();
    const shown = r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    return Object.assign({}, c, { shown, l: r.left, t: r.top, r: r.right, b: r.bottom,
      w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 });
  }), list);
}

function overlaps(rows) {
  const on = rows.filter((x) => x.shown);
  const out = [];
  for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) {
    const a = on[i], b = on[j];
    if (a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5) out.push(a.name + ' / ' + b.name);
  }
  return out;
}

async function home(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  await page.waitForSelector('[data-scope="agents"] .vt[data-layout="grid"]', { timeout: 8000 });
  await page.waitForTimeout(500);
}

(async () => {
  fleet.install(NAMES.map((n, i) => fleet.agent(n, {
    state: ['working', 'idle', 'needs_you'][i],
    displayName: n[0].toUpperCase() + n.slice(1),
    role: 'Role ' + (i + 1),
  })));
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const engine of ENGINES) {
      let browser;
      try { browser = await pw[engine].launch({ headless: process.env.HEADED === '0' }); }
      catch (err) {
        chk(false, `[${engine}] could not start a browser` + (process.env.HEADED === '0' ? '' : ' (headed; try HEADED=0)'),
          err && err.message ? err.message.split('\n')[0] : String(err));
        continue;
      }
      try {
        for (const [w, h] of PHONES) {
          const tag = `[${engine} ${w}x${h}]`;
          const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: engine === 'chromium' });
          const page = await ctx.newPage();
          const errs = [];
          page.on('pageerror', (e) => errs.push(String(e.message || e).split('\n')[0]));
          await home(page, URL);
          const rows = await measure(page, HOME);
          for (const c of rows) {
            if (c.missing || (c.always && !c.shown)) { chk(false, `${tag} ${c.name} is on the page and showing`, c.sel); continue; }
            if (!c.shown) continue;
            chk(c.w >= 44 && c.h >= 44, `${tag} ${c.name} is at least 44x44`, `${c.w}x${c.h}`);
          }
          const ov = overlaps(rows);
          chk(ov.length === 0, `${tag} no two frame controls overlap`, ov.join(', '));
          const pageW = await page.evaluate(() => document.documentElement.scrollWidth);
          chk(pageW <= w, `${tag} the page is no wider than the screen`, `page ${pageW}px`);
          // The header's height with the new sizes, then with the old ones put back.
          const headH = () => page.evaluate(() => Math.round(document.querySelector('body > header').getBoundingClientRect().height));
          const now = await headH();
          const tagEl = await page.addStyleTag({ content: '@media (max-width: 40rem){' + OLD + '}' });
          await page.waitForTimeout(50);
          const before = await headH();
          await tagEl.evaluate((n) => n.remove());
          chk(now <= before, `${tag} the header is no taller than with the old sizes`, `${now}px now, ${before}px old`);
          // The back links, on the agent page and on the create page.
          for (const [go, sel, name] of [
            [() => page.locator('.acard[data-agent="ada"] .namego').first().tap(), '#detail-back', 'the agent page\'s "All agents"'],
            [() => page.evaluate(() => showTab('create')), '#create-back', 'the create page\'s "All agents"'],
          ]) {
            await home(page, URL);
            await go();
            await page.waitForSelector(sel, { state: 'visible', timeout: 8000 }).catch(() => {});
            const [b] = await measure(page, [{ sel, name, always: true }]);
            if (b.missing || !b.shown) chk(false, `${tag} ${name} is on the page and showing`, sel);
            else chk(b.w >= 44 && b.h >= 44, `${tag} ${name} is at least 44x44`, `${b.w}x${b.h}`);
          }
          chk(errs.length === 0, `${tag} no page errors`, errs.join(' | '));
          await ctx.close();
        }
        // Desktop: the phone rules must not reach it.
        {
          const tag = `[${engine} 1280x800]`;
          const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
          const page = await ctx.newPage();
          await home(page, URL);
          const rows = await measure(page, HOME.filter((c) => c.sel !== '#burger'));
          const want = { '#klink': [34, 34], '#worldsw-btn': [null, 32], '#userpop-btn': [null, 32] };
          const got = rows.filter((c) => c.shown).map((c) => {
            const exp = want[c.sel] || (c.sel.includes('.vt') ? [38, 30] : null);
            return { name: c.name, w: c.w, h: c.h, ok: !exp || ((exp[0] === null || c.w === exp[0]) && c.h === exp[1]) };
          });
          chk(got.length >= 4 && got.every((x) => x.ok), `${tag} every frame control keeps its desktop size`, JSON.stringify(got));
          await ctx.close();
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    try { await server.close(); } catch { /* server may already be down */ }
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nALL PASS');
})().catch((e) => { console.error(e); process.exit(1); });
