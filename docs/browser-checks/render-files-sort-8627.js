// Browser-check-surface: d-files-sort docs-sort docs-sortrow d-filesall-list docs-list d-files-list d-files-all pj-docs-all
'use strict';
/**
 * kosmos#8627 (Josh, 2026-11-17 08:53, on an agent's Files page): "I need some way to sort these files on this screen
 * and this probably exists on the project screen as well. Right now I'm trying to look for the most recent one but I
 * can't find it because I can't sort by the date."
 *
 * On a REAL board (server.js in this process, sandboxed data, an agent and a project with real files on disk), on
 * chromium and webkit:
 *   - the agent's Files screen (View All) and the project's Files screen each have a sort control with exactly four
 *     choices, Newest first, Oldest first, A to Z, Z to A, and Newest first is chosen on a fresh browser;
 *   - by default a file saved a minute ago is the top file on both screens, and on the agent card's short list;
 *   - each choice orders the rows as it says (folders stay above files on the agent screen, each group in the order);
 *   - CONTROL: A to Z is exactly the order the server lists (the order both screens showed before this card), read from
 *     the same route in the same page, so "A to Z" cannot pass by matching a list nothing reordered;
 *   - the choice is remembered per screen across a reload, and the two screens do not share it;
 *   - the project sort row hides on the conversation segment and on an empty project opened after a full one;
 *   - a change of order on the agent screen re-sorts the rows on screen and reads nothing (the read fails meanwhile),
 *     and leaves the status line as it was;
 *   - a browser that refuses storage (a throwing localStorage) still shows Newest first and still sorts when asked;
 *   - at 412px wide the control is at least 44px tall and the page does not scroll sideways.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-files-sort-8627.js [shots-dir]
 */
require('./lib-sandbox-home.js'); // never read the host computer's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-filesort-bc-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-filesort-bc-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-filesort-bc-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-filesort-bc-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-filesort-bc-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
const SANDBOXES = [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS,
  process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT];

const playwright = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const projects = require('../../engine/projects');
const create = require('../../engine/create');
const dmfiles = require('../../engine/dmfiles');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

/* Names chosen so the four orders all differ: case (Bravo), numbers (file2 before file10), and dates that are not the
   name order. JUST is saved a minute before the check runs, the case Josh could not find. */
