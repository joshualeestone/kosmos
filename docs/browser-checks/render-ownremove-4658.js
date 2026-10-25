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
 *  - Remove it sends exactly that row's key and the project, closes the dialog, takes the row away, and says so in
 *    the section, with focus inside the section;
 *  - failed reads after a remove never bring the removed computer back, and a later answer listing it again (it
 *    was let in again) shows it again;
 *  - entering another project closes an open dialog and posts nothing;
 *  - in the consolidated view (Members card hidden) the same works from the rail;
 *  - 390 wide with no sideways scroll, chromium and webkit, no page errors.
 * The rest (the in-flight races, the timeout, the gate under an open dialog, the names when rows share a day or a
 * minute or have no time) is in this check's row in docs/browser-checks/README.md.
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

// Two computers let in at noon UTC (so the day is the same in every time zone the check runs in), in June of the year
// the check runs: the rows add the year only for another year, so these never carry one.
const DAY = 86400000;
const THIS_YEAR = new Date().getFullYear();
const AT_LAPTOP = Date.UTC(THIS_YEAR, 5, 1, 12);
const AT_DESK = Date.UTC(THIS_YEAR, 5, 15, 12);
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
          let allowedGets = 0;
          const allowedFor = {};   // own-allowed reads per project
          let answered = 0;        // own-remove answers the page has been sent
          const until = async (ok, ms) => { const t = Date.now() + ms; while (!ok() && Date.now() < t) await new Promise((r) => setTimeout(r, 50)); return ok(); };
          let holdPost = null;   // a promise own-remove waits on, to act while it is in flight
          await page.route('**/api/federation/own-*', async (r) => {
            try {
              const u = new URL(r.request().url());
              const pid = u.searchParams.get('project');
              if (r.request().method() === 'GET') {
                if (failReads) { failsServed += 1; return await r.fulfill({ status: 500, json: { error: 'blip' } }); }
                if (u.pathname.endsWith('/own-compare')) return await r.fulfill({ json: { code: null } });
                if (u.pathname.endsWith('/own-allowed')) { allowedGets += 1; allowedFor[pid] = (allowedFor[pid] || 0) + 1; }
                if (u.pathname.endsWith('/own-allowed')) return await r.fulfill({ json: { computers: pid === ownerP.id ? state.allowed : [] } });
                return await r.fulfill({ json: { computers: [] } });   // own-waiting: nobody waiting
              }
              const body = JSON.parse(r.request().postData() || '{}');
              posted.push({ path: u.pathname, body });
              if (holdPost) await holdPost;
              let out;
              if (refuseNext) { refuseNext = false; out = { status: 409, json: { error: REFUSAL } }; }
              else if (u.pathname.endsWith('/own-remove')) { state.allowed = state.allowed.filter((x) => x.pub !== body.pub); out = { json: { removed: true } }; }
              else out = { status: 400, json: { error: 'unexpected' } };
              await r.fulfill(out);
              answered += 1;
              return;
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
            chk(seen === 0 && allowedGets === 0, `${E} no Remove rows, and the list is never asked, while federation is not live`, JSON.stringify({ seen, allowedGets }));
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
          chk(dlg.open && /^Remove this computer from /.test(dlg.title) && dlg.go === 'Remove it', `${E} Remove opens the confirm dialog`, JSON.stringify(dlg));
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

          // Remove it: exactly that row's key, the dialog closes, the row goes, the section says so. The reads fail
          // from here, so the reload after the remove keeps the list it had: the removed computer must not be in it.
          failReads = true; failsServed = 0;
          await page.click('#mem-go');
          await page.waitForFunction((s) => document.getElementById('mem-modal').hidden && !document.querySelector(s), sel, { timeout: 8000 }).catch(() => null);
          await until(() => failsServed >= 3, 8000);   // the reload after it: all three reads failed
          await page.waitForTimeout(100);
          const rm = posted.filter((p) => p.path.endsWith('/own-remove'));
          const last = rm[rm.length - 1];
          chk(rm.length === 2 && last.body.project === ownerP.id && last.body.pub === 'pub-desk' && Object.keys(last.body).length === 2, `${E} Remove it sends exactly that row's key and the project`, JSON.stringify(rm));
          const done = await page.evaluate((box) => {
            const a = document.activeElement;
            return { open: !document.getElementById('mem-modal').hidden, left: [...document.querySelectorAll(box + ' [data-own-act="remove"]')].map((b) => b.dataset.ownPub),
              msg: (document.querySelector(box + ' .fmsg') || {}).textContent || '', inBox: !!(a && a.closest && a.closest(box)), onRemove: !!(a && a.dataset && a.dataset.ownAct === 'remove') };
          }, BOX);
          chk(!done.open && done.left.length === 1 && done.left[0] === 'pub-laptop' && failsServed >= 3, `${E} the removed computer leaves the list, even when the reload after it fails`, JSON.stringify(done.left) + ' fails=' + failsServed);
          chk(/^Removed\./.test(done.msg), `${E} the section says it was taken out`, done.msg);
          chk(done.inBox && !done.onRemove, `${E} focus stays in the section, not on another computer's Remove`, JSON.stringify(done));
          await page.waitForFunction(() => /^Removed\./.test(document.getElementById('pj-fed-own-said').textContent), null, { timeout: 4000 }).catch(() => null);
          chk(/^Removed\./.test(await page.evaluate(() => document.getElementById('pj-fed-own-said').textContent)), `${E} the result is put in the one live region`);

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

          const held = () => { let go; holdPost = new Promise((res) => { go = res; }); return () => { holdPost = null; go(); }; };
          const openOn = async (pub) => {
            await page.click(BOX + ' [data-own-act="remove"][data-own-pub="' + pub + '"]');
            await page.waitForFunction(() => !document.getElementById('mem-modal').hidden, null, { timeout: 4000 }).catch(() => null);
          };
          const lookReset = () => page.evaluate(() => ({ danger: document.getElementById('mem-go').classList.contains('danger-btn'),
            disabled: document.getElementById('mem-go').disabled, msg: document.getElementById('mem-msg').textContent }));
          // Escape while the remove is in flight, then it succeeds: the dialog stays closed, the row goes, the section
          // says Removed, and the shared dialog is back to its plain look for its other users.
          let release = held();
          await openOn('pub-desk');
          await page.click('#mem-go');
          await page.waitForFunction(() => document.getElementById('mem-msg').textContent === 'Removing…', null, { timeout: 4000 }).catch(() => null);
          await page.keyboard.press('Escape');
          release();
          await page.waitForFunction((s) => !document.querySelector(s) && /^Removed\./.test((document.querySelector(s.split(' ')[0] + ' .fmsg') || {}).textContent || ''), sel, { timeout: 8000 }).catch(() => null);
          const esc1 = await page.evaluate((s) => ({ open: !document.getElementById('mem-modal').hidden, listed: !!document.querySelector(s),
            msg: (document.querySelector(s.split(' ')[0] + ' .fmsg') || {}).textContent || '' }), sel);
          chk(!esc1.open && !esc1.listed && /^Removed\./.test(esc1.msg), `${E} Escape during the remove: it still lands, said in the section`, JSON.stringify(esc1));
          const look1 = await lookReset();
          chk(!look1.danger && !look1.disabled && look1.msg === '', `${E} after an own Remove the shared dialog is back to its plain look`, JSON.stringify(look1));
          // Cancel while a refused remove is in flight: the refusal is said in the section, the dialog stays closed.
          state.allowed = state.allowed.concat([{ pub: 'pub-desk', mac: 'mac-2', at: AT_DESK }]);
          await page.evaluate((pid) => fedOwnLoad(pid), ownerP.id);
          await page.waitForSelector(sel, { timeout: 4000 }).catch(() => null);
          release = held(); refuseNext = true;
          await openOn('pub-desk');
          await page.click('#mem-go');
          await page.waitForFunction(() => document.getElementById('mem-msg').textContent === 'Removing…', null, { timeout: 4000 }).catch(() => null);
          await page.click('#mem-keep');
          release();
          await page.waitForFunction((a) => ((document.querySelector(a.box + ' .fmsg') || {}).textContent || '') === a.t, { box: BOX, t: REFUSAL }, { timeout: 8000 }).catch(() => null);
          const can1 = await page.evaluate((s) => ({ open: !document.getElementById('mem-modal').hidden, listed: !!document.querySelector(s),
            msg: (document.querySelector(s.split(' ')[0] + ' .fmsg') || {}).textContent || '' }), sel);
          chk(!can1.open && can1.listed && can1.msg === REFUSAL, `${E} Cancel during a refused remove: the refusal is said in the section, the computer still listed`, JSON.stringify(can1));
          // The list no longer has the dialog's computer (removed by a press whose answer was lost): the dialog closes,
          // the section says so, focus stays in the section.
          await openOn('pub-desk');
          state.allowed = state.allowed.filter((x) => x.pub !== 'pub-desk');
          await page.evaluate((pid) => fedOwnLoad(pid), ownerP.id);
          await page.waitForFunction(() => document.getElementById('mem-modal').hidden, null, { timeout: 4000 }).catch(() => null);
          const gone = await page.evaluate((box) => { const a = document.activeElement;
            return { open: !document.getElementById('mem-modal').hidden, msg: (document.querySelector(box + ' .fmsg') || {}).textContent || '', inBox: !!(a && a.closest && a.closest(box)) }; }, BOX);
          chk(!gone.open && /^That computer is no longer listed here\.$/.test(gone.msg) && gone.inBox, `${E} a dialog whose computer the list no longer has closes and says only that`, JSON.stringify(gone));
          state.allowed = state.allowed.concat([{ pub: 'pub-desk', mac: 'mac-2', at: AT_DESK }]);
          await page.evaluate((pid) => fedOwnLoad(pid), ownerP.id);
          await page.waitForSelector(sel, { timeout: 4000 }).catch(() => null);
          // A project switch while the remove is in flight: the answer changes nothing in the project now open. This pins the
          // outcome, which several guards hold (the message's project, the live region's visit, the list's project), not any one of them.
          release = held();
          await openOn('pub-desk');
          await page.click('#mem-go');
          await page.waitForFunction(() => document.getElementById('mem-msg').textContent === 'Removing…', null, { timeout: 4000 }).catch(() => null);
          await open(quietP.id);
          const before3 = answered;
          release();
          await until(() => answered > before3, 8000);
          await page.waitForTimeout(200);   // past the live region's 60 ms fill
          const sw = await page.evaluate(() => ({ open: !document.getElementById('mem-modal').hidden, text: ((document.getElementById('pj-fed-own') || {}).textContent || '') + ((document.getElementById('alist-fed-own') || {}).textContent || ''),
            said: document.getElementById('pj-fed-own-said').textContent }));
          chk(answered > before3 && !sw.open && !/Removed/.test(sw.text + sw.said), `${E} a project switch during the remove: the answer changes nothing in the new project`, JSON.stringify(sw));
          await open(ownerP.id);
          if (view === 'consolidated') await page.evaluate((pid) => { applyLayout('consolidated', true); showTab('projects'); openProject(pid); }, ownerP.id);
          state.allowed = state.allowed.filter((x) => x.pub !== 'pub-desk').concat([{ pub: 'pub-desk', mac: 'mac-2', at: AT_DESK }]);
          await page.evaluate((pid) => fedOwnLoad(pid), ownerP.id);
          await page.waitForSelector(sel, { timeout: 8000 }).catch(() => null);

          // A refusal, then a list without that computer (the board lists nothing when it cannot read the room's records):
          // the dialog closes, the refusal is kept, and nothing says the computer was removed.
          refuseNext = true;
          await openOn('pub-desk');
          await page.click('#mem-go');
          await page.waitForFunction((t) => document.getElementById('mem-msg').textContent === t, REFUSAL, { timeout: 8000 }).catch(() => null);
          await page.waitForTimeout(300);   // the refusal's own reload (which still lists it) lands first
          state.allowed = state.allowed.filter((x) => x.pub !== 'pub-desk');
          await page.evaluate((pid) => fedOwnLoad(pid), ownerP.id);
          await page.waitForFunction(() => document.getElementById('mem-modal').hidden, null, { timeout: 4000 }).catch(() => null);
          const rg = await page.evaluate((box) => ({ open: !document.getElementById('mem-modal').hidden, msg: (document.querySelector(box + ' .fmsg') || {}).textContent || '' }), BOX);
          chk(!rg.open && rg.msg.includes(REFUSAL) && /no longer listed/.test(rg.msg) && !/Removed|does not read/.test(rg.msg), `${E} a refusal then an empty list: the refusal is kept, nothing claims a removal`, JSON.stringify(rg));
          state.allowed = state.allowed.concat([{ pub: 'pub-desk', mac: 'mac-2', at: AT_DESK }]);
          await page.evaluate((pid) => fedOwnLoad(pid), ownerP.id);
          await page.waitForSelector(sel, { timeout: 4000 }).catch(() => null);
          // Failed reads under an open dialog are not an answer, even at the third, which drops the kept list: it stays open.
          await openOn('pub-desk');
          failReads = true;
          for (let k = 0; k < 3; k++) await page.evaluate((pid) => fedOwnLoad(pid), ownerP.id);
          failReads = false;
          const fr = await page.evaluate((box) => ({ open: !document.getElementById('mem-modal').hidden, rows: document.querySelectorAll(box + ' [data-own-act="remove"]').length,
            msg: document.getElementById('mem-msg').textContent }), BOX);
          chk(fr.open && fr.rows === 0, `${E} three failed reads under an open dialog leave it open (the list dropped, not answered)`, JSON.stringify(fr));
          chk(fr.msg === 'Kosmos cannot read the list of computers right now. Remove it still takes out the one named above.',
            `${E} and the dialog says why its computer is no longer shown`, JSON.stringify(fr));
          await page.evaluate((pid) => fedOwnLoad(pid), ownerP.id);
          await page.waitForSelector(sel, { timeout: 4000 }).catch(() => null);
          // A list without the computer while its own remove is in flight does not close the dialog; the answer does.
          release = held();
          await page.click('#mem-go');
          await page.waitForFunction(() => document.getElementById('mem-msg').textContent === 'Removing…', null, { timeout: 4000 }).catch(() => null);
          state.allowed = state.allowed.filter((x) => x.pub !== 'pub-desk');
          await page.evaluate((pid) => fedOwnLoad(pid), ownerP.id);
          const mid = await page.evaluate(() => ({ open: !document.getElementById('mem-modal').hidden, line: document.getElementById('mem-msg').textContent }));
          chk(mid.open && mid.line === 'Removing…', `${E} a list change while the remove is in flight leaves the dialog to the answer`, JSON.stringify(mid));
          release();
          await page.waitForFunction((box) => document.getElementById('mem-modal').hidden && /^Removed\./.test((document.querySelector(box + ' .fmsg') || {}).textContent || ''), BOX, { timeout: 8000 }).catch(() => null);
          chk(/^Removed\./.test(await page.evaluate((box) => (document.querySelector(box + ' .fmsg') || {}).textContent || '', BOX)), `${E} then the answer closes it and says Removed`);
          // The federation gate under an open dialog: a signup reading (one poll) leaves it open and Remove it posts nothing;
          // hidden closes it, the section empties, and focus is left on something a person can see.
          state.allowed = state.allowed.filter((x) => x.pub !== 'pub-desk').concat([{ pub: 'pub-desk', mac: 'mac-2', at: AT_DESK }]);
          await page.evaluate((pid) => fedOwnLoad(pid), ownerP.id);
          await page.waitForSelector(sel, { timeout: 4000 }).catch(() => null);
          await openOn('pub-desk');
          const beforeGate = posted.length;
          await page.evaluate(() => fedGateStamp({ sourceChannel: 'prod', federationLive: true, kosmos_plus: false }));
          await page.click('#mem-go');
          const su = await page.evaluate(() => ({ open: !document.getElementById('mem-modal').hidden, msg: document.getElementById('mem-msg').textContent }));
          chk(su.open && /^Removing is not available just now\./.test(su.msg) && posted.length === beforeGate,
            `${E} a signup reading leaves the dialog open, and Remove it then says so and posts nothing`, JSON.stringify(su));
          await page.evaluate(() => fedGateStamp({ sourceChannel: 'prod', federationLive: false, kosmos_plus: true }));
          const hid = await page.evaluate((box) => {
            const ae = document.activeElement;
            return { open: !document.getElementById('mem-modal').hidden, rows: document.querySelectorAll(box + ' [data-own-act="remove"]').length,
              seen: !ae || ae === document.body || ae.getClientRects().length > 0, inModal: !!(ae && ae.closest && ae.closest('#mem-modal')) };
          }, BOX);
          chk(!hid.open && hid.rows === 0 && hid.seen && !hid.inModal, `${E} the gate going hidden closes the dialog and leaves focus somewhere visible`, JSON.stringify(hid));
          await page.evaluate(() => fedGateStamp({ sourceChannel: 'prod', federationLive: true, kosmos_plus: true }));
          await page.evaluate((pid) => fedOwnLoad(pid), ownerP.id);
          await page.waitForSelector(sel, { timeout: 4000 }).catch(() => null);
          // The project closed under the open dialog by a path other than entering another (PJ_CURRENT cleared on a repaint):
          // Remove it then closes the dialog and posts nothing, rather than staying open and doing nothing.
          await openOn('pub-desk');
          const beforeGone = posted.length;
          await page.evaluate(() => { window.__pjKeep = PJ_CURRENT; PJ_CURRENT = null; });
          await page.click('#mem-go');
          const shut = await page.evaluate(() => ({ open: !document.getElementById('mem-modal').hidden }));
          await page.evaluate(() => { PJ_CURRENT = window.__pjKeep; });
          chk(!shut.open && posted.length === beforeGone, `${E} Remove it after the project closed under the dialog closes it and posts nothing`, JSON.stringify(shut));
          await page.evaluate((pid) => fedOwnLoad(pid), ownerP.id);
          await page.waitForSelector(sel, { timeout: 4000 }).catch(() => null);
          // No answer in time: the dialog closes, the section says the timed-out sentence, and the computer stays listed.
          await openOn('pub-desk');
          await page.evaluate(() => { FED_ACT_LIMIT_MS = 200; });
          const answeredT = answered;
          release = held();
          await page.click('#mem-go');
          await page.waitForFunction(() => document.getElementById('mem-modal').hidden, null, { timeout: 4000 }).catch(() => null);
          const to = await page.evaluate((box) => ({ open: !document.getElementById('mem-modal').hidden, msg: (document.querySelector(box + ' .fmsg') || {}).textContent || '',
            listed: !!document.querySelector(box + ' [data-own-act="remove"][data-own-pub="pub-desk"]') }), BOX);
          chk(!to.open && to.msg === 'Kosmos did not hear back in time. Check the list to see whether it went through.' && to.listed,
            `${E} a remove with no answer in time closes the dialog, says so in the section, and keeps the row`, JSON.stringify(to));
          await page.evaluate(() => { FED_ACT_LIMIT_MS = 60000; });
          release();
          await until(() => answered > answeredT, 4000);
          state.allowed = state.allowed.filter((x) => x.pub !== 'pub-desk').concat([{ pub: 'pub-desk', mac: 'mac-2', at: AT_DESK }]);
          await page.evaluate((pid) => fedOwnLoad(pid), ownerP.id);
          await page.waitForSelector(sel, { timeout: 4000 }).catch(() => null);
          // Rows let in the same day carry the time, and the same minute their place too: no two labels alike.
          const T2 = AT_DESK + 30 * 60000;   // half an hour after noon UTC: the same day as AT_DESK in every time zone
          state.allowed = [{ pub: 'pub-laptop', mac: 'mac-1', at: AT_LAPTOP }, { pub: 'pub-desk', mac: 'mac-2', at: AT_DESK },
            { pub: 'pub-a', mac: 'mac-a', at: T2 }, { pub: 'pub-b', mac: 'mac-b', at: T2 + 1000 }];
          await page.evaluate((pid) => fedOwnLoad(pid), ownerP.id);
          await page.waitForSelector(BOX + ' [data-own-pub="pub-b"]', { timeout: 4000 }).catch(() => null);
          const labels = await page.evaluate((box) => [...document.querySelectorAll(box + ' [data-own-act="remove"]')].map((b) => b.getAttribute('aria-label')), BOX);
          const hhmm = (at) => new Date(at).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' });
          chk(labels.length === 4 && new Set(labels).size === 4, `${E} four computers, four different Remove names`, JSON.stringify(labels));
          chk(labels.length === 4 && labels[1].includes(hhmm(AT_DESK)) && labels[2].includes('(3 of 4)') && labels[3].includes('(4 of 4)') && !labels[0].includes(' of '),
            `${E} the same day adds the time, the same minute adds the place`, JSON.stringify(labels));
          // The dialog names the computer the same way as its row, and says what removing does (ownRejoin included).
          await page.click(BOX + ' [data-own-act="remove"][data-own-pub="pub-a"]');
          await page.waitForFunction(() => !document.getElementById('mem-modal').hidden, null, { timeout: 4000 }).catch(() => null);
          const small = await page.evaluate(() => document.getElementById('mem-small').textContent);
          chk(/^The computer you allowed on .+ \(3 of 4\),? stops getting new messages from this room\. What it already has stays on it\. It may ask to come back by itself, and it gets in again only if you compare codes and press Allow\.$/.test(small),
            `${E} the dialog names the computer as its row does and says what Remove does`, small);
          await page.click('#mem-keep');
          await page.waitForFunction(() => document.getElementById('mem-modal').hidden, null, { timeout: 4000 }).catch(() => null);
          // A row the board gave no time for is named by its place; one from another year carries the year.
          const LAST_YEAR = THIS_YEAR - 1;
          state.allowed = [{ pub: 'pub-laptop', mac: 'mac-1', at: AT_LAPTOP }, { pub: 'pub-old', mac: 'mac-old', at: Date.UTC(LAST_YEAR, 5, 1, 12) },
            { pub: 'pub-z', mac: 'mac-z', at: 0 }];
          await page.evaluate((pid) => fedOwnLoad(pid), ownerP.id);
          await page.waitForSelector(BOX + ' [data-own-pub="pub-z"]', { timeout: 4000 }).catch(() => null);
          const odd = await page.evaluate((box) => [...document.querySelectorAll(box + ' [data-own-act="remove"]')].map((b) => b.getAttribute('aria-label')), BOX);
          chk(odd.length === 3 && odd[1].includes(String(LAST_YEAR)) && !odd[0].includes(String(LAST_YEAR)) && /earlier \(3 of 3\)/.test(odd[2]),
            `${E} another year adds the year; no time from the board names the place`, JSON.stringify(odd));
          await page.click(BOX + ' [data-own-act="remove"][data-own-pub="pub-z"]');
          await page.waitForFunction(() => !document.getElementById('mem-modal').hidden, null, { timeout: 4000 }).catch(() => null);
          const smallZ = await page.evaluate(() => document.getElementById('mem-small').textContent);
          chk(/^The computer you allowed earlier \(3 of 3\) stops getting new messages from this room\./.test(smallZ), `${E} the dialog names a row with no time by its place`, smallZ);
          await page.click('#mem-keep');
          await page.waitForFunction(() => document.getElementById('mem-modal').hidden, null, { timeout: 4000 }).catch(() => null);
          state.allowed = [{ pub: 'pub-laptop', mac: 'mac-1', at: AT_LAPTOP }, { pub: 'pub-desk', mac: 'mac-2', at: AT_DESK }];
          await page.evaluate((pid) => fedOwnLoad(pid), ownerP.id);
          await page.waitForSelector(sel, { timeout: 4000 }).catch(() => null);

          // Entering another project closes an open dialog and posts nothing.
          const before = posted.length;
          await page.click(sel);
          await page.waitForFunction(() => !document.getElementById('mem-modal').hidden, null, { timeout: 4000 }).catch(() => null);
          await open(quietP.id);
          await page.waitForTimeout(300);
          const switched = await page.evaluate(() => ({ open: !document.getElementById('mem-modal').hidden, rows: document.querySelectorAll('[data-own-act="remove"]').length }));
          chk(!switched.open && posted.length === before, `${E} entering another project closes the dialog and posts nothing`, JSON.stringify(switched) + ' ' + (posted.length - before));
          const quietReads = allowedFor[quietP.id] || 0;
          await page.evaluate((pid) => fedOwnLoad(pid), quietP.id);
          const quietAnswered = await until(() => (allowedFor[quietP.id] || 0) > quietReads, 8000);
          chk(quietAnswered && await page.evaluate(() => document.querySelectorAll('[data-own-act="remove"]').length) === 0, `${E} a project with no allowed computers shows no rows (its own list answered)`);

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
