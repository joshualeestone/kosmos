'use strict';
/**
 * kosmos#4108 (#718 re-sweep row 4): the chat boxes on a phone are a comfortable tap target.
 *
 * On main at 360 wide the agent page's message box and search are 44px, and the project room's
 * box and search 40px and 24px: under the 48dp Android asks for (Josh's Moto G Play is 360 wide). This drives the
 * REAL page from the REAL server and reads, at 360x800 (touch):
 *   - the agent Direct Message box (#d-say) and its conversation search (#d-talk-search), and the
 *     project room's message box (#pj-post) and search (#pj-room-search), are each at least 48px tall;
 *   - the page is no wider than the screen, and the room box's @-mention mirror still covers it;
 * and at 1280x800 (a mouse) each box keeps the height it had before (DESKTOP, measured on main).
 * Without the pills' padding rule, both searches' pills are 58px and the pill arms red.
 *
 * Controls, measured: on main's page every phone arm reds in both engines (the Direct Message box
 * and its search 44px, the room box 40px, the room search 24px); desktop is 40px and 22px on both.
 *
 * The re-land (0.7.03, after #4162 reverted this for 0.7.01): the taller room box left the project tip's
 * Conversation step 2px short of room above its column at 375, so the card went flat (render-room-msgbox-2806
 * caught it). This check now also walks the project tip at 360 and 375 in both engines, and at 375 with
 * Android's larger text (x1.3, Chromium only: its mobile emulation honours -webkit-text-size-adjust on px text as
 * Android's font scale does; WebKit ignores it). Every step must point, sit fully on screen, and have its area
 * in view. Measured: without the tip fix the Conversation step goes flat at 360 and 375 in both engines; the x1.3
 * case points even without the fix (the layout leaves room there), so it guards against a future break and does
 * not reproduce this one. The make-room step is in the tour code every stepped tip shares, so the agent page's tip
 * and the board's tour are walked at the same sizes: wherever the page made room, that card must then point, fully
 * on screen; their other steps are printed as MEASURE lines, not judged (this card does not own them). And only a
 * step whose card would otherwise go flat may scroll the page (the project tip: the Conversation step, or none).
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
  { sel: '#d-talk-search', name: 'the conversation search', where: 'agent', pill: true },
  { sel: '#pj-post', name: 'the project room box', where: 'room' },
  { sel: '#pj-room-search', name: 'the project room search', where: 'room', pill: true },
];
// EXACT on purpose: the card pins desktop as unchanged. A red here after a font or line-height
// change elsewhere means re-measure these, not that #4108 regressed.
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

/* Android's larger text, as Chromium's mobile emulation honours it (see the header). Says so if it did not take. */
async function textScaled(page, tag, scale) {
  const grew = await page.evaluate((pct) => {
    const el = document.body; const probe = document.createElement('span'); probe.style.fontSize = '16px'; probe.textContent = 'x'; el.appendChild(probe);
    const before = parseFloat(getComputedStyle(probe).fontSize);
    document.documentElement.style.webkitTextSizeAdjust = pct; document.documentElement.style.textSizeAdjust = pct;
    const after = parseFloat(getComputedStyle(probe).fontSize); probe.remove();
    return { before, after };
  }, Math.round(scale * 100) + '%');
  chk(grew.after > grew.before * 1.2, `${tag} setup: the larger text took effect`, JSON.stringify(grew));
  await page.waitForTimeout(200);
  return grew.after > grew.before * 1.2;
}

/* Opens a stepped tip with the real tipShow and walks it with its own Next button. For each step: whether the card
   points, the WHOLE card is on screen, its area is in view, and whether the tour scrolled the page for it. */
