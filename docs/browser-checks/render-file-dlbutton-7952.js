// Browser-check-surface: d-filesall-list d-filesall-msg
'use strict';

/**
 * kosmos#7952 (Josh, 11-04): on a board on another computer, an agent's Files screen offered only Download folder.
 * Each file now has its own download button beside its row. The real web/index.html is served with every /api call
 * answered by a stub (no board runs); the Files screen is painted by the page's own paintAgentFilesAll from a stubbed
 * browse answer, and the page's own delegated handler answers the clicks.
 *   R1  over Kosmos+ (the page reached as kosmos-remote.test) every FILE row has a download button beside it, on
 *       screen: inside the list, at the row's right, level with it, and at least 24 px square; a folder row has none;
 *   R2  a click on the button for a picture (which the row itself would preview) makes the BROWSER download that file
 *       from its download route, and opens no preview;
 *   R3  the button's spoken name says what it downloads;
 *   R4  from the keyboard: the button takes focus and Enter downloads its file;
 *   P1  at phone width (390 px) the button is as big as the row's tap target (44 px) and stays on screen;
 *   L1  CONTROL at the computer (127.0.0.1): no file row has a download button. This is the arm that keeps R1 from
 *       passing on a page that draws the button everywhere.
 * Against web/index.html from before #7952, R1 to R3 FAIL (no button is drawn):
 *   DLBTN_HTML=/path/to/old/index.html node docs/browser-checks/render-file-dlbutton-7952.js
 * Needs no URL. ENGINES=chromium,webkit adds WebKit, the Mac app's engine.
 *
 *   ENGINES=chromium,webkit HEADED=0 NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-file-dlbutton-7952.js
 */
const fs = require('node:fs');
const path = require('node:path');
const pw = require('playwright');

const ALL_ENGINES = ['chromium', 'webkit'];
const ASKED = (process.env.ENGINES || 'chromium').split(',').map((s) => s.trim()).filter(Boolean);
const ENGINES = ASKED.filter((e) => ALL_ENGINES.includes(e));
const say = (ok, label, extra) => console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
if (!ENGINES.length || ENGINES.length !== ASKED.length) {
  say(false, 'render-file-dlbutton-7952: ENGINES names an unknown engine (' + (process.env.ENGINES || '') + '); known: ' + ALL_ENGINES.join(', '));
  process.exit(1);
}

const HTML = fs.readFileSync(process.env.DLBTN_HTML || path.join(__dirname, '..', '..', 'web', 'index.html'), 'utf8');
const AGENT = 'ana';
const BROWSE = { ok: true, dir: '', stamp: 's7952', dirs: [{ name: 'reports', modified: '2026-11-01T10:00:00Z' }],
  files: [{ name: 'chart.png', size: 2048, modified: '2026-11-03T10:00:00Z' }, { name: 'notes.docx', size: 4096, modified: '2026-11-02T10:00:00Z' }] };

