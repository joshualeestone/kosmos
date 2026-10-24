// Browser-check-surface: pj-fed-own fedOwnHtml fedOwnRemoveOpen fedOwnRemoveGo own-allowed own-remove
'use strict';
/**
 * kosmos#4658 with #7028: the computer that first shared a sealed room lists the other computers it let in
 * (GET /api/federation/own-allowed), each with Remove, and Remove takes one out (POST /api/federation/own-remove).
 *
 * What this pins, and why each line can fail:
 *  - hidden while federation is not live; a project whose list is empty shows no rows;
 *  - each row says when it was allowed, and its Remove is a bordered button at least 44 px tall whose label names
 *    that date;
 *  - Remove ASKS FIRST (Josh's rule, the #761 dialog): nothing is posted on the press, and Cancel posts nothing and
 *    brings focus back to that Remove;
 *  - a refusal is said in the dialog, which stays open with the computer still listed;
 *  - Take it out sends exactly that row's key and the project, closes the dialog, takes the row away, and says so in
 *    the section, with focus inside the section;
 *  - failed reads after a remove never bring the removed computer back, and a later answer listing it again (it
 *    was let in again) shows it again;
 *  - entering another project closes an open dialog and posts nothing;
 *  - in the consolidated view (Members card hidden) the same works from the rail;
 *  - 390 wide with no sideways scroll, chromium and webkit, no page errors.
 * The engine and the two routes are tested in engine/fedseats.ownremove-7028.test.js and
 * server.ownremove-7028.test.js; here the routes are answered by the page's own fake.
 *
 *   HEADED=0 node docs/browser-checks/render-ownremove-4658.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host computer's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ownremove-bc-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ownremove-bc-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ownremove-bc-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ownremove-bc-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ownremove-bc-config-'));
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

// Two computers let in on fixed days (noon UTC, so the day is the same in every time zone the check runs in).
const AT_LAPTOP = Date.UTC(2026, 9, 3, 12);
const AT_DESK = Date.UTC(2026, 9, 17, 12);
const REFUSAL = 'That computer was not taken out: the room\'s key could not be changed right now; try again.';

(async () => {
  fleet.install([fleet.agent('ada', { state: 'idle', displayName: 'Ada', role: 'a planner' })]);
  const server = await srv.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await engine.launch({ headless: process.env.HEADED === '0' });
      try {
        for (const [live, width, view] of [[false, 1280, 'tabs'], [true, 1280, 'tabs'], [true, 390, 'tabs'], [true, 1280, 'consolidated']]) {
          const E = `[${engineName} ${live ? 'live' : 'not live'} ${width}${view === 'tabs' ? '' : ' ' + view}]`;
          const ownerP = projects.create({ name: 'Owner ' + engineName + width + live + view });
          const quietP = projects.create({ name: 'Quiet ' + engineName + width + live + view });
          const ctx = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
          const page = await ctx.newPage();
          const errs = [];
          page.on('pageerror', (e) => errs.push(e.message));
          await page.route('**/api/status*', async (r) => {
            try {
              const resp = await r.fetch();
              const j = await resp.json().catch(() => null);
              if (!j) return await r.fulfill({ response: resp });
              j.federationLive = live; j.kosmos_plus = live;
              return await r.fulfill({ response: resp, json: j });
            } catch { await r.abort().catch(() => {}); }
          });
          // The engine's state, as the routes report and change it.
          const state = { allowed: [{ pub: 'pub-laptop', mac: 'mac-1', at: AT_LAPTOP }, { pub: 'pub-desk', mac: 'mac-2', at: AT_DESK }] };
          const posted = [];
          let refuseNext = false;
          let failReads = false;
          let failsServed = 0;
          await page.route('**/api/federation/own-*', async (r) => {
            try {
              const u = new URL(r.request().url());
              const pid = u.searchParams.get('project');
              if (r.request().method() === 'GET') {
                if (failReads) { failsServed += 1; return await r.fulfill({ status: 500, json: { error: 'blip' } }); }
                if (u.pathname.endsWith('/own-compare')) return await r.fulfill({ json: { code: null } });
                if (u.pathname.endsWith('/own-allowed')) return await r.fulfill({ json: { computers: pid === ownerP.id ? state.allowed : [] } });
                return await r.fulfill({ json: { computers: [] } });   // own-waiting: nobody waiting
              }
              const body = JSON.parse(r.request().postData() || '{}');
              posted.push({ path: u.pathname, body });
              if (refuseNext) { refuseNext = false; return await r.fulfill({ status: 409, json: { error: REFUSAL } }); }
              if (u.pathname.endsWith('/own-remove')) { state.allowed = state.allowed.filter((x) => x.pub !== body.pub); return await r.fulfill({ json: { removed: true } }); }
              return await r.fulfill({ status: 400, json: { error: 'unexpected' } });
            } catch { await r.abort().catch(() => {}); }
          });
          await page.goto(BASE, { waitUntil: 'networkidle' });
          if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
          await page.waitForFunction((want) => document.documentElement.getAttribute('data-fed-ui') === want, live ? 'show' : 'hidden', { timeout: 8000 }).catch(() => null);
          const open = async (id) => {
            await page.evaluate(async (pid) => { await loadProjects(); showTab('projects'); openProject(pid); }, id);
            await page.waitForFunction((pid) => typeof PJ_CURRENT !== 'undefined' && PJ_CURRENT === pid, id, { timeout: 8000 });
          };
          await open(ownerP.id);
          if (!live) {
            await page.waitForTimeout(1500);
            const seen = await page.evaluate(() => document.querySelectorAll('[data-own-act="remove"]').length);
            chk(seen === 0, `${E} no Remove rows while federation is not live`, String(seen));
            chk(errs.length === 0, `${E} no page errors`, errs.join(' | '));
            await ctx.close();
            continue;
          }
          if (view === 'consolidated') await page.evaluate((pid) => { applyLayout('consolidated', true); showTab('projects'); openProject(pid); }, ownerP.id);
          const BOX = view === 'consolidated' ? '#alist-fed-own' : '#pj-fed-own';
          await page.waitForSelector(BOX + ' [data-own-act="remove"]', { state: 'visible', timeout: 15000 }).catch(() => null);
          const rows = await page.evaluate((box) => [...document.querySelectorAll(box + ' [data-own-act="remove"]')].map((b) => {
            const cs = getComputedStyle(b);
            const row = b.closest('.fedout-row');
            return { pub: b.dataset.ownPub, label: b.getAttribute('aria-label') || '', h: b.getBoundingClientRect().height,
              border: cs.borderTopStyle !== 'none' && parseFloat(cs.borderTopWidth) > 0, text: row ? row.textContent : '' };
          }), BOX);
          const day = (at) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
          chk(rows.length === 2 && rows[0].pub === 'pub-laptop' && rows[1].pub === 'pub-desk', `${E} each allowed computer has its own Remove`, JSON.stringify(rows.map((r) => r.pub)));
          chk(rows.length === 2 && rows[0].text.includes('Allowed ' + day(AT_LAPTOP)) && rows[1].text.includes('Allowed ' + day(AT_DESK)), `${E} each row says when it was allowed`, JSON.stringify(rows.map((r) => r.text)));
          chk(rows.length === 2 && rows.every((r) => r.h >= 44 && r.border), `${E} Remove is a bordered button at least 44 px tall`, JSON.stringify(rows.map((r) => [r.h, r.border])));
          chk(rows.length === 2 && rows[1].label.includes(day(AT_DESK)), `${E} Remove's label names the day that computer was allowed`, rows.length ? rows[1].label : '');

          // Remove asks first: the dialog opens, nothing is posted, focus is on Cancel.
          const sel = BOX + ' [data-own-act="remove"][data-own-pub="pub-desk"]';
          await page.click(sel);
          await page.waitForFunction(() => !document.getElementById('mem-modal').hidden, null, { timeout: 4000 }).catch(() => null);
          const dlg = await page.evaluate(() => ({ open: !document.getElementById('mem-modal').hidden, title: document.getElementById('mem-title').textContent,
            go: document.getElementById('mem-go').textContent, focus: document.activeElement && document.activeElement.id }));
          chk(dlg.open && /^Take this computer out of /.test(dlg.title) && dlg.go === 'Take it out', `${E} Remove opens the confirm dialog`, JSON.stringify(dlg));
          chk(dlg.focus === 'mem-keep', `${E} the dialog opens on Cancel`, String(dlg.focus));
          chk(posted.length === 0, `${E} pressing Remove posts nothing before the confirm`, String(posted.length));
          // A refresh while the dialog is open rebuilds the rows (the laptop's day moves, so the markup changes): the
          // button that opened the dialog is gone, and Cancel must still find that computer's Remove again.
          state.allowed = state.allowed.map((x) => (x.pub === 'pub-laptop' ? Object.assign({}, x, { at: AT_LAPTOP + 2 * 86400000 }) : x));
          const rebuilt = await page.evaluate(async (a) => {
            const b = document.querySelector(a.sel);
            b.dataset.beforeRefresh = '1';
            await fedOwnLoad(a.pid);
            const n = document.querySelector(a.sel);
            return !!n && !n.dataset.beforeRefresh;
          }, { sel, pid: ownerP.id });
          chk(rebuilt, `${E} a refresh under the open dialog rebuilt that Remove (the case below is real)`);
          await page.click('#mem-keep');
          await page.waitForTimeout(200);
          const afterCancel = await page.evaluate(() => ({ open: !document.getElementById('mem-modal').hidden, act: (document.activeElement && document.activeElement.dataset) ? document.activeElement.dataset.ownAct + ':' + document.activeElement.dataset.ownPub : '' }));
          chk(!afterCancel.open && posted.length === 0, `${E} Cancel closes the dialog and posts nothing`, JSON.stringify(afterCancel) + ' ' + posted.length);
          chk(afterCancel.act === 'remove:pub-desk', `${E} after Cancel, focus is back on that Remove`, afterCancel.act);

          // A refusal is said in the dialog, which stays open with the computer still listed.
          refuseNext = true;
          await page.click(sel);
          await page.waitForFunction(() => !document.getElementById('mem-modal').hidden, null, { timeout: 4000 }).catch(() => null);
          await page.click('#mem-go');
          await page.waitForFunction((t) => document.getElementById('mem-msg').textContent === t, REFUSAL, { timeout: 8000 }).catch(() => null);
          const refused = await page.evaluate((s) => ({ open: !document.getElementById('mem-modal').hidden, msg: document.getElementById('mem-msg').textContent,
            listed: !!document.querySelector(s), live: !document.getElementById('mem-go').disabled }), sel);
          chk(refused.open && refused.msg === REFUSAL && refused.listed && refused.live, `${E} a refusal is said in the dialog, the computer still listed`, JSON.stringify(refused));

          // Take it out: exactly that row's key, the dialog closes, the row goes, the section says so. The reads fail
          // from here, so the reload after the remove keeps the list it had: the removed computer must not be in it.
          failReads = true; failsServed = 0;
          await page.click('#mem-go');
          await page.waitForFunction((s) => document.getElementById('mem-modal').hidden && !document.querySelector(s), sel, { timeout: 8000 }).catch(() => null);
          const rm = posted.filter((p) => p.path.endsWith('/own-remove'));
          const last = rm[rm.length - 1];
          chk(rm.length === 2 && last.body.project === ownerP.id && last.body.pub === 'pub-desk' && Object.keys(last.body).length === 2, `${E} Take it out sends exactly that row's key and the project`, JSON.stringify(rm));
          const done = await page.evaluate((box) => {
            const a = document.activeElement;
            return { open: !document.getElementById('mem-modal').hidden, left: [...document.querySelectorAll(box + ' [data-own-act="remove"]')].map((b) => b.dataset.ownPub),
              msg: (document.querySelector(box + ' .fmsg') || {}).textContent || '', inBox: !!(a && a.closest && a.closest(box)), onRemove: !!(a && a.dataset && a.dataset.ownAct === 'remove') };
          }, BOX);
          chk(!done.open && done.left.length === 1 && done.left[0] === 'pub-laptop' && failsServed >= 1, `${E} the removed computer leaves the list, even when the reload after it fails`, JSON.stringify(done.left) + ' fails=' + failsServed);
          chk(/^Taken out\./.test(done.msg), `${E} the section says it was taken out`, done.msg);
          chk(done.inBox && !done.onRemove, `${E} focus stays in the section, not on another computer's Remove`, JSON.stringify(done));
          await page.waitForFunction(() => /^Taken out\./.test(document.getElementById('pj-fed-own-said').textContent), null, { timeout: 4000 }).catch(() => null);
          chk(/^Taken out\./.test(await page.evaluate(() => document.getElementById('pj-fed-own-said').textContent)), `${E} the result is put in the one live region`);

          // A second failed load (two misses in a row, the most a list is kept through) still keeps it without the
          // removed computer.
          failsServed = 0;
          await page.evaluate((pid) => fedOwnLoad(pid), ownerP.id);
          const kept = await page.evaluate((box) => [...document.querySelectorAll(box + ' [data-own-act="remove"]')].map((b) => b.dataset.ownPub), BOX);
          chk(failsServed >= 3 && kept.length === 1 && kept[0] === 'pub-laptop', `${E} failed reads keep the list without the removed computer`, JSON.stringify(kept) + ' fails=' + failsServed);
          failReads = false;
          // Let in again: the board lists it, so the page shows it again.
          state.allowed = state.allowed.concat([{ pub: 'pub-desk', mac: 'mac-2', at: AT_DESK }]);
          await page.evaluate((pid) => fedOwnLoad(pid), ownerP.id);
          await page.waitForSelector(sel, { timeout: 4000 }).catch(() => null);
          chk(!!(await page.$(sel)), `${E} a computer let in again is listed again`);

          // Entering another project closes an open dialog and posts nothing.
          const before = posted.length;
          await page.click(sel);
          await page.waitForFunction(() => !document.getElementById('mem-modal').hidden, null, { timeout: 4000 }).catch(() => null);
          await open(quietP.id);
          await page.waitForTimeout(300);
          const switched = await page.evaluate(() => ({ open: !document.getElementById('mem-modal').hidden, rows: document.querySelectorAll('[data-own-act="remove"]').length }));
          chk(!switched.open && posted.length === before, `${E} entering another project closes the dialog and posts nothing`, JSON.stringify(switched) + ' ' + (posted.length - before));
          await page.waitForTimeout(1200);
          chk(await page.evaluate(() => document.querySelectorAll('[data-own-act="remove"]').length) === 0, `${E} a project with no allowed computers shows no rows`);

          const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
          chk(!wide, `${E} no sideways scroll`);
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
})().catch((e) => { console.error('FAIL  render-ownremove-4658 crashed: ' + ((e && e.stack) || e)); process.exit(1); });
