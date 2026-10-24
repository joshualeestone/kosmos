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
 *  - the page's fake answers as the engine does (an allowed row leaves the list, a confirmed code is gone, a start
 *    over brings a new code), so a press's sentence is pinned where the press empties the section, and is pinned to
 *    clear once the section shows something the sentence does not describe;
 *  - a refusal's own words are shown; focus stays in the section after a press; a newly opened project never shows
 *    the last project's rows while its own answer is on its way; a project with neither answer shows nothing;
 *  - Mona's review (card comment 6382874566): the answers are bordered buttons at least 44 px tall, It matches and
 *    Does not match at equal weight (same background and border), Allow the same style; the separator is a plain
 *    ASCII hyphen; where Members sits under the room (390), one line above the room says the room is sealed;
 *  - the consolidated view hides the Members card, so the section is drawn in the rail there (#alist-fed-own), and
 *    works from it; the line above the room shows on an upright touch tablet in the classic look (chromium only:
 *    the tablet query needs a coarse pointer, which only chromium's mobile emulation gives);
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

const FIRST_CODE = 'K7M3P-Q9RXA';
const NEXT_CODE = 'M4N5P-R6S7T';
const LATER_CODE = 'W8X9Y-Z2A3B';
const MSG = (page) => page.evaluate(() => (document.querySelector('#pj-fed-own .fmsg') || {}).textContent || '');

(async () => {
  fleet.install([fleet.agent('ada', { state: 'idle', displayName: 'Ada', role: 'a planner' })]);
  const server = await srv.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await engine.launch({ headless: process.env.HEADED === '0' });
      try {
        const arms = [[false, 1280, 'tabs'], [true, 1280, 'tabs'], [true, 390, 'tabs'], [true, 1280, 'consolidated']]
          .concat(engineName === 'chromium' ? [[true, 820, 'tablet']] : []);
        for (const [live, width, view] of arms) {
          const E = `[${engineName} ${live ? 'live' : 'not live'} ${width}${view === 'tabs' ? '' : ' ' + view}]`;
          const waitingP = projects.create({ name: 'Waiting ' + engineName + width + live + view });
          const ownerP = projects.create({ name: 'Owner ' + engineName + width + live + view });
          const quietP = projects.create({ name: 'Quiet ' + engineName + width + live + view });
          const ctx = await browser.newContext(view === 'tablet'
            ? { viewport: { width, height: 1180 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' }
            : { viewport: { width, height: 1000 }, serviceWorkers: 'block' });
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
          // The engine's state, as the four routes report and change it.
          const state = {
            code: FIRST_CODE,
            rows: [{ pub: 'pub-laptop', mac: 'mac-1', code: 'ABCDE-FGHJK', at: 1 }, { pub: 'pub-desk', mac: 'mac-2', code: '23456-789AB', at: 2 }],
          };
          const posted = [];
          let refuseNext = false;
          let hold = null;   // a promise the two reads wait on, to look at the section before an answer lands
          let failReads = false;   // the two reads answer 500, as a blip would
          await page.route('**/api/federation/own-*', async (r) => {
            try {
              const u = new URL(r.request().url());
              const pid = u.searchParams.get('project');
              if (r.request().method() === 'GET') {
                if (hold) await hold;
                if (failReads) return await r.fulfill({ status: 500, json: { error: 'blip' } });
                if (u.pathname.endsWith('/own-compare')) return await r.fulfill({ json: { code: pid === waitingP.id ? state.code : null } });
                return await r.fulfill({ json: { computers: pid === ownerP.id ? state.rows : [] } });
              }
              const body = JSON.parse(r.request().postData() || '{}');
              posted.push({ path: u.pathname, body });
              if (refuseNext) { refuseNext = false; return await r.fulfill({ status: 409, json: { error: 'That computer was not allowed: the code confirmed is not the one that computer shows.' } }); }
              if (u.pathname.endsWith('/own-allow')) { state.rows = state.rows.filter((x) => x.pub !== body.pub); return await r.fulfill({ json: { allowed: true } }); }
              if (body.match === false) { state.code = NEXT_CODE; return await r.fulfill({ json: { started_over: true } }); }
              // Confirmed before the other computer's Allow (the order the hint asks for): the engine keeps answering the
              // same code until the share lands, so the code stays.
              return await r.fulfill({ json: { confirmed: true } });
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
          if (view === 'consolidated') {
            await page.evaluate((pid) => { applyLayout('consolidated', true); showTab('projects'); openProject(pid); }, waitingP.id);
            await page.waitForSelector('#alist-fed-own .ownseal-code', { state: 'visible', timeout: 15000 }).catch(() => null);
            const c = await page.evaluate(() => ({ code: (document.querySelector('#alist-fed-own .ownseal-code') || {}).textContent || '',
              card: !!document.querySelector('#pj-fed-own') && document.querySelector('#pj-fed-own').offsetParent !== null,
              line: !document.getElementById('pj-fed-own-phone').hidden }));
            chk(c.code === FIRST_CODE, `${E} the consolidated rail shows the code where the Members card is hidden`, JSON.stringify(c));
            chk(!c.line, `${E} the line above the room is not shown in the consolidated view`, JSON.stringify(c));
            // A focused rail button survives the rail's rebuild on the next status poll.
            await page.focus('#alist-fed-own [data-own-act="match"]');
            await page.waitForResponse((r) => r.url().includes('/api/status'), { timeout: 15000 }).catch(() => null);
            await page.waitForTimeout(400);
            const railFocus = await page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('#alist-fed-own'));
            chk(railFocus, `${E} focus on a rail button survives the rail's rebuild on a status poll`);
            await page.click('#alist-fed-own [data-own-act="match"]');
            await page.waitForFunction(() => /Confirmed/.test((document.querySelector('#alist-fed-own .fmsg') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => null);
            const cc = posted.filter((p) => p.path.endsWith('/own-confirm')).pop();
            chk(cc && cc.body.code === FIRST_CODE && cc.body.project === waitingP.id, `${E} It matches works from the rail and sends the code shown there`, JSON.stringify(cc));
            await page.waitForFunction(() => document.getElementById('pj-fed-own-said').textContent !== '', null, { timeout: 4000 }).catch(() => null);
            const heard = await page.evaluate(() => document.getElementById('pj-fed-own-said').textContent);
            chk(/^Confirmed\./.test(heard), `${E} the result is put in the one live region`, heard);
            chk(errs.length === 0, `${E} no page errors`, errs.join(' | '));
            await ctx.close();
            continue;
          }
          if (view === 'tablet') {
            await page.waitForSelector('#pj-fed-own .ownseal-code', { state: 'attached', timeout: 15000 }).catch(() => null);
            await page.waitForTimeout(500);
            const t = await page.evaluate(() => ({ upright: pjTabletUpright(), line: !document.getElementById('pj-fed-own-phone').hidden }));
            chk(t.upright && t.line, `${E} an upright touch tablet shows the line above the room`, JSON.stringify(t));
            chk(errs.length === 0, `${E} no page errors`, errs.join(' | '));
            await ctx.close();
            continue;
          }
          // ---- The waiting computer's side. ----
          await page.waitForSelector('#pj-fed-own .ownseal-code', { state: 'visible', timeout: 15000 }).catch(() => null);
          const w = await page.evaluate(() => {
            const c = document.querySelector('#pj-fed-own .ownseal-code');
            if (!c) return null;
            const lh = parseFloat(getComputedStyle(c).lineHeight);
            return { code: c.textContent, oneLine: c.getBoundingClientRect().height < lh * 1.6,
              acts: [...document.querySelectorAll('#pj-fed-own [data-own-act]')].map((b) => b.textContent),
              wide: document.documentElement.scrollWidth > innerWidth };
          });
          chk(w && w.code === FIRST_CODE, `${E} the waiting computer shows its own code`, JSON.stringify(w));
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
          // Does not match, pressed from the keyboard: a new code, the sentence, and focus kept in the section.
          await page.focus('#pj-fed-own [data-own-act="nomatch"]');
          await page.keyboard.press('Enter');
          await page.waitForFunction((c) => (document.querySelector('#pj-fed-own .ownseal-code') || {}).textContent === c, NEXT_CODE, { timeout: 8000 }).catch(() => null);
          const over = posted.filter((p) => p.path.endsWith('/own-confirm')).pop();
          chk(over && over.body.match === false && over.body.code === undefined, `${E} Does not match asks to start over and sends no code`, JSON.stringify(over));
          chk(/^Started over\./.test(await MSG(page)), `${E} the start over is said on screen`, await MSG(page));
          const focusIn = await page.evaluate(() => document.getElementById('pj-fed-own').contains(document.activeElement));
          chk(focusIn, `${E} focus stays in the section after a press`);
          // It matches on the new code, before the other computer's Allow: exactly that code is sent, and while the engine
          // still answers it the code stays to compare with nothing left to press.
          await page.click('#pj-fed-own [data-own-act="match"]');
          await page.waitForFunction(() => /Confirmed/.test((document.querySelector('#pj-fed-own .fmsg') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => null);
          await page.evaluate(() => fedOwnLoad(PJ_CURRENT, true));
          const conf = posted.filter((p) => p.path.endsWith('/own-confirm')).pop();
          chk(conf && conf.body.project === waitingP.id && conf.body.code === NEXT_CODE, `${E} It matches sends exactly the code that was on screen`, JSON.stringify(conf));
          const waitingOn = await page.evaluate(() => ({ code: (document.querySelector('#pj-fed-own .ownseal-code') || {}).textContent || '',
            buttons: document.querySelectorAll('#pj-fed-own [data-own-act]').length, text: document.getElementById('pj-fed-own').textContent }));
          chk(waitingOn.code === NEXT_CODE && waitingOn.buttons === 0 && /You confirmed this code/.test(waitingOn.text),
            `${E} confirmed before the Allow: the code stays, with no button to press again`, JSON.stringify(waitingOn));
          // The other computer's Allow lands: the code is gone.
          state.code = null;
          await page.evaluate(() => fedOwnLoad(PJ_CURRENT));
          await page.waitForFunction(() => !document.querySelector('#pj-fed-own .ownseal-code'), null, { timeout: 8000 }).catch(() => null);
          const adopted = await page.evaluate(() => !!document.querySelector('#pj-fed-own .ownseal-code'));
          chk(!adopted, `${E} once the key is taken the code goes`);
          // The section moves on (the other computer started over): the old sentence goes with it.
          state.code = LATER_CODE;
          await page.evaluate(() => fedOwnLoad(PJ_CURRENT));
          await page.waitForFunction((c) => (document.querySelector('#pj-fed-own .ownseal-code') || {}).textContent === c, LATER_CODE, { timeout: 8000 }).catch(() => null);
          chk((await MSG(page)) === '', `${E} a sentence about an earlier code is cleared when a new code shows`, await MSG(page));
          // ---- A newly opened project shows nothing of the last one while its own answer is on its way. ----
          let release;
          hold = new Promise((res) => { release = res; });
          await open(ownerP.id);
          const early = await page.evaluate(() => (document.getElementById('pj-fed-own') || {}).textContent || '');
          release(); hold = null;
          chk(early.trim() === '', `${E} another project's section is empty until its own answer arrives`, early);
          // ---- The owner's side. ----
          await page.waitForFunction(() => document.querySelectorAll('#pj-fed-own [data-own-act="allow"]').length === 2, null, { timeout: 15000 }).catch(() => null);
          const o = await page.evaluate(() => ({
            codes: [...document.querySelectorAll('#pj-fed-own .ownseal-code')].map((c) => c.textContent),
            allowH: [...document.querySelectorAll('#pj-fed-own [data-own-act="allow"]')].map((b) => b.getBoundingClientRect().height),
            line: (() => { const l = document.getElementById('pj-fed-own-phone'); return !!l && !l.hidden; })(),
            wide: document.documentElement.scrollWidth > innerWidth }));
          chk(o.codes.join('|') === 'ABCDE-FGHJK|23456-789AB', `${E} the owner lists each waiting computer with its code`, JSON.stringify(o));
          chk(o.allowH.length === 2 && o.allowH.every((x) => x >= 44), `${E} each Allow is a button at least 44 px tall`, JSON.stringify(o.allowH));
          chk(!o.line, `${E} the sealed line is not shown on the computer that shared the room`);
          // A refresh whose reads fail keeps what is on screen.
          failReads = true;
          await page.evaluate(() => fedOwnLoad(PJ_CURRENT));
          await page.waitForTimeout(500);
          failReads = false;
          const kept = await page.evaluate(() => document.querySelectorAll('#pj-fed-own [data-own-act="allow"]').length);
          chk(kept === 2, `${E} a refresh whose reads fail keeps the rows on screen`, String(kept));
          // A button drawn for another project acts on nothing here.
          const before = posted.length;
          await page.evaluate((other) => {
            const b = document.querySelector('#pj-fed-own [data-own-act="allow"]').cloneNode(true);
            b.dataset.ownProject = other;
            fedOwnPress(b);
          }, waitingP.id);
          await page.waitForTimeout(300);
          chk(posted.length === before, `${E} a button drawn for another project sends nothing`, String(posted.length - before));
          await page.click('#pj-fed-own [data-own-pub="pub-desk"]');
          await page.waitForFunction(() => /Allowed/.test((document.querySelector('#pj-fed-own .fmsg') || {}).textContent || '')
            && document.querySelectorAll('#pj-fed-own [data-own-act="allow"]').length === 1, null, { timeout: 8000 }).catch(() => null);
          const allow = posted.find((p) => p.path.endsWith('/own-allow'));
          chk(allow && allow.body.project === ownerP.id && allow.body.pub === 'pub-desk' && allow.body.code === '23456-789AB', `${E} Allow sends exactly that row's key and code`, JSON.stringify(allow));
          const left = await page.evaluate(() => document.querySelectorAll('#pj-fed-own [data-own-act="allow"]').length);
          chk(left === 1, `${E} the allowed computer leaves the list`, String(left));
          refuseNext = true;
          await page.click('#pj-fed-own [data-own-pub="pub-laptop"]');
          await page.waitForFunction(() => /not allowed/.test((document.querySelector('#pj-fed-own .fmsg') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => null);
          chk((await MSG(page)) === 'That computer was not allowed: the code confirmed is not the one that computer shows.', `${E} a refusal's own words are shown`, await MSG(page));
          await page.click('#pj-fed-own [data-own-pub="pub-laptop"]');
          await page.waitForFunction(() => /Allowed/.test((document.querySelector('#pj-fed-own .fmsg') || {}).textContent || '')
            && !document.querySelector('#pj-fed-own [data-own-act]'), null, { timeout: 8000 }).catch(() => null);
          const empty = await page.evaluate(() => ({ rows: document.querySelectorAll('#pj-fed-own [data-own-act]').length, msg: (document.querySelector('#pj-fed-own .fmsg') || {}).textContent || '' }));
          chk(empty.rows === 0 && /^Allowed\./.test(empty.msg), `${E} allowing the last computer still says Allowed`, JSON.stringify(empty));
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
