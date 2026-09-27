'use strict';
/**
 * kosmos#4108 (#718 re-sweep row 4): the chat boxes on a phone are a comfortable tap target.
 *
 * The re-sweep measured the agent page's message box at 40px and its conversation search at 42px
 * on a phone: under the 48dp Android asks for (and Josh's Moto G Play is 360 wide). This drives the
 * REAL page from the REAL server and reads, at 360x800 (touch):
 *   - the agent Direct Message box (#d-say) and its conversation search (#d-talk-search), and the
 *     project room's message box (#pj-post) and search (#pj-room-search), are each at least 48px tall;
 *   - the page is no wider than the screen, and the room box's @-mention mirror still covers it;
 * and at 1280x800 (a mouse) each box keeps the height it had before (DESKTOP, measured on main).
 *
 * Controls, measured: on main's page every phone arm reds in both engines (the Direct Message box
 * and its search 44px, the room box 40px, the room search 24px); desktop is 40px and 22px on both.
 *
 *   node docs/browser-checks/render-chatbox-phone-4108.js            # headed
 *   HEADED=0 node docs/browser-checks/render-chatbox-phone-4108.js   # headless
 *   ENGINES=chromium,webkit HEADED=0 node docs/browser-checks/render-chatbox-phone-4108.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cb-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cb-workers-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cb-config-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cb-launch-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cb-projects-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

let pw;
try { pw = require('playwright'); }
catch {
  console.log('render-chatbox-phone-4108: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const store = require('../../engine/store');
const create = require('../../engine/create');

// The gate runs Chromium; ENGINES=chromium,webkit adds WebKit by hand.
const ALL_ENGINES = ['chromium', 'webkit'];
const ASKED = (process.env.ENGINES || 'chromium').split(',').map((s) => s.trim()).filter(Boolean);
const ENGINES = ASKED.filter((e) => ALL_ENGINES.includes(e));
// A misspelt engine would otherwise be dropped silently and the run read as covering it.
if (!ENGINES.length || ENGINES.length !== ASKED.length) {
  console.log('FAIL  render-chatbox-phone-4108: ENGINES names an unknown engine (' + (process.env.ENGINES || '') + '); known: ' + ALL_ENGINES.join(', '));
  process.exit(1);
}
const MIN = 48;
const PHONE = [360, 800];
const NAMES = ['ada', 'bram'];
// The boxes, and where each lives. DESKTOP is each one's height at 1280 on main (measured).
const BOXES = [
  { sel: '#d-say', name: 'the Direct Message box', where: 'agent' },
  { sel: '#d-talk-search', name: 'the conversation search', where: 'agent' },
  { sel: '#pj-post', name: 'the project room box', where: 'room' },
  { sel: '#pj-room-search', name: 'the project room search', where: 'room' },
];
const DESKTOP = { '#d-say': 40, '#d-talk-search': 22, '#pj-post': 40, '#pj-room-search': 22 };

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

async function open(page, base, where, pid) {
  await page.goto(base, { waitUntil: 'networkidle' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  if (where === 'agent') {
    // Through the agent's card, as a person does (a ?tab=detail address is not kept at phone size).
    await page.waitForSelector('.acard[data-agent="ada"] .namego', { timeout: 8000 });
    await page.locator('.acard[data-agent="ada"] .namego').first().click();
    await page.waitForSelector('#d-say', { state: 'visible', timeout: 8000 });
  } else {
    // The Projects tab, through the menu on a phone (as mobile-shots.js does).
    if (await page.isVisible('#burger')) {
      await page.click('#burger');
      await page.waitForSelector('[data-tab="projects"]', { state: 'visible', timeout: 5000 });
    }
    await page.click('[data-tab="projects"]');
    await page.waitForSelector(`.pj-row[data-project="${pid}"]`, { state: 'visible', timeout: 8000 });
    await page.click(`.pj-row[data-project="${pid}"]`);
    await page.waitForSelector('#pj-post', { state: 'visible', timeout: 8000 });
  }
  await page.waitForTimeout(300);
}

function heightOf(page, sel) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { missing: true };
    const r = el.getBoundingClientRect();
    return { shown: r.width > 0 && r.height > 0, h: Math.round(r.height * 10) / 10 };
  }, sel);
}

(async () => {
  fleet.install(NAMES.map((n, i) => fleet.agent(n, { state: 'idle', displayName: n[0].toUpperCase() + n.slice(1), role: 'Role ' + (i + 1) })));
  NAMES.forEach((n, i) => {
    store.writeProfile(n, { role: 'Role ' + (i + 1) });
    fs.mkdirSync(create.workerDir(n), { recursive: true });
  });
  const server = await srv.start(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const res = await fetch(base + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ name: 'Spring launch', agents: NAMES, description: 'Sell more tea' }) });
    const made = await res.json().catch(() => ({}));
    const pid = made && (made.id || (made.project && made.project.id));
    chk(res.ok && !!pid, 'a project to open the room of', `status ${res.status}`);
    for (const engine of ENGINES) {
      let browser;
      try { browser = await pw[engine].launch({ headless: process.env.HEADED === '0' }); }
      catch (err) {
        chk(false, `[${engine}] could not start a browser` + (process.env.HEADED === '0' ? '' : ' (headed; try HEADED=0)'),
          err && err.message ? err.message.split('\n')[0] : String(err));
        continue;
      }
      try {
        for (const [label, ctxOpts, phone] of [
          [`${PHONE[0]}x${PHONE[1]}`, { viewport: { width: PHONE[0], height: PHONE[1] }, hasTouch: true, isMobile: engine === 'chromium' }, true],
          ['1280x800', { viewport: { width: 1280, height: 800 } }, false],
        ]) {
          const tag = `[${engine} ${label}]`;
          const ctx = await browser.newContext(ctxOpts);
          const page = await ctx.newPage();
          const errs = [];
          page.on('pageerror', (e) => errs.push(String(e.message || e).split('\n')[0]));
          for (const where of ['agent', 'room']) {
            await open(page, base, where, pid).catch((e) => chk(false, `${tag} the ${where} page opened`, String(e.message || e).split('\n')[0]));
            for (const b of BOXES.filter((x) => x.where === where)) {
              const m = await heightOf(page, b.sel);
              if (m.missing || !m.shown) { chk(false, `${tag} ${b.name} is showing`, b.sel); continue; }
              if (phone) chk(m.h >= MIN, `${tag} ${b.name} is at least ${MIN}px tall`, `${m.h}px`);
              else chk(m.h === DESKTOP[b.sel], `${tag} ${b.name} keeps its desktop height`, `${m.h}px (was ${DESKTOP[b.sel]})`);
            }
            // The room box's @-mention mirror is drawn over it at paint time; on a taller box it must
            // still cover the box exactly, or the typed text and the caret come apart.
            if (phone && where === 'room') {
              await page.fill('#pj-post', '@ada hello');
              await page.waitForTimeout(200);
              const al = await page.evaluate(() => {
                const t = document.getElementById('pj-post').getBoundingClientRect();
                const m = document.getElementById('pj-post-mirror').getBoundingClientRect();
                return { dTop: Math.round(Math.abs(t.top - m.top)), dH: Math.round(Math.abs(t.height - m.height)), t: Math.round(t.height), m: Math.round(m.height) };
              });
              chk(al.dTop <= 1 && al.dH <= 1, `${tag} the room box's @-mention mirror still covers the box`, JSON.stringify(al));
              await page.fill('#pj-post', '');
            }
            // SHOTS=<dir> saves the phone screens (the card's before/after pictures).
            if (phone && process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `${where}-${engine}-${PHONE[0]}.png`) });
            if (phone) {
              const pageW = await page.evaluate(() => document.documentElement.scrollWidth);
              chk(pageW <= PHONE[0], `${tag} the ${where} page is no wider than the screen`, `page ${pageW}px`);
            }
          }
          chk(errs.length === 0, `${tag} no page errors`, errs.join(' | '));
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
