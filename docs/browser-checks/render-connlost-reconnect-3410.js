'use strict';
/**
 * #3410: a card whose agent lost its connection says what Kosmos is doing about it.
 *
 * web.connection-lost-3410.test.js renders card() from a slice of the page. This
 * drives the whole page on a real board: an agent whose screen really reads as a
 * lost connection (Claude Code's own error line), with the route's `reconnect`
 * field set per phase by editing the /api/status answer in flight (the route's
 * own value is pinned by server.connlost-reconnect-3410.test.js). For each phase
 * it reads the card on screen: the label, and the sentence under it.
 *
 * Control: with no `reconnect` (the self-heal is not running) the card keeps
 * "Connection lost" and promises no retry, so a page that ignored the field
 * fails the Reconnecting arms rather than passing them by default.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-connlost-reconnect-3410.js
 *   SHOT_DIR=<dir> keeps the screenshots (one per phase).
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connlost-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connlost-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connlost-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connlost-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connlost-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'connlost-shots-'));
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const PHASES = [
  { key: 'none', reconnect: null, label: 'Connection lost', st: 'st-paused', says: /lost its internet connection/, not: /Kosmos (will try|has asked)/ },
  { key: 'waiting', reconnect: { phase: 'waiting', tries: 0 }, label: 'Reconnecting…', st: 'st-paused', says: /Kosmos will try again for you\./ },
  { key: 'retried', reconnect: { phase: 'retried', tries: 1 }, label: 'Reconnecting…', st: 'st-paused', says: /Kosmos has asked it to try again/ },
  { key: 'gave_up', reconnect: { phase: 'gave_up', tries: 3 }, label: 'Connection lost', st: 'st-attn', says: /Kosmos tried a few times and stopped\. If your internet is working, restart the agent\. It starts fresh, so anything it was in the middle of is lost\./ },
];

(async () => {
  fleet.install([
    fleet.agent('nettie', { state: 'connection_lost', displayName: 'Nettie', role: 'Researcher' }),
    fleet.agent('ida', { state: 'idle', displayName: 'Ida', role: 'Bookkeeper' }),
  ]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: 'light' });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    let phase = PHASES[0];
    const borderOf = {};
    await page.route('**/api/status', async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      for (const a of body.agents || []) if (a.state === 'connection_lost') a.reconnect = phase.reconnect;
      await route.fulfill({ response: res, json: body });
    });
    for (const p of PHASES) {
      phase = p;
      await page.goto(URL, { waitUntil: 'networkidle' });
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
      await page.waitForSelector('#grid .acard', { timeout: 10000 });
      const seen = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('#grid .acard')];
        const one = (needle) => {
          const c = cards.find((x) => /Nettie|Ida/.test(x.textContent) && x.textContent.includes(needle));
          if (!c) return null;
          const r = c.getBoundingClientRect();
          const pill = c.querySelector('.astate');
          return { text: c.textContent.replace(/\s+/g, ' ').trim(), pill: pill ? pill.textContent.replace(/\s+/g, ' ').trim() : '', cls: pill ? pill.className : '', border: pill ? getComputedStyle(pill).borderTopColor : '', shown: r.width > 0 && r.height > 0 };
        };
        return { nettie: one('Nettie'), ida: one('Ida') };
      });
      chk(seen.nettie && seen.nettie.shown, `${p.key}: Nettie's card is on screen`);
      if (seen.nettie) {
        chk(seen.nettie.pill.includes(p.label), `${p.key}: the label reads "${p.label}"`, seen.nettie.pill);
        const other = p.label === 'Reconnecting…' ? 'Connection lost' : 'Reconnecting…';
        chk(!seen.nettie.pill.includes(other), `${p.key}: the label does not also read "${other}"`, seen.nettie.pill);
        chk(p.says.test(seen.nettie.text), `${p.key}: the card says what Kosmos is doing`, seen.nettie.text.slice(0, 200));
        if (p.not) chk(!p.not.test(seen.nettie.text), `${p.key}: no retry is promised`, seen.nettie.text.slice(0, 200));
        /* Mona Lisa's look: quiet (paused) while Kosmos is reconnecting, the needs-you look once it gave up. */
        chk(seen.nettie.cls.split(/\s+/).includes(p.st), `${p.key}: the card wears ${p.st}`, seen.nettie.cls);
        borderOf[p.key] = seen.nettie.border;
      }
      chk(seen.ida && !/Reconnecting|Connection lost/.test(seen.ida.text), `${p.key}: the idle agent's card is untouched (control)`);
      /* The project members list renders from a projection without `reconnect`; it must borrow it
         from the same agent in the page's latest status (LAST) and agree with the card. Driven
         through the page's own pjMember on the live page. */
      const member = await page.evaluate(() => {
        const n = (LAST || []).find((a) => a && a.state === 'connection_lost');
        if (!n) return null;
        const html = pjMember({ sessionName: n.sessionName, name: n.name, present: true, tied: true, role: null, state: 'connection_lost' });
        const d = document.createElement('div'); d.innerHTML = html;
        const row = d.firstElementChild;
        return { text: d.textContent.replace(/\s+/g, ' ').trim(), attn: !!(row && row.className.split(/\s+/).includes('pjm-attn')) };
      });
      chk(member && member.text.includes(p.label), `${p.key}: the project members list agrees with the card ("${p.label}")`, member ? member.text : 'no member row');
      chk(member && member.attn === (p.st === 'st-attn'), `${p.key}: the members row is ${p.st === 'st-attn' ? '' : 'not '}red, like the card`, member ? String(member.attn) : 'no member row');
      await page.screenshot({ path: path.join(OUT, `connlost-${p.key}.png`) });
    }
    chk(borderOf.gave_up && borderOf.waiting && borderOf.gave_up !== borderOf.waiting, 'given up has the needs-you border, not the paused one', `${borderOf.gave_up} vs ${borderOf.waiting}`);
    chk(errs.length === 0, 'no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`screenshots: ${OUT}`);
  if (fail.length) { for (const f of fail) console.error('  FAIL  ' + f); }
  console.log(fail.length ? `\n${fail.length} FAILED` : '\nall passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('FAIL  render-connlost-reconnect-3410: ' + (e && e.stack || e)); process.exit(2); });
