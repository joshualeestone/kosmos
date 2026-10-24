// Browser-check-surface: pj-fed-own ownseal-code ownseal-acts fedOwnHtml fedOwnPress
'use strict';
/**
 * kosmos#4658 part B: the sealed-room key section in a project's Members card (#pj-fed-own).
 *
 * What this pins, and why each line can fail:
 *  - it is federation content: HIDDEN while federation is not live (the data-fed-ui gate);
 *  - a waiting computer shows ITS code (from GET /api/federation/own-compare) on one line, and "It matches" sends
 *    back exactly that code to POST /api/federation/own-confirm; "Does not match" sends { match: false };
 *  - the computer that first shared the room lists each waiting computer with the code from GET own-waiting, and
 *    Allow sends exactly that row's key and code to POST /api/federation/own-allow;
 *  - a refusal's own words are shown; a project that never sees either answer shows nothing;
 *  - Mona's review (card comment 6382874566): the answers are bordered buttons at least 44 px tall, It matches and
 *    Does not match at equal weight (same background and border), Allow the same style; the separator is a plain
 *    ASCII hyphen; where Members sits under the room (390), one line above the room says the room is sealed;
 *  - 390 wide with no sideways scroll, the code never wraps, chromium and webkit, no page errors.
 * The engine and routes are tested in engine/fedseats.ownseal-4658.test.js and server.ownallow-4658.test.js; here
 * the routes are answered by the page's own fake, so what is measured is what the page sends and shows.
 *
 *   HEADED=0 node docs/browser-checks/render-ownseal-4658.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host computer's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ownseal-bc-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ownseal-bc-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ownseal-bc-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ownseal-bc-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ownseal-bc-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
const SANDBOXES = [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS,
  process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT];

const { chromium, webkit } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const projects = require('../../engine/projects');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const WAITING_CODE = 'K7M3P-Q9RXA';
const ROWS = [{ pub: 'pub-laptop', mac: 'mac-1', code: 'ABCDE-FGHJK', at: 1 }, { pub: 'pub-desk', mac: 'mac-2', code: '23456-789AB', at: 2 }];

(async () => {
  fleet.install([fleet.agent('ada', { state: 'idle', displayName: 'Ada', role: 'a planner' })]);
  const server = await srv.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await engine.launch({ headless: process.env.HEADED === '0' });
      try {
        for (const [live, width] of [[false, 1280], [true, 1280], [true, 390]]) {
          const E = `[${engineName} ${live ? 'live' : 'not live'} ${width}]`;
          const waitingP = projects.create({ name: 'Waiting ' + engineName + width + live });
          const ownerP = projects.create({ name: 'Owner ' + engineName + width + live });
          const quietP = projects.create({ name: 'Quiet ' + engineName + width + live });
          const ctx = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
          const page = await ctx.newPage();
          const errs = [];
          page.on('pageerror', (e) => errs.push(e.message));
          /* #6022: a poll can be in flight when the check closes the browser; its late rejection is caught. */
          await page.route('**/api/status*', async (r) => {
            try {
              const resp = await r.fetch();
              const j = await resp.json().catch(() => null);
              if (!j) return await r.fulfill({ response: resp });
              j.federationLive = live; j.kosmos_plus = live;
              return await r.fulfill({ response: resp, json: j });
            } catch { await r.abort().catch(() => {}); }
          });
          // The four routes, answered per project: the waiting project has a code, the owner project has rows.
          const posted = [];
          let refuseNext = false;
          await page.route('**/api/federation/own-*', async (r) => {
            try {
              const u = new URL(r.request().url());
              const pid = u.searchParams.get('project');
              if (u.pathname.endsWith('/own-compare')) return await r.fulfill({ json: { code: pid === waitingP.id ? WAITING_CODE : null } });
              if (u.pathname.endsWith('/own-waiting')) return await r.fulfill({ json: { computers: pid === ownerP.id ? ROWS : [] } });
              posted.push({ path: u.pathname, body: JSON.parse(r.request().postData() || '{}') });
              if (refuseNext) { refuseNext = false; return await r.fulfill({ status: 409, json: { error: 'That computer was not allowed: the code confirmed is not the one that computer shows.' } }); }
              return await r.fulfill({ json: u.pathname.endsWith('/own-allow') ? { allowed: true } : { confirmed: true } });
            } catch { await r.abort().catch(() => {}); }
          });
          await page.goto(BASE, { waitUntil: 'networkidle' });
          if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
          await page.waitForFunction((want) => document.documentElement.getAttribute('data-fed-ui') === want, live ? 'show' : 'hidden', { timeout: 8000 }).catch(() => null);
          const open = async (id) => {
            await page.evaluate(async (pid) => { await loadProjects(); showTab('projects'); openProject(pid); }, id);
            await page.waitForFunction((pid) => typeof PJ_CURRENT !== 'undefined' && PJ_CURRENT === pid, id, { timeout: 8000 });
          };
          await open(waitingP.id);
          if (!live) {
            await page.waitForTimeout(1500);
            const seen = await page.evaluate(() => { const el = document.getElementById('pj-fed-own'); return !!el && el.offsetParent !== null && el.textContent.trim() !== ''; });
            chk(!seen, `${E} hidden while federation is not live`);
            chk(errs.length === 0, `${E} no page errors`, errs.join(' | '));
            await ctx.close();
            continue;
          }
          // The waiting computer's side.
          await page.waitForSelector('#pj-fed-own .ownseal-code', { state: 'visible', timeout: 15000 }).catch(() => null);
          const w = await page.evaluate(() => {
            const c = document.querySelector('#pj-fed-own .ownseal-code');
            if (!c) return null;
            const lh = parseFloat(getComputedStyle(c).lineHeight);
            return { code: c.textContent, oneLine: c.getBoundingClientRect().height < lh * 1.6,
              acts: [...document.querySelectorAll('#pj-fed-own [data-own-act]')].map((b) => b.textContent),
              wide: document.documentElement.scrollWidth > innerWidth };
          });
          chk(w && w.code === WAITING_CODE, `${E} the waiting computer shows its own code`, JSON.stringify(w));
          chk(w && w.oneLine, `${E} the code stays on one line`, JSON.stringify(w));
          chk(w && w.acts.join('|') === 'It matches|Does not match', `${E} It matches and Does not match are offered`, JSON.stringify(w && w.acts));
          const look = await page.evaluate(() => {
            const bs = [...document.querySelectorAll('#pj-fed-own [data-own-act]')];
            const st = bs.map((b) => { const c = getComputedStyle(b); return { h: b.getBoundingClientRect().height, bg: c.backgroundColor, bd: c.borderTopColor + ' ' + c.borderTopWidth }; });
            const sep = document.querySelector('#pj-fed-own .ownseal-sep');
            const line = document.getElementById('pj-fed-own-phone');
            return { st, sep: sep ? sep.textContent.charCodeAt(0) : null, line: !!line && !line.hidden && line.getBoundingClientRect().height > 0 };
          });
          chk(look.st.length === 2 && look.st.every((x) => x.h >= 44), `${E} both answers are at least 44 px tall`, JSON.stringify(look.st));
          chk(look.st.length === 2 && look.st[0].bg === look.st[1].bg && look.st[0].bd === look.st[1].bd, `${E} It matches and Does not match are equal weight`, JSON.stringify(look.st));
          chk(look.sep === 0x2d, `${E} the separator is a plain hyphen`, String(look.sep));
          chk(look.line === (width < 600), `${E} the line above the room shows only where Members sits under it`, JSON.stringify({ width, line: look.line }));
          await page.click('#pj-fed-own [data-own-act="match"]');
          await page.waitForFunction(() => /Confirmed/.test((document.querySelector('#pj-fed-own .fmsg') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => null);
          const conf = posted.find((p) => p.path.endsWith('/own-confirm'));
          chk(conf && conf.body.project === waitingP.id && conf.body.code === WAITING_CODE, `${E} It matches sends exactly the code that was on screen`, JSON.stringify(conf));
          const confMsg = await page.textContent('#pj-fed-own .fmsg').catch(() => '');
          chk(/^Confirmed\./.test(confMsg || ''), `${E} the confirm is said on screen`, confMsg);
          await page.click('#pj-fed-own [data-own-act="nomatch"]');
          await page.waitForFunction(() => /Started over/.test((document.querySelector('#pj-fed-own .fmsg') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => null);
          const over = posted.filter((p) => p.path.endsWith('/own-confirm')).pop();
          chk(over && over.body.match === false && over.body.code === undefined, `${E} Does not match asks to start over and sends no code`, JSON.stringify(over));
          // The owner's side.
          await open(ownerP.id);
          await page.waitForFunction(() => document.querySelectorAll('#pj-fed-own [data-own-act="allow"]').length === 2, null, { timeout: 15000 }).catch(() => null);
          const o = await page.evaluate(() => ({
            codes: [...document.querySelectorAll('#pj-fed-own .ownseal-code')].map((c) => c.textContent),
            mine: !!document.querySelector('#pj-fed-own [data-own-act="match"]'),
            wide: document.documentElement.scrollWidth > innerWidth }));
          chk(o.codes.join('|') === ROWS.map((r) => r.code).join('|'), `${E} the owner lists each waiting computer with its code`, JSON.stringify(o));
          const allowH = await page.evaluate(() => [...document.querySelectorAll('#pj-fed-own [data-own-act="allow"]')].map((b) => b.getBoundingClientRect().height));
          chk(allowH.length === 2 && allowH.every((x) => x >= 44), `${E} each Allow is a button at least 44 px tall`, JSON.stringify(allowH));
          const ownerLine = await page.evaluate(() => { const l = document.getElementById('pj-fed-own-phone'); return !!l && !l.hidden; });
          chk(!ownerLine, `${E} the sealed line is not shown on the computer that shared the room`);
          chk(!o.mine, `${E} another project does not show the waiting project's code`, JSON.stringify(o));
          await page.click('#pj-fed-own [data-own-pub="pub-desk"]');
          await page.waitForFunction(() => /Allowed/.test((document.querySelector('#pj-fed-own .fmsg') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => null);
          const allow = posted.find((p) => p.path.endsWith('/own-allow'));
          chk(allow && allow.body.project === ownerP.id && allow.body.pub === 'pub-desk' && allow.body.code === '23456-789AB', `${E} Allow sends exactly that row's key and code`, JSON.stringify(allow));
          refuseNext = true;
          await page.click('#pj-fed-own [data-own-pub="pub-laptop"]');
          await page.waitForFunction(() => /not allowed/.test((document.querySelector('#pj-fed-own .fmsg') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => null);
          const refused = await page.textContent('#pj-fed-own .fmsg').catch(() => '');
          chk(refused === 'That computer was not allowed: the code confirmed is not the one that computer shows.', `${E} a refusal's own words are shown`, refused);
          chk(!o.wide && !(w && w.wide), `${E} no sideways scroll`);
          // A project with neither answer shows nothing.
          await open(quietP.id);
          await page.waitForTimeout(1500);
          const quiet = await page.evaluate(() => (document.getElementById('pj-fed-own') || {}).textContent || '');
          chk(quiet.trim() === '', `${E} a project with no waiting computer and no code shows nothing`, quiet);
          chk(errs.length === 0, `${E} no page errors`, errs.join(' | '));
          await ctx.close();
        }
      } finally { await browser.close(); }
    }
  } finally {
    server.close();
    for (const d of SANDBOXES) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  console.log(fail.length ? `\nFAIL: ${fail.length}` : '\nAll checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('FAIL  render-ownseal-4658 crashed: ' + ((e && e.stack) || e)); process.exit(1); });
