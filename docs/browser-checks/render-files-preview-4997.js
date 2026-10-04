// Browser-check-surface: d-files-list d-filesall-list pj-docs docs-list pv-preview pv-do pv-msg
'use strict';
/**
 * The full-page preview from the three Files lists (#4997, the half of Josh's #4930 its PR does not build), on a REAL
 * board: a sandboxed server serves the page and the Files routes, an agent ("ava") has a Files folder and a project
 * has a folder, both holding a real PNG, a PDF, a text file and a link that points OUTSIDE the folder. Rows are drawn
 * by each list's own painter (paintAgentFiles and paintAgentFilesAll reading the real board for the agent page's Files
 * and all-files lists, pjLoadDocs reading it for the project Files panel, pjDocsPaintPage for the Files screen) and
 * clicked through the page's handlers:
 *   F1  an image row opens the preview and the picture LOADS from the board's Files route (fails before the route
 *       exists: the picture errors and the preview falls back to the file's card);
 *   F2  a PDF row shows its first page (drawn by the stubbed renderer) with "The first page";
 *   F3  Open in Finder posts to the Files reveal route with the listed name, never /api/attachment/, and the board
 *       selects THAT file (the reveal runner is stubbed in this process: nothing opens on the machine);
 *   F4  with the list redrawn under it, Escape closes it and focus goes back to the new row for that file;
 *   F5  a text row does not open the preview (it keeps the list's open-on-the-computer, stubbed);
 *   F6  a row naming the link that points outside the folder: the board answers 404 and the preview shows the card;
 *   and no page errors. Chromium and WebKit.
 *
 *   HEADED=0 NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-files-preview-4997.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host computer's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-filespv-bc-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-filespv-bc-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-filespv-bc-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-filespv-bc-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-filespv-bc-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
const OUTSIDE = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-filespv-bc-outside-'));
const SANDBOXES = [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS,
  process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT, OUTSIDE];

const playwright = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const projects = require('../../engine/projects');
const create = require('../../engine/create');
const dmfiles = require('../../engine/dmfiles');
const attachments = require('../../engine/attachments');

/* A real 2 x 2 PNG (red), so the browser decodes it: naturalWidth > 0 only when the route served the picture. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP4z8DwnwEIGBgYGBgAAB/YA/0aUQAAAAAASUVORK5CYII=', 'base64');
fs.writeFileSync(path.join(OUTSIDE, 'secret.png'), PNG);

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}
function fill(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'photo.png'), PNG);
  fs.writeFileSync(path.join(dir, 'report.pdf'), Buffer.from('%PDF-1.4 a check fixture'));
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello');
  fs.symlinkSync(path.join(OUTSIDE, 'secret.png'), path.join(dir, 'away.png'));
}

(async () => {
  fleet.install([fleet.agent('ava', { state: 'idle', displayName: 'Ava', role: 'a writer' })]);
  fs.mkdirSync(create.workerDir('ava'), { recursive: true });
  const filesDir = dmfiles.filesDir('ava');
  fill(filesDir);
  const pfolder = fs.mkdtempSync(path.join(process.env.AGENT_WORKFORCE_PROJECTS, 'pv-'));
  fill(pfolder);
  const project = projects.create({ name: 'Preview Room', folder: pfolder });
  const reveals = [];
  const opens = [];
  projects.setRevealRunner((bin, args) => { (args[0] === '-R' ? reveals : opens).push(args.slice(-1)[0]); return { ok: true }; });
  projects.setRevealPlatform('darwin');
  attachments.setRenderer((file, dir) => { fs.writeFileSync(path.join(dir, 'preview.png'), PNG); });
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;

  try {
    for (const engineName of ['chromium', 'webkit']) {
      const E = `[${engineName}]`;
      const browser = await playwright[engineName].launch({ headless: process.env.HEADED === '0' });
      try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(e.message));
        const asked = [];
        page.on('request', (r) => { const u = new globalThis.URL(r.url()); if (u.pathname.startsWith('/api/')) asked.push(r.method() + ' ' + u.pathname + u.search); });
        const answered = {};   // path+search -> status, for the Files routes
        page.on('response', (r) => { const u = new globalThis.URL(r.url()); if (/\/(files\/preview|file-preview)$/.test(u.pathname)) answered[u.pathname + u.search] = r.status(); });
        await page.goto(URL + '/', { waitUntil: 'load' });
        await page.waitForFunction(() => typeof filesPvOpen === 'function' && typeof agentFileRow === 'function');
        if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }

        /* Draw real rows into a real list and click one through the page's own handler. */
        /* Rows come from each list's OWN painter (reviews 6 to 8): the agent lists from paintAgentFiles and
           paintAgentFilesAll and the project panel from pjLoadDocs, all reading the real board; the Files screen from
           pjDocsPaintPage. The link out (F6) is not listed by the board, so on those three it is drawn with
           agentFileRow, the row shape every list shares; the Files screen paints it with its own painter. */
        const open = async (listId, scope, name) => page.evaluate(async ({ listId, scope, name, pid }) => {
          if (scope === 'agent') CURRENT = { sessionName: 'ava' }; else PJ_CURRENT = pid;
          const list = document.getElementById(listId);
          /* Review 5: every list sits in a view that starts hidden (display: none), and a hidden row cannot take focus,
             so the views on the way up are shown, as opening the agent page, the project or the Files screen does. */
          for (let e = list; e && e !== document.body; e = e.parentElement) e.hidden = false;
          list.textContent = '';
          // Review 8: the agent lists too, through their real painters reading the board (paintAgentFiles keeps a stamp).
          if (listId === 'd-files-list') { AGENT_FILES_STAMP = null; await paintAgentFiles('ava'); }
          else if (listId === 'd-filesall-list') await paintAgentFilesAll('ava');
          else if (listId === 'docs-list') { PJ_DOCS_FILES = [{ name, size: 70, modified: new Date().toISOString() }]; PJ_DOCS_TOTAL = 1; PJ_DOCS_PAGE = 0; pjDocsPaintPage(); }
          // Review 7: pjLoadDocs skips the redraw when the folder's stamp has not moved, so every open forgets it.
          else if (listId === 'pj-docs') { PJ_DOCS_STAMP = null; PJ_DOCS_OK = false; await pjLoadDocs(pid); }
          let row = [...list.querySelectorAll('.pj-doc')].find((r) => r.dataset.doc === name);
          const own = !!row;
          if (!row) { row = agentFileRow({ name, size: 70, modified: new Date().toISOString() }); list.append(row); }
          const visible = row.offsetParent !== null;   // review 8: a row in a still-hidden view could not take focus (F4)
          row.click();
          return { own, visible };
        }, { listId, scope, name, pid: project.id });
        const shown = () => page.evaluate(() => {
          const back = document.getElementById('pv-preview');
          const img = back && back.querySelector('img.pv-media');
          return { up: !!back, img: !!img, loaded: !!(img && img.complete && img.naturalWidth > 0), src: img ? img.getAttribute('src') : null,
            card: !!(back && back.querySelector('.pv-file')), note: back && back.querySelector('.pv-note') ? back.querySelector('.pv-note').textContent : null,
            name: back ? (back.querySelector('#pv-name') || {}).textContent : null, act: back ? (back.querySelector('#pv-do') || {}).textContent : null };
        });
        const settle = async (fn, ms = 4000) => { const t = Date.now(); let v = await fn(); while (!v.done && Date.now() - t < ms) { await page.waitForTimeout(100); v = await fn(); } return v; };

        for (const [listId, scope] of [['d-files-list', 'agent'], ['d-filesall-list', 'agent'], ['pj-docs', 'project'], ['docs-list', 'project']]) {
          const L = `${E} ${listId}:`;
          // Review 7: a listed file's row must come from the list's own painter (agentFileRow IS the agent lists' painter).
          const ownRow = async (name) => { const r = await open(listId, scope, name); chk(r.own && r.visible, `${L} the ${name} row was drawn by this list's own painter and is visible`, JSON.stringify(r)); };
          await ownRow('photo.png');
          const s1 = await settle(async () => { const s = await shown(); return { ...s, done: s.loaded || s.card }; });
          chk(s1.up && s1.loaded && /\/(files\/preview|file-preview)\?name=photo\.png$/.test(s1.src || ''), `${L} F1 an image row opens the preview and the picture loads from the Files route`, JSON.stringify(s1));
          chk(s1.act === 'Open in Finder' && s1.name === 'photo.png', `${L} F1 the name and Open in Finder are there`, JSON.stringify(s1));
          reveals.length = 0;
          const before = asked.length;
          await page.click('#pv-do');
          for (let i = 0; i < 30 && reveals.length === 0; i++) await page.waitForTimeout(100);
          const posted = asked.slice(before);
          const want = scope === 'agent' ? 'POST /api/agent/ava/files/reveal-file' : 'POST /api/project/' + encodeURIComponent(project.id) + '/reveal-file';
          chk(posted.includes(want) && !posted.some((p) => /\/api\/attachment\//.test(p)), `${L} F3 Open in Finder asks the Files reveal route, never /api/attachment/`, JSON.stringify(posted));
          const folder = scope === 'agent' ? filesDir : pfolder;
          chk(reveals.length === 1 && reveals[0] === fs.realpathSync(path.join(folder, 'photo.png')), `${L} F3 the board selected THAT file`, JSON.stringify(reveals));
          /* F4 (review 2): the list REDRAWS under the preview (an agent saved a file), so the row it was opened from is
             gone; focus must come back to the new row for the same file (filesPvRow), not drop to the page. */
          await page.evaluate(async (id) => {
            const list = document.getElementById(id);
            list.textContent = '';
            const mk = (n, size) => { const r = agentFileRow({ name: n, size, modified: new Date().toISOString() }); return r; };
            if (id === 'docs-list') { PJ_DOCS_FILES = [{ name: 'other.txt', size: 5 }, { name: 'photo.png', size: 70 }]; PJ_DOCS_TOTAL = 2; PJ_DOCS_PAGE = 0; pjDocsPaintPage(); }
            else if (id === 'pj-docs') { list.textContent = ''; PJ_DOCS_STAMP = null; PJ_DOCS_OK = false; await pjLoadDocs(PJ_CURRENT); }
            else if (id === 'd-files-list') { AGENT_FILES_STAMP = null; await paintAgentFiles('ava'); }
            else if (id === 'd-filesall-list') await paintAgentFilesAll('ava');
            else list.append(mk('other.txt', 5), mk('photo.png', 70));
          }, listId);
          await page.keyboard.press('Escape');
          const back = await page.evaluate((id) => ({ gone: !document.getElementById('pv-preview'),
            focus: !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('#' + id) && document.activeElement.dataset.doc === 'photo.png') }), listId);
          chk(back.gone && back.focus, `${L} F4 Escape closes it and focus is back on the row, after the list redrew`, JSON.stringify(back));

          await ownRow('report.pdf');
          const s2 = await settle(async () => { const s = await shown(); return { ...s, done: s.loaded || s.card }; });
          chk(s2.up && s2.loaded && s2.note === 'The first page', `${L} F2 a PDF row shows its first page`, JSON.stringify(s2));
          await page.keyboard.press('Escape');

          opens.length = 0;
          await ownRow('notes.txt');
          for (let i = 0; i < 30 && opens.length === 0; i++) await page.waitForTimeout(100);
          const s3 = await shown();
          chk(!s3.up && opens.length === 1, `${L} F5 a text row keeps opening on the computer, no preview`, JSON.stringify({ s3, opens }));

          // Review 9: THIS list's own route, looked up exactly, after forgetting any earlier list's answer.
          const awayKey = (scope === 'agent' ? '/api/agent/ava/files/preview' : '/api/project/' + encodeURIComponent(project.id) + '/file-preview') + '?name=away.png';
          delete answered[awayKey];
          await open(listId, scope, 'away.png');
          for (let i = 0; i < 40 && answered[awayKey] === undefined; i++) await page.waitForTimeout(100);
          const s4 = await settle(async () => { const s = await shown(); return { ...s, done: s.card || s.loaded }; });
          const refused = answered[awayKey];
          chk(s4.up && !s4.loaded && s4.card && refused === 404, `${L} F6 a link that points outside the folder is REFUSED by the board (404) and shows only the file's card`, JSON.stringify({ s4, refused }));
          await page.keyboard.press('Escape');
        }
        chk(errs.length === 0, `${E} no page errors`, errs.join(' | '));
        await ctx.close();
      } finally { await browser.close(); }
    }
  } finally {
    try { server.closeAllConnections(); server.close(); } catch { /* going away */ }
    projects.setRevealRunner(null);
    projects.setRevealPlatform(null);
    attachments.setRenderer(null);
    for (const d of SANDBOXES) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  console.log('\n' + (fail.length ? fail.length + ' FAILED' : 'ALL PASSED'));
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('FAIL  render-files-preview-4997 crashed: ' + ((e && e.stack) || e)); process.exit(1); });
