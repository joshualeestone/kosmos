// Browser-check-surface: acard
'use strict';
/**
 * #3729 (Josh, 2026-09-25 07:32, testing 0.6.94): "These are still showing these status messages
 * that I do not ever want to see 'Its screen shows a question its reports do not mention' and 'it
 * reported stopping, but it is still running'. I dont even what there to be a space on these to
 * have any message like this injected."
 *
 * Boots a real sandboxed board, then INJECTS every conflict sentence the engine can compute (read
 * from engine/status.js, so the list cannot drift) into every agent object on every /api response,
 * as if an engine had sent it. The engine itself now always sends null; this proves the page has
 * nowhere to put one either. On every surface an agent appears (grid, list, org chart, the agent
 * page, the Projects tab, the one-screen layout), on Mac and on Windows, it asserts none of the
 * sentences is on screen, there is no #d-conflict element, and a card has no note slot at all.
 * Controls: the injection is counted, and the injected value is shown to be in the page's own data.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-no-conflict-3729.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-noconf-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const projects = require('../../engine/projects');
const srv = require('../../server.js');

/* Every sentence the engine can put in `conflict`, straight from its source. */
const STATUS_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'engine', 'status.js'), 'utf8');
const PHRASES = [...new Set([
  ...[...STATUS_SRC.matchAll(/conflict:\s*'([^']{12,})'/g)].map((m) => m[1]),
  // the ternary shape too (review pass 1: the OpenAI sign-in sentence is written `conflict: x ? '...' : null`)
  ...[...STATUS_SRC.matchAll(/conflict:[^;{}]*?\?\s*'([^']{12,})'/g)].map((m) => m[1]),
])];
/* The unknown card's old note, the other agent-status diagnostic sentence #3729 removed. */
const UNKNOWN_NOTE = 'Not the same as idle';

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  chk(PHRASES.length >= 7 && PHRASES.some((p) => /reported stopping, but it is still running/.test(p))
      && PHRASES.some((p) => /question its reports do not mention/.test(p)) && PHRASES.some((p) => /OpenAI sign-in is being rejected/.test(p)),
    'precondition: the engine\'s conflict sentences were read from its source (' + PHRASES.length + ')');
  fleet.install([
    fleet.agent('beatrix', { state: 'working', displayName: 'Beatrix', role: 'Collections Coordinator' }),
    fleet.agent('cosmo', { state: 'idle', displayName: 'Cosmo', role: 'Researcher' }),
    fleet.agent('dora', { state: 'idle', displayName: 'Dora', role: 'Analyst' }),     // shown as unknown below
    fleet.agent('ned', { state: 'idle', displayName: 'Ned', role: 'Writer' }),        // shown as needs-trust below
  ]);
  /* Review pass 2: a real project whose members include the unknown and the needs-trust agent, so
     the project member boxes (a surface the card names) are actually drawn and looked at. */
  const pj = projects.create({ name: 'Conflict Check' });
  projects.writeAll(projects.readAll().map((x) => (x.id === pj.id ? { ...x, agents: ['beatrix', 'dora', 'ned'] } : x)));
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const platform of ['mac', 'win32']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      let injected = 0;
      const seen = new Set();
      await page.route('**/api/**', async (route) => {
        let res;
        try { res = await route.fetch(); } catch { return route.continue(); }
        const type = res.headers()['content-type'] || '';
        if (!/json/.test(type)) return route.fulfill({ response: res });
        let body;
        try { body = await res.json(); } catch { return route.fulfill({ response: res }); }
        const walk = (v) => {
          if (Array.isArray(v)) { v.forEach(walk); return; }
          if (v && typeof v === 'object') {
            if (typeof v.sessionName === 'string') {
              // Indexed by the running total (review pass 1: a per-response index only ever sent the first two).
              v.stateConflict = PHRASES[injected % PHRASES.length]; injected += 1;
              seen.add(v.stateConflict);
              if (/^dora/.test(v.sessionName)) v.state = 'unknown';
              // A needs-trust card is drawn only for a stopped agent (card(): running === false), so the
              // fixture says so too (review pass 2: without it this agent drew as a plain card).
              if (/^ned/.test(v.sessionName)) { v.needsTrust = true; v.running = false; }
            }
            for (const k of Object.keys(v)) walk(v[k]);
          }
        };
        walk(body);
        return route.fulfill({ response: res, json: body });
      });
      if (platform === 'win32') {
        await page.route(URL + '/', async (route) => {
          const res = await route.fetch();
          const html = (await res.text()).replace(/(<meta name="kosmos-platform" content=")[^"]*(")/, '$1win32$2');
          return route.fulfill({ response: res, body: html });
        });
      }
      await page.goto(URL + '/', { waitUntil: 'networkidle' });
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
      // The layout is remembered on the board, so this waits for whichever agent element it draws.
      await page.waitForSelector('.acard, .lrow', { timeout: 15000 });
      await page.evaluate(() => { const b = document.querySelector('[data-layout-switch="tabs"]'); if (b) b.click(); showTab('agents'); });
      await page.waitForTimeout(800);
      const onWin = await page.evaluate(() => typeof onWindows === 'function' && onWindows());
      chk(platform === 'win32' ? onWin : !onWin, '[' + platform + '] precondition: the page believes it is on ' + platform);
      chk(injected > 0, '[' + platform + '] control: the conflict sentences were injected into the page\'s agent data', 'injected ' + injected);

      const look = () => page.evaluate(({ phrases }) => {
        const text = document.body.innerText.toLowerCase();
        const hits = phrases.filter((p) => text.includes(p.toLowerCase().slice(0, 40)));
        const shown = (el) => !el.hidden && el.offsetParent !== null;
        return {
          hits,
          slot: !!document.getElementById('d-conflict'),
          // Only notes on cards that are ON SCREEN count (review pass 1: hidden grid cards counted on
          // other surfaces), and the needs-trust card's note is allowed: it asks the person to act.
          cardNotes: [...document.querySelectorAll('.acard:not(.needstrust) .note')].filter(shown).length,
          emptyNotes: [...document.querySelectorAll('.note')].filter((n) => shown(n) && !n.textContent.trim()).length,
          layout: document.documentElement.getAttribute('data-layout') || 'tabs',
          trustCards: document.querySelectorAll('.acard.needstrust').length,
          trustNote: [...document.querySelectorAll('.acard.needstrust .note')].filter(shown).length,
          detail: (() => { const d = document.getElementById('panel-detail'); return d && !d.hidden ? (document.getElementById('d-name') || {}).textContent : null; })(),
          projects: (() => { const pp = document.getElementById('panel-projects'); return !!pp && !pp.hidden; })(),
          members: [...document.querySelectorAll('.pj-member')].filter(shown).length,
          view: (document.querySelector('.viewtoggle[data-scope="agents"] .vt[aria-pressed="true"]') || {}).dataset?.layout || null,
        };
      }, { phrases: [...PHRASES, UNKNOWN_NOTE] });
      const surfaces = [
        // The grid is also where the needs-trust card must exist and keep its note: the one note allowed.
        ['grid', async () => { await page.click('.viewtoggle[data-scope="agents"] .vt[data-layout="grid"]'); }, (m) => m.view === 'grid' && m.trustCards === 1 && m.trustNote === 1],
        ['list', async () => { await page.click('.viewtoggle[data-scope="agents"] .vt[data-layout="list"]'); }, (m) => m.view === 'list'],
        ['org chart', async () => { await page.click('.viewtoggle[data-scope="agents"] .vt[data-layout="org"]'); }, (m) => m.view === 'org'],
        ['agent page', async () => { await page.evaluate(() => openDetail('beatrix')); }, (m) => m.detail === 'Beatrix'],
        ['unknown agent\'s page', async () => { await page.evaluate(() => openDetail('dora')); }, (m) => m.detail === 'Dora'],
        ['Projects tab', async () => { await page.evaluate(() => showTab('projects')); }, (m) => m.projects],
        ['project members', async () => { await page.evaluate((id) => { showTab('projects'); openProject(id); }, pj.id); }, (m) => m.members >= 3],
        ['one-screen layout', async () => { await page.evaluate(() => { showTab('agents'); const b = document.querySelector('[data-layout-switch="consolidated"]'); if (b) b.click(); }); }, (m) => m.layout === 'consolidated'],
      ];
      for (const [name, go, arrived] of surfaces) {
        await go();
        await page.waitForTimeout(900);
        const m = await look();
        chk(arrived(m), '[' + platform + '] precondition: ' + name + ' is actually showing', JSON.stringify({ view: m.view, layout: m.layout }));
        chk(m.hits.length === 0 && !m.slot && m.cardNotes === 0 && m.emptyNotes === 0,
          '[' + platform + '] ' + name + ': no status sentence, no slot for one, no empty note', JSON.stringify(m));
      }
      // Every sentence reached the page at least once, including the two Josh named.
      chk(PHRASES.every((p) => seen.has(p)), '[' + platform + '] control: every conflict sentence was injected', seen.size + ' of ' + PHRASES.length);
      // Control: the injected sentence really is in the page's own agent data, so the absences above
      // mean the page does not show it, not that it never arrived.
      const inData = await page.evaluate(() => {
        const list = (typeof LAST !== 'undefined' && Array.isArray(LAST)) ? LAST : [];
        return list.some((a) => a && typeof a.stateConflict === 'string' && a.stateConflict.length > 0);
      });
      chk(inData, '[' + platform + '] control: the page holds the injected sentence in its data and still shows none of it');
      // Put the layout back (it is remembered on the board) so the next pass starts on the same screen.
      await page.evaluate(() => { const b = document.querySelector('[data-layout-switch="tabs"]'); if (b) b.click(); });
      await page.waitForTimeout(400);
      chk(errs.length === 0, '[' + platform + '] no page errors', errs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
    for (const d of ROOTS) fs.rmSync(d, { recursive: true, force: true });
  }
  if (fail.length) {
    for (const f of fail) console.error('  FAIL  ' + f);
    console.log('\nrender-no-conflict-3729: ' + fail.length + ' FAILED');
    process.exit(1);
  }
  console.log('render-no-conflict-3729: no agent surface shows a reports-versus-screen sentence, or has a slot for one, on Mac or Windows.');
  process.exit(0);
})().catch((e) => { console.error('FAIL  render-no-conflict-3729 crashed: ' + (e && e.stack || e)); process.exit(1); });
