'use strict';

/**
 * Over Kosmos+ a file click downloads to the device you are on (#5165). A Kosmos+ user on a Windows laptop clicked a
 * .pptx an agent made in a project's Files list, and Kosmos tried to open it on the HOST computer, where nobody was.
 * The real web/index.html is served with every /api call answered by a stub (no board runs). File rows are put in
 * the page's real lists and clicked, so the page's own delegated handlers answer:
 *   R1  over Kosmos+ (the page reached as kosmos-remote.test) a click on a file in the project rail, the project's
 *       Documents view, a cited file in the project thread, and an agent's Files list each fetches that file's
 *       DOWNLOAD route with its name (GET), and none asks the board to open it (no POST .../open-file, .../files/open);
 *   R2  over Kosmos+ every button that would open a folder window on the board's computer (the project's folder from
 *       Documents and from project settings, an agent's Files folder, the conversations folders, the Kosmos folder
 *       from Settings and from the update offer) asks the board for nothing and says the folder is on the computer
 *       Kosmos runs on;
 *   L1  CONTROL at the computer (127.0.0.1): the same project-rail and agent-file clicks still POST open and fetch no
 *       download, and the Documents folder button still asks the board to reveal it. This is the arm that keeps R1
 *       and R2 from passing on a page that simply stopped answering clicks.
 *   W   every arm above again with the page served as a WINDOWS board serves it (the platform marker filled with
 *       win32, so the page speaks of File Explorer): the user who found this was on Windows (Josh, 12:48), and the
 *       rule must not depend on the board's platform.
 * Against web/index.html from before #5165, R1 and R2 FAIL (the click POSTs open-file from kosmos-remote.test):
 *   FILEGET_HTML=/path/to/old/index.html node docs/browser-checks/render-remote-file-download-5165.js
 * Needs no URL. ENGINES=chromium,webkit adds WebKit, the Mac app's engine.
 *
 *   ENGINES=chromium,webkit HEADED=0 NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-remote-file-download-5165.js
 */
const fs = require('node:fs');
const path = require('node:path');
const pw = require('playwright');

const ALL_ENGINES = ['chromium', 'webkit'];
const ASKED = (process.env.ENGINES || 'chromium').split(',').map((s) => s.trim()).filter(Boolean);
const ENGINES = ASKED.filter((e) => ALL_ENGINES.includes(e));
if (!ENGINES.length || ENGINES.length !== ASKED.length) {
  console.log('FAIL  render-remote-file-download-5165: ENGINES names an unknown engine (' + (process.env.ENGINES || '') + '); known: ' + ALL_ENGINES.join(', '));
  process.exit(1);
}

const HTML = fs.readFileSync(process.env.FILEGET_HTML || path.join(__dirname, '..', '..', 'web', 'index.html'), 'utf8');
const PROJECT = 'p5165';
const AGENT = 'ana';
const DECK = 'out/Q3 deck.pptx';
const FOLDER_SENTENCE = 'That folder is on the computer Kosmos runs on, not on this device, so it opens only there.';

const PLATFORM_MARKER = '__KOSMOS_PLATFORM__';   // server.js PAGE_PLATFORM_MARKER: the board fills it in
if (!HTML.includes(PLATFORM_MARKER)) {
  console.log('FAIL  render-remote-file-download-5165: the page no longer carries ' + PLATFORM_MARKER + ', so the Windows arm cannot serve it as Windows');
  process.exit(1);
}

