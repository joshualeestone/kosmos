// Browser-check-surface: d-sec-talk d-sec-profile d-sec-model s-sec-accounts s-sec-you
'use strict';
/**
 * #4961 (Josh, 2026-10-01): on the agent page in the Mac app, a black stroke drew round the whole
 * Direct Message section after clicking its pill. A nav pill moves focus into its section
 * (detailGo, and settingsGo in Settings) so a keyboard user's next Tab lands inside, and the ring
 * marking that landing (#350) was keyed on :focus-visible. Safari does not focus a clicked button,
 * so in the Mac app the focus moved next can match :focus-visible after a CLICK, and the 2px ink
 * outline drew round the 16px-radius card. The ring is now drawn only for a keyboard press.
 *
 * Boots a sandboxed board with one agent. On chromium and webkit, light and dark, on the agent page
 * (AI Settings, Profile, Direct Message pills) and in Settings (AI Models, Your Profile pills):
 *   - click arm: focus moves into the pill's section, and the section draws no outline;
 *   - keyboard arm (focus the pill, Enter): focus moves into the section, and it draws the ring.
 * On chromium only, the Mac case: after a click, :focus and :focus-visible are FORCED on the
 * section through the DevTools protocol (what the Mac app's WebKit matches on its own), and it must
 * still draw no outline. That arm is the one that reds on the old rule (Playwright's WebKit focuses the clicked
 * button, so it cannot reproduce the Mac app's click by itself). The keyboard arm is the control:
 * it shows the instrument reads a real ring, so "no outline" is not its default.
 * Then the ring must not outlive the press: land on AI Settings from the keyboard, Tab inside, then
 * click the Model section's own heading (focus returns to the section): the kbd-landed class is gone,
 * no outline, and on chromium none with :focus-visible forced either. And a scripted .click() on a
 * pill after that (no key press, as a harness or an assistive tool sends) lands without the ring.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-dsec-ring-4961.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ring-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium, webkit } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const readFocus = (page) => page.evaluate(() => {
  const el = document.activeElement;
  const cs = el ? getComputedStyle(el) : null;
  return {
    sec: el && el.dataset ? (el.dataset.sec || '') : '',
    style: cs ? cs.outlineStyle : '',
    width: cs ? cs.outlineWidth : '',
  };
});
const ring = (f) => f.style !== 'none' && parseFloat(f.width) > 0;

/* Chromium only: force :focus and :focus-visible on one element, as the Mac app's WebKit matches
   them after a click, then read its outline. */
async function forcedRead(page, selector) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['focus', 'focus-visible'] });
    const f = await page.evaluate((sel) => {
      const cs = getComputedStyle(document.querySelector(sel));
      return { style: cs.outlineStyle, width: cs.outlineWidth };
    }, selector);
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
    return f;
  } finally {
    await cdp.detach();
  }
}

const PAGES = [
  { name: 'agent page', nav: '#d-nav', pills: [['model', 'model'], ['profile', 'profile'], ['talk', 'talk']] },
  { name: 'Settings', nav: '#s-nav', pills: [['accounts', 'accounts'], ['you', 'you']] },
];