const DAY = (d) => new Date(Date.UTC(2026, 0, d));
const FILES = [['alpha.md', DAY(5)], ['Bravo.md', DAY(1)], ['charlie.md', DAY(3)], ['file10.txt', DAY(2)], ['file2.txt', DAY(4)]];
const JUST = 'just-saved.txt';
const DIRS = [['archive', DAY(2)], ['Drafts', DAY(6)]];   // date order is not name order, so the folder asserts can tell them apart
function fill(dir, withDirs) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [n, t] of FILES) { fs.writeFileSync(path.join(dir, n), n); fs.utimesSync(path.join(dir, n), t, t); }
  const now = new Date(Date.now() - 60 * 1000);
  fs.writeFileSync(path.join(dir, JUST), 'new');
  fs.utimesSync(path.join(dir, JUST), now, now);
  if (withDirs) for (const [n, t] of DIRS) { fs.mkdirSync(path.join(dir, n)); fs.utimesSync(path.join(dir, n), t, t); }
}
const ALL = [...FILES.map((f) => f[0]), JUST];
const AZ = ['alpha.md', 'Bravo.md', 'charlie.md', 'file2.txt', 'file10.txt', JUST];
const NEWEST = [JUST, 'alpha.md', 'file2.txt', 'charlie.md', 'file10.txt', 'Bravo.md'];
const EXPECT = { newest: NEWEST, oldest: NEWEST.slice().reverse(), az: AZ, za: AZ.slice().reverse() };
const DIR_EXPECT = { newest: ['Drafts', 'archive'], oldest: ['archive', 'Drafts'], az: ['archive', 'Drafts'], za: ['Drafts', 'archive'] };
// The project folder also holds BRIEF.md (dated oldest, above): A to Z puts it after Bravo (bra before bri).
const P_AZ = ['alpha.md', 'Bravo.md', 'BRIEF.md', 'charlie.md', 'file2.txt', 'file10.txt', JUST];
const P_NEWEST = [...NEWEST, 'BRIEF.md'];
const P_EXPECT = { newest: P_NEWEST, oldest: P_NEWEST.slice().reverse(), az: P_AZ, za: P_AZ.slice().reverse() };
const OPTIONS = [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['az', 'A to Z'], ['za', 'Z to A']];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  fleet.install([fleet.agent('ava', { state: 'idle', displayName: 'Ava', role: 'a writer' })]);
  fs.mkdirSync(create.workerDir('ava'), { recursive: true });
  fill(dmfiles.filesDir('ava'), true);
  const pfolder = fs.mkdtempSync(path.join(process.env.AGENT_WORKFORCE_PROJECTS, 'sort-'));
  fill(pfolder, false);
  const project = projects.create({ name: 'Sort Room', folder: pfolder });
  // A new project writes its BRIEF.md now, which would be the newest file; it is dated with the oldest instead, so the
  // file saved a minute ago is the one that should top the list, and the four orders stay the agent screen's plus it.
  const brief = path.join(pfolder, 'BRIEF.md');
  if (fs.existsSync(brief)) fs.utimesSync(brief, new Date(Date.UTC(2025, 11, 1)), new Date(Date.UTC(2025, 11, 1)));
  // A second project whose folder holds nothing (its new BRIEF.md taken away), for the hidden-row arms.
  const efolder = fs.mkdtempSync(path.join(process.env.AGENT_WORKFORCE_PROJECTS, 'empty-'));
  const emptyProject = projects.create({ name: 'Empty Room', folder: efolder });
  fs.rmSync(path.join(efolder, 'BRIEF.md'), { force: true });
  projects.setRevealPlatform('darwin');
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const SHOTS = process.argv[2] || null;

  const agentRows = (page) => page.evaluate(() => ({
    dirs: [...document.querySelectorAll('#d-filesall-list .pj-dir')].map((b) => b.dataset.dir),
    files: [...document.querySelectorAll('#d-filesall-list .pj-doc:not(.pj-dir)')].map((b) => b.dataset.doc),
  }));
  const docsRows = (page) => page.evaluate(() => [...document.querySelectorAll('#docs-list .pj-doc')].map((b) => b.dataset.doc));
  const options = (page, id) => page.evaluate((i) => [...document.querySelectorAll('#' + i + ' option')].map((o) => [o.value, o.textContent.trim()]), id);
  const settle = async (page, read, want) => {
    for (let i = 0; i < 40; i += 1) { if (same(await read(), want)) return; await page.waitForTimeout(100); }
  };

  const boot = async (page) => {
    await page.goto(URL + '/', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof paintAgentFilesAll === 'function' && typeof openDocsView === 'function');
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
  };
  const openAgentFiles = async (page) => {
    await page.waitForSelector('[data-agent="ava"]', { timeout: 8000 });
    await page.click('[data-agent="ava"]');
    await page.waitForSelector('#panel-detail:not([hidden])');
    if (page.viewportSize().width <= 640) {
      await page.click('#d-nav button[data-go="profile"]');
      await page.waitForSelector('#d-sec-profile:not([hidden])');
    }
    await page.waitForSelector('#d-files-all:not([hidden])', { timeout: 8000 });
    await page.click('#d-files-all');
    await page.waitForFunction(() => document.querySelectorAll('#d-filesall-list .pj-doc:not(.pj-dir)').length === 6, null, { timeout: 8000 });
  };
  const openProjectFiles = async (page, pid, rowsWanted = 7) => {
    // Through the board's own doors: the Projects tab (behind the menu on a phone), then the project's row.
    if (await page.isVisible('#burger')) {
      await page.click('#burger');
      await page.waitForSelector('[data-tab="projects"]', { state: 'visible', timeout: 5000 });
    }
    await page.click('[data-tab="projects"]');
    await page.waitForSelector('#panel-projects', { state: 'visible', timeout: 5000 });
    await page.click(`#pj-list .pj-row[data-project="${pid}"]`);
    if (rowsWanted === 0) {
      // An empty folder has no View All link, so the Files screen is opened by the function that link calls.
      await page.waitForFunction((id) => PJ_CURRENT === id, pid, { timeout: 8000 });
      await page.evaluate(() => openDocsView());
      await page.waitForFunction(() => /Nothing here yet/.test(document.getElementById('docs-msg').textContent), null, { timeout: 8000 });
      return;
    }
    await page.waitForSelector('#pj-docs-all:not([hidden])', { timeout: 8000 });
    await page.click('#pj-docs-all');
    await page.waitForFunction((n) => document.querySelectorAll('#docs-list .pj-doc').length === n, rowsWanted, { timeout: 8000 }).catch(async (e) => {
      // Say what the screen showed instead, so a red here names its cause.
      console.log('project Files screen: ' + JSON.stringify(await page.evaluate(() => ({ view: !document.getElementById('pj-docs-view').hidden,
        msg: document.getElementById('docs-msg').textContent, rows: [...document.querySelectorAll('#docs-list .pj-doc')].map((b) => b.dataset.doc) }))));
      throw e;
    });
  };

  try {
    for (const engineName of ['chromium', 'webkit']) {
      const E = `[${engineName}]`;
      const browser = await playwright[engineName].launch({ headless: process.env.HEADED === '0' });
      try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(e.message));
        await boot(page);

        /* The agent's Files screen. */
        await openAgentFiles(page);
        const short = await page.evaluate(() => [...document.querySelectorAll('#d-files-list .pj-doc')].map((b) => b.dataset.doc));
        chk(short[0] === JUST && same([...short].sort(), [...ALL].sort()), `${E} the agent card's short Files list is newest first`, JSON.stringify(short));
        chk(same(await options(page, 'd-files-sort'), OPTIONS), `${E} the agent Files screen offers exactly the four orders`, JSON.stringify(await options(page, 'd-files-sort')));
        chk(await page.$eval('#d-files-sort', (s) => s.value) === 'newest', `${E} a fresh browser has Newest first chosen on the agent Files screen`);
        let rows = await agentRows(page);
        chk(rows.files[0] === JUST && same(rows.files, EXPECT.newest), `${E} by default the file saved a minute ago is the top file on the agent Files screen`, JSON.stringify(rows));
        if (SHOTS && engineName === 'chromium') await page.screenshot({ path: path.join(SHOTS, '8627-agent-files-newest.png') });
        // The control: the server's own order (what this screen showed before #8627), from the same route.
        const served = await page.evaluate(async () => {
          const b = await (await fetch('/api/agent/ava/files/browse?dir=', { cache: 'no-store' })).json();
          return { dirs: b.dirs.map((d) => d.name), files: b.files.map((f) => f.name) };
        });
        chk(same(served.files, AZ), `${E} CONTROL: the server lists the files A to Z, as the screen did before`, JSON.stringify(served));
        for (const [mode] of OPTIONS) {
          await page.selectOption('#d-files-sort', mode);
          await settle(page, async () => (await agentRows(page)).files, EXPECT[mode]);
          rows = await agentRows(page);
          chk(same(rows.files, EXPECT[mode]) && same(rows.dirs, DIR_EXPECT[mode]), `${E} agent Files, ${mode}: folders first, then files, each in that order`, JSON.stringify(rows));
          if (mode === 'az') chk(same(rows.files, served.files) && same(rows.dirs, served.dirs), `${E} agent Files, A to Z is exactly the server's order`, JSON.stringify({ rows, served }));
        }
        // A change of order re-sorts the rows on screen and reads nothing, so a failing read cannot empty the list.
        const browses = [];
        const onReq = (r) => { if (r.url().includes('/files/browse')) browses.push(r.url()); };
        page.on('request', onReq);
        await page.route('**/files/browse**', (r) => r.abort());
        // A sentence a row click left on the status line: a change of order must not rewrite it (or say it again).
        await page.$eval('#d-filesall-msg', (m) => { m.textContent = 'A sentence already on the status line.'; });
        await page.selectOption('#d-files-sort', 'oldest');
        await settle(page, async () => (await agentRows(page)).files, EXPECT.oldest);
        const kept = await agentRows(page);
        const said = await page.$eval('#d-filesall-msg', (m) => m.textContent);
        chk(same(kept.files, EXPECT.oldest) && same(kept.dirs, DIR_EXPECT.oldest) && browses.length === 0,
          `${E} a change of order re-sorts the rows on screen with no read (the read is failing, and the list stays)`, JSON.stringify({ kept, browses }));
        chk(said === 'A sentence already on the status line.', `${E} a change of order leaves the status line as it was`, JSON.stringify(said));
        await page.$eval('#d-filesall-msg', (m) => { m.textContent = ''; });
        await page.unroute('**/files/browse**');
        page.off('request', onReq);

        /* The project's Files screen: its own choice, untouched by the agent screen's. */
        await openProjectFiles(page, project.id);
        chk(same(await options(page, 'docs-sort'), OPTIONS), `${E} the project Files screen offers exactly the four orders`, JSON.stringify(await options(page, 'docs-sort')));
        chk(await page.$eval('#docs-sort', (s) => s.value) === 'newest', `${E} the project Files screen keeps its own choice (Newest first), not the agent screen's`);
        let docs = await docsRows(page);
        chk(docs[0] === JUST && same(docs, P_EXPECT.newest), `${E} by default the file saved a minute ago is the top file on the project Files screen`, JSON.stringify(docs));
        if (SHOTS && engineName === 'chromium') await page.screenshot({ path: path.join(SHOTS, '8627-project-files-newest.png') });
        const pserved = await page.evaluate(async (id) => (await (await fetch('/api/project/' + encodeURIComponent(id) + '/documents?limit=500', { cache: 'no-store' })).json()).files.map((f) => f.name), project.id);
        for (const [mode] of OPTIONS) {
          await page.selectOption('#docs-sort', mode);
          await settle(page, () => docsRows(page), P_EXPECT[mode]);
          docs = await docsRows(page);
          chk(same(docs, P_EXPECT[mode]), `${E} project Files, ${mode}`, JSON.stringify(docs));
        }
        // The project route sends newest first, so the old screen showed NEWEST; the control is that order, by the server.
        chk(same(pserved, P_EXPECT.newest), `${E} CONTROL: the project route lists newest first, the order its screen showed before`, JSON.stringify(pserved));
        // The row goes with the folder's other parts on the conversation segment (the page's own switch), and comes back.
        const rowShown = () => page.evaluate(() => { const r = document.getElementById('docs-sortrow'); return !!(r && r.getClientRects().length && getComputedStyle(r).display !== 'none'); });
        chk(await rowShown(), `${E} CONTROL: the project sort row is on screen on the folder segment`);
        await page.evaluate(() => docsSegShow('convo'));
        chk(!(await rowShown()), `${E} the project sort row is hidden on the conversation segment`);
        await page.evaluate(() => docsSegShow('folder'));
        chk(await rowShown(), `${E} the project sort row is back on the folder segment`);
        await page.selectOption('#docs-sort', 'za');

        /* Remembered per screen across a reload. */
        await boot(page);
        await openAgentFiles(page);
        chk(await page.$eval('#d-files-sort', (s) => s.value) === 'oldest' && same((await agentRows(page)).files, EXPECT.oldest), `${E} after a reload the agent Files screen is still Oldest first`, JSON.stringify(await agentRows(page)));
        await openProjectFiles(page, project.id);
        chk(await page.$eval('#docs-sort', (s) => s.value) === 'za' && same(await docsRows(page), P_EXPECT.za), `${E} after a reload the project Files screen is still Z to A`, JSON.stringify(await docsRows(page)));
        // Another project, empty: the row the last project showed is not carried over, and an empty folder has none.
        await openProjectFiles(page, emptyProject.id, 0);
        const empty = await page.evaluate(() => ({ rows: document.querySelectorAll('#docs-list .pj-doc').length,
          row: (() => { const r = document.getElementById('docs-sortrow'); return !!(r && r.getClientRects().length); })() }));
        chk(empty.rows === 0 && !empty.row, `${E} an empty project, opened after one with files, shows no sort row and no rows`, JSON.stringify(empty));
        chk(errs.length === 0, `${E} no page errors`, JSON.stringify(errs));
        await ctx.close();

        /* A browser that refuses storage: the default stands and a choice still sorts. */
        const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
        await ctx2.addInitScript(() => {
          const no = () => { throw new Error('storage refused'); };
          try { Object.defineProperty(window, 'localStorage', { configurable: true, get: () => ({ getItem: no, setItem: no, removeItem: no, clear: no, key: no, length: 0 }) }); } catch { /* left as it is */ }
        });
        const p2 = await ctx2.newPage();
        const errs2 = [];
        p2.on('pageerror', (e) => errs2.push(e.message));
        await boot(p2);
        const refused = await p2.evaluate(() => { try { localStorage.getItem('x'); return false; } catch { return true; } });
        chk(refused, `${E} CONTROL: storage really refuses in this browser`);
        await openAgentFiles(p2);
        chk(same((await agentRows(p2)).files, EXPECT.newest), `${E} with storage refused, the agent Files screen is Newest first`, JSON.stringify(await agentRows(p2)));
        await p2.selectOption('#d-files-sort', 'az');
        await settle(p2, async () => (await agentRows(p2)).files, EXPECT.az);
        chk(same((await agentRows(p2)).files, EXPECT.az), `${E} with storage refused, choosing A to Z still sorts`, JSON.stringify(await agentRows(p2)));
        chk(errs2.length === 0, `${E} with storage refused, no page errors`, JSON.stringify(errs2));
        await ctx2.close();

        /* A phone: the control is a full touch target and nothing scrolls sideways. */
        const ctx3 = await browser.newContext({ viewport: { width: 412, height: 900 }, hasTouch: true, serviceWorkers: 'block' });
        const p3 = await ctx3.newPage();
        await boot(p3);
        await openAgentFiles(p3);
        const geo = await p3.evaluate(() => {
          const r = document.getElementById('d-files-sort').getBoundingClientRect();
          return { h: Math.round(r.height), right: Math.round(r.right), vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth };
        });
        chk(geo.h >= 44 && geo.right <= geo.vw && geo.sw <= geo.vw, `${E} 412px: the agent Files sort is at least 44px tall, on screen, and the page does not scroll sideways`, JSON.stringify(geo));
        if (SHOTS && engineName === 'chromium') await p3.screenshot({ path: path.join(SHOTS, '8627-agent-files-412.png') });
        await openProjectFiles(p3, project.id);
        const geo2 = await p3.evaluate(() => {
          const r = document.getElementById('docs-sort').getBoundingClientRect();
          return { h: Math.round(r.height), right: Math.round(r.right), vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth };
        });
        chk(geo2.h >= 44 && geo2.right <= geo2.vw && geo2.sw <= geo2.vw, `${E} 412px: the project Files sort is at least 44px tall, on screen, and the page does not scroll sideways`, JSON.stringify(geo2));
        if (SHOTS && engineName === 'chromium') await p3.screenshot({ path: path.join(SHOTS, '8627-project-files-412.png') });
        await ctx3.close();
      } finally {
        await browser.close();
      }
    }
  } finally {
    server.close();
    projects.setRevealPlatform(null);
    for (const d of SANDBOXES) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  console.log(fail.length ? `\nFAIL: ${fail.length}` : '\nAll checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