async function openPage(engine, origin, viewport = { width: 1280, height: 800 }) {
  const browser = await pw[engine].launch({ headless: process.env.HEADED === '0' });
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const pg = await ctx.newPage();
  const asked = [];
  const errors = [];
  pg.on('pageerror', (e) => errors.push(String(e && e.message)));
  /* As render-remote-file-download-5165 measured: an <a download> request does not pass through page.route, and
     headless WebKit fires no download event, so the browser's download is recorded from the download event
     (DOWNLOAD) and the page's own act from every click() on an anchor carrying `download` (ANCHOR). */
  pg.on('download', (d) => { try { const u = new URL(d.url()); asked.push('DOWNLOAD ' + u.pathname + u.search); } catch { asked.push('DOWNLOAD ?'); } d.cancel().catch(() => {}); });
  await pg.exposeFunction('__dlbtn7952Anchor', (href) => { try { const u = new URL(href); asked.push('ANCHOR ' + u.pathname + u.search); } catch { asked.push('ANCHOR ?'); } });
  await pg.addInitScript(() => {
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.hasAttribute('download')) window.__dlbtn7952Anchor(this.href);
      return click.apply(this, arguments);
    };
  });
  await pg.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname === '/' || u.pathname === '/index.html') return route.fulfill({ status: 200, contentType: 'text/html', body: HTML });
    if (u.pathname === '/api/agent/' + AGENT + '/files/browse') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BROWSE) });
    if (/\/files\/(download|preview)$/.test(u.pathname)) {
      asked.push(req.method() + ' ' + u.pathname + u.search);
      if (u.searchParams.get('check') === '1') return route.fulfill({ status: 204, body: '' });
      return route.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="f.bin"' }, body: 'PK' });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await pg.goto(origin + '/', { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof paintAgentFilesAll === 'function' && typeof kplusRemote === 'function');
  /* The page's own state, as if this agent's Files screen were open; its hidden ancestors are shown so the rows are
     laid out and measurable, then the page's own painter draws them. */
  await pg.evaluate(async (AGENT) => {
    CURRENT = { sessionName: AGENT };
    AGENT_FILES_DIR = '';
    AGENT_FILES_ALL_STAMP = null;
    const list = document.getElementById('d-filesall-list');
    for (let n = list; n && n !== document.documentElement; n = n.parentElement) {
      if (n.hidden || getComputedStyle(n).display === 'none') { n.hidden = false; n.style.setProperty('display', 'block', 'important'); }
    }
    await paintAgentFilesAll(AGENT);
  }, AGENT);
  return { browser, pg, asked, errors };
}

/* Each file row and its button, measured where the person sees them. */
async function measure(pg) {
  return pg.evaluate(() => {
    const list = document.getElementById('d-filesall-list');
    const lb = list.getBoundingClientRect();
    const rows = [...list.querySelectorAll('.pj-doc')].map((row) => {
      const line = row.parentElement && row.parentElement.classList.contains('pj-doc-line') ? row.parentElement : null;
      const dl = line ? line.querySelector('.pj-doc-dl') : null;
      const rb = row.getBoundingClientRect();
      const db = dl ? dl.getBoundingClientRect() : null;
      return {
        doc: row.dataset.doc || null, dir: row.dataset.dir || null,
        dl: dl ? { name: dl.dataset.dl, label: dl.getAttribute('aria-label'), w: db.width, h: db.height,
          right: db.left >= rb.right - 1, inside: db.left >= lb.left - 1 && db.right <= lb.right + 1,
          level: Math.abs((db.top + db.bottom) / 2 - (rb.top + rb.bottom) / 2) <= 6,
          shown: getComputedStyle(dl).display !== 'none' && getComputedStyle(dl).visibility !== 'hidden' } : null,
      };
    });
    return rows;
  });
}