(async () => {
  fleet.install([fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' })]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  await fetch(URL + '/api/first-run/complete', { method: 'POST' });
  let ran = 0;
  let forced = 0;
  let outlived = 0;
  try {
    for (const theme of ['light', 'dark']) {
      for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
        const browser = await engine.launch({ headless: process.env.HEADED === '0' });
        try {
          const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: theme });
          const errs = [];
          page.on('pageerror', (e) => errs.push(e.message));
          for (const pg of PAGES) {
            if (pg.nav === '#d-nav') {
              await page.goto(URL);
              await page.waitForSelector('.acard .namego', { timeout: 20000 });
              await page.locator('.acard .namego').first().click();
              await page.waitForSelector('#d-sec-talk', { timeout: 20000 });
            } else {
              await page.goto(URL + '/?tab=settings');
              await page.waitForSelector('#s-nav button[data-go]', { state: 'visible', timeout: 20000 });
            }
            const tag = `[${theme}] ${engineName} ${pg.name}`;
            for (const how of ['click', 'keyboard']) {
              for (const [go, sec] of pg.pills) {
                const pill = page.locator(`${pg.nav} button[data-go="${go}"]`).first();
                if (how === 'click') await pill.click();
                else { await pill.focus(); await page.keyboard.press('Enter'); }
                await page.waitForTimeout(150);
                const f = await readFocus(page);
                chk(f.sec === sec, `${tag}: ${how} ${go}: focus moved into the ${sec} section`, JSON.stringify(f));
                if (how === 'click') {
                  chk(!ring(f), `${tag}: click ${go}: the section draws no outline round itself`, JSON.stringify(f));
                  if (engineName === 'chromium') {
                    const m = await forcedRead(page, `${pg.nav === '#d-nav' ? '#panel-detail' : '#panel-settings'} .dsec[data-sec="${sec}"]`);
                    chk(!ring(m), `${tag}: click ${go}, then :focus-visible as the Mac app matches it: still no outline`, JSON.stringify(m));
                    forced += 1;
                  }
                } else {
                  chk(ring(f) && f.style === 'solid' && f.width === '2px', `${tag}: keyboard ${go}: the landing ring shows (2px solid)`, JSON.stringify(f));
                }
                ran += 1;
              }
            }
          }
          /* The ring belongs to the press: keyboard-land, Tab inside, click the section's heading. */
          {
            await page.goto(URL);
            await page.waitForSelector('.acard .namego', { timeout: 20000 });
            await page.locator('.acard .namego').first().click();
            await page.waitForSelector('#d-sec-talk', { timeout: 20000 });
            const tag = `[${theme}] ${engineName} agent page`;
            const pill = page.locator('#d-nav button[data-go="model"]');
            await pill.focus(); await page.keyboard.press('Enter');
            await page.waitForTimeout(150);
            const landed = await readFocus(page);
            await page.keyboard.press('Tab');
            await page.waitForTimeout(100);
            const left = await page.evaluate(() => !document.activeElement || document.activeElement.id !== 'd-sec-model');
            await page.locator('#d-sec-model .dlab').first().click();
            await page.waitForTimeout(150);
            const back = await readFocus(page);
            const kept = await page.evaluate(() => document.getElementById('d-sec-model').classList.contains('kbd-landed'));
            chk(ring(landed) && left && back.sec === 'model',
              `${tag}: precondition: landed with the ring, Tab left the section, the heading click refocused it`, JSON.stringify({ landed, left, back }));
            chk(!kept && !ring(back), `${tag}: after Tab and a click back on the section, no kbd-landed and no outline (the ring went with the keypress)`, JSON.stringify({ kept, back }));
            if (engineName === 'chromium') {
              const m = await forcedRead(page, '#panel-detail .dsec[data-sec="model"]');
              chk(!ring(m), `${tag}: and none with :focus-visible forced`, JSON.stringify(m));
            }
            await page.evaluate(() => document.querySelector('#d-nav button[data-go="profile"]').click());
            await page.waitForTimeout(150);
            const scripted = await readFocus(page);
            chk(scripted.sec === 'profile' && !ring(scripted), `${tag}: a scripted .click() on a pill lands without the ring`, JSON.stringify(scripted));
            outlived += 1;
          }
          chk(errs.length === 0, `[${theme}] ${engineName}: no page errors`, errs.join(' | '));
        } finally {
          await browser.close();
        }
      }
    }
  } finally {
    server.close();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  chk(ran === 40 && forced === 10 && outlived === 4, 'precondition: every engine, theme, page and pill arm ran', `ran=${ran} forced=${forced} outlived=${outlived}`);
  console.log(fail.length ? `${fail.length} check(s) FAILED` : 'all checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