async function openPage(engine, origin, platform) {
  const page = HTML.split(PLATFORM_MARKER).join(platform);
  const browser = await pw[engine].launch({ headless: process.env.HEADED === '0' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const pg = await ctx.newPage();
  const asked = [];   // every /api request the clicks made: "METHOD path?query"
  const errors = [];
  pg.on('pageerror', (e) => errors.push(String(e && e.message)));
  await pg.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname === '/' || u.pathname === '/index.html') return route.fulfill({ status: 200, contentType: 'text/html', body: page });
    if (/\/download$/.test(u.pathname)) {
      asked.push(req.method() + ' ' + u.pathname + u.search);
      return route.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="f.bin"' }, body: 'PK' });
    }
    if (/\/(open-file|files\/open|reveal|reveal-folder|reveal-app)$/.test(u.pathname)) {
      asked.push(req.method() + ' ' + u.pathname);
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await pg.goto(origin + '/', { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof kplusRemote === 'function' && typeof pjById === 'function');
  const served = await pg.evaluate(() => (typeof onWindows === 'function' && onWindows()) ? 'win32' : 'other');
  if (served !== (platform === 'win32' ? 'win32' : 'other')) throw new Error('the page served as ' + platform + ' reads its platform as ' + served);
  await pg.evaluate(({ PROJECT, AGENT }) => {
    /* The page's own state, as if this project and this agent were open. */
    PROJECTS = [{ id: PROJECT, name: 'Deck room', folder: '/Users/someone/Kosmos/Deck room', agents: [] }];
    PJ_CURRENT = PROJECT;
    CURRENT = { sessionName: AGENT };
  }, { PROJECT, AGENT });
  return { browser, pg, asked, errors };
}

/* A file row in one of the page's real lists, clicked: the delegated handler on the list answers. */
async function clickRow(pg, listId, name, cls) {
  const before = await pg.evaluate(({ listId, name, cls }) => {
    const list = document.getElementById(listId);
    if (!list) return 'no #' + listId;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    if (cls === 'refgo') b.dataset.ref = name; else b.dataset.doc = name;
    b.textContent = name;
    b.setAttribute('data-fileget-test', '');
    list.appendChild(b);
    b.click();
    return '';
  }, { listId, name, cls });
  await pg.waitForTimeout(400);
  await pg.evaluate(() => document.querySelectorAll('[data-fileget-test]').forEach((n) => n.remove()));
  return before;
}

async function clickButton(pg, id, msgId) {
  const res = await pg.evaluate(({ id, msgId }) => {
    const b = document.getElementById(id);
    if (!b) return { missing: true };
    b.click();
    return { missing: false };
  }, { id, msgId });
  await pg.waitForTimeout(400);
  const said = await pg.evaluate((msgId) => { const m = document.getElementById(msgId); return m ? m.textContent : null; }, msgId);
  return { ...res, said };
}

async function runRemote(engine, platform, say) {
  const { browser, pg, asked, errors } = await openPage(engine, 'http://kosmos-remote.test', platform);
  engine = engine + ' (' + platform + ' board)';
  try {
    say(await pg.evaluate(() => kplusRemote()) === true, engine + ' R0: the page reached as kosmos-remote.test counts as Kosmos+');
    const rows = [
      ['project rail', 'pj-docs', DECK, 'pj-doc', 'GET /api/project/' + PROJECT + '/download?name=' + encodeURIComponent(DECK)],
      ['Documents view', 'docs-list', DECK, 'pj-doc', 'GET /api/project/' + PROJECT + '/download?name=' + encodeURIComponent(DECK)],
      ['a cited file in the thread', 'pj-room', DECK, 'refgo', 'GET /api/project/' + PROJECT + '/download?name=' + encodeURIComponent(DECK)],
      ['an agent’s Files', 'd-files-list', 'report.pptx', 'pj-doc', 'GET /api/agent/' + AGENT + '/files/download?name=report.pptx'],
    ];
    for (const [where, listId, name, cls, want] of rows) {
      asked.length = 0;
      const missing = await clickRow(pg, listId, name, cls);
      const opened = asked.filter((a) => /^POST .*(open-file|files\/open)$/.test(a));
      say(!missing && asked.includes(want) && opened.length === 0,
        engine + ' R1: over Kosmos+ a click on a file in ' + where + ' downloads it and asks the board to open nothing',
        missing || JSON.stringify(asked));
    }
    const buttons = [
      ['the project folder from Documents', 'docs-finder', 'docs-msg'],
      ['the project folder from project settings', 'pjs-reveal', 'pjs-reveal-msg'],
      ['an agent’s Files folder', 'd-files-finder', 'd-filesall-msg'],
      ['the project conversations folder', 'pjs-chats-reveal', 'pjs-chats-msg'],
      ['the task conversations folder', 'tk-chats-reveal', 'tk-chats-msg'],
      ['the Kosmos folder from Settings', 'set-reveal', 'set-reveal-msg'],
      ['the Kosmos folder from the update offer', 'upd-open-folder', 'upd-open-folder-msg'],
    ];
    for (const [what, id, msgId] of buttons) {
      asked.length = 0;
      const r = await clickButton(pg, id, msgId);
      say(!r.missing && asked.length === 0 && r.said === FOLDER_SENTENCE,
        engine + ' R2: over Kosmos+ the button for ' + what + ' asks the board for nothing and says where the folder is',
        r.missing ? 'no #' + id : JSON.stringify({ asked, said: r.said }));
    }
    say(errors.length === 0, engine + ' R: no page errors', errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }
}

async function runLocal(engine, platform, say) {
  const { browser, pg, asked, errors } = await openPage(engine, 'http://127.0.0.1:59965', platform);
  engine = engine + ' (' + platform + ' board)';
  try {
    say(await pg.evaluate(() => kplusRemote()) === false, engine + ' L0: the page at 127.0.0.1 is at the computer');
    for (const [where, listId, name, want] of [
      ['project rail', 'pj-docs', DECK, 'POST /api/project/' + PROJECT + '/open-file'],
      ['an agent’s Files', 'd-files-list', 'report.pptx', 'POST /api/agent/' + AGENT + '/files/open'],
    ]) {
      asked.length = 0;
      const missing = await clickRow(pg, listId, name, 'pj-doc');
      say(!missing && asked.includes(want) && !asked.some((a) => /download/.test(a)),
        engine + ' L1: CONTROL at the computer a click on a file in ' + where + ' still opens it here and downloads nothing',
        missing || JSON.stringify(asked));
    }
    asked.length = 0;
    const r = await clickButton(pg, 'docs-finder', 'docs-msg');
    say(!r.missing && asked.includes('POST /api/project/' + PROJECT + '/reveal-folder') && r.said !== FOLDER_SENTENCE,
      engine + ' L1: CONTROL at the computer the Documents folder button still asks the board to show the folder',
      JSON.stringify({ asked, said: r.said }));
    say(errors.length === 0, engine + ' L: no page errors', errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }
}

(async () => {
  const fails = [];
  const say = (ok, l, x) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (x ? '  ' + x : '')); if (!ok) fails.push(l); };
  for (const engine of ENGINES) {
    try {
      for (const platform of ['darwin', 'win32']) {
        await runRemote(engine, platform, say);
        await runLocal(engine, platform, say);
      }
    } catch (e) {
      say(false, engine + ': ran to the end', String(e && e.message).split('\n')[0]);
    }
  }
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'all good');
  process.exit(fails.length ? 1 : 0);
})();