async function runRemote(engine) {
  const { browser, pg, asked, errors } = await openPage(engine, 'http://kosmos-remote.test');
  try {
    say(await pg.evaluate(() => kplusRemote()) === true, engine + ' R0: the page reached as kosmos-remote.test counts as Kosmos+');
    const rows = await measure(pg);
    const files = rows.filter((r) => r.doc);
    const dirs = rows.filter((r) => r.dir);
    say(files.length === 2 && dirs.length === 1, engine + ' R1 premise: the browse answer is painted (two files, one folder)', JSON.stringify(rows));
    say(files.length > 0 && files.every((r) => r.dl && r.dl.name === r.doc && r.dl.shown), engine + ' R1: every file row has its own download button, for that file', JSON.stringify(files));
    say(files.length > 0 && files.every((r) => r.dl && r.dl.right && r.dl.inside && r.dl.level && r.dl.w >= 24 && r.dl.h >= 24),
      engine + ' R1: each button sits at its row\'s right, inside the list, level with the row, at least 24 px square', JSON.stringify(files.map((r) => r.dl)));
    say(dirs.every((r) => !r.dl), engine + ' R1: a folder row has no download button');
    say(files.length > 0 && files.every((r) => r.dl && r.dl.label === 'Download ' + r.doc), engine + ' R3: the button says what it downloads', JSON.stringify(files.map((r) => r.dl && r.dl.label)));
    asked.length = 0;
    await pg.click('.pj-doc-dl[data-dl="chart.png"]', { timeout: 3000 });
    const want = '/api/agent/' + AGENT + '/files/download?name=chart.png';
    const until = Date.now() + 4000;
    const mark = (engine === 'webkit' ? 'ANCHOR ' : 'DOWNLOAD ') + want;   // Chromium's real download; headless WebKit's page act
    while (Date.now() < until && !asked.includes(mark)) await pg.waitForTimeout(50);
    const got = asked.includes(mark);
    say(got, engine + ' R2: the button for a picture downloads it from its download route', JSON.stringify(asked));
    say(!asked.some((a) => /\/files\/preview/.test(a)), engine + ' R2: and opens no preview', JSON.stringify(asked));
    asked.length = 0;
    await pg.focus('.pj-doc-dl[data-dl="notes.docx"]');
    const focused = await pg.evaluate(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.dl);
    await pg.keyboard.press('Enter');
    const kmark = (engine === 'webkit' ? 'ANCHOR ' : 'DOWNLOAD ') + '/api/agent/' + AGENT + '/files/download?name=notes.docx';
    const kuntil = Date.now() + 4000;
    while (Date.now() < kuntil && !asked.includes(kmark)) await pg.waitForTimeout(50);
    say(focused === 'notes.docx' && asked.includes(kmark), engine + ' R4: the button takes focus and Enter downloads its file', JSON.stringify({ focused, asked }));
    say(errors.length === 0, engine + ' R*: the page threw nothing', JSON.stringify(errors));
  } finally {
    await browser.close();
  }
}

async function runPhone(engine) {
  const { browser, pg, errors } = await openPage(engine, 'http://kosmos-remote.test', { width: 390, height: 844 });
  try {
    const files = (await measure(pg)).filter((r) => r.doc);
    const vw = await pg.evaluate(() => document.documentElement.clientWidth);
    const right = await pg.evaluate(() => Math.max(...[...document.querySelectorAll('.pj-doc-dl')].map((b) => b.getBoundingClientRect().right)));
    say(files.length === 2 && files.every((r) => r.dl && r.dl.w >= 44 && r.dl.h >= 44 && r.dl.right && r.dl.level),
      engine + ' P1: at phone width each button is a 44 px tap target at its row\'s right', JSON.stringify(files.map((r) => r.dl)));
    say(Number.isFinite(right) && right <= vw + 1, engine + ' P1: and stays on screen', 'right ' + right + ', width ' + vw);
    say(errors.length === 0, engine + ' P*: the page threw nothing', JSON.stringify(errors));
  } finally {
    await browser.close();
  }
}

async function runLocal(engine) {
  const { browser, pg, errors } = await openPage(engine, 'http://127.0.0.1:16180');
  try {
    say(await pg.evaluate(() => kplusRemote()) === false, engine + ' L0: the page at 127.0.0.1 is the computer itself');
    const rows = await measure(pg);
    const files = rows.filter((r) => r.doc);
    say(files.length === 2, engine + ' L1 premise: the browse answer is painted at the computer too', JSON.stringify(rows));
    say(files.length > 0 && files.every((r) => !r.dl), engine + ' L1: CONTROL at the computer no file row has a download button', JSON.stringify(files));
    say(errors.length === 0, engine + ' L*: the page threw nothing', JSON.stringify(errors));
  } finally {
    await browser.close();
  }
}

(async () => {
  let failed = false;
  const real = console.log;
  console.log = (...a) => { if (String(a[0]).startsWith('FAIL')) failed = true; real(...a); };
  for (const engine of ENGINES) {
    try { await runRemote(engine); } catch (e) { say(false, engine + ' remote arm threw', String(e && e.message)); }
    try { await runPhone(engine); } catch (e) { say(false, engine + ' phone arm threw', String(e && e.message)); }
    try { await runLocal(engine); } catch (e) { say(false, engine + ' local arm threw', String(e && e.message)); }
  }
  console.log = real;
  process.exit(failed ? 1 : 0);
})();