async function walkTip(page, tipId) {
  const opened = await page.evaluate((id) => {
    if (typeof TIPS === 'undefined' || typeof tipShow !== 'function') return { error: 'TIPS/tipShow missing' };
    if (typeof tipClose === 'function') tipClose({ record: false });
    /* Count the tour's own scrolls per step, so "a card that already points is never moved" is measured, not read. */
    window.__tipScrolls = [];
    if (!window.__sbOrig) window.__sbOrig = window.scrollBy.bind(window);
    window.scrollBy = function (...a) { const st = TIP_PLACES[TIP_STEP]; window.__tipScrolls.push(st ? st.title : '?'); return window.__sbOrig(...a); };
    const t = TIPS.find((x) => x.id === id); if (!t || !t.steps) return { error: 'no stepped ' + id + ' tip' };
    window.scrollTo(0, 0); tipShow(t); return { n: TIP_PLACES.length };
  }, tipId);
  if (opened.error) return opened;
  const steps = [];
  for (let i = 0; i < opened.n; i += 1) {
    await page.waitForTimeout(250);
    steps.push(await page.evaluate(() => {
      const card = document.getElementById('tipcard'); const st = TIP_PLACES[TIP_STEP];
      const target = st && st.sel && (typeof tipTarget === 'function' ? tipTarget(st.sel) : document.querySelector(st.sel));
      if (!card || card.hidden || !target) return { title: st && st.title, error: 'no card or no target' };
      const C = card.getBoundingClientRect(), T = target.getBoundingClientRect();
      const vw = window.visualViewport ? window.visualViewport.width : innerWidth, vh = window.visualViewport ? window.visualViewport.height : innerHeight;
      return { title: st.title, pointing: !/\bflat\b/.test(card.className),
        cardOnScreen: C.top >= 0 && C.bottom <= vh && C.left >= 0 && C.right <= vw,
        areaInView: T.bottom > 0 && T.top < vh && T.right > 0 && T.left < vw,
        scrolledHere: (window.__tipScrolls || []).includes(st.title) };
    }));
    await page.evaluate(() => { const go = document.querySelector('#tipcard .tip-go'); if (go) go.click(); });
  }
  const scrolled = await page.evaluate(() => { if (typeof tipClose === 'function') tipClose({ record: false }); return window.__tipScrolls || []; });
  return { steps, scrolled };
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
              if (phone) {
                chk(m.h >= MIN, `${tag} ${b.name} is at least ${MIN}px tall`, `${m.h}px`);
                // A search's bordered pill must not grow past the input by its padding (it was 58px).
                if (b.pill) {
                  const pill = await page.evaluate((sel) => { const e = document.querySelector(sel); return e ? Math.round(e.closest('.tsearch').getBoundingClientRect().height) : null; }, b.sel);
                  chk(pill !== null && pill <= MIN + 2, `${tag} ${b.name}'s pill is no taller than the input and its border`, `${pill}px`);
                }
              } else {
                chk(m.h === DESKTOP[b.sel], `${tag} ${b.name} keeps its desktop height`, `${m.h}px (was ${DESKTOP[b.sel]})`);
              }
            }
            // The room box's @-mention mirror is drawn over it at paint time; on a taller box it must
            // still cover the box exactly, or the typed text and the caret come apart.
            if (phone && where === 'room') {
              await page.fill('#pj-post', '@ada hello');
              await page.waitForTimeout(200);
              const al = await page.evaluate(() => {
                const tEl = document.getElementById('pj-post');
                const mEl = document.getElementById('pj-post-mirror');
                if (!tEl || !mEl) return { missing: !tEl ? '#pj-post' : '#pj-post-mirror', dTop: 99, dH: 99 };
                const t = tEl.getBoundingClientRect();
                const m = mEl.getBoundingClientRect();
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
        /* The taller room box must not cost the project tip its arrow (main, 0.7.01: render-room-msgbox-2806 at 375
           caught the Conversation step going flat, 2px short of room above the column). Walked with the tip's own Next
           button at 360 and 375, and at 375 with Android's larger text (Chromium's mobile emulation honours
           -webkit-text-size-adjust on px text as Android's font scale does; WebKit ignores it, so Chromium only). At
           every step the card points, the WHOLE card is on screen, and its area is in view.
           The make-room step lives in the tour code every stepped tip shares, so the agent page's tip and the board's tour
           are walked too: wherever it scrolled, the card must then point and be fully on screen (their other steps are
           reported, not judged: this card does not own them). */
        const TIP_CASES = [[360, 1], [375, 1]].concat(engine === 'chromium' ? [[375, 1.3]] : []);
        for (const [width, scale] of TIP_CASES) {
          const tag = `[${engine} ${width}x${PHONE[1]}${scale !== 1 ? ' text x' + scale : ''}]`;
          const ctx = await browser.newContext({ viewport: { width, height: PHONE[1] }, hasTouch: true, isMobile: engine === 'chromium' });
          const page = await ctx.newPage();
          try {
            for (const [where, tipId] of [['room', 'project'], ['agent', 'agentpage'], ['board', 'tour']]) {
              if (where === 'board') {
                await page.goto(base, { waitUntil: 'networkidle' });
                if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
              } else await open(page, base, where, pid);
              if (scale !== 1 && !(await textScaled(page, tag, scale))) continue;
              const w = await walkTip(page, tipId);
              if (w.error) {
                if (tipId === 'project') chk(false, `${tag} the project tip opens`, w.error);
                else chk(false, `${tag} the ${tipId} tip opens (the make-room check has nothing to walk)`, w.error);
                continue;
              }
              chk(w.steps.length >= 1, `${tag} the ${tipId} tip walked at least one step`, String(w.steps.length));
              if (tipId === 'project') {
                for (const st of w.steps) {
                  chk(!st.error && st.pointing && st.cardOnScreen && st.areaInView,
                    `${tag} the project tip's ${st.title || '?'} step points at its area, fully on screen`, JSON.stringify(st));
                }
                /* Only a step whose card would otherwise go flat may scroll: here that is the Conversation step, or none. */
                chk(w.scrolled.every((t) => t === 'Conversation'), `${tag} the tip scrolls the page only for the Conversation step (a pointing card is never moved)`, JSON.stringify(w.scrolled));
                /* At ordinary text size the Conversation step is flat without the fix (measured, both engines), so here the
                   page MUST have made room: if a layout change ever gives the room back, this says the fix went unused. */
                if (scale === 1) chk(w.scrolled.includes('Conversation'), `${tag} the page made room for the Conversation step (the fix ran)`, JSON.stringify(w.scrolled));
                chk(w.steps.length === 4, `${tag} the project tip walked all four steps`, String(w.steps.length));
              } else {
                for (const st of w.steps) console.log(`MEASURE  ${tag} ${tipId} tip, ${st.title || '?'}: ${JSON.stringify(st)}`);
                for (const st of w.steps.filter((x) => x.scrolledHere)) {
                  chk(!st.error && st.pointing && st.cardOnScreen, `${tag} the ${tipId} tip's ${st.title} step, where the page made room, points fully on screen`, JSON.stringify(st));
                }
              }
            }
          } catch (e) {
            chk(false, `${tag} the tip walks ran`, String(e.message || e).split('\n')[0]);
          } finally { await ctx.close(); }
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
