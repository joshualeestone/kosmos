'use strict';
/**
 * #718 row 6: the home grid and the agents list on a phone.
 *
 * The harness flagged three small targets there at 375px: the agent names (16px tall),
 * "Answer" (63x24) and "Set them to start at login" (34px). Only the last is a real
 * thumb problem: a tap anywhere on an agent's card or row opens that agent (the board's
 * one click handler), and "Answer" has its own touch hit area (render-waiting-phone-718).
 * This drives the REAL page from the REAL server and reads, at the four harness sizes:
 *   - "Set them to start at login" is at least 44px tall;
 *   - a tap on an empty part of a card (grid) and of a row (list), away from its name
 *     and any button, opens that agent, so the 16px name is not the target;
 *   - the page is no wider than the screen;
 * and at desktop width (1280) the button keeps its old height.
 *
 * Controls, measured: on main's page the button arm reds at every phone size in both
 * engines (34px) and the rest stay green (they pin the reason the names are left alone). With
 * the board's click handler opening an agent only from its name, both tap arms red at all
 * four sizes.
 *
 * Chromium at phone size is not an Android phone, and WebKit is an engine
 * approximation, not Safari.
 *
 *   node docs/browser-checks/render-home-phone-718.js            # headed
 *   HEADED=0 node docs/browser-checks/render-home-phone-718.js   # headless
 *   ENGINES=chromium,webkit HEADED=0 node docs/browser-checks/render-home-phone-718.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hp-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hp-workers-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hp-config-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hp-launch-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hp-projects-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DRY_RUN = '1';   // the survival button writes launchd jobs; never here

let pw;
try { pw = require('playwright'); }
catch {
  console.log('render-home-phone-718: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const create = require('../../engine/create');
const store = require('../../engine/store');

// The gate runs Chromium; ENGINES=chromium,webkit adds WebKit by hand.
const ALL_ENGINES = ['chromium', 'webkit'];
const ASKED = (process.env.ENGINES || 'chromium').split(',').map((s) => s.trim()).filter(Boolean);
const ENGINES = ASKED.filter((e) => ALL_ENGINES.includes(e));
// A misspelt engine would otherwise be dropped silently and the run read as covering it.
if (!ENGINES.length || ENGINES.length !== ASKED.length) {
  console.log('FAIL  render-home-phone-718: ENGINES names an unknown engine (' + (process.env.ENGINES || '') + '); known: ' + ALL_ENGINES.join(', '));
  process.exit(1);
}
// The mobile-shots harness sizes: iPhone SE, iPhone 15, iPhone 15 Pro Max, a Pixel.
const PHONES = [[375, 667], [393, 852], [430, 932], [412, 915]];
const NAMES = ['ada', 'bram', 'cleo'];
const SURVIVAL = '#restart-wrap [data-survival-fix]';

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

async function home(page, url, layout) {
  await page.goto(url, { waitUntil: 'networkidle' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  await page.click(`[data-scope="agents"] .vt[data-layout="${layout}"]`);
  await page.waitForSelector(layout === 'grid' ? '#grid .acard[data-agent="ada"]' : '#alist .lrow[data-agent="ada"]', { timeout: 8000 });
  await page.waitForTimeout(400);
}

// A point inside the agent's card or row that is not on its name or any control.
function emptySpot(page, sel) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { error: 'no ' + sel };
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    for (let fy = 0.9; fy >= 0.1; fy -= 0.1) for (let fx = 0.9; fx >= 0.1; fx -= 0.1) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy;
      const hit = document.elementFromPoint(x, y);
      if (hit && el.contains(hit) && !hit.closest('button, a, input, select, textarea, [data-answer], [role="button"]')) {
        return { x: Math.round(x), y: Math.round(y), what: hit.tagName.toLowerCase() + (hit.className && typeof hit.className === 'string' ? '.' + hit.className.split(' ')[0] : '') };
      }
    }
    return { error: 'no empty spot on ' + sel };
  }, sel);
}

(async () => {
  fleet.install(NAMES.map((n, i) => fleet.agent(n, {
    state: ['working', 'idle', 'needs_you'][i],
    displayName: n[0].toUpperCase() + n.slice(1),
    role: 'Role ' + (i + 1),
  })));
  // A profile and a folder for each agent and no login job (LAUNCH is an empty temp dir):
  // the survival panel's "missing" list, so "Set them to start at login" shows
  // (engine/register.js reads the profiles, not the fleet stub).
  NAMES.forEach((n, i) => {
    store.writeProfile(n, { role: 'Role ' + (i + 1) });
    fs.mkdirSync(create.workerDir(n), { recursive: true });
  });
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
          await home(page, URL, 'grid');
          const btn = await page.waitForSelector(SURVIVAL, { state: 'visible', timeout: 8000 }).catch(() => null);
          if (!btn) chk(false, `${tag} "Set them to start at login" is showing`, SURVIVAL);
          else {
            const bh = await btn.evaluate((b) => Math.round(b.getBoundingClientRect().height * 10) / 10);
            chk(bh >= 44, `${tag} "Set them to start at login" is at least 44px tall`, `${bh}px`);
          }
          const pageW = await page.evaluate(() => document.documentElement.scrollWidth);
          chk(pageW <= w, `${tag} the page is no wider than the screen`, `page ${pageW}px`);
          for (const [layout, sel, what] of [['grid', '#grid .acard[data-agent="ada"]', 'card'], ['list', '#alist .lrow[data-agent="ada"]', 'row']]) {
            await home(page, URL, layout);
            const spot = await emptySpot(page, sel);
            if (spot.error) { chk(false, `${tag} a tap on an empty part of an agent's ${what} opens it`, spot.error); continue; }
            await page.touchscreen.tap(spot.x, spot.y);
            const opened = await page.waitForFunction(() => {
              const p = document.getElementById('panel-detail');
              return p && !p.hidden && document.getElementById('d-name').textContent.trim() === 'Ada';
            }, null, { timeout: 5000 }).then(() => true, () => false);
            chk(opened, `${tag} a tap on an empty part of an agent's ${what} opens it`, `tapped ${spot.what} at ${spot.x},${spot.y}`);
          }
          chk(errs.length === 0, `${tag} no page errors`, errs.join(' | '));
          await ctx.close();
        }
        // Desktop: the phone rule must not reach it.
        {
          const tag = `[${engine} 1280x800]`;
          const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
          const page = await ctx.newPage();
          await home(page, URL, 'grid');
          const btn = await page.waitForSelector(SURVIVAL, { state: 'visible', timeout: 8000 }).catch(() => null);
          const bh = btn ? await btn.evaluate((b) => Math.round(b.getBoundingClientRect().height * 10) / 10) : null;
          chk(bh !== null && bh < 44, `${tag} "Set them to start at login" keeps its desktop height`, `${bh}px`);
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
